-- ============================================================
--  تصحيح السنة: 2025 ← 2026
--  ------------------------------------------------------------
--  أُدرجت بيانات الربع الثاني باسم «الربع الثاني 2025» والصواب
--  **2026**. هذا الملف يصحّح اسم الربع في الصفوف المدرَجة كلها —
--  القطاعات والجهات والمشاهدات — ولا يمسّ أرقامها.
--
--  idempotent: تشغيله مرّتين كتشغيله مرّة (لا يبقى بعد الأولى صفٌّ
--  بسنة 2025 ليُصحَّح).
--
--  ومعرّفات الصفوف لا تحمل السنة (`nq-q2-…`)، فلا يتكرّر شيء ولا
--  تضيع صفوف.
-- ============================================================

update public.perf_items
   set data = jsonb_set(data, '{quarter}', '"الربع الأول 2026"'::jsonb)
 where section = 'notesq' and data->>'quarter' = 'الربع الأول 2025';

update public.perf_items
   set data = jsonb_set(data, '{quarter}', '"الربع الثاني 2026"'::jsonb)
 where section = 'notesq' and data->>'quarter' = 'الربع الثاني 2025';

-- تحقّق: الأرباع الموجودة الآن وأعداد صفوفها
select data->>'quarter' as "الربع",
       count(*) filter (where data->>'row' is null) as "صفوف القطاعات",
       count(*) filter (where data->>'row' = 'ent') as "صفوف الجهات",
       count(*) filter (where data->>'row' = 'obs') as "صفوف المشاهدات"
  from public.perf_items
 where section = 'notesq'
 group by 1 order by 1;
