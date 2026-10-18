-- ============================================================
--  الخطة التشغيلية: مدير المحفظة يحدّث بنود محفظته
--  ------------------------------------------------------------
--  كان التحديث من «محفظتي» لصاحب المساهمة ولراعي البند والمسؤول
--  عنه. ومدير المحفظة يرى بنود محفظته ولا يستطيع تحديثها إلا إن
--  كان راعياً أو مسؤولاً، فيردّه الخادم بـ«هذا البند لا يخصّك».
--
--  بعد هذا الملف: **صاحب المحفظة** (`data->>'owner'`) دورٌ ثالث،
--  حدُّه حدُّ الراعي والمسؤول: الحالة والفعلي والملاحظة.
--  والمستهدفات واسم البند ومحفظته تبقى لصفحة الخطة بصلاحية
--  `sections:edit` — فالخطة معتمدة لا تُغيَّر من المحافظ.
--
--  والحذف كما هو: لا يُحذف إلا ما أضافه صاحبه («own»).
--
--  idempotent — يُشغَّل بعد perf-opplan-roles.sql بلا ضرر،
--  ولا يمسّ أي بيانات: يغيّر دالّة الأدوار فقط.
-- ============================================================

create or replace function public.perf_opplan_role(p_data jsonb, p_name text)
returns text language sql immutable set search_path = public as $$
  select case
    when public.perf_norm_name(coalesce(p_data->>'contributor','')) = public.perf_norm_name(p_name)
      then 'own'
    when exists (
      /* الراعي والمسؤول وصاحب المحفظة — وكلٌّ منها خانةٌ قد تحمل
         أكثر من اسم مفصولةً بـ«·» أو «،» أو «/» */
      select 1
        from unnest(regexp_split_to_array(
               coalesce(p_data->>'sponsor','')  || '·' ||
               coalesce(p_data->>'assignee','') || '·' ||
               coalesce(p_data->>'owner',''),
               '[·,،/|]+')) as n
       where public.perf_norm_name(btrim(n)) = public.perf_norm_name(p_name)
         and btrim(n) <> ''
    ) then 'role'
    else null
  end;
$$;

-- تحقّق: كم بنداً صار يخصّ كل شخص، وبأي دور
select u.display_name as "الاسم",
       count(*) filter (where public.perf_opplan_role(i.data, u.display_name) = 'own')  as "مساهماته",
       count(*) filter (where public.perf_opplan_role(i.data, u.display_name) = 'role') as "بنود يحدّثها"
  from public.perf_users u
  cross join public.perf_items i
 where i.section = 'opplan' and u.active
 group by u.display_name
 having count(*) filter (where public.perf_opplan_role(i.data, u.display_name) is not null) > 0
 order by 3 desc, 2 desc;
