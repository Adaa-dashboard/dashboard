-- ============================================================
--  الاطّلاع على الأقسام للمدراء، والتحرير لصاحب القسم وحده
--  يُشغَّل من SQL Editor مرة واحدة. idempotent وليس فيه حذف بيانات.
--  يُشغَّل بعد: perf-roster · perf-changes · perf-access · perf-weekly
-- ============================================================

-- ------------------------------------------------------------
--  ١) التحرير صار صلاحيةً لكل قسم على حدة
--
--  كانت «sections:edit» صلاحيةً واحدة تفتح تحرير كل قسم يملك
--  صاحبها الاطّلاع عليه. وهذا يمنع ما هو مطلوب الآن: أن يرى
--  مدير القطاع الأقسام كلها ولا يحدّث إلا قسمه — إذ كان منحُه
--  الاطّلاع يمنحه التحرير معه.
--  فصارت لكل قسم صلاحية تحرير باسمه: sessions:edit وأخواتها.
-- ------------------------------------------------------------
drop policy if exists "perf_items_write" on public.perf_items;
create policy "perf_items_write" on public.perf_items
  for all to authenticated
  using (public.perf_has_scope(section) and public.perf_has_scope(section || ':edit'))
  with check (public.perf_has_scope(section) and public.perf_has_scope(section || ':edit'));

-- ------------------------------------------------------------
--  ٢) ترحيل ما هو قائم: من كان يحرّر قسماً يبقى يحرّره
--     (يملك «sections:edit» + صلاحية القسم ⇒ يُمنح «القسم:edit»)
-- ------------------------------------------------------------
do $$
declare sec text;
begin
  foreach sec in array array['sessions','natstrat','inststrat','outputs','cx','projects']
  loop
    execute format($f$
      update public.perf_users
         set scopes = (select array(select distinct unnest(
               coalesce(scopes, '{}') || array[%L])))
       where active
         and scopes @> array['sections:edit']
         and scopes @> array[%L]
    $f$, sec || ':edit', sec);
  end loop;
end $$;

-- الصلاحية القديمة لم يعد لها أثر في أي سياسة — تُزال من الحسابات
update public.perf_users
   set scopes = array_remove(scopes, 'sections:edit')
 where scopes @> array['sections:edit'];

-- ------------------------------------------------------------
--  ٣) كل المدراء يطّلعون على الأقسام الخمسة
--     المدير = من عُلِّم is_lead في الهيكل التنظيمي
-- ------------------------------------------------------------
update public.perf_users
   set scopes = (select array(select distinct unnest(
         coalesce(scopes, '{}')
         || array['sessions','natstrat','inststrat','outputs','cx'])))
 where active and is_lead;

-- ------------------------------------------------------------
--  ٤) التحرير لصاحب القسم وحده — بأسمائهم
--     ما عدا المخرجات الوطنية: لم يُحدَّد صاحبها بعد، فتبقى
--     لمالكة المنصة ومدير الإدارة (الفقرة ٥).
-- ------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select * from (values
      ('sessions:edit',  'دعاء الفهمي'),
      ('natstrat:edit',  'بدر الغنام'),
      ('inststrat:edit', 'عمر العتيق'),
      ('cx:edit',        'معاذ الهقاص')
    ) as t(scope, person)
  loop
    update public.perf_users u
       set scopes = (select array(select distinct unnest(
             coalesce(u.scopes, '{}') || array[r.scope])))
     where u.active
       and public.perf_norm_name(u.display_name) = public.perf_norm_name(r.person);
  end loop;
end $$;

-- ------------------------------------------------------------
--  ٥) مدير الإدارة ومالكة المنصة: اطّلاع على الكل، وتحرير الكل
-- ------------------------------------------------------------
update public.perf_users
   set scopes = (select array(select distinct unnest(
         coalesce(scopes, '{}') || array[
           'sessions','natstrat','inststrat','outputs','cx','projects',
           'sessions:edit','natstrat:edit','inststrat:edit',
           'outputs:edit','cx:edit','projects:edit'])))
 where active
   and public.perf_norm_name(display_name) in (
         public.perf_norm_name('سلطانه العرجاني'),
         public.perf_norm_name('عبدالله الحزامي'));

-- ------------------------------------------------------------
--  ٦) المراجعة: من يطّلع ومن يحرّر
-- ------------------------------------------------------------
select u.display_name as "الاسم",
       coalesce(u.job_title, '—') as "المسمّى",
       array_to_string(array(
         select s from unnest(array['sessions','natstrat','inststrat','outputs','cx','projects']) s
          where u.scopes @> array[s]), ' · ') as "يطّلع على",
       coalesce(nullif(array_to_string(array(
         select s from unnest(array['sessions','natstrat','inststrat','outputs','cx','projects']) s
          where u.scopes @> array[s || ':edit']), ' · '), ''), '—') as "يحرّر"
  from public.perf_users u
 where u.active
   and u.scopes && array['sessions','natstrat','inststrat','outputs','cx','projects']
 order by u.is_lead desc, u.display_name;
