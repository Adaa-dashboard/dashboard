-- ============================================================
--  تحديث «حالة الاعتماد» للاستراتيجيات الوطنية
--  المصدر: «لوحة متابعة اعتماد الاستراتيجيات الوطنية»
--          مكتب الإدارة الاستراتيجية — بتاريخ 2026-10-27
--
--  يُشغَّل من SQL Editor في Supabase. idempotent: إعادة تشغيله
--  لا تُغيّر شيئاً إن كانت المراحل مضبوطة أصلاً.
--
--  المراحل (قيمة data->>'stage'):
--    1 = طور الإعداد/التحديث     2 = قيد المراجعة
--    3 = معتمدة من اللجنة         4 = معتمدة من مجلس الوزراء
--
--  أرقام التقرير: إجمالي 53 · مجلس الوزراء 2 · اللجنة 35
--                 · قيد المراجعة 0 · إعداد/تحديث 15 (28.3%)
--
--  المطابقة بالاسم بعد توحيده بـ public.perf_ar_norm، فتصل
--  الكلمة إلى الاسم مهما اختلفت «ال» التعريف والهمزات.
--  `nkw` كلمةُ استثناء: «مالي» وحدها تطابق «الشمالية» بعد
--  التوحيد (ال ← ﻻ)، فتُستثنى صراحةً.
-- ============================================================

-- ------------------------------------------------------------
--  ٠) جدول المطابقة: كلمة من اسم الاستراتيجية ← المرحلة
-- ------------------------------------------------------------
drop view  if exists _nat_hit;   -- قبل الجدول: الـview يعتمد عليه
drop table if exists _nat_map;
create temp table _nat_map (kw text, nkw text, stage int, label text);

insert into _nat_map (kw, nkw, stage, label) values
  -- ١١ استراتيجية انتقلت إلى «معتمدة من اللجنة» (▲11)
  ('مياه',        null,         3, 'المياه'),
  ('ثقاف',        null,         3, 'الثقافة'),
  ('تعليم',       null,         3, 'قطاع التعليم والتدريب'),
  ('الإسكان',     null,         3, 'الإسكان — المرحلة الثالثة'),
  ('مستهلك',      null,         3, 'حماية المستهلك'),
  ('عسير',        null,         3, 'منطقة عسير'),
  ('زراع',        null,         3, 'الزراعة'),
  ('الاستثمار',   null,         3, 'الاستثمار'),
  ('عقار',        null,         3, 'القطاع العقاري'),
  ('الحدود',      null,         3, 'منطقة الحدود الشمالية'),
  ('جازان',       null,         3, 'منطقة جازان'),
  -- ٥ استراتيجيات عادت إلى «طور الإعداد/التحديث»
  ('بيئ',         null,         1, 'البيئة'),
  ('هجر',         null,         1, 'الهجرة'),
  ('بلدي',        null,         1, 'تحول القطاع البلدي'),
  ('مالي',        'الشمالية',   1, 'تنمية القطاع المالي'),
  ('توطين',       null,         1, 'التوطين');

-- دالة المطابقة مكرّرة في الاستعلامات، فعُرّفت مرةً كـ view مؤقت
create temp view _nat_hit as
select m.label, m.stage as new_stage, i.id, i.ord,
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

-- ------------------------------------------------------------
--  ١) معاينة قبل التنفيذ — لا تُغيّر شيئاً
-- ------------------------------------------------------------
select label      as "من التقرير",
       name       as "الاسم في المنصة",
       cur_stage  as "المرحلة الحالية",
       new_stage  as "المرحلة الجديدة",
       case when cur_stage = new_stage then 'مطابقة — لا تغيير'
            else 'ستتغيّر' end as "الأثر"
  from _nat_hit
 order by new_stage desc, label;

-- كلمات لم تطابق أي صف، أو طابقت أكثر من صف ⇒ تحتاج مراجعة يدوية.
-- يجب أن تكون هذه النتيجة فارغة قبل تشغيل الجزء ٢
select m.label                        as "من التقرير",
       count(h.id)                    as "عدد الصفوف المطابقة",
       coalesce(string_agg(h.name, ' | '), '— لا شيء —') as "الأسماء"
  from _nat_map m
  left join _nat_hit h on h.label = m.label
 group by m.label
having count(h.id) <> 1
 order by m.label;

-- ------------------------------------------------------------
--  ٢) التنفيذ
-- ------------------------------------------------------------
update public.perf_items i
   set data = (i.data - 'track0' - 'track1' - 'track2' - 'track3')
              || jsonb_build_object(
                   'stage',   h.new_stage,
                   'demo',    false,
                   'updated', '2026-10-27')
     , updated_at = now()
     , updated_by = 'nat-dashboard 2026-10-27'
  from _nat_hit h
 where i.section = 'natstrat'
   and i.id = h.id
   and h.cur_stage <> h.new_stage;

-- ------------------------------------------------------------
--  ٣) التحقق — قارن بأرقام التقرير
-- ------------------------------------------------------------
select case coalesce(nullif(data->>'stage','')::int, 1)
         when 1 then '1 — طور الإعداد/التحديث'
         when 2 then '2 — قيد المراجعة'
         when 3 then '3 — معتمدة من اللجنة'
         when 4 then '4 — معتمدة من مجلس الوزراء'
       end                              as "المرحلة",
       count(*)                         as "العدد في المنصة",
       case coalesce(nullif(data->>'stage','')::int, 1)
         when 1 then 15 when 2 then 0 when 3 then 35 when 4 then 2
       end                              as "العدد في التقرير"
  from public.perf_items
 where section = 'natstrat'
 group by 1, 3
 order by 1;

-- الإجمالي (يُتوقع 53)
select count(*) as "إجمالي الاستراتيجيات"
  from public.perf_items where section = 'natstrat';

-- أي استراتيجية بقيت «قيد المراجعة» — التقرير يقول إن هذه المرحلة
-- خالية الآن، فما يظهر هنا يحتاج قراراً منك
select data->>'name' as "بقيت قيد المراجعة"
  from public.perf_items
 where section = 'natstrat'
   and coalesce(nullif(data->>'stage','')::int, 1) = 2
 order by 1;
