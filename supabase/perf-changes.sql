-- ============================================================
--  تعديلات ٢ سبتمبر ٢٠٢٦ — إضافية بالكامل
--  لا يحذف هذا الملف أي جدول ولا يمسّ أي صف قائم:
--  يضيف عموداً واحداً لجدول المهام، وجدولاً جديداً لطلبات التغيير.
--  آمن للتشغيل أكثر من مرة (idempotent).
-- ============================================================

-- ------------------------------------------------------------
--  ١) نوع البند في جدول المهام
--     task       = مهمة داخلية بسيطة  ← تبقى في صفحة «المهام»
--     assignment = تكليف وارد من الديوان أو جهة أعلى ← يظهر في «نظرة عامة»
--     القيمة الافتراضية 'task' فكل ما هو محفوظ الآن يبقى مهمة كما هو.
-- ------------------------------------------------------------
alter table public.perf_tasks
  add column if not exists kind text not null default 'task';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'perf_tasks_kind_chk'
  ) then
    alter table public.perf_tasks
      add constraint perf_tasks_kind_chk check (kind in ('task','assignment'));
  end if;
end $$;

-- ------------------------------------------------------------
--  ٢) طلبات التغيير الواردة من منصة الرؤية
--     مرآة للملف الذي يُسحب من المنصة: المفتاح هو «الرمز»،
--     فرفع الملف يحدّث الموجود ويضيف الجديد ولا يكرّر شيئاً.
--     الطلب الذي يختفي من الملف = تمت مراجعته ⇐ يُغلق بتاريخه.
-- ------------------------------------------------------------
create table if not exists public.perf_change_requests (
  code           text primary key,   -- الرمز            (VIR_NTP_4767)
  program        text,               -- اسم البرنامج/الاستراتيجية
  item_code      text,               -- كود المبادرة/المؤشر
  item_name      text,               -- اسم المبادرة/المؤشر
  owner_entity   text,               -- الجهة المالكة
  request_cat    text,               -- فئة الطلب
  review_type    text,               -- نوع المراجعة
  classification text,               -- التصنيف
  sla_days       int,                -- اتفاقية مستوى الخدمة (٣ · ٥ · ٧)
  work_days      int,                -- أيام العمل المنقضية
  status         text not null default 'open'
                 check (status in ('open','closed')),
  first_seen     date not null default current_date,
  last_seen      date not null default current_date,
  closed_at      date,
  updated_at     timestamptz not null default now(),
  updated_by     text
);

create index if not exists perf_cr_status_idx
  on public.perf_change_requests (status, last_seen desc);

alter table public.perf_change_requests enable row level security;

-- القراءة: كل من سجّل دخوله (بلا تصنيف — الكل يرى الكل)
drop policy if exists "perf_cr_read" on public.perf_change_requests;
create policy "perf_cr_read" on public.perf_change_requests
  for select to authenticated using (public.perf_signed_in());

-- الرفع والتحديث: أي مستخدم مسجَّل (نورة ترفع الملف اليومي)
drop policy if exists "perf_cr_insert" on public.perf_change_requests;
create policy "perf_cr_insert" on public.perf_change_requests
  for insert to authenticated with check (public.perf_signed_in());

drop policy if exists "perf_cr_update" on public.perf_change_requests;
create policy "perf_cr_update" on public.perf_change_requests
  for update to authenticated
  using (public.perf_signed_in()) with check (public.perf_signed_in());

-- الحذف النهائي: لمدير الإدارة وحده
drop policy if exists "perf_cr_delete" on public.perf_change_requests;
create policy "perf_cr_delete" on public.perf_change_requests
  for delete to authenticated using (public.perf_is_admin());

grant select, insert, update, delete on public.perf_change_requests to authenticated;
revoke all on public.perf_change_requests from anon;
