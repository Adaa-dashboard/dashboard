-- ============================================================
--  حالة «معلقة» للمهام والتكاليف
--  يُشغَّل مرة واحدة من SQL Editor — idempotent ولا يمسّ أي بيان.
--  كل ما يفعله: توسيع قيد الحالة ليقبل 'hold' مع ok/risk/done.
--  البنود الموجودة تبقى بحالتها كما هي.
-- ============================================================

-- يُزال أي قيد تحقُّق على الحالة مهما كان اسمه — الاسم التلقائي قد
-- يختلف بين قاعدة وأخرى، فالاعتماد عليه وحده يترك القيد القديم قائماً
do $$
declare c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.perf_tasks'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%state%'
      and pg_get_constraintdef(oid) ilike '%risk%'
  loop
    execute format('alter table public.perf_tasks drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.perf_tasks
  add constraint perf_tasks_state_check
  check (state in ('ok', 'risk', 'hold', 'done'));

-- تحقّق: يجب أن تظهر الحالات الأربع في تعريف القيد
select pg_get_constraintdef(oid) as state_check
from pg_constraint
where conrelid = 'public.perf_tasks'::regclass
  and conname = 'perf_tasks_state_check';
