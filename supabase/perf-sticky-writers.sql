-- ============================================================
--  الملاحظات اللاصقة: الكتابة لمدير الإدارة ومدراء القطاعات
--  يُشغَّل بعد perf-sticky.sql. idempotent وليس فيه حذف بيانات.
-- ============================================================

-- ------------------------------------------------------------
--  ١) صلاحية «sticky» — تُسحب من الجميع ثم تُمنح لأهلها
--     المدير = من عُلِّم is_lead في الهيكل (ومنهم مدير الإدارة)
-- ------------------------------------------------------------
update public.perf_users
   set scopes = array_remove(scopes, 'sticky')
 where scopes @> array['sticky'];

update public.perf_users
   set scopes = (select array(select distinct unnest(
         coalesce(scopes, '{}') || array['sticky'])))
 where active
   and (is_lead
        or public.perf_norm_name(display_name) in (
             public.perf_norm_name('عبدالله الحزامي'),
             public.perf_norm_name('سلطانه العرجاني')));

-- ------------------------------------------------------------
--  ٢) الكتابة تحتاج الصلاحية مع رؤية الصفحة
--     القراءة تبقى لمن يفتح الصفحة — فالملاحظة تصل من تعنيه.
-- ------------------------------------------------------------
drop policy if exists "perf_stickies_insert" on public.perf_stickies;
create policy "perf_stickies_insert" on public.perf_stickies
  for insert to authenticated
  with check (public.perf_sees_page(page) and public.perf_has_scope('sticky'));

-- ------------------------------------------------------------
--  ٣) المراجعة
-- ------------------------------------------------------------
select display_name as "الاسم",
       coalesce(job_title,'—') as "المسمّى",
       (scopes @> array['sticky']) as "يكتب ملاحظات لاصقة"
  from public.perf_users
 where active and (is_lead or scopes @> array['sticky'])
 order by is_lead desc, display_name;
