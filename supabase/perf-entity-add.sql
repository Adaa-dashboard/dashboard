-- ============================================================
--  إضافة جهة من «محفظتي» — ينعكس في السجلّ المركزي
--  ------------------------------------------------------------
--  الاستشاري أقرب الناس إلى جهاته، فإن استجدّت جهة أضافها من
--  محفظته ولا ينتظر أحداً. وتُسجَّل باسمه، فيصل خبرُها صاحبَ
--  صلاحية «الجهات» في «آخر التحديثات» ويراجعها.
--
--  ما لا يملكه كما كان: تعديل اسم جهة قائمة، ولا نقل إسنادها،
--  ولا حذفها — تلك تبقى بصلاحية «entities:edit».
--
--  idempotent وليس فيه حذف بيانات. يُشغَّل بعد perf-entities-own.sql
-- ============================================================

alter table public.perf_entities
  add column if not exists added_by bigint references public.perf_users(id) on delete set null;
alter table public.perf_entities
  add column if not exists added_by_name text not null default '';

/* الإضافة كلها في دالة واحدة: الجهة ونقطة تواصلها عندنا ونقطتها
   لديها. ولولا ذلك لاحتاج الأمر سياسةً تسمح بإدراج جهةٍ لمن لا
   يملك «entities:edit»، ثم أخرى تسمح بإسناد نفسه إليها — وبينهما
   لحظةٌ تكون فيها الجهة بلا صاحب. */
drop function if exists public.perf_entity_add(text, text, text, text, text, text, text);
create or replace function public.perf_entity_add(
  p_name        text,
  p_kind        text default '',
  p_sector      text default '',
  p_note        text default '',
  p_their_name  text default '',
  p_their_phone text default '',
  p_their_email text default ''
) returns table (ent_id text, existed boolean, owner text)
language plpgsql security definer set search_path = public as $$
declare
  v_me    bigint := public.perf_my_id();
  v_name  text   := btrim(coalesce(p_name, ''));
  v_disp  text;
  v_id    text;
  v_exist boolean := false;
  v_owner text := '';
begin
  if v_me is null then raise exception 'غير مصرّح'; end if;
  if v_name = '' then raise exception 'اسم الجهة مطلوب'; end if;
  select u.display_name into v_disp from public.perf_users u where u.id = v_me;

  select e.id into v_id from public.perf_entities e
   where e.name_n = public.perf_ar_norm(v_name) limit 1;

  if v_id is null then
    v_id := 'ent-' || replace(gen_random_uuid()::text, '-', '');
    insert into public.perf_entities (id, name, kind, sector, note, active, added_by, added_by_name)
    values (v_id, v_name, coalesce(p_kind, ''), coalesce(p_sector, ''), coalesce(p_note, ''),
            true, v_me, coalesce(v_disp, ''));
  else
    v_exist := true;
    update public.perf_entities e set active = true where e.id = v_id and not e.active;
  end if;

  -- نقطة التواصل عندنا: أنا، ما لم تكن الجهة مسندةً لغيري
  select c.name into v_owner from public.perf_contacts c
   where c.entity_id = v_id and c.side = 'نحن' and c.role = 'أساسي' limit 1;
  if v_owner is null then
    insert into public.perf_contacts (id, entity_id, side, role, name, user_id)
    values ('con-' || replace(gen_random_uuid()::text, '-', ''), v_id, 'نحن', 'أساسي',
            coalesce(v_disp, ''), v_me);
    v_owner := coalesce(v_disp, '');
  end if;

  -- نقطة التواصل من الجهة إن أُعطيت ولم تكن مسجّلة
  if coalesce(btrim(p_their_name), '') <> ''
     or coalesce(btrim(p_their_phone), '') <> ''
     or coalesce(btrim(p_their_email), '') <> '' then
    if not exists (select 1 from public.perf_contacts c
                    where c.entity_id = v_id and c.side = 'الجهة' and c.role = 'أساسي') then
      insert into public.perf_contacts (id, entity_id, side, role, name, phone, email)
      values ('con-' || replace(gen_random_uuid()::text, '-', ''), v_id, 'الجهة', 'أساسي',
              coalesce(btrim(p_their_name), ''), coalesce(btrim(p_their_phone), ''),
              coalesce(btrim(p_their_email), ''));
    end if;
  end if;

  return query select v_id, v_exist, v_owner;
end;
$$;
revoke all on function public.perf_entity_add(text, text, text, text, text, text, text) from public, anon;
grant execute on function public.perf_entity_add(text, text, text, text, text, text, text) to authenticated;

-- «جهاتي» تُرجع مَن أضاف الجهة كذلك، فيُعرف الجديد من المرحَّل
drop function if exists public.perf_my_entities();
create or replace function public.perf_my_entities()
returns table (entity_id text, name text, kind text, sector text,
               my_contact_id text, my_role text, mine jsonb, theirs jsonb, added_by_name text)
language sql stable security definer set search_path = public as $$
  select e.id, e.name, e.kind, e.sector, c.id,
         coalesce(nullif(c.note,''), c.job_title),
         coalesce((select jsonb_agg(jsonb_build_object(
                     'id', x.id, 'role', x.role, 'name', x.name, 'jobTitle', x.job_title,
                     'email', x.email, 'phone', x.phone)
                   order by (x.role <> 'أساسي'), x.name)
                     from public.perf_contacts x
                    where x.entity_id = e.id and x.side = 'نحن'), '[]'::jsonb),
         coalesce((select jsonb_agg(jsonb_build_object(
                     'id', x.id, 'role', x.role, 'name', x.name, 'jobTitle', x.job_title,
                     'email', x.email, 'phone', x.phone)
                   order by (x.role <> 'أساسي'), x.name)
                     from public.perf_contacts x
                    where x.entity_id = e.id and x.side <> 'نحن'), '[]'::jsonb),
         e.added_by_name
    from public.perf_contacts c
    join public.perf_entities e on e.id = c.entity_id and e.active
   where c.side = 'نحن' and c.user_id = public.perf_my_id()
   order by e.name;
$$;
revoke all on function public.perf_my_entities() from public, anon;
grant execute on function public.perf_my_entities() to authenticated;

select 'perf_entity_add' as "الدالة", 'جاهزة' as "الحالة";
