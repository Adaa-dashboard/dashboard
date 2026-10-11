-- ============================================================
--  تحقّقٌ واحد: ما شُغِّل، ومن يحرّر كل قسم، وأي فترةٍ مفتوحة
--  ------------------------------------------------------------
--  **استعلامٌ واحد لا ثلاثة**: محرّر Supabase لا يعرض إلا نتيجة
--  آخر استعلام، فكانت الفحوص تضيع ولا يظهر إلا آخر جدول.
--  للقراءة فقط: لا يكتب حرفاً ولا يغيّر شيئاً.
-- ============================================================

with
chk(i, k, v) as (
  -- ١) إصلاح أول دخول: يُفحص بقراءة نصّ الدالّة نفسها
  select 1, 'أول دخول لشخص جديد', case
    when not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                      where n.nspname = 'public' and p.proname = 'perf_users_audit')
      then '✗ دالّة المؤرّخ غير موجودة'
    when (select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'perf_users_audit' limit 1)
         like '%''الجوال''::text%'
      then '✅ مُصلَحة — أول دخول يمرّ'
    else '✗ لم تُشغَّل: perf-audit-phone-fix.sql' end
  union all
  -- ٢) سياسة فترة التحديث الدوري
  select 2, 'سياسة التحديث الدوري', case when exists (
      select 1 from pg_policy
       where polrelid = 'public.perf_settings'::regclass
         and polname = 'perf_settings_cycle_write')
    then '✅ موجودة — الزرّ يعمل'
    else '✗ لم تُشغَّل: perf-cycles.sql' end
  union all
  -- ٣) الدالّة التي تعتمد عليها السياسة
  select 3, 'دالّة الصلاحيات perf_has_scope', case when exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'perf_has_scope')
    then '✅ موجودة' else '✗ ناقصة — شغّلي perf-changes.sql' end
  union all
  -- ٤) تصحيح اسم «عبدالعزيز بن عون»
  select 4, 'اسم «عبدالعزيز بن عون»', case
    when not exists (select 1 from information_schema.tables
                      where table_schema = 'public' and table_name = 'perf_items')
      then '✗ جدول البنود غير موجود'
    when (select count(*) from public.perf_items
           where section = 'opplan'
             and (coalesce(data->>'sponsor','')  like '%عبدالعزيز العون%'
               or coalesce(data->>'assignee','') like '%عبدالعزيز العون%'
               or coalesce(data->>'owner','')    like '%عبدالعزيز العون%')) = 0
      then '✅ لا يوجد اسمٌ خطأ'
    else '✗ ما زال موجوداً — perf-opplan-rename-awn.sql' end
),
-- ٥) من يحرّر كل قسم — يجب أن يطابق قوائم الفرق
edits(i, k, v) as (
  select 10, 'يحرّر «' || x.sect || '»',
         coalesce(nullif(array_to_string(array(
           select u.display_name from public.perf_users u
            where coalesce(u.scopes,'{}') @> array[x.sect || ':edit']
              and coalesce(u.active, true)
            order by u.display_name), ' · '), ''), '✗ لا أحد')
    from (values ('opplan'),('inststrat'),('natstrat'),
                 ('sessions'),('cx'),('outputs'),('entities')) x(sect)
),
-- ٦) الفترات المفتوحة الآن
cyc(i, k, v) as (
  select 20, 'فترة «' || replace(key, 'cycle:', '') || '»',
         coalesce(case value->>'every'
                    when 'daily' then 'يومية' when 'weekly' then 'أسبوعية'
                    when 'monthly' then 'شهرية' when 'range' then 'فترة محدّدة'
                  end, '⚠ مرّة واحدة لا تتجدّد — أُنشئت قبل خيارات التكرار')
         || ' · بدأت ' || left(coalesce(value->>'startedAt',''), 10)
         || ' · بدأها ' || coalesce(nullif(value->>'startedBy',''), '—')
         || ' · المطالَبون ' || coalesce(jsonb_array_length(value->'units'), 0)::text
    from public.perf_settings
   where key like 'cycle:%'
)
select k as "الفحص", v as "النتيجة"
  from (select * from chk union all select * from edits union all select * from cyc) z
 order by i, k;
