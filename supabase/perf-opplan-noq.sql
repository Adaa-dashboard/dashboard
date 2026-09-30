-- ============================================================
--  المبادرات والمكاسب السريعة بلا أرقام أرباع
--  ------------------------------------------------------------
--  الأرباع والمستهدف والوحدة والمستوى خصائصُ مؤشرٍ يُقاس، ولا
--  معنى لها في مبادرةٍ أو مكسبٍ سريع — حالتُهما ووصف ما وصلت
--  إليه يكفيان. فتُحذف من بياناتهما، ولا تُعرض أصلاً في الواجهة.
--
--  idempotent — آمن للتشغيل أكثر من مرة
-- ============================================================

update public.perf_items
   set data = data - 'q1t' - 'q1a' - 'q2t' - 'q2a'
                   - 'q3t' - 'q3a' - 'q4t' - 'q4a'
                   - 'yearTarget' - 'level' - 'unit'
 where section = 'opplan'
   and data->>'kind' in ('init', 'win')
   and (data ?| array['q1t','q1a','q2t','q2a','q3t','q3a','q4t','q4a',
                      'yearTarget','level','unit']);

-- التحقق: الأول لازم يطلع 0
select count(*) filter (
         where data->>'kind' in ('init','win')
           and data ?| array['q1t','q1a','q2t','q2a','q3t','q3a','q4t','q4a',
                             'yearTarget','level','unit']) as "مبادرات/مكاسب فيها أرباع",
       count(*) filter (where data->>'kind' = 'kpi' and data ? 'yearTarget') as "مؤشرات لها مستهدف عام",
       count(*)                                            as "إجمالي بنود الخطة"
  from public.perf_items where section = 'opplan';
