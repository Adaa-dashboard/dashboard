-- ===========================================================
-- لوحة متابعة المشروع — مركز أداء
-- نظام الرموز: دخول برمز واحد بدل حساب لكل شخص
-- شغّل هذا الملف من: Supabase → SQL Editor → New query → Run
-- آمن للتشغيل أكثر من مرة (idempotent)
--
-- ⚠️ قبل التشغيل: فعّل الدخول المجهول من
--    Authentication → Sign In / Providers → Anonymous Sign-Ins → Enable
-- ===========================================================

create extension if not exists pgcrypto with schema extensions;

-- ----------------------------------------------------------
-- 0) إزالة نظام الحسابات الفردية السابق (لم يعد مستخدماً)
--    ملاحظة: trigger إنشاء الملف الشخصي يفشل مع المستخدم المجهول
--    (لا بريد ولا اسم) فيمنع الدخول تماماً — لذلك يجب حذفه.
-- ----------------------------------------------------------
drop trigger  if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user() cascade;
drop table    if exists public.profiles cascade;
drop function if exists public.is_editor() cascade;
drop function if exists public.is_owner() cascade;

-- ----------------------------------------------------------
-- 1) جدول الرموز
--    الرمز يُخزَّن مُجزّأً (bcrypt) — لا يظهر نصاً في أي مكان
-- ----------------------------------------------------------
create table if not exists public.access_codes (
  id         bigint generated always as identity primary key,
  label      text        not null,                    -- وصف الرمز (لمن أُعطي)
  code_hash  text        not null,                    -- bcrypt hash
  scopes     text[]      not null default '{view}',   -- الصلاحيات
  active     boolean     not null default true,
  expires_at timestamptz,                             -- null = بلا انتهاء
  created_at timestamptz not null default now()
);

-- لا سياسات على الإطلاق ⇒ لا أحد يقرأ الرموز من الواجهة.
-- الوصول الوحيد عبر دالة redeem_code أدناه (security definer).
alter table public.access_codes enable row level security;

-- ----------------------------------------------------------
-- 2) جلسات الرموز — تربط الزائر المجهول بصلاحيات رمزه
-- ----------------------------------------------------------
create table if not exists public.code_sessions (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  code_id    bigint not null references public.access_codes (id) on delete cascade,
  scopes     text[] not null,
  granted_at timestamptz not null default now()
);

alter table public.code_sessions enable row level security;

drop policy if exists "own_session_read" on public.code_sessions;
create policy "own_session_read" on public.code_sessions
  for select to authenticated
  using (user_id = auth.uid());

-- ----------------------------------------------------------
-- 3) استبدال الرمز بصلاحيات
-- ----------------------------------------------------------
create or replace function public.redeem_code(p_code text)
returns text[] language plpgsql security definer set search_path = public, extensions as $$
declare c record;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select * into c
  from public.access_codes
  where active
    and (expires_at is null or expires_at > now())
    and code_hash = crypt(p_code, code_hash)
  limit 1;

  if not found then
    return null;                       -- رمز خاطئ أو موقوف أو منتهٍ
  end if;

  insert into public.code_sessions (user_id, code_id, scopes)
  values (auth.uid(), c.id, c.scopes)
  on conflict (user_id) do update
    set code_id = excluded.code_id,
        scopes  = excluded.scopes,
        granted_at = now();

  return c.scopes;
end;
$$;

revoke all on function public.redeem_code(text) from public, anon;
grant execute on function public.redeem_code(text) to authenticated;

-- ----------------------------------------------------------
-- 4) فحص الصلاحية — تُستعمل داخل سياسات RLS
-- ----------------------------------------------------------
create or replace function public.has_scope(p_scope text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.code_sessions
    where user_id = auth.uid()
      and (p_scope = any(scopes) or 'admin' = any(scopes))
  );
$$;

-- ----------------------------------------------------------
-- 5) سياسات جداول اللوحة
--    القراءة: يحتاج صلاحية view
--    الكتابة: يحتاج صلاحية التعديل الخاصة بذلك الجزء
-- ----------------------------------------------------------

-- إزالة سياسات النظام السابق
do $$
declare t text; p text;
begin
  foreach t in array array['monthly_actuals', 'detail_cols', 'detail_rows'] loop
    if to_regclass('public.' || t) is null then continue; end if;
    foreach p in array array['read_authenticated','insert_editor','update_editor','delete_editor'] loop
      execute format('drop policy if exists %I on public.%I', p, t);
    end loop;
  end loop;
end;
$$;

-- المنجز الشهري ⇐ edit:monthly
do $$
begin
  if to_regclass('public.monthly_actuals') is null then
    raise notice 'تخطّي monthly_actuals: الجدول غير موجود';
    return;
  end if;

  execute 'alter table public.monthly_actuals enable row level security';

  execute 'drop policy if exists "ma_read" on public.monthly_actuals';
  execute 'create policy "ma_read" on public.monthly_actuals
             for select to authenticated using (public.has_scope(''view''))';

  execute 'drop policy if exists "ma_insert" on public.monthly_actuals';
  execute 'create policy "ma_insert" on public.monthly_actuals
             for insert to authenticated with check (public.has_scope(''edit:monthly''))';

  execute 'drop policy if exists "ma_update" on public.monthly_actuals';
  execute 'create policy "ma_update" on public.monthly_actuals
             for update to authenticated using (public.has_scope(''edit:monthly''))
             with check (public.has_scope(''edit:monthly''))';

  execute 'drop policy if exists "ma_delete" on public.monthly_actuals';
  execute 'create policy "ma_delete" on public.monthly_actuals
             for delete to authenticated using (public.has_scope(''edit:monthly''))';
end;
$$;

-- تفاصيل المخرجات ⇐ edit:details:N  (N = رقم المخرج 1..4)
-- output_idx يبدأ من 0 في الكود، فالصلاحية تُحسب بـ output_idx + 1
do $$
declare t text;
begin
  foreach t in array array['detail_cols', 'detail_rows'] loop
    if to_regclass('public.' || t) is null then
      raise notice 'تخطّي %: الجدول غير موجود', t;
      continue;
    end if;

    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists "det_read" on public.%I', t);
    execute format('create policy "det_read" on public.%I
                      for select to authenticated using (public.has_scope(''view''))', t);

    execute format('drop policy if exists "det_insert" on public.%I', t);
    execute format('create policy "det_insert" on public.%I
                      for insert to authenticated
                      with check (public.has_scope(''edit:details:'' || (output_idx + 1)))', t);

    execute format('drop policy if exists "det_update" on public.%I', t);
    execute format('create policy "det_update" on public.%I
                      for update to authenticated
                      using      (public.has_scope(''edit:details:'' || (output_idx + 1)))
                      with check (public.has_scope(''edit:details:'' || (output_idx + 1)))', t);

    execute format('drop policy if exists "det_delete" on public.%I', t);
    execute format('create policy "det_delete" on public.%I
                      for delete to authenticated
                      using (public.has_scope(''edit:details:'' || (output_idx + 1)))', t);
  end loop;
end;
$$;

-- ----------------------------------------------------------
-- 6) إدارة الرموز — استعملي هذه الدوال من SQL Editor
-- ----------------------------------------------------------

-- إنشاء أو تحديث رمز
create or replace function public.set_code(p_label text, p_code text, p_scopes text[])
returns bigint language plpgsql security definer set search_path = public, extensions as $$
declare v_id bigint;
begin
  select id into v_id from public.access_codes where label = p_label;
  if found then
    update public.access_codes
       set code_hash = crypt(p_code, gen_salt('bf')), scopes = p_scopes, active = true
     where id = v_id;
  else
    insert into public.access_codes (label, code_hash, scopes)
    values (p_label, crypt(p_code, gen_salt('bf')), p_scopes)
    returning id into v_id;
  end if;
  return v_id;
end;
$$;

revoke all on function public.set_code(text, text, text[]) from public, anon, authenticated;

-- إيقاف رمز (يطرد كل من يستخدمه فوراً)
create or replace function public.revoke_code(p_label text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.access_codes set active = false where label = p_label;
  delete from public.code_sessions
   where code_id in (select id from public.access_codes where label = p_label);
end;
$$;

revoke all on function public.revoke_code(text) from public, anon, authenticated;

-- ===========================================================
-- الصلاحيات المتاحة:
--   view              مشاهدة اللوحة
--   edit:monthly      تعديل المنجز الشهري
--   edit:details:1    تعديل تفاصيل م1 (مراجعة الاستراتيجيات)
--   edit:details:2    تعديل تفاصيل م2 (قياس المؤشرات)
--   edit:details:3    تعديل تفاصيل م3 (التزام التوثيق)
--   edit:details:4    تعديل تفاصيل م4 (الطلبات الواردة)
--   admin             كل شيء
--
-- أمثلة — غيّري الرموز إلى رموز من عندك:
--   select public.set_code('المدير',      'ADAA-ADMIN-2026', array['admin']);
--   select public.set_code('عرض عام',     'ADAA-VIEW-2026',  array['view']);
--   select public.set_code('فريق الإدخال','ADAA-EDIT-2026',
--          array['view','edit:monthly','edit:details:1','edit:details:2',
--                'edit:details:3','edit:details:4']);
--   select public.set_code('مسؤول م1',    'ADAA-M1-2026',
--          array['view','edit:details:1']);
--
-- عرض الرموز الحالية وصلاحياتها (بدون كشف الرمز نفسه):
--   select label, scopes, active, expires_at from public.access_codes order by id;
--
-- إيقاف رمز:
--   select public.revoke_code('مسؤول م1');
-- ===========================================================
