-- ============================================================
--  حسابٌ من خارج الإدارة
--  ------------------------------------------------------------
--  يُشغَّل مرة واحدة من SQL Editor. idempotent وليس فيه حذف.
--
--  الحساب يُنشأ بقطاعٍ لأن المنصة تبني الهيكل التنظيمي وقوائم
--  الفريق من الحسابات نفسها. فمن يُمنح وصولاً من خارج الإدارة
--  كان يظهر موظفاً فيها: في الهيكل، وفي محافظ الفريق، وفي ترتيب
--  الاستشاريين.
--
--  `is_external` رايةٌ تقول «يدخل ولا يُعدّ منّا»: الصلاحيات
--  تعمل كما هي، ويختفي صاحبها من كل ما يَعُدّ موظفي الإدارة.
-- ============================================================

alter table public.perf_users
  add column if not exists is_external boolean not null default false;

comment on column public.perf_users.is_external is
  'حسابٌ من خارج الإدارة: يُستثنى من الهيكل التنظيمي وقوائم الفريق والترتيب';

-- ------------------------------------------------------------
--  ١) القوائم تُرجع الراية
-- ------------------------------------------------------------
drop function if exists public.perf_people();
create or replace function public.perf_people()
returns table (id text, name text, role text, sector_ids text[],
               active boolean, is_lead boolean, job_title text, photo_url text,
               is_external boolean)
language plpgsql security definer set search_path = public as $$
begin
  if not public.perf_signed_in() then raise exception 'forbidden'; end if;
  return query select u.id::text, u.display_name, u.role, u.sector_ids,
                      u.active, u.is_lead, u.job_title, u.photo_url, u.is_external
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
               scopes text[], is_lead boolean, job_title text, is_external boolean)
language plpgsql security definer set search_path = public as $$
begin
  if not public.perf_has_scope('users') then raise exception 'forbidden'; end if;
  return query select u.id::text, u.username, u.display_name, u.phone, u.role,
                      u.sector_ids, u.active,
                      (u.pass_hash is not null and u.pass_hash <> ''),
                      u.scopes, u.is_lead, u.job_title, u.is_external
                 from public.perf_users u order by u.created_at;
end;
$$;
revoke all on function public.perf_list_users() from public, anon;
grant execute on function public.perf_list_users() to authenticated;

-- ------------------------------------------------------------
--  ٢) الحفظ يقبل الراية
--     القديمة تُحذف حتى لا يلتبس على PostgREST أيُّ توقيعٍ يُنادى
-- ------------------------------------------------------------
drop function if exists public.perf_save_user(
  text, text, text, text, text, text[], boolean, text, boolean, text[], boolean, text);

create or replace function public.perf_save_user(
  p_id text, p_username text, p_name text, p_phone text, p_role text,
  p_sectors text[], p_active boolean, p_password text, p_clear_password boolean,
  p_scopes text[] default null, p_is_lead boolean default null,
  p_job_title text default null, p_is_external boolean default null
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
                                   sector_ids, active, scopes, is_lead, job_title, is_external)
    values (public.perf_norm_user(p_username), coalesce(nullif(p_name,''), p_username),
            public.perf_norm_phone(p_phone), v_hash,
            case when p_role = 'admin' then 'admin' else 'manager' end,
            coalesce(p_sectors,'{}'), coalesce(p_active, true),
            coalesce(p_scopes, array['overview','details','tasks']),
            coalesce(p_is_lead, false), nullif(btrim(coalesce(p_job_title,'')), ''),
            coalesce(p_is_external, false))
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
      is_external  = coalesce(p_is_external, is_external),
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
  text, text, text, text, text, text[], boolean, text, boolean, text[], boolean, text, boolean)
  from public, anon;
grant execute on function public.perf_save_user(
  text, text, text, text, text, text[], boolean, text, boolean, text[], boolean, text, boolean)
  to authenticated;
