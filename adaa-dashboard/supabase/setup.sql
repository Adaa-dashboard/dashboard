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

  insert into public.audit_log (username, tbl, op)
  values (u.username, '(دخول)', 'LOGIN');

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

  insert into public.audit_log (username, tbl, op, row_key, new_data)
  values (public.cur_username(), '(مستخدمون)', 'USER_SAVE', v_user,
          jsonb_build_object('scopes', p_scopes, 'active', p_active,
                             'code_changed', coalesce(p_code, '') <> ''));
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

  insert into public.audit_log (username, tbl, op, row_key)
  values (public.cur_username(), '(مستخدمون)', 'USER_DELETE', v_user);

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

-- ----------------------------------------------------------
-- 6.5) خطة الكميات والفواتير — كانت محفوظة في المتصفح فقط
--      صلاحية التعديل: edit:plan
-- ----------------------------------------------------------
create table if not exists public.plan_months (
  month_num  int primary key,
  m1 int not null default 0,
  m2 int not null default 0,
  m3 int not null default 0,
  m4 int not null default 0,
  inv_ex     numeric(14,2) not null default 0,   -- الفاتورة بدون ضريبة
  paid       boolean not null default false,
  actual_pay numeric(14,2),                      -- null = يُحسب تلقائياً
  updated_at timestamptz not null default now()
);

alter table public.plan_months enable row level security;

drop policy if exists "plan_read"   on public.plan_months;
drop policy if exists "plan_insert" on public.plan_months;
drop policy if exists "plan_update" on public.plan_months;
drop policy if exists "plan_delete" on public.plan_months;

create policy "plan_read"   on public.plan_months for select to authenticated
  using (public.has_scope('view'));
create policy "plan_insert" on public.plan_months for insert to authenticated
  with check (public.has_scope('edit:plan'));
create policy "plan_update" on public.plan_months for update to authenticated
  using (public.has_scope('edit:plan')) with check (public.has_scope('edit:plan'));
create policy "plan_delete" on public.plan_months for delete to authenticated
  using (public.has_scope('edit:plan'));

-- ----------------------------------------------------------
-- 7) سجل التعديلات — من عدّل، ماذا، ومتى
--    يُكتب من داخل قاعدة البيانات (triggers) فلا يمكن للواجهة تجاوزه
-- ----------------------------------------------------------
create table if not exists public.audit_log (
  id        bigint generated always as identity primary key,
  at        timestamptz not null default now(),
  username  text        not null,
  tbl       text        not null,
  op        text        not null,
  row_key   text,
  old_data  jsonb,
  new_data  jsonb
);

create index if not exists audit_log_at_idx on public.audit_log (at desc);

alter table public.audit_log enable row level security;

drop policy if exists "audit_read_admin" on public.audit_log;
create policy "audit_read_admin" on public.audit_log
  for select to authenticated
  using (public.has_scope('admin'));

-- اسم المستخدم الحالي (للاستخدام داخل الـ triggers والدوال)
create or replace function public.cur_username()
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select username from public.code_sessions where user_id = auth.uid()),
    '(غير معروف)');
$$;

-- سجل صفّي — للمنجز الشهري (15 صفاً فقط، تغييراته قليلة)
create or replace function public.audit_row()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_old jsonb; v_new jsonb; v_key text;
begin
  if TG_OP <> 'INSERT' then v_old := to_jsonb(OLD); end if;
  if TG_OP <> 'DELETE' then v_new := to_jsonb(NEW); end if;

  -- لا تسجّل تحديثاً لم يغيّر شيئاً فعلياً
  if TG_OP = 'UPDATE' and (v_old - 'updated_at') = (v_new - 'updated_at') then
    return NEW;
  end if;

  v_key := coalesce(v_new, v_old) ->> 'month_num';

  insert into public.audit_log (username, tbl, op, row_key, old_data, new_data)
  values (public.cur_username(), TG_TABLE_NAME, TG_OP, v_key, v_old, v_new);

  if TG_OP = 'DELETE' then return OLD; else return NEW; end if;
end;
$$;

-- سجل مُجمَّع — لجداول التفاصيل (تُحفظ بحذف الصفوف وإعادة إدراجها،
-- فالتسجيل صفّاً صفّاً يغرق السجل بمئات الأسطر لكل حفظة)
create or replace function public.audit_detail_old()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_idx text; v_n int;
begin
  select string_agg(distinct (output_idx + 1)::text, '، '), count(*)
    into v_idx, v_n from old_rows;
  if coalesce(v_n, 0) = 0 then return null; end if;
  insert into public.audit_log (username, tbl, op, row_key, old_data)
  values (public.cur_username(), TG_TABLE_NAME, TG_OP, v_idx,
          jsonb_build_object('rows', v_n));
  return null;
end;
$$;

create or replace function public.audit_detail_new()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_idx text; v_n int;
begin
  select string_agg(distinct (output_idx + 1)::text, '، '), count(*)
    into v_idx, v_n from new_rows;
  if coalesce(v_n, 0) = 0 then return null; end if;
  insert into public.audit_log (username, tbl, op, row_key, new_data)
  values (public.cur_username(), TG_TABLE_NAME, TG_OP, v_idx,
          jsonb_build_object('rows', v_n));
  return null;
end;
$$;

-- تركيب الـ triggers
do $$
declare t text;
begin
  if to_regclass('public.monthly_actuals') is not null then
    execute 'drop trigger if exists audit_ma on public.monthly_actuals';
    execute 'create trigger audit_ma after insert or update or delete
               on public.monthly_actuals for each row execute function public.audit_row()';
  end if;

  if to_regclass('public.plan_months') is not null then
    execute 'drop trigger if exists audit_plan on public.plan_months';
    execute 'create trigger audit_plan after insert or update or delete
               on public.plan_months for each row execute function public.audit_row()';
  end if;

  foreach t in array array['detail_cols', 'detail_rows'] loop
    if to_regclass('public.' || t) is null then continue; end if;

    execute format('drop trigger if exists audit_%s_del on public.%I', t, t);
    execute format('create trigger audit_%s_del after delete on public.%I
                      referencing old table as old_rows
                      for each statement execute function public.audit_detail_old()', t, t);

    execute format('drop trigger if exists audit_%s_ins on public.%I', t, t);
    execute format('create trigger audit_%s_ins after insert on public.%I
                      referencing new table as new_rows
                      for each statement execute function public.audit_detail_new()', t, t);

    execute format('drop trigger if exists audit_%s_upd on public.%I', t, t);
    execute format('create trigger audit_%s_upd after update on public.%I
                      referencing new table as new_rows
                      for each statement execute function public.audit_detail_new()', t, t);
  end loop;
end;
$$;

-- قراءة السجل (للمدير فقط)
create or replace function public.audit_recent(p_limit int default 200)
returns table (
  at timestamptz, username text, tbl text, op text,
  row_key text, old_data jsonb, new_data jsonb
)
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_scope('admin') then raise exception 'forbidden'; end if;
  return query
    select a.at, a.username, a.tbl, a.op, a.row_key, a.old_data, a.new_data
    from public.audit_log a
    order by a.at desc
    limit least(greatest(coalesce(p_limit, 200), 1), 1000);
end;
$$;

revoke all on function public.audit_recent(int) from public, anon;
grant execute on function public.audit_recent(int) to authenticated;

-- تنظيف السجل القديم (من SQL Editor عند الحاجة)
create or replace function public.audit_prune(p_days int default 180)
returns bigint language plpgsql security definer set search_path = public as $$
declare n bigint;
begin
  delete from public.audit_log where at < now() - (p_days || ' days')::interval;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.audit_prune(int) from public, anon, authenticated;

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
--   edit:plan       تعديل خطة الكميات والفواتير
--   edit:details:1  تفاصيل م1 — مراجعة الاستراتيجيات
--   edit:details:2  تفاصيل م2 — قياس المؤشرات
--   edit:details:3  تفاصيل م3 — التزام التوثيق
--   edit:details:4  تفاصيل م4 — الطلبات الواردة
--   admin           كل الصلاحيات + إدارة المستخدمين
-- ===========================================================
