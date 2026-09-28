-- ============================================================
--  تشغيلٌ واحد لكل ما تراكم — سبتمبر ٢٠٢٦
--  ------------------------------------------------------------
--  يجمع خمسة ملفات بالترتيب الذي يجب أن تُشغَّل به:
--
--    ١) حالة «معلقة» للمهام والتكاليف
--    ٢) إضافة جهة من «محفظتي» إلى السجلّ المركزي
--    ٣) الأسماء البديلة للجهات (ملف منصة الرؤية)
--    ٤) صورة الموظف
--    ٥) التفعيل: رسالةٌ تقول السبب حين لا جوال مسجَّل
--    ٦) صلاحيات ترتيب القائمة
--    ٧) سجل النشاط: تعديلات الحسابات والجهات والوثائق
--
--  الترتيب مقصود:
--    · «إضافة جهة» قبل «سجل النشاط» لأن السجل يقرأ `added_by_name`
--      الذي يُنشئه الأول.
--    · «صلاحيات القائمة» قبل «سجل النشاط» كذلك، وإلا سجّل الـ trigger
--      سطراً لكل حساب تغيّرت صلاحياته في هذا الملف نفسه.
--
--  لا يحذف بياناً ولا يمسّ مدخلاً: جداولُ وأعمدةٌ ودوالُّ وصلاحيات.
--  آمن التكرار — يمكن تشغيله أكثر من مرة بلا ضرر.
--  شغّليه كاملاً دفعةً واحدة في SQL Editor.
-- ============================================================


-- ══════════════════════════════════════════════════════════
--  ١) حالة «معلقة» للمهام والتكاليف
-- ══════════════════════════════════════════════════════════
-- يُزال أي قيد تحقُّق على الحالة مهما كان اسمه — الاسم التلقائي قد
-- يختلف بين قاعدة وأخرى، فالاعتماد عليه وحده يترك القيد القديم قائماً
do $$
declare c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.perf_tasks'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%state%'
      and pg_get_constraintdef(oid) ilike '%risk%'
  loop
    execute format('alter table public.perf_tasks drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.perf_tasks
  add constraint perf_tasks_state_check
  check (state in ('ok', 'risk', 'hold', 'done'));

-- تحقّق: يجب أن تظهر الحالات الأربع في تعريف القيد
select pg_get_constraintdef(oid) as state_check
from pg_constraint
where conrelid = 'public.perf_tasks'::regclass
  and conname = 'perf_tasks_state_check';


-- ══════════════════════════════════════════════════════════
--  ٢) إضافة جهة من «محفظتي» إلى السجلّ المركزي
-- ══════════════════════════════════════════════════════════
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


-- ══════════════════════════════════════════════════════════
--  ٣) الأسماء البديلة للجهات
-- ══════════════════════════════════════════════════════════
alter table public.perf_entities
  add column if not exists aliases text[] not null default '{}';

/* الإضافة لمن يحرّر الجهات أو لمن يرفع ملف الطلبات — فهو أعرف
   الناس بصيغ الأسماء في الملف. والاسم يُحفظ كما ورد، والمطابقة
   تتم بعد التطبيع في الواجهة. */
create or replace function public.perf_entity_alias(p_entity text, p_alias text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_alias text := btrim(coalesce(p_alias, ''));
begin
  if not (public.perf_has_scope('entities:edit') or public.perf_has_scope('changes:upload')) then
    raise exception 'الأسماء البديلة لمن يحرّر الجهات أو يرفع ملف الطلبات';
  end if;
  if v_alias = '' then raise exception 'الاسم البديل مطلوب'; end if;
  update public.perf_entities e
     set aliases = (select array(select distinct unnest(coalesce(e.aliases, '{}') || array[v_alias])))
   where e.id = p_entity;
  return found;
end;
$$;
revoke all on function public.perf_entity_alias(text, text) from public, anon;
grant execute on function public.perf_entity_alias(text, text) to authenticated;

select 'aliases' as "العمود", 'جاهز' as "الحالة";


-- ══════════════════════════════════════════════════════════
--  ٤) صورة الموظف
-- ══════════════════════════════════════════════════════════
alter table public.perf_users
  add column if not exists photo_url text not null default '';

-- قائمة الأسماء تُرجع الصورة كذلك
drop function if exists public.perf_people();
create or replace function public.perf_people()
returns table (id text, name text, role text, sector_ids text[],
               active boolean, is_lead boolean, job_title text, photo_url text)
language plpgsql security definer set search_path = public as $$
begin
  if not public.perf_signed_in() then raise exception 'forbidden'; end if;
  return query select u.id::text, u.display_name, u.role, u.sector_ids,
                      u.active, u.is_lead, u.job_title, u.photo_url
                 from public.perf_users u
                where u.active
                order by u.is_lead desc, u.display_name;
end;
$$;
revoke all on function public.perf_people() from public, anon;
grant execute on function public.perf_people() to authenticated;

/* تعيين الصورة: لنفسه دائماً، ولغيره بصلاحية «المستخدمون» —
   الحارس في القاعدة لا في الواجهة */
create or replace function public.perf_set_photo(p_id bigint, p_url text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_me bigint := public.perf_my_id();
begin
  if v_me is null then raise exception 'غير مصرّح'; end if;
  if p_id is distinct from v_me and not public.perf_has_scope('users') then
    raise exception 'الصورة يغيّرها صاحبها أو صاحب صلاحية «المستخدمون»';
  end if;
  update public.perf_users set photo_url = coalesce(btrim(p_url), '')
   where id = coalesce(p_id, v_me);
  return true;
end;
$$;
revoke all on function public.perf_set_photo(bigint, text) from public, anon;
grant execute on function public.perf_set_photo(bigint, text) to authenticated;

/* الصور تُرفع إلى مجلد avatars/ داخل سلّة الوثائق — القراءة عامة
   كما هي، والكتابة لكل مسجَّل في هذا المجلد وحده */
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    execute $p$drop policy if exists "perf_avatars_insert" on storage.objects$p$;
    execute $p$create policy "perf_avatars_insert" on storage.objects
      for insert to authenticated
      with check (bucket_id = 'docs' and name like 'avatars/%' and public.perf_signed_in())$p$;
    execute $p$drop policy if exists "perf_avatars_update" on storage.objects$p$;
    execute $p$create policy "perf_avatars_update" on storage.objects
      for update to authenticated
      using (bucket_id = 'docs' and name like 'avatars/%' and public.perf_signed_in())
      with check (bucket_id = 'docs' and name like 'avatars/%' and public.perf_signed_in())$p$;
  end if;
end $$;

select 'photo_url' as "العمود", 'جاهز' as "الحالة";


-- ══════════════════════════════════════════════════════════
--  ٥) التفعيل: رسالةٌ تقول السبب حين لا جوال مسجَّل
--     (ومعها ختم وقت التفعيل الذي تقرؤه صفحة سجل النشاط)
-- ══════════════════════════════════════════════════════════
create or replace function public.perf_activate(
  p_username text, p_phone text, p_last4 text, p_password text, p_sectors text[]
) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare u record; v_first boolean; v_ok boolean; v_phone text;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if length(coalesce(p_password,'')) < 6 then return jsonb_build_object('error','short'); end if;

  select * into u from public.perf_users
   where username = public.perf_norm_user(p_username) and active;
  if not found then return null; end if;

  v_first := (u.pass_hash is null or u.pass_hash = '');
  v_phone := public.perf_norm_phone(p_phone);

  if v_first and coalesce(u.phone,'') = '' then
    -- لا جوال مسجَّل: يكتبه صاحب الحساب الآن، بشرط ألّا يكون لغيره
    if length(v_phone) < 12 then return jsonb_build_object('error','phone'); end if;
    if exists (select 1 from public.perf_users x where x.phone = v_phone and x.id <> u.id) then
      return jsonb_build_object('error','phone_taken');
    end if;
    v_ok := true;
  elsif not v_first and coalesce(u.phone,'') = '' then
    -- له كلمة مرور ولا جوال: الاستعادة متعذّرة، فتُقال كما هي
    return jsonb_build_object('error','no_phone');
  else
    v_ok := case when v_first
              then v_phone = u.phone
              else length(coalesce(p_last4,'')) = 4 and right(u.phone, 4) = p_last4
            end;
  end if;
  if not v_ok then return null; end if;

  update public.perf_users
     set pass_hash = crypt(p_password, gen_salt('bf')),
         phone = case when v_first and coalesce(phone,'') = '' then v_phone else phone end,
         -- ختم وقت التفعيل — صفحة سجل النشاط تقرؤه، ونسخةٌ سابقة أسقطته
         activated_at = case when v_first then now() else activated_at end,
         sector_ids = case
           when v_first and u.role = 'manager'
                and coalesce(array_length(sector_ids,1),0) = 0
                and coalesce(array_length(p_sectors,1),0) > 0
             then p_sectors else sector_ids end,
         last_login = now()
   where id = u.id
   returning * into u;

  insert into public.perf_sessions (user_id, app_user_id, username, display_name, role, sector_ids)
  values (auth.uid(), u.id, u.username, u.display_name, u.role, u.sector_ids)
  on conflict (user_id) do update
    set app_user_id = excluded.app_user_id, username = excluded.username,
        display_name = excluded.display_name, role = excluded.role,
        sector_ids = excluded.sector_ids, granted_at = now();

  return jsonb_build_object('id', u.id::text, 'username', u.username,
    'name', u.display_name, 'role', u.role, 'sectorIds', u.sector_ids);
end;
$$;
revoke all on function public.perf_activate(text,text,text,text,text[]) from public, anon;
grant execute on function public.perf_activate(text,text,text,text,text[]) to authenticated;

-- من تتعذّر عليه الاستعادة اليوم: له كلمة مرور ولا جوال مسجَّل
select display_name as "الاسم", username as "اسم الدخول",
       case when coalesce(phone,'') = '' then '— لا جوال —' else phone end as "الجوال"
  from public.perf_users
 where active and coalesce(phone,'') = ''
   and pass_hash is not null and pass_hash <> ''
 order by display_name;


-- ══════════════════════════════════════════════════════════
--  ٦) صلاحيات ترتيب القائمة
-- ══════════════════════════════════════════════════════════
-- ١) للجميع: الهيكل التنظيمي · الجهات
update public.perf_users
   set scopes = (select array(select distinct unnest(coalesce(scopes,'{}') || array['structure','entities'])))
 where active;

-- ٢) تحرير الجهات: ناصر ومالكة المنصة فقط — يُسحب ممن سواهما
update public.perf_users
   set scopes = array_remove(coalesce(scopes,'{}'), 'entities:edit')
 where active
   and public.perf_norm_name(display_name) not in (
         public.perf_norm_name('ناصر الشايع'),
         public.perf_norm_name('سلطانه العرجاني'));

update public.perf_users
   set scopes = (select array(select distinct unnest(coalesce(scopes,'{}') || array['entities:edit'])))
 where active
   and public.perf_norm_name(display_name) in (
         public.perf_norm_name('ناصر الشايع'),
         public.perf_norm_name('سلطانه العرجاني'));

-- ٣) المستخدمون والصلاحيات: الأربعة وحدهم
update public.perf_users
   set scopes = array_remove(coalesce(scopes,'{}'), 'users')
 where active
   and public.perf_norm_name(display_name) not in (
         public.perf_norm_name('سلطانه العرجاني'),
         public.perf_norm_name('ناصر الشايع'),
         public.perf_norm_name('لمى المبدل'),
         public.perf_norm_name('عبدالله الحزامي'));

update public.perf_users
   set scopes = (select array(select distinct unnest(coalesce(scopes,'{}') || array['users'])))
 where active
   and public.perf_norm_name(display_name) in (
         public.perf_norm_name('سلطانه العرجاني'),
         public.perf_norm_name('ناصر الشايع'),
         public.perf_norm_name('لمى المبدل'),
         public.perf_norm_name('عبدالله الحزامي'));

-- ٤) سجل النشاط: مالكة المنصة وحدها
update public.perf_users
   set scopes = array_remove(coalesce(scopes,'{}'), 'audit')
 where active
   and public.perf_norm_name(display_name) <> public.perf_norm_name('سلطانه العرجاني');

update public.perf_users
   set scopes = (select array(select distinct unnest(coalesce(scopes,'{}') || array['audit'])))
 where active
   and public.perf_norm_name(display_name) = public.perf_norm_name('سلطانه العرجاني');

-- المراجعة
select display_name as "الاسم",
       is_lead as "مدير",
       ('structure'     = any(scopes)) as "الهيكل",
       ('entities'      = any(scopes)) as "الجهات",
       ('entities:edit' = any(scopes)) as "تحرير الجهات",
       ('users'         = any(scopes)) as "المستخدمون",
       ('audit'         = any(scopes)) as "سجل النشاط"
  from public.perf_users
 where active
 order by display_name;


-- ══════════════════════════════════════════════════════════
--  ٧) سجل النشاط: تعديلات الحسابات والجهات والوثائق
-- ══════════════════════════════════════════════════════════
-- ------------------------------------------------------------
--  ١) جدول السجل
-- ------------------------------------------------------------
create table if not exists public.perf_audit (
  id    bigserial primary key,
  at    timestamptz not null default now(),
  who   text not null default '—',
  kind  text not null,
  what  text not null default '',
  place text not null default ''
);
create index if not exists perf_audit_at on public.perf_audit (at desc);
alter table public.perf_audit enable row level security;
-- لا سياسة قراءة ولا كتابة: الكتابة من trigger، والقراءة عبر
-- perf_audit_log وحدها — وهي security definer تتحقق من الصلاحية
revoke all on public.perf_audit from anon, authenticated;

-- ------------------------------------------------------------
--  ٢) من يفعل الآن — اسم صاحب الجلسة، أو «خارج المنصة»
-- ------------------------------------------------------------
create or replace function public.perf_audit_who()
returns text language plpgsql stable security definer set search_path = public as $$
declare v text;
begin
  select u.display_name into v
    from public.perf_users u where u.id = public.perf_my_id();
  return coalesce(nullif(btrim(coalesce(v,'')), ''), '— خارج المنصة');
exception when others then
  return '— خارج المنصة';
end;
$$;

/* قائمةٌ مختصرة: أربعة أسماء ثم عددُ الباقي — قائمة الصلاحيات
   كاملةً تملأ خانة السجل وتُخفي ما قبلها */
create or replace function public.perf_few(p text[], p_max int default 4)
returns text language sql immutable as $$
  select case
    when coalesce(array_length(p,1),0) = 0 then '—'
    when array_length(p,1) <= p_max then array_to_string(p, ' · ')
    else array_to_string(p[1:p_max], ' · ') || ' و' || (array_length(p,1) - p_max)::text || ' غيرها'
  end;
$$;

-- ------------------------------------------------------------
--  ٣) تعديلات الحسابات — trigger صفّي
--     الدخول وحده لا يُسجَّل: `last_login` تتغيّر مع كل دخول،
--     وتسجيلها يغرق السجل بما لا يفيد.
-- ------------------------------------------------------------
create or replace function public.perf_users_audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_who text := public.perf_audit_who(); ch text[] := '{}';
        v_add text[]; v_rem text[]; v_first_pw boolean := false;
begin
  if TG_OP = 'INSERT' then
    insert into public.perf_audit(who, kind, what, place)
    values (v_who, 'حساب', 'أُنشئ الحساب', new.display_name);
    return new;
  end if;

  if TG_OP = 'DELETE' then
    insert into public.perf_audit(who, kind, what, place)
    values (v_who, 'حساب', 'حُذف الحساب', old.display_name);
    return old;
  end if;

  if new.display_name is distinct from old.display_name then
    ch := ch || ('الاسم: ' || old.display_name || ' ← ' || new.display_name); end if;
  if new.username is distinct from old.username then
    ch := ch || ('اسم الدخول: ' || coalesce(old.username,'—') || ' ← ' || coalesce(new.username,'—')); end if;
  if new.phone is distinct from old.phone then ch := ch || 'الجوال'; end if;
  if coalesce(new.job_title,'') is distinct from coalesce(old.job_title,'') then
    ch := ch || ('المسمّى: ' || coalesce(nullif(new.job_title,''),'—')); end if;
  if new.role is distinct from old.role then
    ch := ch || ('الدور: ' || old.role || ' ← ' || new.role); end if;
  if new.is_lead is distinct from old.is_lead then
    ch := ch || (case when new.is_lead then 'صار مدير قطاع' else 'لم يعد مدير قطاع' end); end if;
  if new.active is distinct from old.active then
    ch := ch || (case when new.active then 'أُعيد تفعيله' else 'أُوقف الحساب' end); end if;
  if new.sector_ids is distinct from old.sector_ids then ch := ch || 'القطاعات'; end if;
  if new.photo_url is distinct from old.photo_url then ch := ch || 'الصورة'; end if;

  if coalesce(new.pass_hash,'') is distinct from coalesce(old.pass_hash,'') then
    v_first_pw := coalesce(old.pass_hash,'') = '' and coalesce(new.pass_hash,'') <> '';
    ch := ch || (case
      when coalesce(old.pass_hash,'') = '' then 'ضُبطت كلمة المرور لأول مرة'
      when coalesce(new.pass_hash,'') = '' then 'أُعيد الحساب إلى «بانتظار التفعيل»'
      else 'غُيِّرت كلمة المرور' end);
  end if;

  if new.scopes is distinct from old.scopes then
    select array(select unnest(coalesce(new.scopes,'{}'))
                 except select unnest(coalesce(old.scopes,'{}'))) into v_add;
    select array(select unnest(coalesce(old.scopes,'{}'))
                 except select unnest(coalesce(new.scopes,'{}'))) into v_rem;
    if coalesce(array_length(v_add,1),0) > 0 then
      ch := ch || ('مُنح: ' || public.perf_few(v_add)); end if;
    if coalesce(array_length(v_rem,1),0) > 0 then
      ch := ch || ('سُحب: ' || public.perf_few(v_rem)); end if;
  end if;

  -- لم يتغيّر إلا وقت الدخول ⇒ لا يُسجَّل
  if coalesce(array_length(ch,1),0) = 0 then return new; end if;

  /* من فعّل حسابه بنفسه لا جلسة له بعدُ لحظةَ التعديل، فيُنسب إليه —
     وذلك حين تُضبط كلمة المرور أول مرة وحدها، لا في كل تعديل يقع
     على حسابٍ غير مفعَّل */
  if v_who = '— خارج المنصة' and v_first_pw then
    v_who := new.display_name;
  end if;

  insert into public.perf_audit(who, kind, what, place)
  values (v_who, 'حساب', array_to_string(ch, ' · '), new.display_name);
  return new;
end;
$$;

drop trigger if exists perf_users_audit_tg on public.perf_users;
create trigger perf_users_audit_tg
  after insert or update or delete on public.perf_users
  for each row execute function public.perf_users_audit();

-- ------------------------------------------------------------
--  ٤) نقطة التواصل: من عدّلها
--     الجدول ليس فيه عمود للمعدِّل، فتُختم الصفوف باسم صاحب
--     الجلسة عند كل كتابة — قبل الحفظ، فلا تحتاج الواجهة تغييراً.
-- ------------------------------------------------------------
alter table public.perf_contacts add column if not exists by_name text not null default '';

create or replace function public.perf_contacts_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.by_name := public.perf_audit_who();
  new.at := now();
  return new;
end;
$$;

drop trigger if exists perf_contacts_stamp_tg on public.perf_contacts;
create trigger perf_contacts_stamp_tg
  before insert or update on public.perf_contacts
  for each row execute function public.perf_contacts_stamp();

-- ------------------------------------------------------------
--  ٥) السجل الكامل
--     ما يُكتب دفعةً واحدة (رفع ملف الجهات · ملف طلبات التغيير ·
--     نقاط التواصل) يُجمَّع سطراً واحداً لكل شخص في اليوم، وإلا
--     أغرق رفعٌ واحد السجلَّ بمئات الأسطر وأخفى ما سواه.
-- ------------------------------------------------------------
create or replace function public.perf_audit_log(p_days int default 30, p_limit int default 400)
returns table (at timestamptz, who text, kind text, what text, "where" text)
language sql stable security definer set search_path = public as $$
  with since as (select now() - make_interval(days => greatest(1, p_days)) as t)
  select * from (
    -- تعديلات الحسابات — من الجدول المكتوب بـ trigger
    select a.at, a.who, a.kind, a.what, a.place
      from public.perf_audit a where a.at >= (select t from since)
    union all
    -- بنود الأقسام
    select i.updated_at, coalesce(nullif(i.updated_by,''), '—'), 'قسم',
           coalesce(nullif(i.data->>'name',''), nullif(i.data->>'owner',''),
                    nullif(i.data->>'entity',''), i.id),
           case i.section
             when 'sessions' then 'جلسات مراجعة الأداء'
             when 'natstrat' then 'الاستراتيجيات الوطنية'
             when 'inststrat' then 'الاستراتيجيات المؤسسية'
             when 'outputs' then 'المخرجات الوطنية'
             when 'cx' then 'أعمال قياس تجربة المستفيد'
             when 'projects' then 'المشاريع الاستراتيجية'
             else i.section end
      from public.perf_items i where i.updated_at >= (select t from since)
    union all
    select m.updated_at, coalesce(nullif(m.updated_by,''), '—'), 'قياس',
           coalesce(ind.name, m.indicator_id) || ' = ' || coalesce(m.actual::text,'—'),
           coalesce(sec.name, m.sector_id)
      from public.perf_measurements m
      left join public.perf_indicators ind on ind.id = m.indicator_id
      left join public.perf_sectors sec on sec.id = m.sector_id
     where m.updated_at >= (select t from since)
    union all
    select g.at, coalesce(nullif(g.by_name,''), '—'), 'مستهدف',
           coalesce(ind.name, g.indicator_id) || ': ' ||
           coalesce(g.old_value::text,'—') || ' ← ' || coalesce(g.new_value::text,'—'),
           coalesce(sec.name, g.sector_id)
      from public.perf_target_log g
      left join public.perf_indicators ind on ind.id = g.indicator_id
      left join public.perf_sectors sec on sec.id = g.sector_id
     where g.at >= (select t from since)
    union all
    -- ملاحظة على مؤشر — بلا نصّها
    select n.at, coalesce(nullif(n.by_name,''), '—'), 'ملاحظة',
           coalesce(ind.name, n.indicator_id), coalesce(sec.name, n.sector_id)
      from public.perf_notes n
      left join public.perf_indicators ind on ind.id = n.indicator_id
      left join public.perf_sectors sec on sec.id = n.sector_id
     where n.at >= (select t from since)
    union all
    -- ملاحظة لاصقة (القلم) — الصفحة وحدها بلا نصّها
    select s.at, coalesce(nullif(s.by_name,''), '—'), 'ملاحظة لاصقة',
           '— (لا يُعرض النص)',
           case s.page
             when 'overview' then 'نظرة عامة'
             when 'details' then 'المؤشرات التفصيلية'
             when 'sessions' then 'جلسات مراجعة الأداء'
             when 'natstrat' then 'الاستراتيجيات الوطنية'
             when 'inststrat' then 'الاستراتيجيات المؤسسية'
             when 'outputs' then 'المخرجات الوطنية'
             when 'cx' then 'أعمال قياس تجربة المستفيد'
             when 'projects' then 'المشاريع الاستراتيجية'
             when 'weekly' then 'الإنجاز الأسبوعي'
             else s.page end
      from public.perf_stickies s where s.at >= (select t from since)
    union all
    -- بنود محفظته — الاسم والقسم بلا محتوى
    select pf.updated_at, coalesce(nullif(pu.display_name,''), '—'), 'محفظتي',
           coalesce(nullif(pf.data->>'name',''), nullif(pf.data->>'title',''),
                    nullif(pf.data->>'entity',''), pf.id),
           case pf.section
             when 'entities' then 'جهاتي ومساهماتها'
             when 'projects' then 'مشاريعي'
             when 'ops' then 'أعمالي التشغيلية'
             else pf.section end
      from public.perf_portfolio pf
      left join public.perf_users pu on pu.id = pf.app_user_id
     where pf.updated_at >= (select t from since)
    union all
    -- ملاحظاته وتقويمه الخاص: وقت التحديث وحده، ولا يُقرأ محتواه
    select ud.updated_at, coalesce(nullif(uu.display_name,''), '—'),
           case ud.key when 'notes' then 'ملاحظاته الخاصة' else 'صفحته الخاصة' end,
           '— (خاصة به — لا يُعرض محتواها)', 'محفظتي'
      from public.perf_user_data ud
      left join public.perf_users uu on uu.id = ud.app_user_id
     where ud.updated_at >= (select t from since)
    union all
    select t.created_at, coalesce(nullif(cu.display_name,''), '—'),
           case when t.kind = 'assignment' then 'تكليف' else 'مهمة' end,
           t.title, coalesce(au.display_name, '—')
      from public.perf_tasks t
      left join public.perf_users cu on cu.id::text = t.created_by_id
      left join public.perf_users au on au.id::text = t.assignee_id
     where t.created_at >= (select t from since)
    union all
    -- ردّ على مهمة — بلا نصّه
    select (u->>'at')::timestamptz, coalesce(nullif(u->>'byName',''), '—'), 'ردّ',
           '— (لا يُعرض النص)', t.title
      from public.perf_tasks t,
           lateral jsonb_array_elements(coalesce(t.updates,'[]'::jsonb)) u
     where (u->>'at') is not null and (u->>'at')::timestamptz >= (select t from since)
    union all
    select g.granted_at, coalesce(nullif(g.granted_by,''), '—'), 'تفويض',
           gu.display_name || ' — ' || case when g.can_edit then 'تحرير' else 'اطّلاع' end,
           g.section
      from public.perf_section_grants g
      left join public.perf_users gu on gu.id = g.grantee_id
     where g.granted_at >= (select t from since)
    union all
    -- الجهات المضافة — مجمَّعة لكل شخص في اليوم
    select max(e.at), coalesce(nullif(e.added_by_name,''), '—'), 'جهات',
           'أُضيفت ' || count(*)::text || ' جهة', '—'
      from public.perf_entities e where e.at >= (select t from since)
     group by coalesce(nullif(e.added_by_name,''), '—'), date_trunc('day', e.at)
    union all
    -- نقاط التواصل — مجمَّعة كذلك (الرفع يكتب المئات دفعةً)
    select max(c.at), coalesce(nullif(c.by_name,''), '—'), 'نقاط تواصل',
           'كُتبت ' || count(*)::text || ' نقطة تواصل', '—'
      from public.perf_contacts c where c.at >= (select t from since)
     group by coalesce(nullif(c.by_name,''), '—'), date_trunc('day', c.at)
    union all
    -- الوثائق
    select d.at, coalesce(nullif(d.added_by,''), '—'), 'وثيقة', d.title,
           coalesce(nullif(d.kind,''), '—')
      from public.perf_docs d where d.at >= (select t from since)
    union all
    -- رفع ملف طلبات التغيير — مجمَّع لكل رفعة
    select max(cr.updated_at), coalesce(nullif(cr.updated_by,''), '—'), 'طلبات التغيير',
           'رفع ملف — ' || count(*)::text || ' طلباً', '—'
      from public.perf_change_requests cr where cr.updated_at >= (select t from since)
     group by coalesce(nullif(cr.updated_by,''), '—'), date_trunc('day', cr.updated_at)
  ) x(at, who, kind, what, "where")
  where public.perf_has_scope('audit')
  order by at desc
  limit greatest(1, p_limit);
$$;
revoke all on function public.perf_audit_log(int, int) from public, anon;
grant execute on function public.perf_audit_log(int, int) to authenticated;

-- ------------------------------------------------------------
--  ٦) التنظيف عند الحاجة — من SQL Editor وحده
--     select public.perf_audit_prune(180);
-- ------------------------------------------------------------
create or replace function public.perf_audit_prune(p_days int default 180)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  delete from public.perf_audit where at < now() - make_interval(days => greatest(30, p_days));
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.perf_audit_prune(int) from public, anon, authenticated;

select 'perf_audit' as "الجدول", 'جاهز' as "الحالة";

-- ══════════════════════════════════════════════════════════
--  المراجعة الأخيرة — ماذا صار جاهزاً
-- ══════════════════════════════════════════════════════════
select 'حالة «معلقة»' as "الميزة",
       (select count(*) from pg_constraint
         where conrelid='public.perf_tasks'::regclass
           and pg_get_constraintdef(oid) like '%hold%') > 0 as "جاهزة"
union all select 'إضافة جهة من المحفظة',
       to_regclass('public.perf_entities') is not null
       and exists(select 1 from information_schema.columns
                   where table_name='perf_entities' and column_name='added_by_name')
union all select 'الأسماء البديلة',
       exists(select 1 from information_schema.columns
               where table_name='perf_entities' and column_name='aliases')
union all select 'صورة الموظف',
       exists(select 1 from information_schema.columns
               where table_name='perf_users' and column_name='photo_url')
union all select 'رسالة «لا جوال مسجَّل»',
       exists(select 1 from pg_proc where proname='perf_activate' and prosrc like '%no_phone%')
union all select 'ختم وقت التفعيل',
       exists(select 1 from pg_proc where proname='perf_activate' and prosrc like '%activated_at%')
union all select 'سجل تعديلات الحسابات',
       to_regclass('public.perf_audit') is not null
       and exists(select 1 from pg_trigger where tgname='perf_users_audit_tg')
union all select 'ختم نقطة التواصل',
       exists(select 1 from information_schema.columns
               where table_name='perf_contacts' and column_name='by_name');
