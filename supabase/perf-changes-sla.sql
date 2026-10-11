-- ============================================================
--  مؤشر «نسبة الالتزام باتفاقيات مستوى الخدمة لمراجعة طلبات
--  التغيير» — الأرقام التي سبقت دخول المنصة
--  ------------------------------------------------------------
--  يُشغَّل من SQL Editor مرة واحدة. idempotent، وليس فيه حذف.
--
--  المصدر: عرض «لوحة بيانات مؤشر اتفاقيات مستوى الخدمة لطلبات
--  التغيير». ثلاثة أنواع صفوف في `perf_items` تحت
--  `section = 'changes'`، يميّزها الحقل `row`:
--
--    row = 'q'    ربعٌ ونسبته وعدد مرات المراجعة فيه
--    row = 'm'    شهرٌ ونسبته وعدده
--    row = 'sec'  قطاعٌ داخل ربع، ومعه تفصيل رؤية 2030 والوطنية
--
--  والمنصة تحسب ما بعد هذه الفترات من ملف منصة الرؤية اليومي:
--  كل طلبٍ أُغلق يقع في شهره وربعه بتاريخ إغلاقه، ويُعدّ ملتزماً
--  إن كانت أيام عمله دون مدّته. **والمُدخَل هنا يسبق المحسوب**
--  في الفترة الواحدة، فالرقم المعتمد لا تزيحه حسبةٌ تقريبية.
--
--  ثلاثة تحقّقات من العرض نفسه، وكلها تنطبق على هذه الأرقام:
--    · مجموع القطاعات الأربعة = 262 = عدد الربع الثاني
--    · مجموع الأشهر الثلاثة   = 262 كذلك
--    · ترجيح الاثنين بعدد الطلبات يعطي 73% = نسبة الربع
--  فالنسبة مرجّحةٌ بالعدد لا متوسطَ نِسَب.
-- ============================================================

-- ١) الأرباع الأربعة
insert into public.perf_items (section, id, ord, data) values
 ('changes', 'cr-q-2025-3', 101, '{"row": "q", "quarter": "الربع الثالث 2025", "total": 531, "pct": 60}'::jsonb),
 ('changes', 'cr-q-2025-4', 102, '{"row": "q", "quarter": "الربع الرابع 2025", "total": 525, "pct": 77}'::jsonb),
 ('changes', 'cr-q-2026-1', 103, '{"row": "q", "quarter": "الربع الأول 2026",  "total": 465, "pct": 75}'::jsonb),
 ('changes', 'cr-q-2026-2', 104, '{"row": "q", "quarter": "الربع الثاني 2026", "total": 262, "pct": 73}'::jsonb)
on conflict (section, id) do update set data = excluded.data, ord = excluded.ord;

-- ٢) أشهر الربع الثاني 2026
insert into public.perf_items (section, id, ord, data) values
 ('changes', 'cr-m-2026-04', 201, '{"row": "m", "month": "أبريل 2026", "total": 88, "pct": 68}'::jsonb),
 ('changes', 'cr-m-2026-05', 202, '{"row": "m", "month": "مايو 2026",  "total": 96, "pct": 81}'::jsonb),
 ('changes', 'cr-m-2026-06', 203, '{"row": "m", "month": "يونيو 2026", "total": 78, "pct": 68}'::jsonb)
on conflict (section, id) do update set data = excluded.data, ord = excluded.ord;

-- ٣) قطاعات الربع الثاني 2026
--    `v30` نسبة رؤية 2030 · `nat` نسبة الاستراتيجيات الوطنية
--    والعدد مجموع الاثنين: 45+2 · 14+21 · 70+17 · 44+49
insert into public.perf_items (section, id, ord, data) values
 ('changes', 'cr-s-2026-2-gov',  301, '{"row": "sec", "quarter": "الربع الثاني 2026", "sector": "الشؤون الحكومية",   "total": 47, "pct": 70, "v30": 69, "nat": 100}'::jsonb),
 ('changes', 'cr-s-2026-2-fin',  302, '{"row": "sec", "quarter": "الربع الثاني 2026", "sector": "المالي والاقتصادي",  "total": 35, "pct": 91, "v30": 86, "nat": 95}'::jsonb),
 ('changes', 'cr-s-2026-2-soc',  303, '{"row": "sec", "quarter": "الربع الثاني 2026", "sector": "الخدمات الاجتماعية", "total": 87, "pct": 79, "v30": 84, "nat": 59}'::jsonb),
 ('changes', 'cr-s-2026-2-inf',  304, '{"row": "sec", "quarter": "الربع الثاني 2026", "sector": "البنية التحتية",     "total": 93, "pct": 61, "v30": 61, "nat": 61}'::jsonb)
on conflict (section, id) do update set data = excluded.data, ord = excluded.ord;

-- ٤) صلاحية تحرير هذه الصفوف لاحقاً من الواجهة
--    سياسة الكتابة في `perf_items` تشترط `changes` و`changes:edit`
--    معاً. تُمنح لمن يرفع ملف المنصة — ولا تفتح شيئاً اليوم: لا
--    واجهةَ تكتبها بعد، لكنها تُجهّز إدخال الربع القادم بلا SQL.
update public.perf_users
   set scopes = (select array_agg(distinct x) from unnest(scopes || array['changes:edit']) as x)
 where active
   and scopes @> array['changes:upload']
   and not (scopes @> array['changes:edit']);

-- ------------------------------------------------------------
--  تحقّق — ستّة أسطر تقول إنّ الأرقام دخلت كما في العرض
-- ------------------------------------------------------------
select 'الأرباع' as "البند",
       string_agg(format('%s: %s%% (%s)', data->>'quarter', data->>'pct', data->>'total'),
                  ' · ' order by id) as "القيمة"
  from public.perf_items where section = 'changes' and data->>'row' = 'q'
union all
select 'الأشهر',
       string_agg(format('%s: %s%% (%s)', data->>'month', data->>'pct', data->>'total'),
                  ' · ' order by id)
  from public.perf_items where section = 'changes' and data->>'row' = 'm'
union all
select 'القطاعات',
       string_agg(format('%s: %s%% (%s)', data->>'sector', data->>'pct', data->>'total'),
                  ' · ' order by id)
  from public.perf_items where section = 'changes' and data->>'row' = 'sec'
union all
select 'مجموع القطاعات = 262؟',
       (sum((data->>'total')::numeric))::text
  from public.perf_items where section = 'changes' and data->>'row' = 'sec'
union all
select 'ترجيح القطاعات = 73؟',
       round(sum((data->>'total')::numeric * (data->>'pct')::numeric)
             / nullif(sum((data->>'total')::numeric), 0))::text
  from public.perf_items where section = 'changes' and data->>'row' = 'sec'
union all
select 'ترجيح الأشهر = 73؟',
       round(sum((data->>'total')::numeric * (data->>'pct')::numeric)
             / nullif(sum((data->>'total')::numeric), 0))::text
  from public.perf_items where section = 'changes' and data->>'row' = 'm';
