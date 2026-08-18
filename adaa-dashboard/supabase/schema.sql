-- ===========================================================
-- لوحة متابعة المشروع — مركز أداء
-- تفعيل تسجيل الدخول وحماية الصفوف (RLS)
-- شغّل هذا الملف مرة واحدة من: Supabase → SQL Editor → New query → Run
-- آمن للتشغيل أكثر من مرة (idempotent)
-- ===========================================================

-- ------------------------- الأدوار -------------------------
-- owner  = مالك اللوحة — كل الصلاحيات + إدارة المستخدمين
-- editor = مُدخِل بيانات — إضافة/تعديل/حذف بيانات اللوحة
-- viewer = عرض فقط
create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  full_name  text not null,
  role       text not null default 'viewer' check (role in ('owner', 'editor', 'viewer')),
  created_at timestamptz not null default now()
);

-- إنشاء ملف تعريف تلقائيًا لكل مستخدم جديد (بدور viewer افتراضيًا)
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, role)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.email), 'viewer')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------- دوال الصلاحيات -------------------------
-- security definer حتى لا تدخل في حلقة لا نهائية مع سياسات جدول profiles
create or replace function public.is_editor()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('owner', 'editor')
  );
$$;

create or replace function public.is_owner()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'owner'
  );
$$;

-- ------------------------- حماية جدول profiles -------------------------
alter table public.profiles enable row level security;

drop policy if exists "profiles_read" on public.profiles;
create policy "profiles_read" on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_owner());

drop policy if exists "profiles_manage" on public.profiles;
create policy "profiles_manage" on public.profiles
  for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

-- ------------------------- حماية جداول اللوحة -------------------------
-- القراءة: لكل من سجّل دخوله. الكتابة والحذف: للمحررين والمالك فقط.
-- أي زائر لم يسجّل دخوله (دور anon) لا يملك أي سياسة ⇒ لا يرى ولا يكتب شيئًا.
do $$
declare t text;
begin
  foreach t in array array['monthly_actuals', 'detail_cols', 'detail_rows']
  loop
    if to_regclass('public.' || t) is null then
      raise notice 'تخطّي %: الجدول غير موجود', t;
      continue;
    end if;

    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists "read_authenticated" on public.%I', t);
    execute format(
      'create policy "read_authenticated" on public.%I for select to authenticated using (true)', t);

    execute format('drop policy if exists "insert_editor" on public.%I', t);
    execute format(
      'create policy "insert_editor" on public.%I for insert to authenticated with check (public.is_editor())', t);

    execute format('drop policy if exists "update_editor" on public.%I', t);
    execute format(
      'create policy "update_editor" on public.%I for update to authenticated using (public.is_editor()) with check (public.is_editor())', t);

    execute format('drop policy if exists "delete_editor" on public.%I', t);
    execute format(
      'create policy "delete_editor" on public.%I for delete to authenticated using (public.is_editor())', t);
  end loop;
end;
$$;

-- ===========================================================
-- بعد التشغيل:
-- 1) أنشئ المستخدمين من: Authentication → Users → Add user
--    (فعّل Auto Confirm User حتى لا يحتاج تأكيد البريد)
-- 2) ارفع دورك أنت إلى owner:
--      update public.profiles set role = 'owner'
--      where id = (select id from auth.users where email = 'ضع-بريدك-هنا');
-- 3) امنح بقية الفريق دور editor:
--      update public.profiles set role = 'editor'
--      where id in (select id from auth.users where email in ('a@x.com', 'b@x.com'));
-- 4) تحقّق أن الحماية فعّالة:
--      select relname, relrowsecurity from pg_class
--      where relname in ('monthly_actuals','detail_cols','detail_rows','profiles');
--    يجب أن تكون relrowsecurity = true للجميع.
-- ===========================================================
