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


-- ------------------------------------------------------------
--  ٤) إظهار الراية في شاشة المستخدمين وحفظها
--     الدالتان تُحذفان أولاً لأن تغيير التوقيع أو نوع الإرجاع
--     لا يقبله create or replace، ولو تُركت القديمة صار تعارضاً.
-- ------------------------------------------------------------
drop function if exists public.perf_list_users();
create or replace function public.perf_list_users()
returns table (id text, username text, name text, phone text, role text,
               sector_ids text[], active boolean, has_password boolean,
               can_changes boolean)
language plpgsql security definer set search_path = public as $$
begin
  if not public.perf_is_admin() then raise exception 'forbidden'; end if;
  return query select u.id::text, u.username, u.display_name, u.phone, u.role,
                      u.sector_ids, u.active,
                      (u.pass_hash is not null and u.pass_hash <> ''),
                      u.can_changes
                 from public.perf_users u order by u.created_at;
end;
$$;
revoke all on function public.perf_list_users() from public, anon;
grant execute on function public.perf_list_users() to authenticated;

drop function if exists public.perf_save_user(
  text, text, text, text, text, text[], boolean, text, boolean);
create or replace function public.perf_save_user(
  p_id text, p_username text, p_name text, p_phone text, p_role text,
  p_sectors text[], p_active boolean, p_password text, p_clear_password boolean,
  p_can_changes boolean default null
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
    insert into public.perf_users (username, display_name, phone, pass_hash, role,
                                   sector_ids, active, can_changes)
    values (public.perf_norm_user(p_username), coalesce(nullif(p_name,''), p_username),
            public.perf_norm_phone(p_phone), v_hash,
            case when p_role = 'admin' then 'admin' else 'manager' end,
            case when p_role = 'admin' then '{}'::text[] else coalesce(p_sectors,'{}') end,
            coalesce(p_active, true), coalesce(p_can_changes, false))
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
      can_changes  = coalesce(p_can_changes, can_changes),
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
revoke all on function public.perf_save_user(
  text, text, text, text, text, text[], boolean, text, boolean, boolean) from public, anon;
grant execute on function public.perf_save_user(
  text, text, text, text, text, text[], boolean, text, boolean, boolean) to authenticated;
