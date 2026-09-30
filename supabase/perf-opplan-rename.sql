-- تصحيح اسم: «معاذ البقاص» ← «معاذ الهقاص»
-- آمن للتشغيل أكثر من مرة (idempotent)

update public.perf_items
   set data = data
        || case when data->>'sponsor' = 'معاذ البقاص'
                then jsonb_build_object('sponsor','معاذ الهقاص') else '{}'::jsonb end
        || case when data->>'owner' = 'معاذ البقاص'
                then jsonb_build_object('owner','معاذ الهقاص') else '{}'::jsonb end
        || case when data->>'assignee' = 'معاذ البقاص'
                then jsonb_build_object('assignee','معاذ الهقاص') else '{}'::jsonb end
 where section = 'opplan'
   and (data->>'sponsor' = 'معاذ البقاص'
     or data->>'owner'   = 'معاذ البقاص'
     or data->>'assignee'= 'معاذ البقاص');

-- التحقق: يجب أن يكون العمود الأول 0 والثاني أكبر من 0
select count(*) filter (
         where data->>'sponsor' = 'معاذ البقاص'
            or data->>'owner'   = 'معاذ البقاص'
            or data->>'assignee'= 'معاذ البقاص') as "المتبقي بالاسم الخطأ",
       count(*) filter (
         where data->>'sponsor' = 'معاذ الهقاص'
            or data->>'owner'   = 'معاذ الهقاص'
            or data->>'assignee'= 'معاذ الهقاص') as "بالاسم الصحيح"
  from public.perf_items
 where section = 'opplan';
