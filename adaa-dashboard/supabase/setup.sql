-- ===========================================================
-- لوحة متابعة المشروع — مركز أداء
-- الملف الوحيد للإعداد: مستخدمون (اسم + رمز) وصلاحيات وحماية RLS
-- شغّله من: Supabase → SQL Editor → New query → Run
-- آمن للتشغيل أكثر من مرة، ويحذف بقايا أي إعداد سابق
--
-- ⚠️ قبل التشغيل: فعّل الدخول المجهول من
--    Authentication → Sign In / Providers → Anonymous Sign-Ins → Enable
--    (اللوحة تفتح جلسة مجهولة ثم تستبدلها باسم المستخدم والرمز)
-- ===========================================================

create extension if not exists pgcrypto with schema extensions;

-- ----------------------------------------------------------
-- 0) تنظيف الإعدادات السابقة
-- ----------------------------------------------------------
drop trigger  if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user()      cascade;
drop table    if exists public.profiles                cascade;
drop function if exists public.is_editor()             cascade;
drop function if exists public.is_owner()              cascade;
drop function if exists public.redeem_code(text)       cascade;
drop function if exists public.set_code(text,text,text[]) cascade;
drop function if exists public.revoke_code(text)       cascade;
drop table    if exists public.code_sessions           cascade;
drop table    if exists public.access_codes            cascade;

-- ----------------------------------------------------------
-- 1) المستخدمون — اسم المستخدم + رمز مُجزّأ
--    username: اسم أو رقم جوال أو يوزر — أي نص تختارينه
-- ----------------------------------------------------------
create table if not exists public.app_users (
  id           bigint generated always as identity primary key,
  username     text        not null unique,
  display_name text,
  code_hash    text        not null,
  scopes       text[]      not null default '{view}',
  active       boolean     not null default true,
  created_at   timestamptz not null default now(),
  last_login   timestamptz
);

-- لا سياسات ⇒ لا أحد يقرأ الجدول من الواجهة إطلاقاً.
-- كل وصول يمرّ عبر دوال security definer أدناه.
alter table public.app_users enable row level security;

-- توحيد اسم المستخدم: حروف صغيرة بلا مسافات طرفية
create or replace function public.norm_user(p text)
returns text language sql immutable as $$
  select lower(btrim(coalesce(p, '')));
$$;

-- ----------------------------------------------------------
-- 2) الجلسات — تربط الزائر المجهول بمستخدم وصلاحياته
-- ----------------------------------------------------------
create table if not exists public.code_sessions (
  user_id     uuid   primary key references auth.users (id) on delete cascade,
  app_user_id bigint not null references public.app_users (id) on delete cascade,
  username    text   not null,
  scopes      text[] not null,
  granted_at  timestamptz not null default now()
);

alter table public.code_sessions enable row level security;

drop policy if exists "own_session_read" on public.code_sessions;
create policy "own_session_read" on public.code_sessions
  for select to authenticated
  using (user_id = auth.uid());

-- ----------------------------------------------------------
-- 3) تسجيل الدخول
-- ----------------------------------------------------------
create or replace function public.login(p_username text, p_code text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare u record;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select * into u
  from public.app_users
  where username = public.norm_user(p_username)
    and active
    and code_hash = crypt(p_code, code_hash);

  if not found then
    return null;                       -- اسم أو رمز خاطئ، أو الحساب موقوف
  end if;

  insert into public.code_sessions (user_id, app_user_id, username, scopes)
  values (auth.uid(), u.id, u.username, u.scopes)
  on conflict (user_id) do update
    set app_user_id = excluded.app_user_id,
        username    = excluded.username,
        scopes      = excluded.scopes,
        granted_at  = now();

  update public.app_users set last_login = now() where id = u.id;

  return jsonb_build_object(
    'username', u.username,
    'name',     coalesce(u.display_name, u.username),
    'scopes',   u.scopes
  );
end;
$$;

revoke all on function public.login(text, text) from public, anon;
grant execute on function public.login(text, text) to authenticated;

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
-- 5) إدارة المستخدمين من داخل اللوحة (تتطلب صلاحية admin)
-- ----------------------------------------------------------

-- قائمة المستخدمين — بلا كشف أي رمز
create or replace function public.admin_list_users()
returns table (
  username text, display_name text, scopes text[],
  active boolean, last_login timestamptz
)
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_scope('admin') then raise exception 'forbidden'; end if;
  return query
    select u.username, u.display_name, u.scopes, u.active, u.last_login
    from public.app_users u order by u.username;
end;
$$;

-- إضافة أو تعديل مستخدم — p_code فارغ يعني: أبقِ الرمز الحالي
create or replace function public.admin_save_user(
  p_username text, p_name text, p_code text, p_scopes text[], p_active boolean
) returns void language plpgsql security definer set search_path = public, extensions as $$
declare v_user text := public.norm_user(p_username);
begin
  if not public.has_scope('admin') then raise exception 'forbidden'; end if;
  if v_user = '' then raise exception 'اسم المستخدم مطلوب'; end if;

  -- لا تسمحي بإزالة آخر مدير نشط
  if exists (select 1 from public.app_users
             where username = v_user and 'admin' = any(scopes) and active)
     and not ('admin' = any(p_scopes) and p_active)
     and (select count(*) from public.app_users
          where 'admin' = any(scopes) and active) <= 1 then
    raise exception 'لا يمكن إزالة آخر مدير — عيّني مديراً آخر أولاً';
  end if;

  if exists (select 1 from public.app_users where username = v_user) then
    update public.app_users
       set display_name = nullif(btrim(coalesce(p_name, '')), ''),
           scopes       = p_scopes,
           active       = p_active,
           code_hash    = case when coalesce(p_code, '') = ''
                               then code_hash
                               else crypt(p_code, gen_salt('bf')) end
     where username = v_user;
  else
    if coalesce(p_code, '') = '' then raise exception 'الرمز مطلوب للمستخدم الجديد'; end if;
    insert into public.app_users (username, display_name, code_hash, scopes, active)
    values (v_user, nullif(btrim(coalesce(p_name, '')), ''),
            crypt(p_code, gen_salt('bf')), p_scopes, p_active);
  end if;

  -- حدّثي جلسات هذا المستخدم فوراً حتى تسري الصلاحيات الجديدة
  update public.code_sessions cs
     set scopes = u.scopes
    from public.app_users u
   where u.username = v_user and cs.app_user_id = u.id;

  -- الحساب الموقوف تُنهى جلساته
  delete from public.code_sessions cs
   using public.app_users u
   where u.username = v_user and cs.app_user_id = u.id and not u.active;
end;
$$;

-- حذف مستخدم
create or replace function public.admin_delete_user(p_username text)
returns void language plpgsql security definer set search_path = public as $$
declare v_user text := public.norm_user(p_username);
begin
  if not public.has_scope('admin') then raise exception 'forbidden'; end if;

  if exists (select 1 from public.app_users
             where username = v_user and 'admin' = any(scopes) and active)
     and (select count(*) from public.app_users
          where 'admin' = any(scopes) and active) <= 1 then
    raise exception 'لا يمكن حذف آخر مدير';
  end if;

  delete from public.app_users where username = v_user;
end;
$$;

revoke all on function public.admin_list_users()                          from public, anon;
revoke all on function public.admin_save_user(text,text,text,text[],boolean) from public, anon;
revoke all on function public.admin_delete_user(text)                     from public, anon;
grant execute on function public.admin_list_users()                          to authenticated;
grant execute on function public.admin_save_user(text,text,text,text[],boolean) to authenticated;
grant execute on function public.admin_delete_user(text)                     to authenticated;

-- إنشاء أول مدير من SQL Editor فقط (لا يُستدعى من اللوحة)
create or replace function public.bootstrap_admin(p_username text, p_code text, p_name text default null)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  insert into public.app_users (username, display_name, code_hash, scopes, active)
  values (public.norm_user(p_username), p_name, crypt(p_code, gen_salt('bf')), array['admin'], true)
  on conflict (username) do update
    set code_hash = excluded.code_hash, scopes = array['admin'], active = true;
end;
$$;

revoke all on function public.bootstrap_admin(text, text, text) from public, anon, authenticated;

-- ----------------------------------------------------------
-- 6) سياسات جداول اللوحة
-- ----------------------------------------------------------
do $$
declare t text; p text;
begin
  foreach t in array array['monthly_actuals', 'detail_cols', 'detail_rows'] loop
    if to_regclass('public.' || t) is null then continue; end if;
    foreach p in array array['read_authenticated','insert_editor','update_editor','delete_editor',
                             'ma_read','ma_insert','ma_update','ma_delete',
                             'det_read','det_insert','det_update','det_delete'] loop
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
  execute 'create policy "ma_read"   on public.monthly_actuals for select to authenticated
             using (public.has_scope(''view''))';
  execute 'create policy "ma_insert" on public.monthly_actuals for insert to authenticated
             with check (public.has_scope(''edit:monthly''))';
  execute 'create policy "ma_update" on public.monthly_actuals for update to authenticated
             using (public.has_scope(''edit:monthly'')) with check (public.has_scope(''edit:monthly''))';
  execute 'create policy "ma_delete" on public.monthly_actuals for delete to authenticated
             using (public.has_scope(''edit:monthly''))';
end;
$$;

-- تفاصيل المخرجات ⇐ edit:details:N   (N = output_idx + 1)
do $$
declare t text;
begin
  foreach t in array array['detail_cols', 'detail_rows'] loop
    if to_regclass('public.' || t) is null then
      raise notice 'تخطّي %: الجدول غير موجود', t;
      continue;
    end if;
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "det_read" on public.%I for select to authenticated
                      using (public.has_scope(''view''))', t);
    execute format('create policy "det_insert" on public.%I for insert to authenticated
                      with check (public.has_scope(''edit:details:'' || (output_idx + 1)))', t);
    execute format('create policy "det_update" on public.%I for update to authenticated
                      using      (public.has_scope(''edit:details:'' || (output_idx + 1)))
                      with check (public.has_scope(''edit:details:'' || (output_idx + 1)))', t);
    execute format('create policy "det_delete" on public.%I for delete to authenticated
                      using (public.has_scope(''edit:details:'' || (output_idx + 1)))', t);
  end loop;
end;
$$;

-- ===========================================================
-- الخطوة الأخيرة — أنشئي أول مدير (غيّري الاسم والرمز):
--
--   select public.bootstrap_admin('sultana', 'رمز-قوي-هنا', 'سلطانه العرجاني');
--
-- بعدها ادخلي اللوحة بهذا الاسم والرمز، واضغطي ⚙️ الإعدادات
-- لإضافة بقية الأشخاص وتحديد صلاحية كل واحد — بدون SQL.
--
-- الصلاحيات المتاحة:
--   view            مشاهدة اللوحة
--   edit:monthly    تعديل المنجز الشهري
--   edit:details:1  تفاصيل م1 — مراجعة الاستراتيجيات
--   edit:details:2  تفاصيل م2 — قياس المؤشرات
--   edit:details:3  تفاصيل م3 — التزام التوثيق
--   edit:details:4  تفاصيل م4 — الطلبات الواردة
--   admin           كل الصلاحيات + إدارة المستخدمين
-- ===========================================================
