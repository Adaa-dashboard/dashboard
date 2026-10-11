-- ============================================================
--  صفحة «جودة ملاحظات الأداء» — صلاحيتها وبياناتها
--  ------------------------------------------------------------
--  يُشغَّل من SQL Editor مرّة واحدة. idempotent، وليس فيه حذف
--  بيانات. لا يحتاج جدولاً جديداً: الصفحة قسمٌ في `perf_items`
--  مثل بقيّة الأقسام (`section = 'notesq'`)، وسياساتُه القائمة
--  تحرسه: القراءة لكل من دخل، والكتابة لمن يملك
--  `notesq` و`notesq:edit` معاً.
--
--  ومن الصفحة تُشتقّ نسبةُ كل موظفٍ في محفظته، فلا تُدخَل مرّتين.
-- ============================================================

-- ٠) تطبيع الاسم — نفس الدالة في `perf-teams-scopes.sql`، تُعاد
--    هنا ليعمل الملف وحده إن شُغِّل قبله
create or replace function public.perf_nm(p text)
returns text language sql immutable as $$
  select regexp_replace(
           regexp_replace(translate(coalesce(p,''), 'أإآةىـٱ', 'اااهيا'),
                          '[ً-ْٰ]', '', 'g'),
           '\s+', ' ', 'g')
$$;

-- ١) الصلاحية لحمد العويس — الاطّلاع والتحرير
update public.perf_users
   set scopes = (
         select array_agg(distinct x)
           from unnest(scopes || array['notesq','notesq:edit']) as x
       )
 where active
   and public.perf_nm(name) = public.perf_nm('حمد العويس');

-- ٢) الاطّلاع (بلا تحرير) لمن يتابع: صاحب صلاحية «المستخدمون»
--    يرى الصفحة كما يرى بقيّة الأقسام
update public.perf_users
   set scopes = (
         select array_agg(distinct x) from unnest(scopes || array['notesq']) as x
       )
 where active
   and scopes @> array['users']
   and not (scopes @> array['notesq']);

-- ------------------------------------------------------------
--  تحقّق: من يملك الصفحة ومن يحرّرها
-- ------------------------------------------------------------
select name as "الاسم",
       (scopes @> array['notesq'])      as "يرى الصفحة",
       (scopes @> array['notesq:edit']) as "يحرّرها"
  from public.perf_users
 where active and scopes @> array['notesq']
 order by (scopes @> array['notesq:edit']) desc, name;
