-- ============================================================
--  إصلاح: رابط مشاركة «الإنجاز الأسبوعي» يقول «الرابط غير صالح»
--  ------------------------------------------------------------
--  يُشغَّل من SQL Editor مرة واحدة. idempotent، وليس فيه حذف.
--
--  السبب: نسخة `perf_shared_report` في `perf-item-log.sql` كانت
--  تقرأ من جدول اسمه `perf_changes` — ولا وجود له: اسم جدول طلبات
--  التغيير **`perf_change_requests`**. فالدالة تفشل عند التنفيذ،
--  والصفحة العامة لا تفرّق بين «رمزٍ منتهٍ» و«دالةٍ أخطأت»،
--  فتعرض «الرابط غير صالح» في الحالتين.
--
--  وهذه النسخة تُصلح الاسم وتزيد حصانةً: كل جزءٍ إضافي يُقرأ داخل
--  `begin … exception` مستقلّ، فإن غاب جدولٌ أو عمود بقي التقرير
--  يُفتح بما تيسّر بدل أن يسقط كلُّه.
-- ============================================================

--  وتُحذف الدالة أولاً: `create or replace` يرفض تغيير اسم
--  الوسيط إن كان مختلفاً في النسخة المنصّبة، فيبقى القديم عاملاً
--  ويظن المشغّل أن الإصلاح تمّ.
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
    'tasks',        (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.perf_tasks x),
    'items',        (select coalesce(jsonb_agg(to_jsonb(x) order by x.ord), '[]'::jsonb) from public.perf_items x),
    'settings',     (select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) from public.perf_settings),
    'log',      v_log,
    'changes',  v_chg,
    'contacts', v_con
  );
end;
$$;
grant execute on function public.perf_shared_report(text) to anon, authenticated;

-- ------------------------------------------------------------
--  تحقّق: الرابط الأحدث يُفتح فعلاً — ويجب أن يُرجع صفوفاً لا خطأ
-- ------------------------------------------------------------
select coalesce(
         (select 'يعمل · بنود: ' || jsonb_array_length(public.perf_shared_report(token)->'items')
            from public.perf_shares
           where expires_at is null or expires_at > now()
           order by created_at desc limit 1),
         'لا توجد روابط سارية'
       ) as "النتيجة";
