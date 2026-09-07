-- ============================================================
--  تفويض قسم — يمنحه صاحب القسم لمن ينوب عنه أثناء إجازته
--  يُشغَّل من SQL Editor مرة واحدة. idempotent وليس فيه حذف بيانات.
--  يُشغَّل بعد: perf-roster · perf-changes · perf-access · perf-weekly
--             · perf-section-edit
-- ============================================================

-- ------------------------------------------------------------
--  ١) جدول التفويضات
--     التفويض مؤقّت بطبعه، فله تاريخ انتهاء يُلغيه بنفسه.
--     expires_at فارغاً = بلا انتهاء (يُسحب يدوياً).
-- ------------------------------------------------------------
create table if not exists public.perf_section_grants (
  section     text        not null,
  grantee_id  bigint      not null references public.perf_users(id) on delete cascade,
  can_edit    boolean     not null default false,
  granted_by  text        not null default '',
  granted_at  timestamptz not null default now(),
  expires_at  date,
  note        text        not null default '',
  primary key (section, grantee_id)
);
alter table public.perf_section_grants enable row level security;
grant select, insert, update, delete on public.perf_section_grants to authenticated;

-- ------------------------------------------------------------
--  ٢) هل للمستخدم الحالي تفويضٌ سارٍ على القسم؟
--     p_edit = هل نسأل عن التحرير أم عن الاطّلاع
-- ------------------------------------------------------------
create or replace function public.perf_granted(p_section text, p_edit boolean default false)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.perf_section_grants g
      join public.perf_sessions s on s.app_user_id = g.grantee_id
      join public.perf_users u    on u.id = g.grantee_id
     where s.user_id = auth.uid()
       and u.active
       and g.section = p_section
       and (g.expires_at is null or g.expires_at >= current_date)
       and (not p_edit or g.can_edit));
$$;
revoke all on function public.perf_granted(text, boolean) from public, anon;
grant execute on function public.perf_granted(text, boolean) to authenticated;

-- ------------------------------------------------------------
--  ٣) الكتابة في بنود الأقسام: صاحب القسم أو مَن فُوِّض بالتحرير
-- ------------------------------------------------------------
drop policy if exists "perf_items_write" on public.perf_items;
create policy "perf_items_write" on public.perf_items
  for all to authenticated
  using (
    (public.perf_has_scope(section) and public.perf_has_scope(section || ':edit'))
    or public.perf_granted(section, true))
  with check (
    (public.perf_has_scope(section) and public.perf_has_scope(section || ':edit'))
    or public.perf_granted(section, true));

-- ------------------------------------------------------------
--  ٤) من يمنح ومن يرى التفويضات
--     المنح لصاحب القسم (يملك «القسم:edit») — لا لمن فُوِّض هو،
--     فالتفويض لا يُورَّث. والجميع يقرأ ليعرف مَن ينوب عن مَن.
-- ------------------------------------------------------------
drop policy if exists "perf_grants_read" on public.perf_section_grants;
create policy "perf_grants_read" on public.perf_section_grants
  for select to authenticated using (public.perf_signed_in());

drop policy if exists "perf_grants_write" on public.perf_section_grants;
create policy "perf_grants_write" on public.perf_section_grants
  for all to authenticated
  using (public.perf_has_scope(section || ':edit'))
  with check (public.perf_has_scope(section || ':edit'));

-- ------------------------------------------------------------
--  ٥) صلاحياتي = صلاحياتي + ما فُوِّضت به وهو سارٍ
--     فتظهر صفحة القسم لمن ناب عن صاحبها بلا تعديل في الواجهة.
-- ------------------------------------------------------------
create or replace function public.perf_me()
returns table (scopes text[], job_title text, is_lead boolean)
language plpgsql security definer set search_path = public as $$
begin
  return query
    select (
             select array(select distinct unnest(
               coalesce(u.scopes, '{}')
               || coalesce((
                    select array_agg(g.section) || array_agg(g.section || ':edit')
                             filter (where g.can_edit)
                      from public.perf_section_grants g
                     where g.grantee_id = u.id
                       and (g.expires_at is null or g.expires_at >= current_date)
                  ), '{}'::text[])))
           ) as scopes,
           u.job_title, u.is_lead
      from public.perf_sessions s
      join public.perf_users u on u.id = s.app_user_id
     where s.user_id = auth.uid() and u.active;
end;
$$;
revoke all on function public.perf_me() from public, anon;
grant execute on function public.perf_me() to authenticated;

-- ------------------------------------------------------------
--  ٦) قائمة تفويضات قسم — بالأسماء، لعرضها في نافذة الإعدادات
-- ------------------------------------------------------------
create or replace function public.perf_grants_of(p_section text)
returns table (grantee_id bigint, name text, can_edit boolean,
               granted_by text, granted_at timestamptz,
               expires_at date, note text, active boolean)
language sql stable security definer set search_path = public as $$
  select g.grantee_id, u.display_name, g.can_edit, g.granted_by, g.granted_at,
         g.expires_at, g.note,
         (g.expires_at is null or g.expires_at >= current_date) as active
    from public.perf_section_grants g
    join public.perf_users u on u.id = g.grantee_id
   where g.section = p_section
     and public.perf_signed_in()
   order by u.display_name;
$$;
revoke all on function public.perf_grants_of(text) from public, anon;
grant execute on function public.perf_grants_of(text) to authenticated;

-- ------------------------------------------------------------
--  ٦-ب) هل أنا صاحب القسم فأمنح التفويض؟
--     تقرأ الصلاحيات المخزّنة في الحساب، والتفويض ليس منها —
--     فمن نابَ عن صاحب القسم لا ينوب عنه في المنح.
-- ------------------------------------------------------------
create or replace function public.perf_can_delegate(p_section text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.perf_has_scope(p_section || ':edit');
$$;
revoke all on function public.perf_can_delegate(text) from public, anon;
grant execute on function public.perf_can_delegate(text) to authenticated;

-- ------------------------------------------------------------
--  ٧) تنظيف المنتهي — يُشغَّل متى شئت، والسريان لا ينتظره
--     (الدوال أعلاه تتحقق من التاريخ في كل استدعاء)
-- ------------------------------------------------------------
create or replace function public.perf_grants_prune()
returns integer language sql security definer set search_path = public as $$
  with d as (
    delete from public.perf_section_grants
     where expires_at is not null and expires_at < current_date - 30
    returning 1)
  select count(*)::int from d;
$$;
revoke all on function public.perf_grants_prune() from public, anon, authenticated;

-- ------------------------------------------------------------
--  ٨) المراجعة
-- ------------------------------------------------------------
select g.section as "القسم",
       u.display_name as "المفوَّض",
       case when g.can_edit then 'تحرير' else 'اطّلاع' end as "المستوى",
       coalesce(g.expires_at::text, 'بلا انتهاء') as "ينتهي",
       g.granted_by as "منحه"
  from public.perf_section_grants g
  join public.perf_users u on u.id = g.grantee_id
 order by g.section, u.display_name;
