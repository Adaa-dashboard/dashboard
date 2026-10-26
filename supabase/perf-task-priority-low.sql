-- ============================================================
--  أولوية ثالثة للمهام: «منخفضة»
--  ------------------------------------------------------------
--  عمود `priority` في `perf_tasks` مقيَّدٌ بقيمتين منذ الإنشاء
--  (`high` و`mid`)، فاختيار «منخفضة» من الواجهة يُرفض برسالة
--  غامضة من القاعدة. هذا يوسّع القيد ليقبل `low` — ولا يغيّر
--  قيمةً قائمة ولا يحذف شيئاً.
--
--  idempotent — آمن للتشغيل أكثر من مرة
-- ============================================================

alter table public.perf_tasks drop constraint if exists perf_tasks_priority_check;
alter table public.perf_tasks
  add constraint perf_tasks_priority_check
  check (priority in ('high', 'mid', 'low'));

select 'perf_tasks.priority' as "العمود",
       pg_get_constraintdef(oid) as "القيد"
  from pg_constraint
 where conrelid = 'public.perf_tasks'::regclass
   and conname = 'perf_tasks_priority_check';
