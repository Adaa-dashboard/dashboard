-- ============================================================
--  أرقام الأقسام في «نظرة عامة» تظهر لكل من دخل
--  ------------------------------------------------------------
--  بطاقات نظرة عامة تُحسب من بنود الأقسام (perf_items)، وسياسة
--  القراءة كانت تشترط صلاحية القسم. فمن لا يملكها يحصل على صفر
--  صفوف، فتظهر البطاقات فارغة بلا سبب مفهوم.
--
--  القراءة تُفتح لكل حساب داخل المنصة — والكتابة تبقى كما هي:
--  صاحبُ القسم أو مَن فُوِّض. فالأرقام تُرى ولا تُحرَّر.
--
--  ملاحظة صريحة: هذا يفتح **صفوف الأقسام** لا النسب وحدها. كل
--  من دخل المنصة يستطيع قراءة بنود الأقسام (الأسماء والتواريخ
--  والملاحظات) عبر الواجهة أو أدوات المتصفح. إن كان المطلوب
--  النسب المجرّدة دون التفاصيل فالطريق مختلف: دالة تُرجع
--  المجاميع وحدها — قوليها ونعملها.
--
--  الصفحات التفصيلية تبقى محجوبة كما هي: التنقّل يحكمه
--  perf_me/الصلاحيات لا هذه السياسة.
--
--  idempotent وليس فيه حذف بيانات.
-- ============================================================

drop policy if exists "perf_items_read" on public.perf_items;
create policy "perf_items_read" on public.perf_items
  for select to authenticated
  using (public.perf_signed_in());

-- الكتابة كما هي — تُعاد للتوثيق لا للتغيير
drop policy if exists "perf_items_write" on public.perf_items;
create policy "perf_items_write" on public.perf_items
  for all to authenticated
  using (
    (public.perf_has_scope(section) and public.perf_has_scope(section || ':edit'))
    or public.perf_granted(section, true))
  with check (
    (public.perf_has_scope(section) and public.perf_has_scope(section || ':edit'))
    or public.perf_granted(section, true));

select polname as "السياسة",
       case polcmd when 'r' then 'قراءة' when 'a' then 'إضافة' else 'الكل' end as "النوع",
       pg_get_expr(polqual, polrelid) as "الشرط"
  from pg_policy where polrelid = 'public.perf_items'::regclass
 order by polname;
