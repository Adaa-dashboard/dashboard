-- ============================================================
--  صلاحيات ترتيب القائمة الجديد
--  ------------------------------------------------------------
--  · الهيكل التنظيمي والجهات ونقاط التواصل ⇐ لكل حساب نشط
--  · تحرير الجهات ⇐ ناصر الشايع وحده (ويبقى لمالكة المنصة لأنها
--    تمنح الصلاحيات أصلاً من صفحة «المستخدمون»)
--  · المستخدمون والصلاحيات ⇐ سلطانه · ناصر · لمى · عبدالله الحزامي
--  · سجل النشاط ⇐ سلطانه وحدها
--
--  لا يمسّ بياناً: صلاحيات فقط. آمن التكرار.
--  الأسماء تُطابَق بـ perf_norm_name فلا تهمّ الهمزة ولا التاء المربوطة.
-- ============================================================

-- ١) للجميع: الهيكل التنظيمي · الجهات
update public.perf_users
   set scopes = (select array(select distinct unnest(coalesce(scopes,'{}') || array['structure','entities'])))
 where active;

-- ٢) تحرير الجهات: ناصر ومالكة المنصة فقط — يُسحب ممن سواهما
update public.perf_users
   set scopes = array_remove(coalesce(scopes,'{}'), 'entities:edit')
 where active
   and public.perf_norm_name(display_name) not in (
         public.perf_norm_name('ناصر الشايع'),
         public.perf_norm_name('سلطانه العرجاني'));

update public.perf_users
   set scopes = (select array(select distinct unnest(coalesce(scopes,'{}') || array['entities:edit'])))
 where active
   and public.perf_norm_name(display_name) in (
         public.perf_norm_name('ناصر الشايع'),
         public.perf_norm_name('سلطانه العرجاني'));

-- ٣) المستخدمون والصلاحيات: الأربعة وحدهم
update public.perf_users
   set scopes = array_remove(coalesce(scopes,'{}'), 'users')
 where active
   and public.perf_norm_name(display_name) not in (
         public.perf_norm_name('سلطانه العرجاني'),
         public.perf_norm_name('ناصر الشايع'),
         public.perf_norm_name('لمى المبدل'),
         public.perf_norm_name('عبدالله الحزامي'));

update public.perf_users
   set scopes = (select array(select distinct unnest(coalesce(scopes,'{}') || array['users'])))
 where active
   and public.perf_norm_name(display_name) in (
         public.perf_norm_name('سلطانه العرجاني'),
         public.perf_norm_name('ناصر الشايع'),
         public.perf_norm_name('لمى المبدل'),
         public.perf_norm_name('عبدالله الحزامي'));

-- ٤) سجل النشاط: مالكة المنصة وحدها
update public.perf_users
   set scopes = array_remove(coalesce(scopes,'{}'), 'audit')
 where active
   and public.perf_norm_name(display_name) <> public.perf_norm_name('سلطانه العرجاني');

update public.perf_users
   set scopes = (select array(select distinct unnest(coalesce(scopes,'{}') || array['audit'])))
 where active
   and public.perf_norm_name(display_name) = public.perf_norm_name('سلطانه العرجاني');

-- المراجعة
select display_name as "الاسم",
       is_lead as "مدير",
       ('structure'     = any(scopes)) as "الهيكل",
       ('entities'      = any(scopes)) as "الجهات",
       ('entities:edit' = any(scopes)) as "تحرير الجهات",
       ('users'         = any(scopes)) as "المستخدمون",
       ('audit'         = any(scopes)) as "سجل النشاط"
  from public.perf_users
 where active
 order by display_name;
