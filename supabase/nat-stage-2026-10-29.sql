-- ============================================================
--  ضبط «حالة الاعتماد» للاستراتيجيات الوطنية على أرقام 2026-10-29
--    طور الإعداد/التحديث = 16 · قيد المراجعة = 0
--    معتمدة من اللجنة    = 35 · معتمدة من مجلس الوزراء = 2
--                                            (الإجمالي 53)
--
--  يُشغَّل من SQL Editor في Supabase، ويغني عن
--  `nat-stage-2026-10-27.sql` (يشمله ويزيد عليه).
--  idempotent: إعادة تشغيله لا تُغيّر شيئاً بعد استقرار الأرقام.
--
--  1 = طور الإعداد/التحديث · 2 = قيد المراجعة
--  3 = معتمدة من اللجنة     · 4 = معتمدة من مجلس الوزراء
-- ============================================================

-- ------------------------------------------------------------
--  ٠) ما كان عليه الحال قبل التشغيل — للمقارنة بعدُ
-- ------------------------------------------------------------
select coalesce(nullif(data->>'stage','')::int, 1) as "المرحلة",
       count(*)                                    as "قبل التشغيل"
  from public.perf_items where section = 'natstrat'
 group by 1 order by 1;

-- ------------------------------------------------------------
--  ١) الاستراتيجيات المسمّاة في لوحة مكتب الإدارة الاستراتيجية
-- ------------------------------------------------------------
drop view  if exists _nat_hit;
drop table if exists _nat_map;
create temp table _nat_map (kw text, nkw text, stage int, label text);

insert into _nat_map (kw, nkw, stage, label) values
  ('مياه',        null,         3, 'المياه'),
  ('ثقاف',        null,         3, 'الثقافة'),
  ('تعليم',       null,         3, 'قطاع التعليم والتدريب'),
  ('الإسكان',     null,         3, 'الإسكان'),
  ('مستهلك',      null,         3, 'حماية المستهلك'),
  ('عسير',        null,         3, 'منطقة عسير'),
  ('زراع',        null,         3, 'الزراعة'),
  ('الاستثمار',   null,         3, 'الاستثمار'),
  ('عقار',        null,         3, 'القطاع العقاري'),
  ('الحدود',      null,         3, 'منطقة الحدود الشمالية'),
  ('جازان',       null,         3, 'منطقة جازان'),
  ('بيئ',         null,         1, 'البيئة'),
  ('هجر',         null,         1, 'الهجرة'),
  ('بلدي',        null,         1, 'تحول القطاع البلدي'),
  ('مالي',        'الشمالية',   1, 'تنمية القطاع المالي'),
  ('توطين',       null,         1, 'التوطين');

create temp view _nat_hit as
select m.label, m.stage as new_stage, i.id,
       i.data->>'name' as name,
       coalesce(nullif(i.data->>'stage','')::int, 1) as cur_stage
  from _nat_map m
  join public.perf_items i
    on i.section = 'natstrat'
   and public.perf_ar_norm(i.data->>'name')
       like '%' || public.perf_ar_norm(m.kw) || '%'
   and (m.nkw is null
        or public.perf_ar_norm(i.data->>'name')
           not like '%' || public.perf_ar_norm(m.nkw) || '%');

-- معاينة: ما ستغيّره هذه الخطوة
select label as "من اللوحة", name as "الاسم في المنصة",
       cur_stage as "الحالية", new_stage as "الجديدة"
  from _nat_hit where cur_stage <> new_stage
 order by new_stage desc, label;

update public.perf_items i
   set data = (i.data - 'track0' - 'track1' - 'track2' - 'track3')
              || jsonb_build_object('stage', h.new_stage, 'demo', false,
                                    'updated', '2026-10-29')
     , updated_at = now()
     , updated_by = 'nat-dashboard 2026-10-29'
  from _nat_hit h
 where i.section = 'natstrat' and i.id = h.id
   and h.cur_stage <> h.new_stage;

-- ------------------------------------------------------------
--  ٢) «قيد المراجعة» مرحلةٌ خالية الآن
--     كل ما بقي فيها عُرض على اللجنة واعتُمد ⇒ ينتقل إلى 3
-- ------------------------------------------------------------
select data->>'name' as "كان قيد المراجعة ⇒ اللجنة"
  from public.perf_items
 where section = 'natstrat'
   and coalesce(nullif(data->>'stage','')::int, 1) = 2
 order by 1;

update public.perf_items
   set data = (data - 'track0' - 'track1' - 'track2' - 'track3')
              || jsonb_build_object('stage', 3, 'demo', false,
                                    'updated', '2026-10-29')
     , updated_at = now()
     , updated_by = 'nat-dashboard 2026-10-29'
 where section = 'natstrat'
   and coalesce(nullif(data->>'stage','')::int, 1) = 2;

-- ------------------------------------------------------------
--  ٣) التحقّق — يجب أن يطابق العمودان
-- ------------------------------------------------------------
with want(stage, n) as (values (1,16), (2,0), (3,35), (4,2)),
     got as (select coalesce(nullif(data->>'stage','')::int, 1) as stage,
                    count(*)::int as n
               from public.perf_items where section = 'natstrat'
              group by 1)
select case w.stage
         when 1 then '1 — طور الإعداد/التحديث'
         when 2 then '2 — قيد المراجعة'
         when 3 then '3 — معتمدة من اللجنة'
         when 4 then '4 — معتمدة من مجلس الوزراء' end as "المرحلة",
       coalesce(g.n, 0) as "في المنصة",
       w.n              as "المطلوب",
       case when coalesce(g.n, 0) = w.n then '✅'
            else '⚠️ الفرق ' || (coalesce(g.n, 0) - w.n)::text end as "الحالة"
  from want w left join got g on g.stage = w.stage
 order by w.stage;

select count(*) as "الإجمالي (يُتوقع 53)"
  from public.perf_items where section = 'natstrat';

-- ------------------------------------------------------------
--  ٤) الأسماء في كل مرحلة — لضبط ما تبقّى يدوياً إن ظهر فرق
-- ------------------------------------------------------------
select coalesce(nullif(data->>'stage','')::int, 1) as "المرحلة",
       data->>'name'                               as "الاسم"
  from public.perf_items
 where section = 'natstrat'
   and coalesce(nullif(data->>'stage','')::int, 1) in (1, 3)
 order by 1, 2;

-- تصحيحٌ فرديّ عند الحاجة — استبدلي الاسم والمرحلة:
-- update public.perf_items
--    set data = data || jsonb_build_object('stage', 3, 'demo', false,
--                                          'updated', '2026-10-29')
--  where section = 'natstrat'
--    and public.perf_ar_norm(data->>'name')
--        like '%' || public.perf_ar_norm('جزء من الاسم') || '%';
