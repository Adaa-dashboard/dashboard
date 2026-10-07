-- ============================================================
--  تصحيح اسم في الخطة التشغيلية
--  «عبدالعزيز العون» ← «عبدالعزيز بن عون»
--  ------------------------------------------------------------
--  حسابه في المنصة «عبدالعزيز بن عون»، وفي بنود الخطة كُتب
--  «عبدالعزيز العون» — فظهر سطرين في جدول نسبة المساهمات كأنهما
--  شخصان. الواجهة تصحّحه عند العرض (NAME_ALIAS)، وهذا يصحّح
--  **المخزون نفسه** فلا يعود بعد أي رفع إكسل.
--
--  والخانة قد تحمل عدة أسماء («أ · ب»)، فالتصحيح بالاستبدال داخل
--  النصّ لا بمساواة الخانة كلها — وبحدٍّ يمنع أن يُصيب اسماً آخر
--  يحوي «عبدالعزيز العون» جزءاً منه.
--
--  idempotent: تشغيله مرّتين كتشغيله مرّة.
-- ============================================================

-- ١) قبل: أين يظهر الاسم الخطأ؟
select id, data->>'name' as "البند",
       data->>'sponsor' as "الراعي", data->>'assignee' as "المسؤول"
  from public.perf_items
 where section = 'opplan'
   and (coalesce(data->>'sponsor','')  like '%عبدالعزيز العون%'
     or coalesce(data->>'assignee','') like '%عبدالعزيز العون%'
     or coalesce(data->>'owner','')    like '%عبدالعزيز العون%')
 order by ord;

-- ٢) التصحيح — `data ? 'key'` حتى لا يُكتب مفتاحٌ فارغ لم يكن
--    موجوداً أصلاً، فيبقى البند كما كان إلا الاسم
update public.perf_items
   set data = data
        || case when data ? 'sponsor'
                then jsonb_build_object('sponsor',  replace(data->>'sponsor',  'عبدالعزيز العون', 'عبدالعزيز بن عون'))
                else '{}'::jsonb end
        || case when data ? 'assignee'
                then jsonb_build_object('assignee', replace(data->>'assignee', 'عبدالعزيز العون', 'عبدالعزيز بن عون'))
                else '{}'::jsonb end
        || case when data ? 'owner'
                then jsonb_build_object('owner',    replace(data->>'owner',    'عبدالعزيز العون', 'عبدالعزيز بن عون'))
                else '{}'::jsonb end
 where section = 'opplan'
   and (coalesce(data->>'sponsor','')  like '%عبدالعزيز العون%'
     or coalesce(data->>'assignee','') like '%عبدالعزيز العون%'
     or coalesce(data->>'owner','')    like '%عبدالعزيز العون%');

-- ٣) بعد: الأول يجب أن يكون 0 والثاني أكبر من 0
select count(*) filter (
         where coalesce(data->>'sponsor','')  like '%عبدالعزيز العون%'
            or coalesce(data->>'assignee','') like '%عبدالعزيز العون%'
            or coalesce(data->>'owner','')    like '%عبدالعزيز العون%') as "المتبقي بالاسم الخطأ",
       count(*) filter (
         where coalesce(data->>'sponsor','')  like '%عبدالعزيز بن عون%'
            or coalesce(data->>'assignee','') like '%عبدالعزيز بن عون%'
            or coalesce(data->>'owner','')    like '%عبدالعزيز بن عون%') as "بالاسم الصحيح"
  from public.perf_items
 where section = 'opplan';
