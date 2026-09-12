-- ============================================================
--  الجهات ونقاط التواصل
--  ------------------------------------------------------------
--  سجلٌّ مركزي واحد يجيب سؤالاً يتكرّر في القروبات: «هل عندنا
--  نقطة تواصل مع جهة كذا؟» — فيُقرأ من المنصة بلا سؤال أحد.
--
--  جدولان:
--    perf_entities  — الجهة (وزارة · هيئة · برنامج …)
--    perf_contacts  — نقطة تواصل: من عندنا (side='نحن') أو من
--                     الجهة (side='الجهة'). ونقطتنا تُربط بحساب
--                     الموظف، فتظهر الجهة في «جهاتي» بلا تعبئة.
--
--  القراءة لكل من دخل المنصة — فالمعرفة بلا بحث عنها هي المقصود.
--  الكتابة بصلاحية «entities:edit».
--  idempotent وليس فيه حذف بيانات.
--  يُشغَّل بعد perf-docs.sql (يستعمل perf_ar_norm منه).
-- ============================================================

create table if not exists public.perf_entities (
  id        text primary key,
  name      text not null,
  kind      text not null default '',          -- وزارة · هيئة · برنامج · مركز …
  sector    text not null default '',          -- القطاع في المركز
  note      text not null default '',
  active    boolean not null default true,
  at        timestamptz not null default now(),
  name_n    text generated always as (public.perf_ar_norm(name)) stored
);
create index if not exists perf_entities_name_n on public.perf_entities (name_n);
alter table public.perf_entities enable row level security;
grant select, insert, update, delete on public.perf_entities to authenticated;

drop policy if exists "perf_ent_read" on public.perf_entities;
create policy "perf_ent_read" on public.perf_entities
  for select to authenticated using (public.perf_signed_in());
drop policy if exists "perf_ent_write" on public.perf_entities;
create policy "perf_ent_write" on public.perf_entities
  for all to authenticated
  using (public.perf_has_scope('entities:edit'))
  with check (public.perf_has_scope('entities:edit'));

create table if not exists public.perf_contacts (
  id         text primary key,
  entity_id  text not null references public.perf_entities(id) on delete cascade,
  side       text not null default 'الجهة',    -- 'نحن' أو 'الجهة'
  name       text not null default '',
  job_title  text not null default '',
  email      text not null default '',
  phone      text not null default '',
  note       text not null default '',
  /* ربط نقطة تواصلنا بحساب الموظف — فتظهر الجهة في «جهاتي» عنده
     بلا أن يعبّئها، ويُعرف من يتولّاها إن غاب */
  user_id    bigint references public.perf_users(id) on delete set null,
  at         timestamptz not null default now(),
  name_n     text generated always as (public.perf_ar_norm(name || ' ' || job_title)) stored
);
create index if not exists perf_contacts_entity on public.perf_contacts (entity_id);
create index if not exists perf_contacts_user on public.perf_contacts (user_id);
alter table public.perf_contacts enable row level security;
grant select, insert, update, delete on public.perf_contacts to authenticated;

drop policy if exists "perf_con_read" on public.perf_contacts;
create policy "perf_con_read" on public.perf_contacts
  for select to authenticated using (public.perf_signed_in());
drop policy if exists "perf_con_write" on public.perf_contacts;
create policy "perf_con_write" on public.perf_contacts
  for all to authenticated
  using (public.perf_has_scope('entities:edit'))
  with check (public.perf_has_scope('entities:edit'));

-- ------------------------------------------------------------
--  البحث: «هل عندنا نقطة تواصل مع هيئة المقاولين؟»
--  يبحث في اسم الجهة وفي أسماء نقاط التواصل ومسمّياتها.
-- ------------------------------------------------------------
create or replace function public.perf_entities_find(p_q text, p_limit int default 8)
returns table (id text, name text, kind text, sector text,
               ours jsonb, theirs jsonb, hits int)
language sql stable security definer set search_path = public as $$
  with words as (
    select t from (select distinct unnest(string_to_array(public.perf_ar_norm(p_q), ' ')) as t) w
     where length(t) >= 3
       and t not in (public.perf_ar_norm('عندنا'), public.perf_ar_norm('هل'),
                     public.perf_ar_norm('نقطة'), public.perf_ar_norm('تواصل'),
                     public.perf_ar_norm('مع'), public.perf_ar_norm('احد'),
                     public.perf_ar_norm('من'), public.perf_ar_norm('في'))
  )
  select e.id, e.name, e.kind, e.sector,
         coalesce((select jsonb_agg(jsonb_build_object(
                     'name', c.name, 'jobTitle', c.job_title,
                     'email', c.email, 'phone', c.phone, 'note', c.note)
                   order by c.name)
                     from public.perf_contacts c
                    where c.entity_id = e.id and c.side = 'نحن'), '[]'::jsonb),
         coalesce((select jsonb_agg(jsonb_build_object(
                     'name', c.name, 'jobTitle', c.job_title,
                     'email', c.email, 'phone', c.phone, 'note', c.note)
                   order by c.name)
                     from public.perf_contacts c
                    where c.entity_id = e.id and c.side <> 'نحن'), '[]'::jsonb),
         (select count(*)::int from words x
           where e.name_n like '%' || x.t || '%'
              or exists (select 1 from public.perf_contacts c
                          where c.entity_id = e.id and c.name_n like '%' || x.t || '%')) as hits
    from public.perf_entities e
   where e.active and public.perf_signed_in()
     and (select count(*) from words x
           where e.name_n like '%' || x.t || '%'
              or exists (select 1 from public.perf_contacts c
                          where c.entity_id = e.id and c.name_n like '%' || x.t || '%')) > 0
   order by hits desc, e.name
   limit greatest(1, p_limit);
$$;
revoke all on function public.perf_entities_find(text, int) from public, anon;
grant execute on function public.perf_entities_find(text, int) to authenticated;

-- ------------------------------------------------------------
--  جهاتي: ما أنا نقطة التواصل فيه — تُقرأ في «محفظتي» بلا تعبئة
-- ------------------------------------------------------------
create or replace function public.perf_my_entities()
returns table (entity_id text, name text, kind text, sector text,
               my_role text, theirs jsonb)
language sql stable security definer set search_path = public as $$
  select e.id, e.name, e.kind, e.sector, coalesce(nullif(c.note,''), c.job_title),
         coalesce((select jsonb_agg(jsonb_build_object(
                     'name', x.name, 'jobTitle', x.job_title,
                     'email', x.email, 'phone', x.phone) order by x.name)
                     from public.perf_contacts x
                    where x.entity_id = e.id and x.side <> 'نحن'), '[]'::jsonb)
    from public.perf_contacts c
    join public.perf_entities e on e.id = c.entity_id and e.active
   where c.side = 'نحن' and c.user_id = public.perf_my_id()
   order by e.name;
$$;
revoke all on function public.perf_my_entities() from public, anon;
grant execute on function public.perf_my_entities() to authenticated;

-- ------------------------------------------------------------
--  ربط نقاط تواصلنا بحسابات الموظفين بالاسم
--  يُشغَّل بعد كل استيراد — يطابق بالاسم المُوحَّد، ولا يلمس
--  ما رُبط يدوياً ولا يخمّن عند التشابه.
-- ------------------------------------------------------------
create or replace function public.perf_contacts_link()
returns table (linked int, unmatched int)
language plpgsql security definer set search_path = public as $$
declare v_linked int; v_un int;
begin
  if not public.perf_has_scope('entities:edit') then raise exception 'forbidden'; end if;

  update public.perf_contacts c
     set user_id = u.id
    from public.perf_users u
   where c.side = 'نحن' and c.user_id is null and u.active
     and public.perf_norm_name(u.display_name) = public.perf_norm_name(c.name);
  get diagnostics v_linked = row_count;

  select count(*)::int into v_un
    from public.perf_contacts c
   where c.side = 'نحن' and c.user_id is null;

  return query select v_linked, v_un;
end;
$$;
revoke all on function public.perf_contacts_link() from public, anon;
grant execute on function public.perf_contacts_link() to authenticated;

-- من لم يُربط — لمراجعته يدوياً
create or replace function public.perf_contacts_unlinked()
returns table (contact_id text, name text, entity text)
language sql stable security definer set search_path = public as $$
  select c.id, c.name, e.name
    from public.perf_contacts c
    join public.perf_entities e on e.id = c.entity_id
   where c.side = 'نحن' and c.user_id is null and public.perf_has_scope('entities:edit')
   order by c.name;
$$;
revoke all on function public.perf_contacts_unlinked() from public, anon;
grant execute on function public.perf_contacts_unlinked() to authenticated;


-- ------------------------------------------------------------
--  الأعمدة المُولَّدة لا تُحسب من جديد حين تتغيّر دالة التوحيد،
--  فتُحدَّث الصفوف لتُعاد حوسبتها. لا يغيّر بيانات.
-- ------------------------------------------------------------
update public.perf_entities set name = name;
update public.perf_contacts set name = name;

-- ------------------------------------------------------------
--  الصلاحية: الجهات يراها الجميع، وتحريرها لمالكة المنصة ومدير الإدارة
-- ------------------------------------------------------------
update public.perf_users
   set scopes = (select array(select distinct unnest(coalesce(scopes,'{}') || array['entities'])))
 where active;

update public.perf_users
   set scopes = (select array(select distinct unnest(coalesce(scopes,'{}') || array['entities:edit'])))
 where active
   and public.perf_norm_name(display_name) in (
         public.perf_norm_name('سلطانه العرجاني'),
         public.perf_norm_name('عبدالله الحزامي'));

select 'perf_entities' as "الجدول", count(*)::text as "عدد" from public.perf_entities
union all select 'perf_contacts', count(*)::text from public.perf_contacts;
