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

-- ------------------------------------------------------------
--  ٣) صلاحية رفع ملف طلبات التغيير
--     راية على المستخدم نفسه، لا دور جديد: من يسحب الملف من منصة
--     الرؤية يرفعه، والبقية يقرؤون وينسخون ويصدّرون Excel.
--     الدالة تقرأ الراية من جدول المستخدمين مباشرة، فتغييرها يسري
--     فوراً بلا حاجة لخروج المستخدم وعودته.
-- ------------------------------------------------------------
alter table public.perf_users
  add column if not exists can_changes boolean not null default false;

create or replace function public.perf_can_changes()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.perf_sessions s
      join public.perf_users u on u.id = s.app_user_id
     where s.user_id = auth.uid()
       and u.active
       and (s.role = 'admin' or u.can_changes)
  );
$$;
revoke all on function public.perf_can_changes() from public, anon;
grant execute on function public.perf_can_changes() to authenticated;

-- الرفع والتحديث: صاحب الراية أو مدير الإدارة
drop policy if exists "perf_cr_insert" on public.perf_change_requests;
create policy "perf_cr_insert" on public.perf_change_requests
  for insert to authenticated with check (public.perf_can_changes());

drop policy if exists "perf_cr_update" on public.perf_change_requests;
create policy "perf_cr_update" on public.perf_change_requests
  for update to authenticated
  using (public.perf_can_changes()) with check (public.perf_can_changes());

-- الحذف النهائي: لمدير الإدارة وحده
drop policy if exists "perf_cr_delete" on public.perf_change_requests;
create policy "perf_cr_delete" on public.perf_change_requests
  for delete to authenticated using (public.perf_is_admin());

grant select, insert, update, delete on public.perf_change_requests to authenticated;
revoke all on public.perf_change_requests from anon;


-- ============================================================
--  ٥) نظام الصلاحيات التفصيلي
--     كان عندنا دوران فقط: مدير إدارة / مدير قطاع. صار لكل حساب
--     قائمة صلاحيات صريحة، فيمكن إعطاء موظف «نظرة عامة» بلا
--     «التكليفات» مثلاً، أو «مهامه» دون بقية المهام.
--     لا يوجد تجاوز ضمني للدور: ما لم يُمنح لا يظهر.
-- ============================================================
alter table public.perf_users
  add column if not exists scopes text[] not null default '{}';

-- ------------------------------------------------------------
--  الصلاحيات المعرَّفة (نفس القائمة في الكود):
--    overview        نظرة عامة
--    assignments     التكليفات
--    changes         طلبات التغيير — عرض ونسخ وتصدير
--    changes:upload  رفع ملف طلبات التغيير
--    details         المؤشرات التفصيلية
--    details:all     كل القطاعات لا قطاعه فقط
--    entry           المؤشرات والمستهدفات
--    structure       القطاعات والإدارات
--    tasks           المهام
--    tasks:all       كل المهام لا مهامه فقط
--    weekly          الإنجاز الأسبوعي
--    users           المستخدمون والصلاحيات
-- ------------------------------------------------------------

-- تعبئة أولية للحسابات القائمة حتى لا تفقد ما كانت تصل إليه.
-- «users» لا تُمنح هنا لأحد — تُمنح صراحةً بعد قليل.
update public.perf_users
   set scopes = array['overview','assignments','changes','details','details:all',
                      'entry','structure','tasks','tasks:all','weekly']
 where role = 'admin' and coalesce(array_length(scopes,1),0) = 0;

update public.perf_users
   set scopes = array['overview','details','tasks']
 where role <> 'admin' and coalesce(array_length(scopes,1),0) = 0;

-- من كانت له راية رفع طلبات التغيير تُنقل صلاحيةً
update public.perf_users
   set scopes = scopes || array['changes','changes:upload']
 where can_changes and not (scopes @> array['changes:upload']);

-- ------------------------------------------------------------
--  «المستخدمون والصلاحيات» لحساب واحد بعينه
--  غيّري اسم المستخدم في السطر التالي إن اختلف.
-- ------------------------------------------------------------
update public.perf_users
   set scopes = array['overview','assignments','changes','changes:upload','details',
                      'details:all','entry','structure','tasks','tasks:all','weekly','users']
 where username = public.perf_norm_user('salarjani');

-- شبكة أمان: لو لم يحصل أحد على «users» لأي سبب، تُمنح لأقدم مدير إدارة
-- نشط — وإلا أُقفلت إدارة المستخدمين على الجميع بلا رجعة.
do $$
declare v_id bigint;
begin
  if not exists (select 1 from public.perf_users where active and scopes @> array['users']) then
    select id into v_id from public.perf_users
      where active and role = 'admin' order by created_at limit 1;
    if v_id is not null then
      update public.perf_users set scopes = scopes || array['users'] where id = v_id;
    end if;
  end if;
end $$;

-- ------------------------------------------------------------
--  دوال القراءة — تقرأ من جدول المستخدمين مباشرة عبر الجلسة،
--  فتغيير الصلاحية يسري فوراً بلا خروج وعودة.
-- ------------------------------------------------------------
create or replace function public.perf_has_scope(p_scope text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.perf_sessions s
      join public.perf_users u on u.id = s.app_user_id
     where s.user_id = auth.uid() and u.active and u.scopes @> array[p_scope]
  );
$$;
revoke all on function public.perf_has_scope(text) from public, anon;
grant execute on function public.perf_has_scope(text) to authenticated;

create or replace function public.perf_my_scopes()
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(
    (select u.scopes
       from public.perf_sessions s
       join public.perf_users u on u.id = s.app_user_id
      where s.user_id = auth.uid() and u.active),
    '{}'::text[]);
$$;
revoke all on function public.perf_my_scopes() from public, anon;
grant execute on function public.perf_my_scopes() to authenticated;

-- رفع ملف طلبات التغيير صار صلاحيةً لا راية
create or replace function public.perf_can_changes()
returns boolean language sql stable security definer set search_path = public as $$
  select public.perf_has_scope('changes:upload');
$$;

-- ============================================================
--  ٦) إدارة المستخدمين — بصلاحية «users» لا بالدور
--     الدالتان تُحذفان أولاً لأن تغيير التوقيع أو نوع الإرجاع
--     لا يقبله create or replace، ولو تُركت القديمة صار تعارضاً.
-- ============================================================
drop function if exists public.perf_list_users();
create or replace function public.perf_list_users()
returns table (id text, username text, name text, phone text, role text,
               sector_ids text[], active boolean, has_password boolean,
               scopes text[])
language plpgsql security definer set search_path = public as $$
begin
  if not public.perf_has_scope('users') then raise exception 'forbidden'; end if;
  return query select u.id::text, u.username, u.display_name, u.phone, u.role,
                      u.sector_ids, u.active,
                      (u.pass_hash is not null and u.pass_hash <> ''),
                      u.scopes
                 from public.perf_users u order by u.created_at;
end;
$$;
revoke all on function public.perf_list_users() from public, anon;
grant execute on function public.perf_list_users() to authenticated;

drop function if exists public.perf_save_user(
  text, text, text, text, text, text[], boolean, text, boolean);
drop function if exists public.perf_save_user(
  text, text, text, text, text, text[], boolean, text, boolean, boolean);
create or replace function public.perf_save_user(
  p_id text, p_username text, p_name text, p_phone text, p_role text,
  p_sectors text[], p_active boolean, p_password text, p_clear_password boolean,
  p_scopes text[] default null
) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_id bigint; v_me bigint; v_hash text;
begin
  if not public.perf_has_scope('users') then raise exception 'forbidden'; end if;
  if coalesce(p_username,'') = '' then return jsonb_build_object('error','no_username'); end if;
  if p_password is not null and p_password <> '' and length(p_password) < 6 then
    return jsonb_build_object('error','short'); end if;

  select app_user_id into v_me from public.perf_sessions where user_id = auth.uid();
  v_id := nullif(p_id,'')::bigint;

  -- لا يسحب أحد صلاحية إدارة المستخدمين من نفسه ولا يوقف حسابه،
  -- وإلا أُقفلت الشاشة على الجميع بلا رجعة
  if v_id is not null and v_id = v_me then
    if p_active is false then return jsonb_build_object('error','self_disable'); end if;
    if p_scopes is not null and not (p_scopes @> array['users']) then
      return jsonb_build_object('error','self_scope');
    end if;
  end if;

  if exists (select 1 from public.perf_users
              where username = public.perf_norm_user(p_username)
                and (v_id is null or id <> v_id)) then
    return jsonb_build_object('error','dup_username');
  end if;

  v_hash := case when p_password is null or p_password = '' then null
                 else crypt(p_password, gen_salt('bf')) end;

  if v_id is null then
    insert into public.perf_users (username, display_name, phone, pass_hash, role,
                                   sector_ids, active, scopes)
    values (public.perf_norm_user(p_username), coalesce(nullif(p_name,''), p_username),
            public.perf_norm_phone(p_phone), v_hash,
            case when p_role = 'admin' then 'admin' else 'manager' end,
            coalesce(p_sectors,'{}'), coalesce(p_active, true),
            coalesce(p_scopes, array['overview','details','tasks']))
    returning id into v_id;
  else
    update public.perf_users set
      username     = public.perf_norm_user(p_username),
      display_name = coalesce(nullif(p_name,''), display_name),
      phone        = case when coalesce(p_phone,'') = '' then phone else public.perf_norm_phone(p_phone) end,
      role         = case when p_role in ('admin','manager') then p_role else role end,
      sector_ids   = case when p_sectors is null then sector_ids else p_sectors end,
      active       = coalesce(p_active, active),
      scopes       = coalesce(p_scopes, scopes),
      -- كلمة مرور فارغة تُبقي الحالية · والمسح المتعمّد يُرجع الحساب لبانتظار التفعيل
      pass_hash    = case when p_clear_password then null
                          when v_hash is not null then v_hash else pass_hash end
    where id = v_id;
  end if;

  -- تغيير الدور أو القطاعات يسري فوراً على الجلسات المفتوحة، وإيقاف الحساب يُنهيها
  update public.perf_sessions s
     set role = u.role, sector_ids = u.sector_ids, display_name = u.display_name, username = u.username
    from public.perf_users u where u.id = s.app_user_id and u.id = v_id;
  delete from public.perf_sessions s
   using public.perf_users u where u.id = s.app_user_id and u.id = v_id and not u.active;

  return jsonb_build_object('ok', true, 'id', v_id::text);
end;
$$;
revoke all on function public.perf_save_user(
  text, text, text, text, text, text[], boolean, text, boolean, text[]) from public, anon;
grant execute on function public.perf_save_user(
  text, text, text, text, text, text[], boolean, text, boolean, text[]) to authenticated;

create or replace function public.perf_delete_user(p_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me bigint;
begin
  if not public.perf_has_scope('users') then raise exception 'forbidden'; end if;
  select app_user_id into v_me from public.perf_sessions where user_id = auth.uid();
  if nullif(p_id,'')::bigint = v_me then return jsonb_build_object('error','self_delete'); end if;
  delete from public.perf_users where id = nullif(p_id,'')::bigint;
  return jsonb_build_object('ok', true);
end;
$$;

-- ============================================================
--  ٧) مخزن شخصي لكل مستخدم
--     ملاحظاته الخاصة وإعداد صفحته الخاصة. كل صف يخصّ صاحبه
--     وحده: السياسة تقارن بـ app_user_id الخاص بجلسته، فلا يقرأ
--     أحد ملاحظات أحد ولو حاول من خارج الواجهة.
-- ============================================================
create or replace function public.perf_my_id()
returns bigint language sql stable security definer set search_path = public as $$
  select app_user_id from public.perf_sessions where user_id = auth.uid();
$$;
revoke all on function public.perf_my_id() from public, anon;
grant execute on function public.perf_my_id() to authenticated;

create table if not exists public.perf_user_data (
  app_user_id bigint not null references public.perf_users (id) on delete cascade,
  key         text   not null,           -- 'notes' · 'mypage'
  value       jsonb  not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  primary key (app_user_id, key)
);
alter table public.perf_user_data enable row level security;

drop policy if exists "perf_ud_own" on public.perf_user_data;
create policy "perf_ud_own" on public.perf_user_data
  for all to authenticated
  using (app_user_id = public.perf_my_id())
  with check (app_user_id = public.perf_my_id());

grant select, insert, update, delete on public.perf_user_data to authenticated;
revoke all on public.perf_user_data from anon;

-- ============================================================
--  ٨) قائمة الزملاء — الاسم والقطاع فقط
--     يحتاجها الجميع: اسم المسؤول عن المهمة، والإشارة في الملاحظات،
--     والهيكل التنظيمي. أما perf_list_users فتبقى محصورة بصلاحية
--     «users» لأنها تكشف الجوال وحالة كلمة المرور والصلاحيات.
-- ============================================================
-- الحذف قبل الإنشاء: نوع الإرجاع يتغيّر في مقاطع تالية، وإعادة تشغيل
-- الملف كاملاً تصطدم بـ «cannot change return type» بلا هذا السطر
drop function if exists public.perf_people();
create or replace function public.perf_people()
returns table (id text, name text, role text, sector_ids text[], active boolean)
language plpgsql security definer set search_path = public as $$
begin
  if not public.perf_signed_in() then raise exception 'forbidden'; end if;
  return query select u.id::text, u.display_name, u.role, u.sector_ids, u.active
                 from public.perf_users u
                where u.active
                order by u.display_name;
end;
$$;
revoke all on function public.perf_people() from public, anon;
grant execute on function public.perf_people() to authenticated;

-- ============================================================
--  ٩) مدير القطاع · صلاحية المستهدفات · سجلّ تغييرها
--     (سُمّيت is_lead لا position لأن position كلمة محجوزة في Postgres)
-- ============================================================
alter table public.perf_users
  add column if not exists is_lead boolean not null default false;

-- من يعدّل مستهدفات قطاع؟ صاحب صلاحية «targets» في قطاعه،
-- أو من يملك «كل القطاعات».
create or replace function public.perf_can_target(p_sector text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.perf_sessions s
      join public.perf_users u on u.id = s.app_user_id
     where s.user_id = auth.uid()
       and u.active
       and u.scopes @> array['targets']
       and (u.scopes @> array['details:all'] or p_sector = any(u.sector_ids))
  );
$$;
revoke all on function public.perf_can_target(text) from public, anon;
grant execute on function public.perf_can_target(text) to authenticated;

-- كانت كتابة المستهدفات لمدير الإدارة وحده
drop policy if exists "perf_targets_write" on public.perf_targets;
drop policy if exists "perf_targets_edit" on public.perf_targets;
create policy "perf_targets_edit" on public.perf_targets
  for all to authenticated
  using (public.perf_can_target(sector_id))
  with check (public.perf_can_target(sector_id));

-- ------------------------------------------------------------
--  سجلّ تغيير المستهدفات — يُكتب من trigger داخل القاعدة، فلا
--  تستطيع الواجهة تجاوزه ولا تزويره. منه تظهر التحديثات للمدير.
-- ------------------------------------------------------------
create table if not exists public.perf_target_log (
  id           bigint generated always as identity primary key,
  sector_id    text not null,
  indicator_id text not null,
  old_value    jsonb,
  new_value    jsonb,
  by_id        bigint,
  by_name      text,
  at           timestamptz not null default now()
);
create index if not exists perf_tlog_at_idx on public.perf_target_log (at desc);
alter table public.perf_target_log enable row level security;

drop policy if exists "perf_tlog_read" on public.perf_target_log;
create policy "perf_tlog_read" on public.perf_target_log
  for select to authenticated using (public.perf_signed_in());

grant select on public.perf_target_log to authenticated;
revoke all on public.perf_target_log from anon;

create or replace function public.perf_log_target()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_id bigint; v_name text;
begin
  if tg_op = 'UPDATE' and old.value is not distinct from new.value then
    return new;                       -- حفظ بلا تغيير فعلي: لا يُسجَّل
  end if;
  select s.app_user_id, s.display_name into v_id, v_name
    from public.perf_sessions s where s.user_id = auth.uid();
  insert into public.perf_target_log (sector_id, indicator_id, old_value, new_value, by_id, by_name)
  values (new.sector_id, new.indicator_id,
          case when tg_op = 'UPDATE' then old.value else null end,
          new.value, v_id, coalesce(v_name, '—'));
  return new;
end;
$$;

drop trigger if exists perf_targets_log on public.perf_targets;
create trigger perf_targets_log
  after insert or update on public.perf_targets
  for each row execute function public.perf_log_target();

-- ------------------------------------------------------------
--  إظهار «مدير القطاع» في القوائم — المدير أولاً في قطاعه
-- ------------------------------------------------------------
drop function if exists public.perf_people();
create or replace function public.perf_people()
returns table (id text, name text, role text, sector_ids text[],
               active boolean, is_lead boolean)
language plpgsql security definer set search_path = public as $$
begin
  if not public.perf_signed_in() then raise exception 'forbidden'; end if;
  return query select u.id::text, u.display_name, u.role, u.sector_ids, u.active, u.is_lead
                 from public.perf_users u
                where u.active
                order by u.is_lead desc, u.display_name;
end;
$$;
revoke all on function public.perf_people() from public, anon;
grant execute on function public.perf_people() to authenticated;

drop function if exists public.perf_list_users();
create or replace function public.perf_list_users()
returns table (id text, username text, name text, phone text, role text,
               sector_ids text[], active boolean, has_password boolean,
               scopes text[], is_lead boolean)
language plpgsql security definer set search_path = public as $$
begin
  if not public.perf_has_scope('users') then raise exception 'forbidden'; end if;
  return query select u.id::text, u.username, u.display_name, u.phone, u.role,
                      u.sector_ids, u.active,
                      (u.pass_hash is not null and u.pass_hash <> ''),
                      u.scopes, u.is_lead
                 from public.perf_users u order by u.created_at;
end;
$$;
revoke all on function public.perf_list_users() from public, anon;
grant execute on function public.perf_list_users() to authenticated;

drop function if exists public.perf_save_user(
  text, text, text, text, text, text[], boolean, text, boolean, text[]);
create or replace function public.perf_save_user(
  p_id text, p_username text, p_name text, p_phone text, p_role text,
  p_sectors text[], p_active boolean, p_password text, p_clear_password boolean,
  p_scopes text[] default null, p_is_lead boolean default null
) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_id bigint; v_me bigint; v_hash text;
begin
  if not public.perf_has_scope('users') then raise exception 'forbidden'; end if;
  if coalesce(p_username,'') = '' then return jsonb_build_object('error','no_username'); end if;
  if p_password is not null and p_password <> '' and length(p_password) < 6 then
    return jsonb_build_object('error','short'); end if;

  select app_user_id into v_me from public.perf_sessions where user_id = auth.uid();
  v_id := nullif(p_id,'')::bigint;

  if v_id is not null and v_id = v_me then
    if p_active is false then return jsonb_build_object('error','self_disable'); end if;
    if p_scopes is not null and not (p_scopes @> array['users']) then
      return jsonb_build_object('error','self_scope');
    end if;
  end if;

  if exists (select 1 from public.perf_users
              where username = public.perf_norm_user(p_username)
                and (v_id is null or id <> v_id)) then
    return jsonb_build_object('error','dup_username');
  end if;

  v_hash := case when p_password is null or p_password = '' then null
                 else crypt(p_password, gen_salt('bf')) end;

  if v_id is null then
    insert into public.perf_users (username, display_name, phone, pass_hash, role,
                                   sector_ids, active, scopes, is_lead)
    values (public.perf_norm_user(p_username), coalesce(nullif(p_name,''), p_username),
            public.perf_norm_phone(p_phone), v_hash,
            case when p_role = 'admin' then 'admin' else 'manager' end,
            coalesce(p_sectors,'{}'), coalesce(p_active, true),
            coalesce(p_scopes, array['overview','details','tasks']),
            coalesce(p_is_lead, false))
    returning id into v_id;
  else
    update public.perf_users set
      username     = public.perf_norm_user(p_username),
      display_name = coalesce(nullif(p_name,''), display_name),
      phone        = case when coalesce(p_phone,'') = '' then phone else public.perf_norm_phone(p_phone) end,
      role         = case when p_role in ('admin','manager') then p_role else role end,
      sector_ids   = case when p_sectors is null then sector_ids else p_sectors end,
      active       = coalesce(p_active, active),
      scopes       = coalesce(p_scopes, scopes),
      is_lead      = coalesce(p_is_lead, is_lead),
      pass_hash    = case when p_clear_password then null
                          when v_hash is not null then v_hash else pass_hash end
    where id = v_id;
  end if;

  update public.perf_sessions s
     set role = u.role, sector_ids = u.sector_ids, display_name = u.display_name, username = u.username
    from public.perf_users u where u.id = s.app_user_id and u.id = v_id;
  delete from public.perf_sessions s
   using public.perf_users u where u.id = s.app_user_id and u.id = v_id and not u.active;

  return jsonb_build_object('ok', true, 'id', v_id::text);
end;
$$;
revoke all on function public.perf_save_user(
  text, text, text, text, text, text[], boolean, text, boolean, text[], boolean) from public, anon;
grant execute on function public.perf_save_user(
  text, text, text, text, text, text[], boolean, text, boolean, text[], boolean) to authenticated;

-- مدير القطاع يعدّل مستهدفات قطاعه افتراضياً
update public.perf_users
   set scopes = scopes || array['targets']
 where is_lead and not (scopes @> array['targets']);

-- ============================================================
--  ١٠) المسمّى الوظيفي
-- ============================================================
alter table public.perf_users
  add column if not exists job_title text;

-- بطاقة المستخدم الحالي: الصلاحيات والمسمّى ومنصبه في نداء واحد
create or replace function public.perf_me()
returns table (scopes text[], job_title text, is_lead boolean)
language plpgsql security definer set search_path = public as $$
begin
  return query select u.scopes, u.job_title, u.is_lead
                 from public.perf_sessions s
                 join public.perf_users u on u.id = s.app_user_id
                where s.user_id = auth.uid() and u.active;
end;
$$;
revoke all on function public.perf_me() from public, anon;
grant execute on function public.perf_me() to authenticated;

drop function if exists public.perf_people();
create or replace function public.perf_people()
returns table (id text, name text, role text, sector_ids text[],
               active boolean, is_lead boolean, job_title text)
language plpgsql security definer set search_path = public as $$
begin
  if not public.perf_signed_in() then raise exception 'forbidden'; end if;
  return query select u.id::text, u.display_name, u.role, u.sector_ids,
                      u.active, u.is_lead, u.job_title
                 from public.perf_users u
                where u.active
                order by u.is_lead desc, u.display_name;
end;
$$;
revoke all on function public.perf_people() from public, anon;
grant execute on function public.perf_people() to authenticated;

drop function if exists public.perf_list_users();
create or replace function public.perf_list_users()
returns table (id text, username text, name text, phone text, role text,
               sector_ids text[], active boolean, has_password boolean,
               scopes text[], is_lead boolean, job_title text)
language plpgsql security definer set search_path = public as $$
begin
  if not public.perf_has_scope('users') then raise exception 'forbidden'; end if;
  return query select u.id::text, u.username, u.display_name, u.phone, u.role,
                      u.sector_ids, u.active,
                      (u.pass_hash is not null and u.pass_hash <> ''),
                      u.scopes, u.is_lead, u.job_title
                 from public.perf_users u order by u.created_at;
end;
$$;
revoke all on function public.perf_list_users() from public, anon;
grant execute on function public.perf_list_users() to authenticated;

drop function if exists public.perf_save_user(
  text, text, text, text, text, text[], boolean, text, boolean, text[], boolean);
create or replace function public.perf_save_user(
  p_id text, p_username text, p_name text, p_phone text, p_role text,
  p_sectors text[], p_active boolean, p_password text, p_clear_password boolean,
  p_scopes text[] default null, p_is_lead boolean default null,
  p_job_title text default null
) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_id bigint; v_me bigint; v_hash text;
begin
  if not public.perf_has_scope('users') then raise exception 'forbidden'; end if;
  if coalesce(p_username,'') = '' then return jsonb_build_object('error','no_username'); end if;
  if p_password is not null and p_password <> '' and length(p_password) < 6 then
    return jsonb_build_object('error','short'); end if;

  select app_user_id into v_me from public.perf_sessions where user_id = auth.uid();
  v_id := nullif(p_id,'')::bigint;

  if v_id is not null and v_id = v_me then
    if p_active is false then return jsonb_build_object('error','self_disable'); end if;
    if p_scopes is not null and not (p_scopes @> array['users']) then
      return jsonb_build_object('error','self_scope');
    end if;
  end if;

  if exists (select 1 from public.perf_users
              where username = public.perf_norm_user(p_username)
                and (v_id is null or id <> v_id)) then
    return jsonb_build_object('error','dup_username');
  end if;

  v_hash := case when p_password is null or p_password = '' then null
                 else crypt(p_password, gen_salt('bf')) end;

  if v_id is null then
    insert into public.perf_users (username, display_name, phone, pass_hash, role,
                                   sector_ids, active, scopes, is_lead, job_title)
    values (public.perf_norm_user(p_username), coalesce(nullif(p_name,''), p_username),
            public.perf_norm_phone(p_phone), v_hash,
            case when p_role = 'admin' then 'admin' else 'manager' end,
            coalesce(p_sectors,'{}'), coalesce(p_active, true),
            coalesce(p_scopes, array['overview','details','tasks']),
            coalesce(p_is_lead, false), nullif(btrim(coalesce(p_job_title,'')), ''))
    returning id into v_id;
  else
    update public.perf_users set
      username     = public.perf_norm_user(p_username),
      display_name = coalesce(nullif(p_name,''), display_name),
      phone        = case when coalesce(p_phone,'') = '' then phone else public.perf_norm_phone(p_phone) end,
      role         = case when p_role in ('admin','manager') then p_role else role end,
      sector_ids   = case when p_sectors is null then sector_ids else p_sectors end,
      active       = coalesce(p_active, active),
      scopes       = coalesce(p_scopes, scopes),
      is_lead      = coalesce(p_is_lead, is_lead),
      -- نص فارغ يعني «امسح المسمّى»، وnull يعني «اتركه كما هو»
      job_title    = case when p_job_title is null then job_title
                          else nullif(btrim(p_job_title), '') end,
      pass_hash    = case when p_clear_password then null
                          when v_hash is not null then v_hash else pass_hash end
    where id = v_id;
  end if;

  update public.perf_sessions s
     set role = u.role, sector_ids = u.sector_ids, display_name = u.display_name, username = u.username
    from public.perf_users u where u.id = s.app_user_id and u.id = v_id;
  delete from public.perf_sessions s
   using public.perf_users u where u.id = s.app_user_id and u.id = v_id and not u.active;

  return jsonb_build_object('ok', true, 'id', v_id::text);
end;
$$;
revoke all on function public.perf_save_user(
  text, text, text, text, text, text[], boolean, text, boolean, text[], boolean, text)
  from public, anon;
grant execute on function public.perf_save_user(
  text, text, text, text, text, text[], boolean, text, boolean, text[], boolean, text)
  to authenticated;


-- ============================================================
--  ١١) أقسام نظرة عامة الخمسة
--      جلسات مراجعة الأداء · الاستراتيجيات الوطنية ·
--      الاستراتيجيات المؤسسية · المخرجات الوطنية · المشاريع
--
--      جدول واحد لكل الأقسام: المفتاح (القسم، المعرّف) والمحتوى
--      في عمود jsonb. اخترناه لأن تفاصيل كل قسم لم تُحسم بعد —
--      فإضافة حقل أو تغيير اسمه لاحقاً لا يحتاج ترحيلاً جديداً
--      ولا يمسّ ما هو محفوظ.
-- ============================================================
create table if not exists public.perf_items (
  section    text not null,
  id         text not null,
  ord        int  not null default 100,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by text,
  primary key (section, id)
);

alter table public.perf_items enable row level security;
grant select, insert, update, delete on public.perf_items to authenticated;

-- القراءة: من يملك صلاحية القسم نفسه (اسم القسم هو اسم الصلاحية)
drop policy if exists "perf_items_read" on public.perf_items;
create policy "perf_items_read" on public.perf_items
  for select to authenticated
  using (public.perf_has_scope(section));

-- الكتابة: صلاحية القسم + صلاحية تحرير الأقسام
drop policy if exists "perf_items_write" on public.perf_items;
create policy "perf_items_write" on public.perf_items
  for all to authenticated
  using (public.perf_has_scope(section) and public.perf_has_scope('sections:edit'))
  with check (public.perf_has_scope(section) and public.perf_has_scope('sections:edit'));

-- ------------------------------------------------------------
--  الصلاحيات الجديدة:
--    sessions       جلسات مراجعة الأداء
--    natstrat       الاستراتيجيات الوطنية
--    inststrat      الاستراتيجيات المؤسسية
--    outputs        المخرجات الوطنية
--    projects       المشاريع الاستراتيجية
--    sections:edit  تحرير بيانات هذه الأقسام
--  العرض يُمنح لكل حساب نشط (أقسام معلوماتية للإدارة كلها)،
--  والتحرير لمدير الإدارة وحده — وما بعدها من الواجهة.
-- ------------------------------------------------------------
update public.perf_users
   set scopes = (select array(select distinct unnest(
         coalesce(scopes,'{}') ||
         array['sessions','natstrat','inststrat','outputs','projects'])))
 where active
   and not (coalesce(scopes,'{}') @> array['sessions']);

update public.perf_users
   set scopes = (select array(select distinct unnest(
         coalesce(scopes,'{}') || array['sections:edit'])))
 where active
   and coalesce(scopes,'{}') @> array['users']
   and not (coalesce(scopes,'{}') @> array['sections:edit']);

-- ------------------------------------------------------------
--  بيانات مبدئية — للعرض حتى تصل البيانات الحقيقية.
--  كل صف مُعلَّم بـ "demo": true، فإعادة تشغيل الملف تُحدّث
--  صفوف العرض وحدها ولا تمسّ أي صف أدخلته الإدارة.
-- ------------------------------------------------------------
insert into public.perf_items (section, id, ord, data) values
 ('sessions','ses-1',1,'{"demo":true,"entity":"وزارة التعليم","quarter":"الربع الثالث 2026","done":4,"stages":[{"n":"تحديد الجهة","d":"2026-07-05"},{"n":"جمع البيانات","d":"2026-07-20"},{"n":"إعداد التقرير","d":"2026-08-02"},{"n":"انعقاد الجلسة","d":"2026-08-11"},{"n":"محضر وتوصيات","d":"2026-08-25"},{"n":"الإغلاق","d":""}]}'::jsonb),
 ('sessions','ses-2',2,'{"demo":true,"entity":"هيئة الحكومة الرقمية","quarter":"الربع الثالث 2026","done":2,"stages":[{"n":"تحديد الجهة","d":"2026-07-06"},{"n":"جمع البيانات","d":"2026-07-28"},{"n":"إعداد التقرير","d":""},{"n":"انعقاد الجلسة","d":""},{"n":"محضر وتوصيات","d":""},{"n":"الإغلاق","d":""}]}'::jsonb),
 ('sessions','ses-3',3,'{"demo":true,"entity":"وزارة النقل","quarter":"الربع الثالث 2026","done":6,"stages":[{"n":"تحديد الجهة","d":"2026-07-05"},{"n":"جمع البيانات","d":"2026-07-15"},{"n":"إعداد التقرير","d":"2026-07-30"},{"n":"انعقاد الجلسة","d":"2026-08-12"},{"n":"محضر وتوصيات","d":"2026-08-20"},{"n":"الإغلاق","d":"2026-08-28"}]}'::jsonb),
 ('sessions','ses-4',4,'{"demo":true,"entity":"وزارة البلديات والإسكان","quarter":"الربع الثالث 2026","done":0,"stages":[{"n":"تحديد الجهة","d":""},{"n":"جمع البيانات","d":""},{"n":"إعداد التقرير","d":""},{"n":"انعقاد الجلسة","d":""},{"n":"محضر وتوصيات","d":""},{"n":"الإغلاق","d":""}]}'::jsonb),

 ('natstrat','nat-1',1,'{"demo":true,"name":"الاستراتيجية الوطنية للتجارة الخارجية","owner":"وزارة التجارة","domain":"الاستثمار","stage":2,"tech":false,"meas":58,"note":"مخرجات غير قابلة للقياس ولم تُحدَّد مستهدفاتها","period":"2025 – 2030","approvedAt":"","kpisRep":11,"kpisTot":18,"initRep":19,"initTot":34,"current":"جارٍ العمل مع مالك الاستراتيجية لرفع مستوى قابلية القياس، وتُعدّ ضمن النطاق المنخفض بنسبة 58٪.","challenge":"توجد عناصر في الاستراتيجية لم تستوفِ معايير المركز.","next":"العمل مع فريق الجهة لرفع قابلية القياس للوصول إلى 100٪.","support":"التأكيد على فريق الجهة بالمواءمة المستمرة مع مركز أداء.","updated":"2026-09-04"}'::jsonb),
 ('natstrat','nat-2',2,'{"demo":true,"name":"استراتيجية قطاع التنمية الاجتماعية","owner":"وزارة الموارد البشرية","domain":"القطاع الصحي","stage":3,"tech":false,"meas":46,"note":"امتثال 46٪ من العناصر — زُوِّدت الوزارة بالملاحظات","period":"2024 – 2030","approvedAt":"2026-05-12","kpisRep":9,"kpisTot":22,"initRep":14,"initTot":31,"current":"الملاحظات الفنية أُرسلت للوزارة وبانتظار المعالجة.","challenge":"نصف عناصر الاستراتيجية غير مرتبطة بمؤشرات قياس.","next":"استلام النسخة المعالَجة ومراجعتها فنياً.","support":"تحديد ممثل دائم من الوزارة للتواصل الفني.","updated":"2026-09-03"}'::jsonb),
 ('natstrat','nat-3',3,'{"demo":true,"name":"الاستراتيجية الوطنية للفضاء","owner":"وكالة الفضاء السعودية","domain":"الفضاء","stage":3,"tech":false,"meas":72,"note":"ملاحظات فنية على المؤشرات والمبادرات — زُوِّدت الجهة","period":"2023 – 2030","approvedAt":"2026-08-28","kpisRep":16,"kpisTot":24,"initRep":21,"initTot":29,"current":"معتمدة من اللجنة الاستراتيجية وقيد رفع قابلية القياس.","challenge":"بعض المبادرات بلا مؤشرات أداء مرتبطة.","next":"مراجعة المبادرات غير الممثَّلة مع الوكالة.","support":"جلسة فنية مشتركة خلال الربع القادم.","updated":"2026-08-28"}'::jsonb),
 ('natstrat','nat-4',4,'{"demo":true,"name":"الاستراتيجية الوطنية للتخصيص","owner":"المركز الوطني للتخصيص","domain":"التوطين","stage":4,"tech":true,"meas":100,"note":"لا توجد ملاحظات — قابلية القياس 100٪","period":"2021 – 2030","approvedAt":"2026-02-19","kpisRep":21,"kpisTot":21,"initRep":18,"initTot":18,"current":"معتمدة من مجلس الوزراء وجميع عناصرها قابلة للقياس.","challenge":"لا يوجد.","next":"المتابعة الدورية للأداء الربعي.","support":"لا يوجد.","updated":"2026-08-20"}'::jsonb),
 ('natstrat','nat-5',5,'{"demo":true,"name":"استراتيجية المدينة المنورة","owner":"هيئة تطوير المدينة","domain":"الحج","stage":3,"tech":false,"meas":68,"note":"ملاحظات فنية بانتظار المعالجة","period":"2024 – 2030","approvedAt":"2026-06-30","kpisRep":13,"kpisTot":20,"initRep":11,"initTot":17,"current":"معتمدة من اللجنة وبانتظار معالجة الملاحظات الفنية.","challenge":"تأخر ورود الردود من الهيئة.","next":"متابعة أسبوعية حتى استلام النسخة المعالَجة.","support":"تحديد موعد نهائي للردّ.","updated":"2026-08-14"}'::jsonb),

 ('inststrat','ins-1',1,'{"demo":true,"name":"استراتيجية وزارة التعليم المؤسسية","owner":"وزارة التعليم","goals":6,"kpis":24,"stage":2,"status":"عند المركز للمراجعة","note":"","updated":"2026-09-04"}'::jsonb),
 ('inststrat','ins-2',2,'{"demo":true,"name":"استراتيجية هيئة الحكومة الرقمية","owner":"هيئة الحكومة الرقمية","goals":5,"kpis":19,"stage":3,"status":"عند الجهة لمعالجة الملاحظات","note":"ثلاثة مؤشرات بلا مستهدفات، وهدفان بلا مؤشرات قياس.","updated":"2026-09-03"}'::jsonb),
 ('inststrat','ins-3',3,'{"demo":true,"name":"استراتيجية المركز الوطني للتخصيص","owner":"المركز الوطني للتخصيص","goals":4,"kpis":16,"stage":5,"status":"معتمدة · فُعِّل القياس","note":"","updated":"2026-08-27"}'::jsonb),
 ('inststrat','ins-4',4,'{"demo":true,"name":"استراتيجية الهيئة الملكية للجبيل وينبع","owner":"الهيئة الملكية للجبيل وينبع","goals":7,"kpis":31,"stage":2,"status":"عند المركز للمراجعة","note":"","updated":"2026-08-24"}'::jsonb),

 ('projects','prj-1',1,'{"demo":true,"name":"مشروع دعم وتفعيل وقياس الاستراتيجيات الوطنية والأداء المؤسسي","status":"جارٍ التنفيذ","planned":30,"actual":26,"period":"أبريل 2026 – سبتمبر 2027","months":18,"elapsed":6}'::jsonb),
 ('projects','prj-2',2,'{"demo":true,"name":"مشروع الحج والعمرة","status":"جارٍ التنفيذ","planned":0,"actual":0,"period":"","months":0,"elapsed":0}'::jsonb)
-- التحديث يتخطّى أي صف عُدِّل من الواجهة: الحفظ يضع "demo": false
-- فيبقى ما أدخلته الإدارة كما هو مهما أُعيد تشغيل الملف.
on conflict (section, id) do update
   set data = excluded.data, ord = excluded.ord
 where public.perf_items.data->>'demo' is distinct from 'false';
