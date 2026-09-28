-- ============================================================
--  المنشن في الملاحظات اللاصقة — ومن يراها
--  ------------------------------------------------------------
--  كانت الملاحظة تصل كلَّ من يفتح الصفحة. الآن كاتبها يقرّر:
--    · بلا منشن        ⇐ للجميع كما كانت (audience = 'all')
--    · @اسم شخص        ⇐ له وحده     (audience = 'users')
--    · @sector managers ⇐ لمدراء القطاعات (audience = 'leads')
--    · @all             ⇐ للجميع صراحةً
--  وكاتبها يراها دائماً مهما كان الجمهور.
--
--  الحارس RLS لا الواجهة: من لا يعنيه الأمر **لا تصله الملاحظة
--  من القاعدة أصلاً**، فإخفاؤها ليس تجميلاً في الشاشة.
--
--  ويضيف `username` إلى قائمة الأسماء، فيُكتب المنشن بالعربي
--  (الاسم) أو بالإنجليزي (اسم الدخول).
--
--  idempotent وليس فيه حذف بيانات. يُشغَّل بعد perf-sticky.sql
-- ============================================================

alter table public.perf_stickies
  add column if not exists audience text not null default 'all';
alter table public.perf_stickies
  add column if not exists mention_ids bigint[] not null default '{}';

do $$ begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.perf_stickies'::regclass
                    and conname = 'perf_stickies_audience_check') then
    alter table public.perf_stickies
      add constraint perf_stickies_audience_check
      check (audience in ('all', 'leads', 'users'));
  end if;
end $$;

/* «هل أنا مدير قطاع؟» — داخل دالة، لأن ما في جسم السياسة يجري
   بصلاحية السائل، و`authenticated` لا يقرأ `perf_users` مباشرةً */
create or replace function public.perf_is_lead()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.perf_users u
     where u.id = public.perf_my_id() and u.active and u.is_lead
  );
$$;
revoke all on function public.perf_is_lead() from public, anon;
grant execute on function public.perf_is_lead() to authenticated;

/* القراءة: الصفحة أولاً، ثم الجمهور */
drop policy if exists "perf_stickies_read" on public.perf_stickies;
create policy "perf_stickies_read" on public.perf_stickies
  for select to authenticated
  using (
    public.perf_sees_page(page)
    and (
      audience = 'all'
      -- كاتبها يراها دائماً، وإلا كتب ملاحظةً لا يجدها
      or by_id = public.perf_my_id()::text
      or (audience = 'leads' and public.perf_is_lead())
      or (audience = 'users' and public.perf_my_id() = any(mention_ids))
    )
  );

/* قائمة الأسماء تُرجع اسم الدخول كذلك — للمنشن بالإنجليزي */
drop function if exists public.perf_people();
create or replace function public.perf_people()
returns table (id text, name text, username text, role text, sector_ids text[],
               active boolean, is_lead boolean, job_title text, photo_url text)
language plpgsql security definer set search_path = public as $$
begin
  if not public.perf_signed_in() then raise exception 'forbidden'; end if;
  return query select u.id::text, u.display_name, u.username, u.role, u.sector_ids,
                      u.active, u.is_lead, u.job_title, u.photo_url
                 from public.perf_users u
                where u.active
                order by u.is_lead desc, u.display_name;
end;
$$;
revoke all on function public.perf_people() from public, anon;
grant execute on function public.perf_people() to authenticated;

select 'audience' as "العمود", 'جاهز' as "الحالة";
