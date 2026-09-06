-- ============================================================
--  نموذج الصلاحيات المعتمد — إدارة عمليات الأداء
--
--  القاعدة: ملخّصات الأقسام في «نظرة عامة» يراها كل من سجّل دخوله،
--  والصفحة التفصيلية والتعديل عليها لأصحاب القسم وحدهم.
--
--  ⚠️ شغّلي ملف الهيكل perf-roster.sql أولاً — هذا الملف يمنح
--     صلاحيات لحسابات قائمة، ولا ينشئ حساباً.
--  آمن للتشغيل أكثر من مرة.
-- ============================================================

-- ------------------------------------------------------------
--  ١) قراءة بنود الأقسام لكل من سجّل دخوله
--     كانت محصورة بصاحب صلاحية القسم، فكانت بطاقات «نظرة عامة»
--     تظهر فارغة لمن لا يملك القسم. التعديل يبقى كما هو: صلاحية
--     القسم + «تحرير الأقسام» معاً.
-- ------------------------------------------------------------
drop policy if exists "perf_items_read" on public.perf_items;
create policy "perf_items_read" on public.perf_items
  for select to authenticated
  using (public.perf_signed_in());

-- ------------------------------------------------------------
--  ٢) الأساس للجميع: نظرة عامة · محفظتي (مدمجة) · المهام
-- ------------------------------------------------------------
update public.perf_users
   set scopes = (select array(select distinct unnest(
         coalesce(scopes, '{}') || array['overview','tasks'])))
 where active;

-- ------------------------------------------------------------
--  ٣) صلاحيات الأقسام — تُسحب من الجميع أولاً ثم تُمنح لأصحابها
--
--  مهم: ملف perf-changes.sql السابق منح الأقسام الخمسة لكل حساب
--  نشط، فكان الجميع يفتح كل صفحة تفصيلية. السحب هنا يصحّح ذلك،
--  والملخّصات في «نظرة عامة» تبقى للجميع لأنها لا تعتمد على
--  صلاحية القسم بعد تعديل سياسة القراءة في الفقرة (١).
--
--  «تحرير الأقسام» صلاحية عامة لكنها لا تفتح إلا ما يملك صاحبها
--  صلاحيته، فمنحها مع صلاحية القسم = تحرير ذلك القسم وحده.
-- ------------------------------------------------------------
update public.perf_users
   set scopes = (
         select coalesce(array_agg(x), '{}'::text[])
           from unnest(coalesce(scopes, '{}')) x
          where x <> all (array['sessions','natstrat','inststrat','outputs',
                                'cx','projects','sections:edit']))
 where active;

do $$
declare r record;
begin
  for r in
    select * from (values
      ('sessions',  array['دعاء الفهمي','ياسر بخاري','هيفاء التركي']),
      ('natstrat',  array['بدر الغنام','عبدالعزيز بن عون','عبدالله البكر']),
      ('inststrat', array['عمر العتيق','لمى المبدل','خالد الخثلان','سلطانه العرجاني']),
      ('cx',        array['معاذ الهقاص','مشاعل الدايل','محمد الحميزي'])
      -- المخرجات الوطنية (outputs) والمشاريع الاستراتيجية (projects)
      -- لم يُحدَّد أصحابهما بعد، فتبقيان لمدير الإدارة وسلطانة وحدهما
    ) as t(scope, people)
  loop
    update public.perf_users u
       set scopes = (select array(select distinct unnest(
             coalesce(u.scopes, '{}') || array[r.scope, 'sections:edit'])))
     where u.active
       and exists (
         select 1 from unnest(r.people) p
          where public.perf_norm_name(p) = public.perf_norm_name(u.display_name));
  end loop;
end $$;

-- طلبات التغيير صفحة مستقلة لا قسم في perf_items، فلا تحتاج «تحرير الأقسام»
update public.perf_users
   set scopes = (select array(select distinct unnest(
         coalesce(scopes, '{}') || array['changes'])))
 where active
   and public.perf_norm_name(display_name) in (
         public.perf_norm_name('نورة النصار'),
         public.perf_norm_name('حمد العويس'));

-- ------------------------------------------------------------
--  ٤) التكاليف — ناصر الشايع ومدير الإدارة
-- ------------------------------------------------------------
update public.perf_users
   set scopes = (select array(select distinct unnest(
         coalesce(scopes, '{}') || array['assignments','tasks:all'])))
 where active
   and public.perf_norm_name(display_name) in (
         public.perf_norm_name('ناصر الشايع'),
         public.perf_norm_name('عبدالله الحزامي'));

-- ------------------------------------------------------------
--  ٥) الإنجاز الأسبوعي — يقرؤه الجميع
--     (خانة الكتابة اليدوية لم تُضف بعد؛ ستُحصر بمدير الإدارة)
-- ------------------------------------------------------------
update public.perf_users
   set scopes = (select array(select distinct unnest(
         coalesce(scopes, '{}') || array['weekly'])))
 where active;

-- ------------------------------------------------------------
--  ٦) مدير الإدارة — يرى كل الصفحات التفصيلية
--     («المستخدمون والصلاحيات» و«الهيكل التنظيمي» لا يُمنحان هنا:
--      يبقيان مع مَن يُسنَد إليه ضبط المنصة)
-- ------------------------------------------------------------
update public.perf_users
   set scopes = (select array(select distinct unnest(
         coalesce(scopes, '{}') || array[
           'overview','details','details:all','tasks','tasks:all','assignments',
           'changes','weekly','sessions','natstrat','inststrat','outputs','cx',
           'projects','sections:edit'])))
 where active
   and public.perf_norm_name(display_name) = public.perf_norm_name('عبدالله الحزامي');

-- ------------------------------------------------------------
--  ٧) سلطانة العرجاني — كل الصلاحيات مؤقتاً (ضبط المنصة)
-- ------------------------------------------------------------
update public.perf_users
   set scopes = (select array(select distinct unnest(
         coalesce(scopes, '{}') || array[
           'overview','details','details:all','entry','targets','tasks','tasks:all',
           'assignments','changes','changes:upload','weekly','sessions','natstrat',
           'inststrat','outputs','cx','projects','sections:edit','structure','users'])))
 where active
   and public.perf_norm_name(display_name) = public.perf_norm_name('سلطانه العرجاني');

-- ------------------------------------------------------------
--  ٨) المراجعة: من يملك ماذا
-- ------------------------------------------------------------
select u.display_name as "الاسم",
       coalesce(s.name, '—') as "القطاع",
       array_to_string(u.scopes, ' · ') as "الصلاحيات"
  from public.perf_users u
  left join public.perf_sectors s on s.id = u.sector_ids[1]
 where u.active
 order by cardinality(u.scopes) desc, u.display_name;
