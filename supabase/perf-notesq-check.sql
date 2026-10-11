-- ============================================================
--  تحقّق من أرقام «جودة ملاحظات الأداء» — الربع الثاني 2025
--  ------------------------------------------------------------
--  **استعلامٌ واحد**: محرّر Supabase يعرض نتيجة آخر جملةٍ وحدها،
--  فجُمعت الفحوص الاثنا عشر في جدولٍ واحد بعمود «مطابق».
--  قراءةٌ محضة، لا يكتب شيئاً.
--
--  المتوقَّع منقولٌ من عرض الربع الثاني، ومنه ثلاثة تحقّقات
--  متقاطعة: 79% للإدارة · 94% مرجَّح نِسَب الجهات (= متوسط
--  المعايير) · 84 جهة من 101 بلغت 90% فأكثر (= «83%» في العرض).
-- ============================================================

with q as (
  select data from public.perf_items
   where section = 'notesq' and data->>'quarter' = 'الربع الثاني 2025'
), sec as (select * from q where data->>'row' is null),
   ent as (select * from q where data->>'row' = 'ent'),
   obs as (select * from q where data->>'row' = 'obs'),
   w  as (select sum((data->>'total')::numeric) n,
                 sum((data->>'total')::numeric * (data->>'pct')::numeric) ok from sec),
   we as (select count(*) c, sum((data->>'total')::numeric) n,
                 sum((data->>'total')::numeric * (data->>'pct')::numeric) ok,
                 count(*) filter (where (data->>'pct')::numeric >= 90) hi from ent),
   p  as (select sum((data->>'total')::numeric) n,
                 sum((data->>'total')::numeric*(data->>'p1')::numeric) a,
                 sum((data->>'total')::numeric*(data->>'p2')::numeric) b,
                 sum((data->>'total')::numeric*(data->>'p3')::numeric) c,
                 sum((data->>'total')::numeric*(data->>'p4')::numeric) d from sec)
select z.f as "الفحص", z.r as "النتيجة", z.x as "المتوقَّع",
       case when z.r = z.x then '✅' else '❌' end as "مطابق"
  from (
  select 1 o, 'مجموع العناصر — القطاعات' f, (select n::text from w) r, '558' x
  union all select 2,  'نسبة الإدارة ٪',          (select round(ok/nullif(n,0))::text from w),  '79'
  union all select 3,  'عدد صفوف القطاعات',       (select count(*)::text from sec),             '4'
  union all select 4,  'عدد صفوف المشاهدات',      (select count(*)::text from obs),             '10'
  union all select 5,  'وصف التحدي ٪',            (select round(a/nullif(n,0))::text from p),   '90'
  union all select 6,  'تصنيف التحدي ٪',          (select round(b/nullif(n,0))::text from p),   '96'
  union all select 7,  'الإجراء التصحيحي ٪',      (select round(c/nullif(n,0))::text from p),   '98'
  union all select 8,  'تاريخ الإجراء التصحيحي ٪',(select round(d/nullif(n,0))::text from p),   '91'
  union all select 9,  'عدد الجهات',              (select c::text from we),                     '101'
  union all select 10, 'مجموع العناصر — الجهات',  (select n::text from we),                     '558'
  union all select 11, 'المرجَّح لنِسَب الجهات ٪',   (select round(ok/nullif(n,0))::text from we),  '94'
  union all select 12, 'جهات بلغت 90% فأكثر',     (select hi::text from we),                    '84'
) z order by z.o;
