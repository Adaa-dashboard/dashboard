-- فحصٌ بعد تشغيل perf-opplan.sql ثم perf-opplan-mine.sql — قراءة فقط
select 'بنود الخطة (المتوقع 43)' as "العنصر", count(*)::text as "الحالة"
  from public.perf_items where section = 'opplan'
union all
select 'منها مؤشرات (19)', count(*)::text
  from public.perf_items where section = 'opplan' and data->>'kind' = 'kpi'
union all
select 'منها مبادرات (14)', count(*)::text
  from public.perf_items where section = 'opplan' and data->>'kind' = 'init'
union all
select 'منها مكاسب سريعة (10)', count(*)::text
  from public.perf_items where section = 'opplan' and data->>'kind' = 'win'
union all
select 'perf_opplan_mine_save',
       case when to_regprocedure('public.perf_opplan_mine_save(text,jsonb)') is not null
            then '✅ موجودة' else '❌ ناقصة' end
union all
select 'perf_opplan_mine_del',
       case when to_regprocedure('public.perf_opplan_mine_del(text)') is not null
            then '✅ موجودة' else '❌ ناقصة' end
union all
select 'حسابات ترى الخطة', count(*)::text
  from public.perf_users where active and scopes @> array['opplan'];
