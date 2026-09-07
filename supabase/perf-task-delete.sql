-- ============================================================
--  حذف مهمة أو تكليف — توسيع صلاحية الحذف
--  كان الحذف لمدير الإدارة وحده، فلم يكن لأحد خيار حذف
--  التكاليف من صفحة «نظرة عامة». صار: المدير أو من سجّل البند.
--  الملف idempotent — يُشغَّل من SQL Editor أكثر من مرة بلا ضرر.
--  لا يمسّ أي بيانات: يغيّر سياسة فقط.
-- ============================================================

drop policy if exists "perf_tasks_delete" on public.perf_tasks;
create policy "perf_tasks_delete" on public.perf_tasks
  for delete to authenticated
  using (
    public.perf_is_admin()
    or created_by_id = public.perf_my_id()::text
  );
