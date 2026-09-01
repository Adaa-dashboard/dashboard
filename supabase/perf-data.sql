-- ============================================================
--  القيم الفعلية المنقولة من النسخة السابقة (تاريخ التحديث 2026-08-10)
--  يُشغَّل مرة واحدة من SQL Editor. آمن للتكرار: يحدّث ولا يكرّر.
--  الخانات التي كانت فارغة تبقى فارغة — لم تُقَس بعد.
-- ============================================================

insert into public.perf_measurements
  (id, sector_id, indicator_id, period_id, target, actual, updated_by, updated_at)
values
  -- قطاع البنية التحتية
  ('sec-infra|ind-5|per-1','sec-infra','ind-5','per-1',  4,  3,'salarjani','2026-08-10'),

  -- قطاع الخدمات الاجتماعية
  ('sec-social|ind-1|per-1','sec-social','ind-1','per-1', 12, 11,'salarjani','2026-08-10'),
  ('sec-social|ind-2|per-1','sec-social','ind-2','per-1',100,  0,'salarjani','2026-08-10'),
  ('sec-social|ind-3|per-1','sec-social','ind-3','per-1',100, 95,'salarjani','2026-08-10'),
  ('sec-social|ind-4|per-1','sec-social','ind-4','per-1',100, 94,'salarjani','2026-08-10'),
  ('sec-social|ind-5|per-1','sec-social','ind-5','per-1',  3,  3,'salarjani','2026-08-10'),

  -- قطاع المالي والاقتصادي
  ('sec-econ|ind-1|per-1','sec-econ','ind-1','per-1', 15, 15,'salarjani','2026-08-10'),
  ('sec-econ|ind-2|per-1','sec-econ','ind-2','per-1',100,  0,'salarjani','2026-08-10'),
  ('sec-econ|ind-3|per-1','sec-econ','ind-3','per-1',100, 95,'salarjani','2026-08-10'),
  ('sec-econ|ind-4|per-1','sec-econ','ind-4','per-1',100, 94,'salarjani','2026-08-10'),
  ('sec-econ|ind-5|per-1','sec-econ','ind-5','per-1',  4,  2,'salarjani','2026-08-10'),

  -- قطاع الشؤون الحكومية
  ('sec-gov|ind-1|per-1','sec-gov','ind-1','per-1', 16, 14,'salarjani','2026-08-10'),
  ('sec-gov|ind-2|per-1','sec-gov','ind-2','per-1',100,  0,'salarjani','2026-08-10'),
  ('sec-gov|ind-3|per-1','sec-gov','ind-3','per-1',100, 95,'salarjani','2026-08-10'),
  ('sec-gov|ind-4|per-1','sec-gov','ind-4','per-1',100, 94,'salarjani','2026-08-10'),
  ('sec-gov|ind-5|per-1','sec-gov','ind-5','per-1',  8,  2,'salarjani','2026-08-10')
on conflict (sector_id, indicator_id, period_id) do update
  set target = excluded.target,
      actual = excluded.actual,
      updated_at = excluded.updated_at;

-- المؤشر الأول عدد لا نسبة، وهكذا كان اسمه في النسخة السابقة
update public.perf_indicators
   set name = 'عدد الأجهزة العامة التي يتم قياس خدماتها'
 where id = 'ind-1';
