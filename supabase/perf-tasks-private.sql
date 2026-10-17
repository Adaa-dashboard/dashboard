-- ============================================================
--  المهمة الشخصية خاصّة — لا يقرؤها ولا يعدّلها إلا صاحبها
--
--  كانت `perf_can_see_task` تعطي القراءة لصاحب صلاحية
--  «كل المهام» (tasks:all) ولمدير القطاع، فظهرت مهام كل موظف
--  في صفحة المهام عند المديرين. والمهمة الشخصية خاصّةٌ بصاحبها
--  في صفحته وحدها ولا تُشارَك.
--
--  بعد هذا الملف:
--    المهمة (kind='task') يراها ويعدّلها:
--       صاحبها (assignee_id) · من أسندها إليه (created_by_id)
--       · ومن منحه صاحبها مهامه صراحةً من «محفظتي» (قراءةً فقط)
--    التكليف (kind='assignment') يبقى كما هو: قسمٌ مشترك يراه
--       صاحب صلاحية «التكاليف» أو «كل المهام»، ومدير القطاع
--       لموظفي قطاعه.
--
--  الملف idempotent — يُشغَّل من SQL Editor أكثر من مرة بلا ضرر،
--  ولا يمسّ أي بيانات: يغيّر دالّتَي الصلاحية والسياستين فقط.
-- ============================================================

create or replace function public.perf_can_see_task(
  p_assignee text, p_creator text, p_kind text
) returns boolean language sql stable security definer set search_path = public as $$
  select
      /* صاحب المهمة ومن أسندها — في المهمة والتكليف سواء */
      p_assignee = public.perf_my_id()::text
   or p_creator  = public.perf_my_id()::text
      /* التكاليف وحدها مشتركة */
   or (coalesce(p_kind, 'task') = 'assignment'
       and (public.perf_has_scope('assignments') or public.perf_has_scope('tasks:all')))
   or (coalesce(p_kind, 'task') = 'assignment'
       and exists (select 1
                     from public.perf_users me
                     join public.perf_users u on u.id::text = p_assignee
                    where me.id = public.perf_my_id()
                      and me.is_lead
                      and u.sector_ids && me.sector_ids))
      /* ومن منحه صاحبُها الاطّلاع صراحةً من «محفظتي» — بإذنه هو */
   or exists (select 1
                from public.perf_portfolio_grants g
               where g.owner_id::text = p_assignee
                 and g.grantee_id = public.perf_my_id()
                 and (g.scopes @> array['*'] or g.scopes @> array['tasks']));
$$;
revoke all on function public.perf_can_see_task(text, text, text) from public, anon;
grant execute on function public.perf_can_see_task(text, text, text) to authenticated;

-- التعديل أضيق من القراءة: المنح للاطّلاع فقط، فلا يعدّل الممنوح له
create or replace function public.perf_can_edit_task(
  p_assignee text, p_creator text, p_kind text
) returns boolean language sql stable security definer set search_path = public as $$
  select
      p_assignee = public.perf_my_id()::text
   or p_creator  = public.perf_my_id()::text
   or (coalesce(p_kind, 'task') = 'assignment'
       and (public.perf_has_scope('assignments') or public.perf_has_scope('tasks:all')))
   or (coalesce(p_kind, 'task') = 'assignment'
       and exists (select 1
                     from public.perf_users me
                     join public.perf_users u on u.id::text = p_assignee
                    where me.id = public.perf_my_id()
                      and me.is_lead
                      and u.sector_ids && me.sector_ids));
$$;
revoke all on function public.perf_can_edit_task(text, text, text) from public, anon;
grant execute on function public.perf_can_edit_task(text, text, text) to authenticated;

-- السياستان تُعاد كتابتهما على الدالّتين نفسيهما (لا تتغيّران، ولكن
-- إعادة إنشائهما تضمن أنهما قائمتان على التعريف الجديد)
drop policy if exists "perf_tasks_read" on public.perf_tasks;
create policy "perf_tasks_read" on public.perf_tasks
  for select to authenticated
  using (public.perf_can_see_task(assignee_id, created_by_id, kind));

drop policy if exists "perf_tasks_update" on public.perf_tasks;
create policy "perf_tasks_update" on public.perf_tasks
  for update to authenticated
  using (public.perf_can_edit_task(assignee_id, created_by_id, kind))
  with check (public.perf_can_edit_task(assignee_id, created_by_id, kind));

-- ------------------------------------------------------------
--  وحمولة رابط المشاركة كذلك: كانت تُخرج كل المهام ولو لم تُعرض
--  فيه، فتُقرأ من الرابط العام. صارت التكاليف وحدها.
-- ------------------------------------------------------------
drop function if exists public.perf_shared_report(text);

create function public.perf_shared_report(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s     record;
  d0    date;
  d1    date;
  v_log jsonb := '[]'::jsonb;
  v_chg jsonb := '[]'::jsonb;
  v_con jsonb := '[]'::jsonb;
begin
  select * into s from public.perf_shares
   where token = p_token
     and (expires_at is null or expires_at > now());
  if not found then return null; end if;

  update public.perf_shares
     set views = views + 1, last_view = now()
   where token = p_token;

  d0 := s.week_start::date;
  d1 := d0 + 7;

  /* سجلّ التغييرات — أسبوع الرابط وحده */
  begin
    select coalesce(jsonb_agg(to_jsonb(x) order by x.at), '[]'::jsonb) into v_log
      from public.perf_item_log x
     where x.at >= d0::timestamptz and x.at < d1::timestamptz;
  exception when others then v_log := '[]'::jsonb;
  end;

  /* طلبات التغيير: المفتوح كله، والمغلق في آخر ١٨٠ يوماً — منها
     نسبة الالتزام ومقارنتها بالأسبوع الماضي */
  begin
    select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_chg
      from public.perf_change_requests x
     where x.closed_at is null or x.closed_at >= d0 - 180;
  exception when others then v_chg := '[]'::jsonb;
  end;

  /* جهات التواصل التي روجعت بياناتها في الأسبوع */
  begin
    select coalesce(jsonb_agg(jsonb_build_object('entity', e.name, 'reviewedAt', c.reviewed_at)), '[]'::jsonb)
      into v_con
      from public.perf_contacts c
      join public.perf_entities e on e.id = c.entity_id
     where c.reviewed_at >= d0::timestamptz and c.reviewed_at < d1::timestamptz;
  exception when others then v_con := '[]'::jsonb;
  end;

  return jsonb_build_object(
    'weekStart', s.week_start,
    'sectors',      (select coalesce(jsonb_agg(to_jsonb(x) order by x.ord), '[]'::jsonb) from public.perf_sectors x),
    'indicators',   (select coalesce(jsonb_agg(to_jsonb(x) order by x.ord), '[]'::jsonb) from public.perf_indicators x where x.active),
    'periods',      (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.perf_periods x),
    'targets',      (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.perf_targets x),
    'measurements', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.perf_measurements x),
    /* **التكاليف وحدها**: المهمة الشخصية خاصّةٌ بصاحبها، وكانت
       تخرج كلُّها في حمولة الرابط العام ولو لم تُعرض فيه */
    'tasks',        (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb)
                       from public.perf_tasks x
                      where coalesce(x.kind, 'task') = 'assignment'),
    'items',        (select coalesce(jsonb_agg(to_jsonb(x) order by x.ord), '[]'::jsonb) from public.perf_items x),
    'settings',     (select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) from public.perf_settings),
    'log',      v_log,
    'changes',  v_chg,
    'contacts', v_con
  );
end;
$$;
grant execute on function public.perf_shared_report(text) to anon, authenticated;

-- تحقّق: كم مهمةً شخصيةً يراها حسابك الآن (المفروض مهامك وحدها)
select count(*) as "مهام شخصية مرئية لك"
  from public.perf_tasks
 where coalesce(kind, 'task') = 'task';
