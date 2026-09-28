-- ============================================================
--  فحصٌ: أيُّ ملفات SQL شُغِّلت فعلاً وأيُّها لم يُشغَّل
--  ------------------------------------------------------------
--  للقراءة فقط — لا يغيّر شيئاً. يُشغَّل من SQL Editor فيعرض
--  جدولاً: كل عنصرٍ ومصدره وهل هو موجود في قاعدة البيانات.
--  كل الصفوف ✅ ⇒ الملف مُشغَّل. أيُّ ❌ ⇒ شغِّل ملفه.
-- ============================================================
with checks(ord, "الملف", "العنصر", ok) as (values
  (1, 'perf-portfolio-main.sql',    'perf_my_entity_names()',
      to_regprocedure('public.perf_my_entity_names()') is not null),
  (2, 'perf-portfolio-main.sql',    'perf_item_mine(text,jsonb)',
      to_regprocedure('public.perf_item_mine(text,jsonb)') is not null),
  (3, 'perf-portfolio-main.sql',    'perf_item_mine_save(text,text,jsonb)',
      to_regprocedure('public.perf_item_mine_save(text,text,jsonb)') is not null),
  (4, 'perf-portfolio-main.sql',    'perf_session_flag(text,text)',
      to_regprocedure('public.perf_session_flag(text,text)') is not null),
  (5, 'perf-sticky-mentions.sql',   'perf_stickies.audience',
      exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'perf_stickies'
                 and column_name = 'audience')),
  (6, 'perf-sticky-mentions.sql',   'perf_stickies.mention_ids',
      exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'perf_stickies'
                 and column_name = 'mention_ids')),
  (7, 'perf-sticky-mentions.sql',   'perf_is_lead()',
      to_regprocedure('public.perf_is_lead()') is not null),
  (8, 'perf-sticky-mentions.sql',   'perf_people() فيها username',
      exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.proname = 'perf_people'
                 and pg_get_function_result(p.oid) ilike '%username%')),
  (9, 'perf-sticky-mentions.sql',   'سياسة perf_stickies_read',
      exists (select 1 from pg_policies
               where schemaname = 'public' and tablename = 'perf_stickies'
                 and policyname = 'perf_stickies_read')),
  -- وجودُ الدالة لا يكفي: قائمة الحقول المسموحة داخلها توسّعت،
  -- ونسخةٌ قديمة تتجاهل الحقول الجديدة **بصمت** فلا يظهر خطأ
  (10, 'perf-portfolio-main.sql',   'perf_item_mine_save بالحقول الموسَّعة',
      exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.proname = 'perf_item_mine_save'
                 and pg_get_functiondef(p.oid) like '%q4Sat%'
                 and pg_get_functiondef(p.oid) like '%docsState%'))
)
select "الملف", "العنصر",
       case when ok then '✅ موجود' else '❌ ناقص — شغِّل الملف' end as "الحالة"
  from checks order by ord;
