-- ============================================================
--  «ليست جهتي» — تصحيح نسبة الجهات إلى الاستشاريين
--  ------------------------------------------------------------
--  يُشغَّل مرة واحدة من SQL Editor. idempotent وليس فيه حذف.
--
--  نسبة الطلب إلى استشاريٍّ تمرّ بجهته المالكة: سجلّ الجهات يقول
--  من نقطة تواصلها من المركز. والسجلّ قد يتأخّر عن الواقع، فتُحسب
--  طلبات جهةٍ على من لا يراجعها.
--
--  فمن يصله تنبيهٌ بطلبٍ ليس له ينفي نسبة جهته إليه، فيتوقّف
--  احتساب طلباتها عليه، وتظهر الجهة في صفحة طلبات التغيير
--  «بلا استشاري واضح» حتى تُسند في سجلّ الجهات.
--
--  النفي لا يحذف شيئاً من سجلّ الجهات — فهو قولُ الاستشاري لا
--  قرارَ إدارة، ويبقى ظاهراً لمن يُسند حتى يصحّح المصدر.
-- ============================================================

create table if not exists public.perf_cr_disown (
  id        text primary key,
  entity    text not null,                 -- اسم الجهة كما ورد في ملف المنصة
  entity_n  text generated always as (public.perf_ar_norm(entity)) stored,
  user_name text not null,                 -- من نفى نسبتها إليه
  note      text,
  at        timestamptz not null default now()
);

create index if not exists perf_cr_disown_n on public.perf_cr_disown (entity_n);

alter table public.perf_cr_disown enable row level security;
grant select, insert, delete on public.perf_cr_disown to authenticated;
revoke all on public.perf_cr_disown from anon;

-- القراءة: كل من دخل المنصة — الجدول يقول أين تلتبس النسبة
drop policy if exists "perf_cr_disown_read" on public.perf_cr_disown;
create policy "perf_cr_disown_read" on public.perf_cr_disown
  for select to authenticated using (public.perf_signed_in());

-- الإضافة: كل مستخدم عن نفسه — والسطر يحمل اسمه فالمسؤولية ظاهرة
drop policy if exists "perf_cr_disown_insert" on public.perf_cr_disown;
create policy "perf_cr_disown_insert" on public.perf_cr_disown
  for insert to authenticated with check (public.perf_signed_in());

-- الحذف بعد تصحيح الإسناد: لمن يرفع الملف أو لمدير الإدارة
drop policy if exists "perf_cr_disown_delete" on public.perf_cr_disown;
create policy "perf_cr_disown_delete" on public.perf_cr_disown
  for delete to authenticated
  using (public.perf_can_changes() or public.perf_is_admin());
