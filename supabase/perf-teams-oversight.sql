-- ============================================================
--  إشرافٌ عام: من يرى ويعدّل كل الأقسام فوق الفرق
--  ------------------------------------------------------------
--  `perf-teams-scopes.sql` حصر تحرير كل قسمٍ في فريقه — «هم اللي
--  يعدلونها فقط» — فسحب التحرير ممّن ليس في الفريق، ومنهم صاحبة
--  المنصة نفسها. فاختفى زرّ «إضافة» و⚙️ من صفحات الأعمال الرئيسية،
--  لأنهما معلّقان على `<القسم>:edit`.
--
--  هذا الملف يُعيدهما لمن يُشرف على الكل. أضيفي أو احذفي الأسماء
--  من الجدول أدناه، ثم شغّليه.
--
--  idempotent: تشغيله مرّتين كتشغيله مرّة.
--  **ويُشغَّل بعد `perf-teams-scopes.sql` لا قبله**، وإلا سحب ذاك
--  ما منحه هذا.
-- ============================================================

create or replace function public.perf_nm(p text)
returns text language sql immutable as $$
  select regexp_replace(
           regexp_replace(translate(coalesce(p,''), 'أإآةىـٱ', 'اااهيا'),
                          '[ً-ْٰ]', '', 'g'),
           '\s+', ' ', 'g')
$$;

drop table if exists t_over;
create temp table t_over(member text);
insert into t_over(member) values
 ('سلطانة العرجاني');
 -- لإضافة غيرها: افصلي بفاصلة وأضيفي سطراً، مثال:
 --   ('سلطانة العرجاني'), ('عبدالله الحزامي');

-- ------------------------------------------------------------
--  ١) هل وُجد كلّ اسم؟
-- ------------------------------------------------------------
select o.member as "الاسم المطلوب",
       coalesce((select u.display_name from public.perf_users u
                  where public.perf_nm(u.display_name) = public.perf_nm(o.member)
                  limit 1), '✗ لا حساب بهذا الاسم') as "الحساب في المنصة"
  from t_over o;

-- ------------------------------------------------------------
--  ٢) المنح: الأقسام السبعة اطّلاعاً وتحريراً
-- ------------------------------------------------------------
update public.perf_users u
   set scopes = (select array(select distinct unnest(
         coalesce(u.scopes,'{}') || array[
           'opplan','opplan:edit','inststrat','inststrat:edit',
           'natstrat','natstrat:edit','sessions','sessions:edit',
           'cx','cx:edit','outputs','outputs:edit',
           'entities','entities:edit'])))
 where exists (select 1 from t_over o
                where public.perf_nm(o.member) = public.perf_nm(u.display_name));

-- ------------------------------------------------------------
--  ٣) الحصيلة: من يحرّر كل قسم الآن
-- ------------------------------------------------------------
select x.sect as "القسم",
       coalesce(nullif(array_to_string(array(
         select u.display_name from public.perf_users u
          where coalesce(u.scopes,'{}') @> array[x.sect || ':edit']
            and coalesce(u.active, true)
          order by u.display_name), ' · '), ''), '✗ لا أحد') as "من يحرّره"
  from (values ('opplan'),('inststrat'),('natstrat'),
               ('sessions'),('cx'),('outputs'),('entities')) x(sect)
 order by x.sect;
