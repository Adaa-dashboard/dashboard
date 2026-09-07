-- ============================================================
--  ملاحظات لاصقة على الصفحات — ورقة صفراء تُوضع حيث يُشار إليه
--  يُشغَّل بعد: perf-section-edit · perf-delegate
--  idempotent وليس فيه حذف بيانات.
-- ============================================================

-- ------------------------------------------------------------
--  ١) الجدول
--     الموضع بالنسبة المئوية لا بالبكسل، فيبقى على مكانه مهما
--     اختلف حجم شاشة القارئ.
--     pinned_until فارغاً = بلا مدة (تبقى حتى تُغلق).
-- ------------------------------------------------------------
create table if not exists public.perf_stickies (
  id           text primary key,
  page         text        not null,
  x            numeric     not null default 50,
  y            numeric     not null default 30,
  body         text        not null default '',
  by_id        text        not null default '',
  by_name      text        not null default '',
  at           timestamptz not null default now(),
  pinned_until date,
  done         boolean     not null default false,
  done_by      text        not null default '',
  done_at      timestamptz
);
create index if not exists perf_stickies_page on public.perf_stickies (page, done);
alter table public.perf_stickies enable row level security;
grant select, insert, update, delete on public.perf_stickies to authenticated;

-- ------------------------------------------------------------
--  ٢) من يرى ومن يكتب — من يفتح الصفحة، أصالةً أو بتفويضٍ سارٍ
-- ------------------------------------------------------------
create or replace function public.perf_sees_page(p_page text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.perf_has_scope(p_page) or public.perf_granted(p_page, false);
$$;
revoke all on function public.perf_sees_page(text) from public, anon;
grant execute on function public.perf_sees_page(text) to authenticated;

drop policy if exists "perf_stickies_read" on public.perf_stickies;
create policy "perf_stickies_read" on public.perf_stickies
  for select to authenticated using (public.perf_sees_page(page));

drop policy if exists "perf_stickies_insert" on public.perf_stickies;
create policy "perf_stickies_insert" on public.perf_stickies
  for insert to authenticated with check (public.perf_sees_page(page));

-- التعديل والحذف: لكاتبها، أو لمن يحرّر الصفحة (يغلقها بعد معالجتها)
drop policy if exists "perf_stickies_write" on public.perf_stickies;
create policy "perf_stickies_write" on public.perf_stickies
  for update to authenticated
  using (by_id = public.perf_my_id()::text or public.perf_has_scope(page || ':edit'))
  with check (by_id = public.perf_my_id()::text or public.perf_has_scope(page || ':edit'));

drop policy if exists "perf_stickies_delete" on public.perf_stickies;
create policy "perf_stickies_delete" on public.perf_stickies
  for delete to authenticated
  using (by_id = public.perf_my_id()::text or public.perf_has_scope(page || ':edit'));

-- ------------------------------------------------------------
--  ٣) تنظيف ما انتهت مدّته وأُغلق — اختياري
-- ------------------------------------------------------------
create or replace function public.perf_stickies_prune()
returns integer language sql security definer set search_path = public as $$
  with d as (
    delete from public.perf_stickies
     where done and done_at < now() - interval '90 days'
    returning 1)
  select count(*)::int from d;
$$;
revoke all on function public.perf_stickies_prune() from public, anon, authenticated;

-- ------------------------------------------------------------
--  ٤) المراجعة
-- ------------------------------------------------------------
select page as "الصفحة", by_name as "من", left(body, 50) as "الملاحظة",
       coalesce(pinned_until::text, 'بلا مدة') as "حتى",
       case when done then 'مُغلقة' else 'قائمة' end as "الحالة"
  from public.perf_stickies order by at desc;
