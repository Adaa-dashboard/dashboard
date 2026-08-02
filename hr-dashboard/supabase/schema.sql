-- ===========================================================
-- داشبورد إدارة استقطاب المواهب — مركز أداء
-- مخطّط قاعدة البيانات (Supabase / PostgreSQL)
-- شغّل هذا الملف مرة واحدة من: Supabase → SQL Editor → New query
-- ===========================================================

-- ------------------------- المستخدمون والصلاحيات -------------------------
-- role: 'owner'  = مالك الداشبورد — كل الصلاحيات + تعديل العناوين
--       'editor' = مُدخِل بيانات — إضافة/تعديل/حذف البيانات
--       'viewer' = عرض فقط (الإدارة)
create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  full_name  text not null,
  role       text not null default 'viewer' check (role in ('owner', 'editor', 'viewer')),
  created_at timestamptz not null default now()
);

-- إنشاء ملف تعريف تلقائيًا لكل مستخدم جديد
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, role)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.email), 'viewer')
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- دالة مساعدة: هل المستخدم الحالي مُدخِل بيانات؟
create or replace function public.is_editor()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('owner', 'editor'));
$$;

-- ------------------------- الهيكل التنظيمي -------------------------
create table if not exists public.org_units (
  id         text primary key default gen_random_uuid()::text,
  name       text not null,
  parent_id  text references public.org_units (id) on delete cascade,
  approved   integer not null default 0,   -- الوظائف المعتمدة
  filled     integer not null default 0,   -- الوظائف المشغولة
  junior     integer not null default 0,   -- مبتدئ
  senior     integer not null default 0,   -- متقدم
  male       integer not null default 0,   -- ذكور
  female     integer not null default 0,   -- إناث
  created_at timestamptz not null default now()
);
create index if not exists org_units_parent_idx on public.org_units (parent_id);

-- ------------------------- الوظائف الشاغرة -------------------------
create table if not exists public.vacancies (
  id         text primary key default gen_random_uuid()::text,
  unit_id    text references public.org_units (id) on delete set null,
  title      text,
  count      integer not null default 0,   -- عدد الشواغر
  received   integer not null default 0,   -- الطلبات المستلمة
  status     text default 'مفتوحة',
  year       integer,
  month      integer,
  created_at timestamptz not null default now()
);

-- ------------------------- المرشحون ومراحلهم -------------------------
-- stage: 0=المقابلة 1=العرض الأولي 2=المسح الأمني 3=الفحص الطبي 4=العرض النهائي 5=الانضمام
create table if not exists public.candidates (
  id         text primary key default gen_random_uuid()::text,
  name       text not null,
  position   text,
  unit_id    text references public.org_units (id) on delete set null,
  stage      integer not null default 0 check (stage between 0 and 5),
  note       text,
  year       integer,
  month      integer,
  created_at timestamptz not null default now()
);

-- ------------------------- المقابلات -------------------------
create table if not exists public.interviews (
  id               text primary key default gen_random_uuid()::text,
  candidate        text not null,
  position         text,
  unit_id          text references public.org_units (id) on delete set null,
  owner            text,               -- مالك الوظيفة
  status           text default 'مجدولة' check (status in ('مجدولة', 'تمت', 'مرفوضة')),
  date             text,
  day              text,
  time             text,
  job_source       text,
  cand_source      text,
  cand_source_name text,
  hr_rating        text,
  mgr_rating       text,
  year             integer,
  month            integer,
  created_at       timestamptz not null default now()
);

-- ------------------------- الانضمام -------------------------
create table if not exists public.onboarding (
  id         text primary key default gen_random_uuid()::text,
  name       text not null,
  position   text,
  grade      text,
  start_date text,
  notes      text,
  year       integer,
  month      integer,
  created_at timestamptz not null default now()
);

-- ------------------------- المتدربون -------------------------
create table if not exists public.trainees (
  id         text primary key default gen_random_uuid()::text,
  name       text not null,
  university text,
  supervisor text,
  unit_id    text references public.org_units (id) on delete set null,
  start_date text,
  end_date   text,
  phone      text,
  status     text default 'قائم' check (status in ('قائم', 'تحت الإجراء', 'مكتمل')),
  year       integer,
  month      integer,
  created_at timestamptz not null default now()
);

-- ------------------------- الاستقالات -------------------------
create table if not exists public.resignations (
  id         text primary key default gen_random_uuid()::text,
  name       text not null,
  position   text,
  grade      text,
  unit_id    text references public.org_units (id) on delete set null,
  last_day   text,
  reason     text,
  year       integer,
  month      integer,
  created_at timestamptz not null default now()
);

-- ------------------------- الإعدادات والعناوين -------------------------
create table if not exists public.settings (
  id    text primary key default gen_random_uuid()::text,
  key   text unique not null,
  value text
);

insert into public.settings (key, value) values ('training_target', '80')
  on conflict (key) do nothing;
insert into public.settings (key, value) values ('titles', '{}')
  on conflict (key) do nothing;

-- ===========================================================
-- سياسات الحماية (RLS): الجميع يقرأ بعد تسجيل الدخول،
-- والكتابة لمُدخِلي البيانات فقط.
-- ===========================================================
do $$
declare t text;
begin
  foreach t in array array['profiles','org_units','vacancies','candidates','interviews',
                           'onboarding','trainees','resignations','settings']
  loop
    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists "read_all" on public.%I', t);
    execute format('create policy "read_all" on public.%I for select to authenticated using (true)', t);

    if t <> 'profiles' then
      execute format('drop policy if exists "write_editor" on public.%I', t);
      execute format('create policy "write_editor" on public.%I for insert to authenticated with check (public.is_editor())', t);

      execute format('drop policy if exists "update_editor" on public.%I', t);
      execute format('create policy "update_editor" on public.%I for update to authenticated using (public.is_editor()) with check (public.is_editor())', t);

      execute format('drop policy if exists "delete_editor" on public.%I', t);
      execute format('create policy "delete_editor" on public.%I for delete to authenticated using (public.is_editor())', t);
    end if;
  end loop;
end $$;

-- ===========================================================
-- بيانات ابتدائية للهيكل التنظيمي (اختيارية — عدّلها بهيكلكم الحقيقي)
-- ===========================================================
insert into public.org_units (id, name, parent_id, approved, filled, junior, senior, male, female) values
  ('s1',   'قطاع الأداء',                      null,  0, 0, 0, 0, 0, 0),
  ('s1a',  'إدارة قياس الأداء',                's1',  0, 0, 0, 0, 0, 0),
  ('s1a1', 'قسم المؤشرات',                     's1a', 11, 10, 7, 3, 6, 4),
  ('s1a2', 'قسم التقارير',                     's1a',  9,  8, 5, 3, 4, 4),
  ('s1b',  'إدارة تطوير الأداء',               's1',  16, 14, 8, 6, 8, 6),
  ('s1c',  'إدارة تحليل البيانات',             's1',  12, 10, 6, 4, 7, 3),
  ('s2',   'قطاع الخدمات المشتركة',            null,  0, 0, 0, 0, 0, 0),
  ('s2a',  'إدارة الموارد البشرية',            's2',  12, 11, 7, 4, 5, 6),
  ('s2b',  'إدارة تقنية المعلومات',            's2',  13, 12, 8, 4, 8, 4),
  ('s2c',  'إدارة الشؤون المالية',             's2',   8,  7, 4, 3, 4, 3),
  ('s2d',  'إدارة المشتريات والعقود',          's2',   6,  5, 3, 2, 2, 3),
  ('s3',   'الإدارة القانونية',                null,  0, 0, 0, 0, 0, 0),
  ('s3a',  'قسم العقود',                       's3',   8,  6, 3, 3, 4, 2),
  ('s3b',  'قسم التقاضي',                      's3',   6,  5, 2, 3, 3, 2),
  ('s4',   'مكتب المدير العام',                null,   9,  8, 3, 5, 5, 3),
  ('s5',   'إدارة الحوكمة والمخاطر والالتزام', null,   0, 0, 0, 0, 0, 0),
  ('s5a',  'قسم الحوكمة',                      's5',   9,  7, 4, 3, 4, 3),
  ('s5b',  'قسم المخاطر والالتزام',            's5',  10,  8, 5, 3, 4, 4),
  ('s5c',  'مكتب البيانات',                    's5',   8,  7, 4, 3, 4, 3),
  ('s6',   'مكتب التحول الاستراتيجي',          null,   0, 0, 0, 0, 0, 0),
  ('s6a',  'قسم إدارة المشاريع',               's6',  12, 10, 7, 3, 6, 4),
  ('s6b',  'قسم التخطيط',                      's6',   9,  7, 4, 3, 4, 3),
  ('s7',   'المراجعة الداخلية',                null,  18, 15, 8, 7, 9, 6)
on conflict (id) do nothing;
