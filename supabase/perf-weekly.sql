-- ============================================================
--  التقرير الأسبوعي — تخصيصه ومن يحرّره
--  يُشغَّل من SQL Editor مرة واحدة. الملف idempotent: إعادة
--  تشغيله لا تُغيّر شيئاً وليس فيه حذف بيانات إطلاقاً.
--  يُشغَّل بعد: perf-roster.sql · perf-changes.sql · perf-access.sql
-- ============================================================

-- ------------------------------------------------------------
--  ١) الكتابة في إعدادات التقرير الأسبوعي
--     perf_settings كانت الكتابة فيها لمدير الإدارة وحده. التقرير
--     الأسبوعي يحتاج كاتباً ليس بالضرورة مديراً، فنفتح مفاتيحه
--     وحدها (weekly*) لمن يملك weekly:edit — وبقية المفاتيح
--     تبقى كما هي تماماً.
-- ------------------------------------------------------------
drop policy if exists "perf_settings_weekly_write" on public.perf_settings;
create policy "perf_settings_weekly_write" on public.perf_settings
  for all to authenticated
  using (key like 'weekly%' and public.perf_has_scope('weekly:edit'))
  with check (key like 'weekly%' and public.perf_has_scope('weekly:edit'));

-- ------------------------------------------------------------
--  ٢) من يحرّر التقرير: سلطانة العرجاني وعبدالله الحزامي وحدهما
--     (البقية يقرؤونه بصلاحية weekly كما هم)
-- ------------------------------------------------------------
update public.perf_users
   set scopes = (select array(select distinct unnest(
         coalesce(scopes, '{}') || array['weekly', 'weekly:edit'])))
 where active
   and public.perf_norm_name(display_name) in (
         public.perf_norm_name('سلطانه العرجاني'),
         public.perf_norm_name('عبدالله الحزامي'));

-- سحبها ممن سواهما — التحرير لهما وحدهما بطلب مالكة المنصة
update public.perf_users
   set scopes = array_remove(scopes, 'weekly:edit')
 where scopes @> array['weekly:edit']
   and public.perf_norm_name(display_name) not in (
         public.perf_norm_name('سلطانه العرجاني'),
         public.perf_norm_name('عبدالله الحزامي'));

-- ------------------------------------------------------------
--  ٣) الرابط المشترَك يعرض التقرير الجديد
--     التقرير صار يُبنى من بنود الأقسام (perf_items)، فتُضاف إلى
--     ما ترجعه الدالة. لا تكشف شيئاً بلا رمز صحيح غير منتهٍ —
--     الشرط أعلى الدالة كما هو.
-- ------------------------------------------------------------
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
    'items',        (select coalesce(jsonb_agg(to_jsonb(x) order by x.ord), '[]'::jsonb) from public.perf_items x),
    'settings',     (select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) from public.perf_settings)
  );
end;
$$;
grant execute on function public.perf_shared_report(text) to anon, authenticated;

-- ------------------------------------------------------------
--  ٤) المراجعة
-- ------------------------------------------------------------
select u.display_name as "الاسم",
       (u.scopes @> array['weekly'])      as "يقرأ التقرير",
       (u.scopes @> array['weekly:edit']) as "يحرّر التقرير"
  from public.perf_users u
 where u.active and u.scopes @> array['weekly']
 order by u.display_name;
