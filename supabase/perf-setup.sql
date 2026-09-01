-- ============================================================
--  لوحة إدارة عمليات الأداء — إعداد قاعدة Supabase
--  يُشغَّل مرة واحدة من SQL Editor. آمن للتكرار (idempotent).
--
--  ⚠️ كل جدول ودالة هنا يبدأ بـ perf_ ولا يوجد في هذا الملف أمر
--     drop واحد لأي كائن خارج هذه البادئة — فلا يمسّ أي لوحة أخرى
--     تشارك القاعدة نفسها.
-- ============================================================

create extension if not exists pgcrypto with schema extensions;

-- ------------------------------------------------------------
-- 1) المستخدمون
--    كلمة المرور مُجزّأة بـ bcrypt داخل القاعدة، ولا تخرج أبداً:
--    الجدول بلا أي سياسة قراءة، وكل وصول عبر دوال security definer.
-- ------------------------------------------------------------
create table if not exists public.perf_users (
  id           bigint generated always as identity primary key,
  username     text        not null unique,
  display_name text        not null,
  phone        text        not null,
  pass_hash    text,                                   -- فارغ = بانتظار التفعيل
  role         text        not null default 'manager'
               check (role in ('admin','manager')),
  sector_ids   text[]      not null default '{}',
  active       boolean     not null default true,
  created_at   timestamptz not null default now(),
  last_login   timestamptz
);
alter table public.perf_users enable row level security;

create or replace function public.perf_norm_user(p text)
returns text language sql immutable as $$
  select lower(btrim(coalesce(p, '')));
$$;

-- توحيد رقم الجوال إلى 9665XXXXXXXX — نفس منطق الواجهة
create or replace function public.perf_norm_phone(p text)
returns text language plpgsql immutable as $$
declare s text;
begin
  s := regexp_replace(coalesce(p,''), '[^0-9+]', '', 'g');
  s := ltrim(s, '+');
  if left(s,2) = '00' then s := substr(s,3); end if;
  if left(s,1) = '0' then s := '966' || substr(s,2);
  elsif left(s,3) <> '966' and length(s) = 9 then s := '966' || s;
  end if;
  return s;
end;
$$;

-- ------------------------------------------------------------
-- 2) الجلسات — تربط الزائر المجهول بحسابه وصلاحياته
-- ------------------------------------------------------------
create table if not exists public.perf_sessions (
  user_id     uuid   primary key references auth.users (id) on delete cascade,
  app_user_id bigint not null references public.perf_users (id) on delete cascade,
  username    text   not null,
  display_name text  not null,
  role        text   not null,
  sector_ids  text[] not null,
  granted_at  timestamptz not null default now()
);
alter table public.perf_sessions enable row level security;

drop policy if exists "perf_own_session" on public.perf_sessions;
create policy "perf_own_session" on public.perf_sessions
  for select to authenticated using (user_id = auth.uid());

-- ------------------------------------------------------------
-- 3) دوال الصلاحية — تُستعمل داخل سياسات RLS
-- ------------------------------------------------------------
create or replace function public.perf_is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.perf_sessions
                 where user_id = auth.uid() and role = 'admin');
$$;

create or replace function public.perf_signed_in()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.perf_sessions where user_id = auth.uid());
$$;

-- مدير الإدارة يكتب في كل القطاعات · مدير القطاع في قطاعاته وحدها
create or replace function public.perf_can_sector(p_sector text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.perf_sessions
    where user_id = auth.uid()
      and (role = 'admin' or p_sector = any(sector_ids))
  );
$$;

create or replace function public.perf_cur_user()
returns text language sql stable security definer set search_path = public as $$
  select username from public.perf_sessions where user_id = auth.uid();
$$;

-- ------------------------------------------------------------
-- 4) الدخول
-- ------------------------------------------------------------
create or replace function public.perf_login(p_username text, p_password text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare u record;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;

  select * into u from public.perf_users
   where username = public.perf_norm_user(p_username) and active;

  if not found then return null; end if;

  -- حساب بلا كلمة مرور: يُوجَّه إلى شاشة التفعيل بدل رسالة خاطئة
  if u.pass_hash is null or u.pass_hash = '' then
    return jsonb_build_object('needsActivation', true);
  end if;

  if u.pass_hash <> crypt(p_password, u.pass_hash) then return null; end if;

  insert into public.perf_sessions (user_id, app_user_id, username, display_name, role, sector_ids)
  values (auth.uid(), u.id, u.username, u.display_name, u.role, u.sector_ids)
  on conflict (user_id) do update
    set app_user_id = excluded.app_user_id, username = excluded.username,
        display_name = excluded.display_name, role = excluded.role,
        sector_ids = excluded.sector_ids, granted_at = now();

  update public.perf_users set last_login = now() where id = u.id;

  return jsonb_build_object('id', u.id::text, 'username', u.username,
    'name', u.display_name, 'role', u.role, 'sectorIds', u.sector_ids);
end;
$$;
revoke all on function public.perf_login(text,text) from public, anon;
grant execute on function public.perf_login(text,text) to authenticated;

-- ------------------------------------------------------------
-- 5) التفعيل واستعادة كلمة المرور
--    التسجيل الأول يطابق الجوال كاملاً · الاستعادة تكتفي بآخر أربعة.
--    القطاع يُقبل في التسجيل الأول وحده ولمدير القطاع وحده.
-- ------------------------------------------------------------
create or replace function public.perf_activate(
  p_username text, p_phone text, p_last4 text, p_password text, p_sectors text[]
) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare u record; v_first boolean; v_ok boolean;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if length(coalesce(p_password,'')) < 6 then return jsonb_build_object('error','short'); end if;

  select * into u from public.perf_users
   where username = public.perf_norm_user(p_username) and active;
  if not found then return null; end if;

  v_first := (u.pass_hash is null or u.pass_hash = '');
  v_ok := case when v_first
            then public.perf_norm_phone(p_phone) = u.phone
            else length(coalesce(p_last4,'')) = 4 and right(u.phone, 4) = p_last4
          end;
  if not v_ok then return null; end if;

  update public.perf_users
     set pass_hash = crypt(p_password, gen_salt('bf')),
         -- القطاع المختار عند التسجيل يُقبل فقط إن لم يكن مدير الإدارة
         -- قد أسند قطاعاً أصلاً — فلا يمنح موظف نفسه قطاعاً لم يُمنح له
         sector_ids = case
           when v_first and u.role = 'manager'
                and coalesce(array_length(sector_ids,1),0) = 0
                and coalesce(array_length(p_sectors,1),0) > 0
             then p_sectors else sector_ids end,
         last_login = now()
   where id = u.id
   returning * into u;

  insert into public.perf_sessions (user_id, app_user_id, username, display_name, role, sector_ids)
  values (auth.uid(), u.id, u.username, u.display_name, u.role, u.sector_ids)
  on conflict (user_id) do update
    set app_user_id = excluded.app_user_id, username = excluded.username,
        display_name = excluded.display_name, role = excluded.role,
        sector_ids = excluded.sector_ids, granted_at = now();

  return jsonb_build_object('id', u.id::text, 'username', u.username,
    'name', u.display_name, 'role', u.role, 'sectorIds', u.sector_ids);
end;
$$;
revoke all on function public.perf_activate(text,text,text,text,text[]) from public, anon;
grant execute on function public.perf_activate(text,text,text,text,text[]) to authenticated;

create or replace function public.perf_change_password(p_current text, p_next text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare u record;
begin
  select pu.* into u from public.perf_users pu
    join public.perf_sessions s on s.app_user_id = pu.id
   where s.user_id = auth.uid();
  if not found then return jsonb_build_object('error','no_session'); end if;
  if u.pass_hash is null or u.pass_hash <> crypt(p_current, u.pass_hash) then
    return jsonb_build_object('error','wrong_current');
  end if;
  if length(coalesce(p_next,'')) < 6 then return jsonb_build_object('error','short'); end if;
  update public.perf_users set pass_hash = crypt(p_next, gen_salt('bf')) where id = u.id;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.perf_change_password(text,text) from public, anon;
grant execute on function public.perf_change_password(text,text) to authenticated;

-- ------------------------------------------------------------
-- 6) إدارة المستخدمين — لمدير الإدارة وحده، ولا تُرجع أي كلمة مرور
-- ------------------------------------------------------------
create or replace function public.perf_list_users()
returns table (id text, username text, name text, phone text, role text,
               sector_ids text[], active boolean, has_password boolean)
language plpgsql security definer set search_path = public as $$
begin
  if not public.perf_is_admin() then raise exception 'forbidden'; end if;
  return query select u.id::text, u.username, u.display_name, u.phone, u.role,
                      u.sector_ids, u.active,
                      (u.pass_hash is not null and u.pass_hash <> '')
                 from public.perf_users u order by u.created_at;
end;
$$;
revoke all on function public.perf_list_users() from public, anon;
grant execute on function public.perf_list_users() to authenticated;

create or replace function public.perf_save_user(
  p_id text, p_username text, p_name text, p_phone text, p_role text,
  p_sectors text[], p_active boolean, p_password text, p_clear_password boolean
) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_id bigint; v_me bigint; v_hash text;
begin
  if not public.perf_is_admin() then raise exception 'forbidden'; end if;
  if coalesce(p_username,'') = '' then return jsonb_build_object('error','no_username'); end if;
  if p_password is not null and p_password <> '' and length(p_password) < 6 then
    return jsonb_build_object('error','short'); end if;

  select app_user_id into v_me from public.perf_sessions where user_id = auth.uid();
  v_id := nullif(p_id,'')::bigint;

  -- لا يسحب مدير الإدارة صلاحيته من نفسه ولا يوقف حسابه، وإلا أُقفلت اللوحة
  if v_id is not null and v_id = v_me then
    if p_role = 'manager' then return jsonb_build_object('error','self_demote'); end if;
    if p_active is false then return jsonb_build_object('error','self_disable'); end if;
  end if;

  if exists (select 1 from public.perf_users
              where username = public.perf_norm_user(p_username)
                and (v_id is null or id <> v_id)) then
    return jsonb_build_object('error','dup_username');
  end if;

  v_hash := case when p_password is null or p_password = '' then null
                 else crypt(p_password, gen_salt('bf')) end;

  if v_id is null then
    insert into public.perf_users (username, display_name, phone, pass_hash, role, sector_ids, active)
    values (public.perf_norm_user(p_username), coalesce(nullif(p_name,''), p_username),
            public.perf_norm_phone(p_phone), v_hash,
            case when p_role = 'admin' then 'admin' else 'manager' end,
            case when p_role = 'admin' then '{}'::text[] else coalesce(p_sectors,'{}') end,
            coalesce(p_active, true))
    returning id into v_id;
  else
    update public.perf_users set
      username     = public.perf_norm_user(p_username),
      display_name = coalesce(nullif(p_name,''), display_name),
      phone        = case when coalesce(p_phone,'') = '' then phone else public.perf_norm_phone(p_phone) end,
      role         = case when p_role in ('admin','manager') then p_role else role end,
      sector_ids   = case when p_role = 'admin' then '{}'::text[]
                          when p_sectors is null then sector_ids else p_sectors end,
      active       = coalesce(p_active, active),
      -- كلمة مرور فارغة تُبقي الحالية · والمسح المتعمّد يُرجع الحساب لبانتظار التفعيل
      pass_hash    = case when p_clear_password then null
                          when v_hash is not null then v_hash else pass_hash end
    where id = v_id;
  end if;

  -- تغيير الصلاحيات يسري فوراً على الجلسات المفتوحة، وإيقاف الحساب يُنهيها
  update public.perf_sessions s
     set role = u.role, sector_ids = u.sector_ids, display_name = u.display_name, username = u.username
    from public.perf_users u where u.id = s.app_user_id and u.id = v_id;
  delete from public.perf_sessions s
   using public.perf_users u where u.id = s.app_user_id and u.id = v_id and not u.active;

  return jsonb_build_object('ok', true, 'id', v_id::text);
end;
$$;
revoke all on function public.perf_save_user(text,text,text,text,text,text[],boolean,text,boolean) from public, anon;
grant execute on function public.perf_save_user(text,text,text,text,text,text[],boolean,text,boolean) to authenticated;

create or replace function public.perf_delete_user(p_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me bigint;
begin
  if not public.perf_is_admin() then raise exception 'forbidden'; end if;
  select app_user_id into v_me from public.perf_sessions where user_id = auth.uid();
  if nullif(p_id,'')::bigint = v_me then return jsonb_build_object('error','self_delete'); end if;
  delete from public.perf_users where id = nullif(p_id,'')::bigint;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.perf_delete_user(text) from public, anon;
grant execute on function public.perf_delete_user(text) to authenticated;

-- أول حساب مدير إدارة — يُشغَّل من SQL Editor مرة واحدة
create or replace function public.perf_bootstrap_admin(
  p_username text, p_name text, p_phone text, p_password text default null
) returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  insert into public.perf_users (username, display_name, phone, pass_hash, role, active)
  values (public.perf_norm_user(p_username), p_name, public.perf_norm_phone(p_phone),
          case when p_password is null then null else crypt(p_password, gen_salt('bf')) end,
          'admin', true)
  on conflict (username) do update
     set display_name = excluded.display_name, phone = excluded.phone,
         role = 'admin', active = true;
end;
$$;
revoke all on function public.perf_bootstrap_admin(text,text,text,text) from public, anon, authenticated;

-- ============================================================
--  7) جداول البيانات
--     القراءة لكل من له جلسة · والكتابة حسب القطاع أو صلاحية المدير
-- ============================================================

create table if not exists public.perf_sectors (
  id text primary key, name text not null, ord int not null default 0
);
create table if not exists public.perf_indicators (
  id text primary key, name text not null,
  unit text not null default 'percent' check (unit in ('percent','number')),
  active boolean not null default true, ord int not null default 0
);
create table if not exists public.perf_periods (
  id text primary key, label text not null, ord int not null default 0, week_start date
);
create table if not exists public.perf_targets (
  sector_id text not null, indicator_id text not null,
  value jsonb not null,                       -- رقم سنوي أو [ر1..ر4]
  primary key (sector_id, indicator_id)
);
create table if not exists public.perf_measurements (
  id text primary key,
  sector_id text not null, indicator_id text not null, period_id text not null,
  target numeric, actual numeric,
  updated_by text, updated_at timestamptz not null default now(),
  unique (sector_id, indicator_id, period_id)
);
create table if not exists public.perf_tasks (
  id text primary key, title text not null, description text,
  assignee_id text not null,
  priority text not null default 'mid' check (priority in ('high','mid')),
  due_date date not null, indicator_id text,
  state text not null default 'ok' check (state in ('ok','risk','done')),
  updates jsonb not null default '[]'::jsonb,
  created_by_id text, created_at timestamptz not null default now(),
  completed_at timestamptz
);
create table if not exists public.perf_notes (
  id text primary key, sector_id text not null, indicator_id text not null,
  body text not null, mentions text[] not null default '{}',
  by_id text, by_name text, at timestamptz not null default now()
);
create table if not exists public.perf_settings (
  key text primary key, value jsonb not null
);
create table if not exists public.perf_last_seen (
  app_user_id bigint primary key, at timestamptz not null default now()
);

alter table public.perf_sectors      enable row level security;
alter table public.perf_indicators   enable row level security;
alter table public.perf_periods      enable row level security;
alter table public.perf_targets      enable row level security;
alter table public.perf_measurements enable row level security;
alter table public.perf_tasks        enable row level security;
alter table public.perf_notes        enable row level security;
alter table public.perf_settings     enable row level security;
alter table public.perf_last_seen    enable row level security;

-- القراءة: كل من سجّل دخوله · الزائر بلا جلسة لا يقرأ شيئاً
do $$
declare t text;
begin
  foreach t in array array['perf_sectors','perf_indicators','perf_periods',
                           'perf_targets','perf_settings','perf_tasks','perf_notes']
  loop
    execute format('drop policy if exists "%1$s_read" on public.%1$s', t);
    execute format('create policy "%1$s_read" on public.%1$s for select to authenticated using (public.perf_signed_in())', t);
  end loop;
end $$;

-- المرجعيات (القطاعات · المؤشرات · الفترات · المستهدفات · الإعدادات):
-- الكتابة لمدير الإدارة وحده
do $$
declare t text;
begin
  foreach t in array array['perf_sectors','perf_indicators','perf_periods',
                           'perf_targets','perf_settings']
  loop
    execute format('drop policy if exists "%1$s_write" on public.%1$s', t);
    execute format('create policy "%1$s_write" on public.%1$s for all to authenticated using (public.perf_is_admin()) with check (public.perf_is_admin())', t);
  end loop;
end $$;

-- الفترات يحتاجها أي مُدخِل بيانات لإنشاء فترة التحديث أول مرة
drop policy if exists "perf_periods_insert" on public.perf_periods;
create policy "perf_periods_insert" on public.perf_periods
  for insert to authenticated with check (public.perf_signed_in());

-- القياسات: القراءة للجميع بعد الدخول، والكتابة على القطاع المصرَّح به وحده
drop policy if exists "perf_measurements_read" on public.perf_measurements;
create policy "perf_measurements_read" on public.perf_measurements
  for select to authenticated using (public.perf_signed_in());
drop policy if exists "perf_measurements_insert" on public.perf_measurements;
create policy "perf_measurements_insert" on public.perf_measurements
  for insert to authenticated with check (public.perf_can_sector(sector_id));
drop policy if exists "perf_measurements_update" on public.perf_measurements;
create policy "perf_measurements_update" on public.perf_measurements
  for update to authenticated using (public.perf_can_sector(sector_id))
  with check (public.perf_can_sector(sector_id));

-- المهام: يكتبها كل من سجّل دخوله · ولا يحذفها إلا مدير الإدارة
drop policy if exists "perf_tasks_write" on public.perf_tasks;
create policy "perf_tasks_write" on public.perf_tasks
  for insert to authenticated with check (public.perf_signed_in());
drop policy if exists "perf_tasks_update" on public.perf_tasks;
create policy "perf_tasks_update" on public.perf_tasks
  for update to authenticated using (public.perf_signed_in()) with check (public.perf_signed_in());
drop policy if exists "perf_tasks_delete" on public.perf_tasks;
create policy "perf_tasks_delete" on public.perf_tasks
  for delete to authenticated using (public.perf_is_admin());

-- الملاحظات: تُكتب على القطاع المصرَّح به وحده
drop policy if exists "perf_notes_insert" on public.perf_notes;
create policy "perf_notes_insert" on public.perf_notes
  for insert to authenticated with check (public.perf_can_sector(sector_id));

drop policy if exists "perf_seen_all" on public.perf_last_seen;
create policy "perf_seen_all" on public.perf_last_seen
  for all to authenticated using (public.perf_signed_in()) with check (public.perf_signed_in());

-- ============================================================
--  8) روابط مشاركة التقرير الأسبوعي — للاطّلاع فقط بلا حساب
--     الجدول بلا سياسة قراءة للزائر: لا يُقرأ إلا عبر دالة تتحقق
--     من الرمز، فلا يستطيع أحد تعداد الروابط ولا تخمينها.
-- ============================================================
create table if not exists public.perf_shares (
  token       text primary key,
  week_start  date not null,
  created_by  text,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz,
  views       int not null default 0,
  last_view   timestamptz
);
alter table public.perf_shares enable row level security;

drop policy if exists "perf_shares_admin" on public.perf_shares;
create policy "perf_shares_admin" on public.perf_shares
  for all to authenticated using (public.perf_is_admin()) with check (public.perf_is_admin());

-- البيانات التي يحتاجها التقرير المشترك — تُعاد دفعةً واحدة للزائر
-- المجهول إن كان الرمز صحيحاً وغير منتهٍ، وإلا فارغ.
create or replace function public.perf_shared_report(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s record;
begin
  select * into s from public.perf_shares
   where token = p_token
     and (expires_at is null or expires_at > now());
  if not found then return null; end if;

  update public.perf_shares
     set views = views + 1, last_view = now()
   where token = p_token;

  return jsonb_build_object(
    'weekStart', s.week_start,
    'sectors',      (select coalesce(jsonb_agg(to_jsonb(x) order by x.ord), '[]'::jsonb) from public.perf_sectors x),
    'indicators',   (select coalesce(jsonb_agg(to_jsonb(x) order by x.ord), '[]'::jsonb) from public.perf_indicators x where x.active),
    'periods',      (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.perf_periods x),
    'targets',      (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.perf_targets x),
    'measurements', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.perf_measurements x),
    'tasks',        (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.perf_tasks x),
    'settings',     (select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) from public.perf_settings)
  );
end;
$$;
-- الزائر المجهول يُنفّذها — وهي لا تكشف شيئاً بلا رمز صحيح
grant execute on function public.perf_shared_report(text) to anon, authenticated;

-- ------------------------------------------------------------
-- 9) البذرة: القطاعات والمؤشرات وعتبات الحالة
--     insert ... on conflict do nothing ⇒ لا تُدهس أي قيمة عدّلتِها
-- ------------------------------------------------------------
insert into public.perf_sectors (id, name, ord) values
  ('sec-infra','قطاع البنية التحتية',1),
  ('sec-social','قطاع الخدمات الاجتماعية',2),
  ('sec-econ','قطاع المالي والاقتصادي',3),
  ('sec-gov','قطاع الشؤون الحكومية',4)
on conflict (id) do nothing;

insert into public.perf_indicators (id, name, unit, ord) values
  ('ind-1','نسبة الأجهزة العامة التي يتم قياس خدماتها','number',1),
  ('ind-2','نسبة الأجهزة ذات الأداء المنخفض التي تم عقد جلسات مراجعة لها','percent',2),
  ('ind-3','نسبة قابلية قياس مؤشرات المخرجات الوطنية','percent',3),
  ('ind-4','نسبة قابلية قياس الاستراتيجيات الوطنية المعتمدة من مجلس الوزراء','percent',4),
  ('ind-5','عدد الأجهزة العامة التي تم قياس استراتيجياتها المؤسسية','number',5),
  ('ind-6','نسبة التكليفات المباشرة المكتملة أو على المسار','percent',6),
  ('ind-7','نسبة إتمام الخطة الفردية للاحتياج التطويري','percent',7)
on conflict (id) do nothing;

insert into public.perf_periods (id, label, ord) values ('per-1','التحديث',1)
on conflict (id) do nothing;

insert into public.perf_settings (key, value) values
  ('statuses', '[{"label":"متعثر","color":"#ef4444","from":0},
                 {"label":"متعثر جزئيًا","color":"#f59e0b","from":80},
                 {"label":"وفق المسار","color":"#22c55e","from":100}]'::jsonb),
  ('targetMode', '"annual"'::jsonb)
on conflict (key) do nothing;

-- المستهدفات الافتراضية: عدد الجهات لكل قطاع في المؤشرين العدديين، و100% لغيرهما
insert into public.perf_targets (sector_id, indicator_id, value)
select s.id, i.id,
       case
         when i.id = 'ind-1' then to_jsonb((case s.id when 'sec-gov' then 16 when 'sec-social' then 12
                                                      when 'sec-infra' then 19 else 15 end))
         when i.id = 'ind-5' then to_jsonb((case s.id when 'sec-gov' then 8 when 'sec-social' then 3
                                                      when 'sec-infra' then 4 else 4 end))
         else to_jsonb(100)
       end
  from public.perf_sectors s cross join public.perf_indicators i
on conflict (sector_id, indicator_id) do nothing;

-- ============================================================
--  تم. الخطوة الأخيرة (مرة واحدة) — أنشئي حسابك:
--
--    select public.perf_bootstrap_admin(
--      'sultana', 'سلطانة العرجاني', '05XXXXXXXX'
--    );
--
--  اتركي كلمة المرور فارغة، وفعّلي حسابك من شاشة «مستخدم جديد».
-- ============================================================
