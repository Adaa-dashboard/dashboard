-- ============================================================
--  «طلبٌ راجعتُه» — إضافة طلب تغيير إلى محفظة استشاري
--  ------------------------------------------------------------
--  يُشغَّل مرة واحدة من SQL Editor. idempotent وليس فيه حذف.
--
--  نسبة الطلب تمرّ بجهته المالكة، والاستشاري قد يراجع طلباً من
--  جهة زميله — فلا يظهر في محفظته ولا يُحتسب له.
--
--  هذا الجدول يُسند **طلباً بعينه** إلى من راجعه: يظهر في محفظته،
--  ويُحتسب له في ترتيب الاستشاريين ونسبة الالتزام، ويخرج من حساب
--  صاحب الجهة — فلا يُعدّ الطلب مرّتين.
--
--  وهو مكمّل لـ`perf_cr_disown`: ذاك ينفي جهةً كاملة، وهذا يضيف
--  طلباً واحداً. والمفتاح هو الرمز، فالطلب لا يُنسب إلى اثنين.
-- ============================================================

create table if not exists public.perf_cr_mine (
  code      text primary key,          -- رمز الطلب في منصة الرؤية
  user_name text not null,             -- من راجعه فنُسب إليه
  note      text,
  by_name   text,                      -- من أضاف السطر
  at        timestamptz not null default now()
);

create index if not exists perf_cr_mine_user on public.perf_cr_mine (user_name);

alter table public.perf_cr_mine enable row level security;
grant select, insert, update, delete on public.perf_cr_mine to authenticated;
revoke all on public.perf_cr_mine from anon;

-- القراءة: كل من دخل المنصة — الإسناد يظهر في الترتيب للجميع
drop policy if exists "perf_cr_mine_read" on public.perf_cr_mine;
create policy "perf_cr_mine_read" on public.perf_cr_mine
  for select to authenticated using (public.perf_signed_in());

-- الإضافة والتعديل: كل مستخدم، والسطر يحمل اسمه واسم من أضافه
drop policy if exists "perf_cr_mine_insert" on public.perf_cr_mine;
create policy "perf_cr_mine_insert" on public.perf_cr_mine
  for insert to authenticated with check (public.perf_signed_in());

drop policy if exists "perf_cr_mine_update" on public.perf_cr_mine;
create policy "perf_cr_mine_update" on public.perf_cr_mine
  for update to authenticated
  using (public.perf_signed_in()) with check (public.perf_signed_in());

-- الحذف: صاحب الإسناد، أو من يرفع ملف الطلبات، أو مدير الإدارة
drop policy if exists "perf_cr_mine_delete" on public.perf_cr_mine;
create policy "perf_cr_mine_delete" on public.perf_cr_mine
  for delete to authenticated
  using (
    public.perf_can_changes()
    or public.perf_is_admin()
    or public.perf_norm_name(user_name) = public.perf_norm_name(
         (select display_name from public.perf_users where id = public.perf_my_id()))
  );
