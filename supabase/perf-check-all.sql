-- ============================================================
--  تحقّقٌ من الملفات التي شُغّلت — جدولٌ واحد يقول ما نجح وما لم ينجح
--  ------------------------------------------------------------
--  للقراءة فقط: لا يغيّر شيئاً ولا يكتب حرفاً. شغّليه كاملاً.
--  كل سطرٍ فيه «✅» سليم، و«✗» يحتاج إعادة تشغيل ملفه.
-- ============================================================

with
-- ١) إصلاح أول دخول: المؤرّخ يضيف «الجوال» نصّاً صريحاً لا مصفوفة
audit_fix as (
  select case
    when not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                      where n.nspname = 'public' and p.proname = 'perf_users_audit')
      then '✗ دالّة المؤرّخ غير موجودة'
    when (select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'perf_users_audit' limit 1)
         like '%''الجوال''::text%'
      then '✅ مُصلَحة — أول دخول يمرّ'
    else '✗ لم تُشغَّل: perf-audit-phone-fix.sql'
  end as v
),
-- ٢) سياسة فترة التحديث الدوري
cycle_pol as (
  select case when exists (
    select 1 from pg_policy
     where polrelid = 'public.perf_settings'::regclass
       and polname = 'perf_settings_cycle_write')
    then '✅ موجودة — زرّ التحديث الدوري يعمل'
    else '✗ لم تُشغَّل: perf-cycles.sql' end as v
),
-- ٣) الدالّة التي تعتمد عليها السياسة
scope_fn as (
  select case when exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'perf_has_scope')
    then '✅ موجودة'
    else '✗ ناقصة — شغّلي perf-changes.sql أولاً' end as v
),
-- ٤) تصحيح اسم «عبدالعزيز بن عون» في بنود الخطة
awn as (
  select case
    when not exists (select 1 from information_schema.tables
                      where table_schema = 'public' and table_name = 'perf_items')
      then '✗ جدول البنود غير موجود'
    when (select count(*) from public.perf_items
           where section = 'opplan'
             and (coalesce(data->>'sponsor','')  like '%عبدالعزيز العون%'
               or coalesce(data->>'assignee','') like '%عبدالعزيز العون%'
               or coalesce(data->>'owner','')    like '%عبدالعزيز العون%')) = 0
      then '✅ لا يوجد اسمٌ خطأ'
    else '✗ ما زال الاسم الخطأ موجوداً — perf-opplan-rename-awn.sql'
  end as v
)
select 'أول دخول لشخص جديد'      as "الفحص", (select v from audit_fix) as "النتيجة"
union all select 'سياسة التحديث الدوري',  (select v from cycle_pol)
union all select 'دالّة الصلاحيات',        (select v from scope_fn)
union all select 'اسم «عبدالعزيز بن عون»', (select v from awn);

-- ------------------------------------------------------------
--  ٥) صلاحيات الفرق — من يحرّر كل قسم الآن
--     يجب أن تطابق القوائم التي أرسلتِها تماماً
-- ------------------------------------------------------------
select x.sect as "القسم",
       coalesce(nullif(array_to_string(array(
         select u.display_name from public.perf_users u
          where coalesce(u.scopes,'{}') @> array[x.sect || ':edit']
            and u.active
          order by u.display_name), ' · '), ''), '✗ لا أحد') as "من يحرّره"
  from (values ('opplan'),('inststrat'),('natstrat'),
               ('sessions'),('cx'),('outputs'),('entities')) x(sect)
 order by x.sect;

-- ------------------------------------------------------------
--  ٦) فترات التحديث المفتوحة الآن (إن بدأتِ شيئاً)
-- ------------------------------------------------------------
select replace(key, 'cycle:', '')   as "القسم",
       value->>'every'              as "التكرار",
       left(value->>'startedAt', 10) as "بدأت في",
       value->>'startedBy'          as "بدأها",
       jsonb_array_length(coalesce(value->'units','[]'::jsonb)) as "عدد المطالَبين"
  from public.perf_settings
 where key like 'cycle:%'
 order by key;
