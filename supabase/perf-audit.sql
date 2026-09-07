-- ============================================================
--  سجل النشاط — صفحة لمالكة المنصة وحدها للتحقّق
--  من عدّل ماذا ومتى، ومتى فعّل كلٌّ حسابه.
--
--  للحذف لاحقاً: انظر آخر الملف.
--  idempotent وليس فيه حذف بيانات.
-- ============================================================

-- ------------------------------------------------------------
--  ١) وقت التفعيل — عمودٌ مستقل
--     last_login يتغيّر مع كل دخول، فلا يصلح للتفعيل.
-- ------------------------------------------------------------
alter table public.perf_users add column if not exists activated_at timestamptz;

-- تقدير للحسابات التي فُعِّلت قبل هذا العمود: أول دخول مسجَّل.
-- يُعلَّم «تقديري» في العرض حتى لا يُقرأ رقماً موثقاً.
update public.perf_users
   set activated_at = last_login
 where activated_at is null
   and coalesce(pass_hash,'') <> ''
   and last_login is not null;

-- ------------------------------------------------------------
--  ٢) التفعيل يسجّل وقته
-- ------------------------------------------------------------
create or replace function public.perf_activate(
  p_username text, p_phone text, p_last4 text, p_password text, p_sectors text[]
) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare u record; v_first boolean; v_ok boolean; v_phone text;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if length(coalesce(p_password,'')) < 6 then return jsonb_build_object('error','short'); end if;

  select * into u from public.perf_users
   where username = public.perf_norm_user(p_username) and active;
  if not found then return null; end if;

  v_first := (u.pass_hash is null or u.pass_hash = '');
  v_phone := public.perf_norm_phone(p_phone);

  if v_first and coalesce(u.phone,'') = '' then
    if length(v_phone) < 12 then return jsonb_build_object('error','phone'); end if;
    if exists (select 1 from public.perf_users x where x.phone = v_phone and x.id <> u.id) then
      return jsonb_build_object('error','phone_taken');
    end if;
    v_ok := true;
  else
    v_ok := case when v_first
              then v_phone = u.phone
              else length(coalesce(p_last4,'')) = 4 and right(u.phone, 4) = p_last4
            end;
  end if;
  if not v_ok then return null; end if;

  update public.perf_users
     set pass_hash = crypt(p_password, gen_salt('bf')),
         phone = case when v_first and coalesce(phone,'') = '' then v_phone else phone end,
         activated_at = case when v_first then now() else activated_at end,
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

-- ------------------------------------------------------------
--  ٣) حالة الحسابات — من فعّل ومتى
-- ------------------------------------------------------------
create or replace function public.perf_audit_users()
returns table (name text, username text, active boolean, is_lead boolean,
               job_title text, created_at timestamptz,
               activated_at timestamptz, last_login timestamptz,
               activated boolean, approx boolean)
language sql stable security definer set search_path = public as $$
  select u.display_name, u.username, u.active, u.is_lead,
         coalesce(u.job_title,''), u.created_at,
         u.activated_at, u.last_login,
         coalesce(u.pass_hash,'') <> '' as activated,
         -- تقديري: وقتُه مساوٍ لآخر دخول، فلم يُسجَّل عند التفعيل نفسه
         (u.activated_at is not null and u.activated_at = u.last_login) as approx
    from public.perf_users u
   where public.perf_has_scope('audit')
   order by u.activated_at desc nulls last, u.display_name;
$$;
revoke all on function public.perf_audit_users() from public, anon;
grant execute on function public.perf_audit_users() to authenticated;

-- ------------------------------------------------------------
--  ٤) من عدّل ماذا ومتى — من مصادر التعديل كلها
--     ما لا يحمل اسم مُعدِّله يظهر بـ«—» لا يُنسب لأحد.
-- ------------------------------------------------------------
create or replace function public.perf_audit_log(p_days int default 30, p_limit int default 400)
returns table (at timestamptz, who text, kind text, what text, "where" text)
language sql stable security definer set search_path = public as $$
  with since as (select now() - make_interval(days => greatest(1, p_days)) as t)
  select * from (
    -- بنود الأقسام
    select i.updated_at, coalesce(nullif(i.updated_by,''), '—'), 'قسم',
           coalesce(nullif(i.data->>'name',''), nullif(i.data->>'owner',''),
                    nullif(i.data->>'entity',''), i.id),
           case i.section
             when 'sessions' then 'جلسات مراجعة الأداء'
             when 'natstrat' then 'الاستراتيجيات الوطنية'
             when 'inststrat' then 'الاستراتيجيات المؤسسية'
             when 'outputs' then 'المخرجات الوطنية'
             when 'cx' then 'أعمال قياس تجربة المستفيد'
             when 'projects' then 'المشاريع الاستراتيجية'
             else i.section end
      from public.perf_items i where i.updated_at >= (select t from since)
    union all
    -- القياسات
    select m.updated_at, coalesce(nullif(m.updated_by,''), '—'), 'قياس',
           coalesce(ind.name, m.indicator_id) || ' = ' || coalesce(m.actual::text,'—'),
           coalesce(sec.name, m.sector_id)
      from public.perf_measurements m
      left join public.perf_indicators ind on ind.id = m.indicator_id
      left join public.perf_sectors sec on sec.id = m.sector_id
     where m.updated_at >= (select t from since)
    union all
    -- المستهدفات
    select g.at, coalesce(nullif(g.by_name,''), '—'), 'مستهدف',
           coalesce(ind.name, g.indicator_id) || ': ' ||
           coalesce(g.old_value::text,'—') || ' ← ' || coalesce(g.new_value::text,'—'),
           coalesce(sec.name, g.sector_id)
      from public.perf_target_log g
      left join public.perf_indicators ind on ind.id = g.indicator_id
      left join public.perf_sectors sec on sec.id = g.sector_id
     where g.at >= (select t from since)
    union all
    -- الملاحظات (النص لا يُعرض — يكفي أنها كُتبت)
    select n.at, coalesce(nullif(n.by_name,''), '—'), 'ملاحظة',
           coalesce(ind.name, n.indicator_id), coalesce(sec.name, n.sector_id)
      from public.perf_notes n
      left join public.perf_indicators ind on ind.id = n.indicator_id
      left join public.perf_sectors sec on sec.id = n.sector_id
     where n.at >= (select t from since)
    union all
    -- المهام والتكاليف: إنشاء
    select t.created_at, coalesce(nullif(cu.display_name,''), '—'),
           case when t.kind = 'assignment' then 'تكليف' else 'مهمة' end,
           t.title, coalesce(au.display_name, '—')
      from public.perf_tasks t
      left join public.perf_users cu on cu.id::text = t.created_by_id
      left join public.perf_users au on au.id::text = t.assignee_id
     where t.created_at >= (select t from since)
    union all
    -- ردود المهام والتكاليف
    select (u->>'at')::timestamptz, coalesce(nullif(u->>'byName',''), '—'), 'ردّ',
           left(coalesce(u->>'text',''), 90), t.title
      from public.perf_tasks t,
           lateral jsonb_array_elements(coalesce(t.updates,'[]'::jsonb)) u
     where (u->>'at') is not null and (u->>'at')::timestamptz >= (select t from since)
    union all
    -- تفويضات الأقسام
    select g.granted_at, coalesce(nullif(g.granted_by,''), '—'), 'تفويض',
           gu.display_name || ' — ' || case when g.can_edit then 'تحرير' else 'اطّلاع' end,
           g.section
      from public.perf_section_grants g
      left join public.perf_users gu on gu.id = g.grantee_id
     where g.granted_at >= (select t from since)
  ) x(at, who, kind, what, "where")
  where public.perf_has_scope('audit')
  order by at desc
  limit greatest(1, p_limit);
$$;
revoke all on function public.perf_audit_log(int, int) from public, anon;
grant execute on function public.perf_audit_log(int, int) to authenticated;

-- ------------------------------------------------------------
--  ٥) الصلاحية لمالكة المنصة وحدها
-- ------------------------------------------------------------
update public.perf_users
   set scopes = array_remove(scopes, 'audit')
 where scopes @> array['audit'];

update public.perf_users
   set scopes = (select array(select distinct unnest(coalesce(scopes,'{}') || array['audit'])))
 where active
   and public.perf_norm_name(display_name) = public.perf_norm_name('سلطانه العرجاني');

-- ------------------------------------------------------------
--  ٦) المراجعة
-- ------------------------------------------------------------
select display_name as "الاسم", username as "اسم الدخول",
       case when coalesce(pass_hash,'') <> '' then 'مفعّل' else 'لم يُفعّل' end as "الحساب",
       activated_at as "وقت التفعيل", last_login as "آخر دخول"
  from public.perf_users where active order by activated_at desc nulls last, display_name;

-- ============================================================
--  للحذف لاحقاً — ثلاثة أسطر:
--    drop function if exists public.perf_audit_log(int,int);
--    drop function if exists public.perf_audit_users();
--    update public.perf_users set scopes = array_remove(scopes,'audit');
--  (عمود activated_at يُترك — لا ضرر منه وفيه معلومة)
-- ============================================================
