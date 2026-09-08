-- ============================================================
--  قياس الاستخدام + استكمال سجل النشاط
--  ------------------------------------------------------------
--  السجل كان يرصد بنود الأقسام والقياسات والمستهدفات وملاحظات
--  المؤشرات والمهام وردودها والتفويضات. وكان يفوته:
--    · الملاحظات اللاصقة (القلم)
--    · بنود محفظة كل موظف
--    · ملاحظات محفظته وتقويمه (perf_user_data)
--  ولذلك لم يظهر أنّ أحداً «أضاف ملاحظات» وهو قد أضافها فعلاً.
--
--  ولا يُعرض محتوى شيء: الأسماء والأماكن والأوقات وحدها. ونصّ
--  ردود المهام الذي كان يظهر في السجل أُزيل.
--
--  ويضيف perf_usage(p_days): جدول استخدام لكل حساب في مدّة —
--  آخر دخول وعدد ما فعله بكل نوع وآخر نشاط له.
--
--  الاثنتان محجوبتان خلف صلاحية «audit» كبقية السجل.
--  idempotent وليس فيه حذف بيانات. يُشغَّل بعد perf-audit.sql
-- ============================================================

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
    select m.updated_at, coalesce(nullif(m.updated_by,''), '—'), 'قياس',
           coalesce(ind.name, m.indicator_id) || ' = ' || coalesce(m.actual::text,'—'),
           coalesce(sec.name, m.sector_id)
      from public.perf_measurements m
      left join public.perf_indicators ind on ind.id = m.indicator_id
      left join public.perf_sectors sec on sec.id = m.sector_id
     where m.updated_at >= (select t from since)
    union all
    select g.at, coalesce(nullif(g.by_name,''), '—'), 'مستهدف',
           coalesce(ind.name, g.indicator_id) || ': ' ||
           coalesce(g.old_value::text,'—') || ' ← ' || coalesce(g.new_value::text,'—'),
           coalesce(sec.name, g.sector_id)
      from public.perf_target_log g
      left join public.perf_indicators ind on ind.id = g.indicator_id
      left join public.perf_sectors sec on sec.id = g.sector_id
     where g.at >= (select t from since)
    union all
    -- ملاحظة على مؤشر — بلا نصّها
    select n.at, coalesce(nullif(n.by_name,''), '—'), 'ملاحظة',
           coalesce(ind.name, n.indicator_id), coalesce(sec.name, n.sector_id)
      from public.perf_notes n
      left join public.perf_indicators ind on ind.id = n.indicator_id
      left join public.perf_sectors sec on sec.id = n.sector_id
     where n.at >= (select t from since)
    union all
    -- ملاحظة لاصقة (القلم) — الصفحة وحدها بلا نصّها
    select s.at, coalesce(nullif(s.by_name,''), '—'), 'ملاحظة لاصقة',
           '— (لا يُعرض النص)',
           case s.page
             when 'overview' then 'نظرة عامة'
             when 'details' then 'المؤشرات التفصيلية'
             when 'sessions' then 'جلسات مراجعة الأداء'
             when 'natstrat' then 'الاستراتيجيات الوطنية'
             when 'inststrat' then 'الاستراتيجيات المؤسسية'
             when 'outputs' then 'المخرجات الوطنية'
             when 'cx' then 'أعمال قياس تجربة المستفيد'
             when 'projects' then 'المشاريع الاستراتيجية'
             when 'weekly' then 'الإنجاز الأسبوعي'
             else s.page end
      from public.perf_stickies s where s.at >= (select t from since)
    union all
    -- بنود محفظته — الاسم والقسم بلا محتوى
    select pf.updated_at, coalesce(nullif(pu.display_name,''), '—'), 'محفظتي',
           coalesce(nullif(pf.data->>'name',''), nullif(pf.data->>'title',''),
                    nullif(pf.data->>'entity',''), pf.id),
           case pf.section
             when 'entities' then 'جهاتي ومساهماتها'
             when 'projects' then 'مشاريعي'
             when 'ops' then 'أعمالي التشغيلية'
             else pf.section end
      from public.perf_portfolio pf
      left join public.perf_users pu on pu.id = pf.app_user_id
     where pf.updated_at >= (select t from since)
    union all
    -- ملاحظاته وتقويمه الخاص: وقت التحديث وحده، ولا يُقرأ محتواه
    select ud.updated_at, coalesce(nullif(uu.display_name,''), '—'),
           case ud.key when 'notes' then 'ملاحظاته الخاصة' else 'صفحته الخاصة' end,
           '— (خاصة به — لا يُعرض محتواها)', 'محفظتي'
      from public.perf_user_data ud
      left join public.perf_users uu on uu.id = ud.app_user_id
     where ud.updated_at >= (select t from since)
    union all
    select t.created_at, coalesce(nullif(cu.display_name,''), '—'),
           case when t.kind = 'assignment' then 'تكليف' else 'مهمة' end,
           t.title, coalesce(au.display_name, '—')
      from public.perf_tasks t
      left join public.perf_users cu on cu.id::text = t.created_by_id
      left join public.perf_users au on au.id::text = t.assignee_id
     where t.created_at >= (select t from since)
    union all
    -- ردّ على مهمة — بلا نصّه (كان يظهر أول 90 حرفاً)
    select (u->>'at')::timestamptz, coalesce(nullif(u->>'byName',''), '—'), 'ردّ',
           '— (لا يُعرض النص)', t.title
      from public.perf_tasks t,
           lateral jsonb_array_elements(coalesce(t.updates,'[]'::jsonb)) u
     where (u->>'at') is not null and (u->>'at')::timestamptz >= (select t from since)
    union all
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
--  جدول الاستخدام: لكل حساب، ماذا فعل في المدّة
-- ------------------------------------------------------------
create or replace function public.perf_usage(p_days int default 30)
returns table (name text, job_title text, activated boolean,
               last_login timestamptz, last_act timestamptz,
               items int, meas int, notes int, stickies int,
               tasks int, replies int, portfolio int, own_notes int, total int)
language sql stable security definer set search_path = public as $$
  with since as (select now() - make_interval(days => greatest(1, p_days)) as t),
  u as (select * from public.perf_users where active),
  a as (
    select coalesce(nullif(i.updated_by,''),'—') as who, 'items' as k, i.updated_at as at
      from public.perf_items i where i.updated_at >= (select t from since)
    union all
    select coalesce(nullif(m.updated_by,''),'—'), 'meas', m.updated_at
      from public.perf_measurements m where m.updated_at >= (select t from since)
    union all
    select coalesce(nullif(n.by_name,''),'—'), 'notes', n.at
      from public.perf_notes n where n.at >= (select t from since)
    union all
    select coalesce(nullif(s.by_name,''),'—'), 'stickies', s.at
      from public.perf_stickies s where s.at >= (select t from since)
    union all
    select coalesce(nullif(cu.display_name,''),'—'), 'tasks', t.created_at
      from public.perf_tasks t left join public.perf_users cu on cu.id::text = t.created_by_id
     where t.created_at >= (select t from since)
    union all
    select coalesce(nullif(v->>'byName',''),'—'), 'replies', (v->>'at')::timestamptz
      from public.perf_tasks t, lateral jsonb_array_elements(coalesce(t.updates,'[]'::jsonb)) v
     where (v->>'at') is not null and (v->>'at')::timestamptz >= (select t from since)
    union all
    select coalesce(nullif(pu.display_name,''),'—'), 'portfolio', pf.updated_at
      from public.perf_portfolio pf left join public.perf_users pu on pu.id = pf.app_user_id
     where pf.updated_at >= (select t from since)
    union all
    select coalesce(nullif(uu.display_name,''),'—'), 'own_notes', ud.updated_at
      from public.perf_user_data ud left join public.perf_users uu on uu.id = ud.app_user_id
     where ud.updated_at >= (select t from since)
  )
  select u.display_name, coalesce(u.job_title,''),
         coalesce(u.pass_hash,'') <> '',
         u.last_login,
         (select max(a.at) from a where public.perf_norm_name(a.who) = public.perf_norm_name(u.display_name)),
         (select count(*)::int from a where a.k='items'     and public.perf_norm_name(a.who)=public.perf_norm_name(u.display_name)),
         (select count(*)::int from a where a.k='meas'      and public.perf_norm_name(a.who)=public.perf_norm_name(u.display_name)),
         (select count(*)::int from a where a.k='notes'     and public.perf_norm_name(a.who)=public.perf_norm_name(u.display_name)),
         (select count(*)::int from a where a.k='stickies'  and public.perf_norm_name(a.who)=public.perf_norm_name(u.display_name)),
         (select count(*)::int from a where a.k='tasks'     and public.perf_norm_name(a.who)=public.perf_norm_name(u.display_name)),
         (select count(*)::int from a where a.k='replies'   and public.perf_norm_name(a.who)=public.perf_norm_name(u.display_name)),
         (select count(*)::int from a where a.k='portfolio' and public.perf_norm_name(a.who)=public.perf_norm_name(u.display_name)),
         (select count(*)::int from a where a.k='own_notes' and public.perf_norm_name(a.who)=public.perf_norm_name(u.display_name)),
         (select count(*)::int from a where public.perf_norm_name(a.who)=public.perf_norm_name(u.display_name))
    from u
   where public.perf_has_scope('audit')
   order by 14 desc, u.display_name;
$$;
revoke all on function public.perf_usage(int) from public, anon;
grant execute on function public.perf_usage(int) to authenticated;
