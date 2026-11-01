-- ============================================================
--  جولات مراجعة طلبات التغيير عند أداء
--  ------------------------------------------------------------
--  يُشغَّل مرة واحدة من SQL Editor. idempotent وليس فيه حذف.
--
--  لماذا جدولٌ ثانٍ؟ `perf_change_requests` يحمل **حالة الطلب
--  الآن** (مفتاحه الرمز، فصفٌّ واحد للطلب). والمؤشر يَعُدّ
--  **الجولات**: الطلب الذي يُعاد للجهة ثم يعود إلى أداء جولتان
--  بمدّتين مختلفتين (الاتفاقية أقصر بعد الإعادة). فكل جولة صفٌّ
--  هنا، تُفتح حين يدخل الطلب قائمة أداء وتُغلق حين يخرج منها.
--
--  والنسبة الربعية = الملتزم ÷ الإجمالي × 100 — معادلة بطاقة
--  المؤشر نفسها، محسوبةً من هذه الصفوف لا من تجميعٍ يدوي.
-- ============================================================

-- ١) أعمدة تُكمل سجلّ الطلب: متى وصل أداء، وعلى ماذا الطلب
alter table public.perf_change_requests
  add column if not exists arrived_at date,     -- تاريخ آخر إجراء قبل أداء = تسليمه إليه
  add column if not exists req_kind   text;     -- مبادرة · مؤشر

comment on column public.perf_change_requests.arrived_at is
  'تاريخ وصول الطلب إلى أداء في جولته الحالية (تاريخ آخر إجراء قبلها)';

-- ٢) الجولات
create table if not exists public.perf_cr_rounds (
  id           text primary key,          -- <الرمز>:<تاريخ الوصول>
  code         text not null,
  program      text,
  item_name    text,
  owner_entity text,
  axis         text,                      -- رؤية 2030 · استراتيجية وطنية
  req_kind     text,                      -- مبادرة · مؤشر
  review       text,                      -- طلب جديد · إعادة توجيه
  sla_days     int,
  work_days    int,
  on_time      boolean,
  arrived_at   date not null,
  left_at      date,
  updated_at   timestamptz not null default now(),
  updated_by   text
);

create index if not exists perf_cr_rounds_left_idx on public.perf_cr_rounds (left_at desc);
create index if not exists perf_cr_rounds_code_idx on public.perf_cr_rounds (code);

alter table public.perf_cr_rounds enable row level security;
grant select, insert, update, delete on public.perf_cr_rounds to authenticated;

-- القراءة: كل من دخل المنصة — كما في جدول الطلبات نفسه
drop policy if exists "perf_cr_rounds_read" on public.perf_cr_rounds;
create policy "perf_cr_rounds_read" on public.perf_cr_rounds
  for select to authenticated using (public.perf_signed_in());

-- الكتابة: من يرفع الملف — نفس شرط جدول الطلبات (`changes:upload`)
drop policy if exists "perf_cr_rounds_insert" on public.perf_cr_rounds;
create policy "perf_cr_rounds_insert" on public.perf_cr_rounds
  for insert to authenticated with check (public.perf_can_changes());

drop policy if exists "perf_cr_rounds_update" on public.perf_cr_rounds;
create policy "perf_cr_rounds_update" on public.perf_cr_rounds
  for update to authenticated
  using (public.perf_can_changes()) with check (public.perf_can_changes());

-- الحذف النهائي: لمدير الإدارة وحده
drop policy if exists "perf_cr_rounds_delete" on public.perf_cr_rounds;
create policy "perf_cr_rounds_delete" on public.perf_cr_rounds
  for delete to authenticated using (public.perf_is_admin());

revoke all on public.perf_cr_rounds from anon;
