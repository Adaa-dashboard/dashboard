-- ============================================================
--  الفرق وصلاحياتها — كل فريقٍ يحرّر صفحته وحدها
--  ------------------------------------------------------------
--  يُشغَّل من SQL Editor في Supabase. idempotent: تشغيله مرّتين
--  كتشغيله مرّة.
--
--  لكل قسمٍ صلاحيتان: `قسم` للاطّلاع و`قسم:edit` للتحرير. وهذا
--  الملف:
--    ١) يمنح كل عضوٍ صلاحيتَي فريقه.
--    ٢) **ويسحب `:edit` من كل من ليس في الفريق** — «هم اللي
--       يعدلونها فقط». ولا يمسّ الاطّلاع: من كان يرى الصفحة يبقى
--       يراها، وإنما يفقد التعديل.
--
--  و`admin` في هذه المنصة **لا يعني كل الصلاحيات**: العضوية صريحة
--  ولا تُستنتج من الدور. فمن أردتِ استثناءه أضيفي اسمه إلى فريقه.
--
--  القائمة نفسها في `src/lib/teams.ts`، وتُعدَّل في الموضعين معاً.
-- ============================================================

-- تطبيع الاسم: الهمزات والتاء المربوطة والألف المقصورة والتشكيل
-- والمسافات — فلا يُفوِّت الاختلافُ الإملائيُّ أحداً
create or replace function public.perf_nm(p text)
returns text language sql immutable as $$
  select regexp_replace(
           regexp_replace(translate(coalesce(p,''), 'أإآةىـٱ', 'اااهيا'),
                          '[ً-ْٰ]', '', 'g'),
           '\s+', ' ', 'g')
$$;

-- ------------------------------------------------------------
--  الفرق: (اسم الفريق · القسم · العضو)
-- ------------------------------------------------------------
/* **لا `on commit drop`**: محرّر SQL ينفّذ كل جملةٍ في معاملةٍ
   وحدها، فتُحذف الجدولة فور إنشائها ولا تجدها الجمل بعدها. */
drop table if exists t_team;
create temp table t_team(team text, sect text, member text);
insert into t_team(team, sect, member) values
 ('الفريق المركزي','opplan','رؤى الحماد'),
 ('الفريق المركزي','opplan','ندى العمير'),
 ('الفريق المركزي','opplan','عمر الظاهري'),
 ('الفريق المركزي','opplan','سلطانة العرجاني'),
 ('فريق الاستراتيجيات المؤسسية','inststrat','عمر العتيق'),
 ('فريق الاستراتيجيات المؤسسية','inststrat','لمى المبدل'),
 ('فريق الاستراتيجيات المؤسسية','inststrat','خالد الخثلان'),
 ('فريق الاستراتيجيات الوطنية','natstrat','بدر الغنام'),
 ('فريق الاستراتيجيات الوطنية','natstrat','عبدالعزيز بن عون'),
 ('فريق الاستراتيجيات الوطنية','natstrat','عبدالله البكر'),
 ('فريق جلسات مراجعة الأداء','sessions','دعاء الفهمي'),
 ('فريق جلسات مراجعة الأداء','sessions','هيفاء التركي'),
 ('فريق جلسات مراجعة الأداء','sessions','ياسر بخاري'),
 ('فريق قياس تجربة المستفيد','cx','معاذ الهقاص'),
 ('فريق قياس تجربة المستفيد','cx','مشاعل الدايل'),
 ('فريق قياس تجربة المستفيد','cx','محمد الحميزي'),
 ('فريق المخرجات الوطنية','outputs','معاذ الهقاص'),
 ('فريق المخرجات الوطنية','outputs','فارس السحيباني'),
 ('فريق المخرجات الوطنية','outputs','حمد العويس'),
 ('فريق الجهات ونقاط التواصل','entities','ناصر الشايع');

-- ------------------------------------------------------------
--  ١) من يحرّر ماذا الآن؟ (قبل أي تغيير)
-- ------------------------------------------------------------
select u.display_name as "الاسم",
       array_to_string(array(
         select s from unnest(coalesce(u.scopes,'{}')) s
          where s like '%:edit') , ' · ') as "يحرّر الآن"
  from public.perf_users u
 where exists (select 1 from unnest(coalesce(u.scopes,'{}')) s where s like '%:edit')
 order by u.display_name;

-- ------------------------------------------------------------
--  ٢) هل وُجد كل عضو؟ — الاسم الذي لم يُطابَق يظهر هنا، فيُصحَّح
--     إملاؤه أو يُضاف حسابه من «المستخدمون والصلاحيات»
-- ------------------------------------------------------------
select t.team as "الفريق", t.member as "العضو",
       coalesce((select u.display_name from public.perf_users u
                  where public.perf_nm(u.display_name) = public.perf_nm(t.member)
                  limit 1), '✗ لا حساب بهذا الاسم') as "الحساب في المنصة"
  from t_team t
 order by t.team, t.member;

-- ------------------------------------------------------------
--  ٣) المنح: لكل عضوٍ قسمُه اطّلاعاً وتحريراً
-- ------------------------------------------------------------
update public.perf_users u
   set scopes = (select array(select distinct unnest(
         coalesce(u.scopes,'{}') || g.add)))
  from (select public.perf_nm(t.member) as n,
               array_agg(distinct t.sect) || array_agg(distinct t.sect || ':edit') as add
          from t_team t group by public.perf_nm(t.member)) g
 where public.perf_nm(u.display_name) = g.n
   and not (coalesce(u.scopes,'{}') @> g.add);

-- ------------------------------------------------------------
--  ٤) السحب: `قسم:edit` ممّن ليس في فريق ذلك القسم
--     — الاطّلاع لا يُمسّ
-- ------------------------------------------------------------
/* **بلا `from`**: `update ... from` يطبّق صفّاً واحداً من المصدر
   على صفّ الهدف، فمن كان يحرّر ثلاثة أقسام لا يفقد إلا واحداً في
   كل تشغيل. وهذه تبني المصفوفة الجديدة كاملةً مرّةً واحدة. */
update public.perf_users u
   set scopes = (select array(
         select s from unnest(coalesce(u.scopes,'{}')) s
          where s not in (select distinct t.sect || ':edit' from t_team t)
             or exists (select 1 from t_team t
                         where t.sect || ':edit' = s
                           and public.perf_nm(t.member) = public.perf_nm(u.display_name))))
 where exists (
   select 1
     from unnest(coalesce(u.scopes,'{}')) s
     join (select distinct sect from t_team) x on x.sect || ':edit' = s
    where not exists (select 1 from t_team t
                       where t.sect = x.sect
                         and public.perf_nm(t.member) = public.perf_nm(u.display_name)));

-- ------------------------------------------------------------
--  ٥) الحصيلة — كل قسمٍ ومن يحرّره، ويجب أن يطابق القوائم أعلاه
-- ------------------------------------------------------------
select x.sect as "القسم",
       array_to_string(array(
         select u.display_name from public.perf_users u
          where coalesce(u.scopes,'{}') @> array[x.sect || ':edit']
          order by u.display_name), ' · ') as "من يحرّره"
  from (select distinct sect from t_team) x
 order by x.sect;
