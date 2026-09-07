-- ما الملفات التي شُغِّلت فعلاً؟ — قراءة فقط، لا تغيّر شيئاً
with chk(n, "الملف", "يفحص", "مُشغَّل") as (values
  (1,'perf-weekly.sql','خطة التقرير الأسبوعي',
     exists(select 1 from pg_policies where policyname='perf_settings_weekly_write')),
  (2,'perf-section-edit.sql','تعديل كل قسم لصاحبه',
     exists(select 1 from pg_policies
             where policyname='perf_items_write' and qual like '%|| '':edit''%')),
  (3,'perf-delegate.sql','تفويض الصلاحية في الإجازة',
     to_regclass('public.perf_section_grants') is not null),
  (4,'perf-selfphone.sql','الجوال يكتبه صاحبه عند التفعيل',
     exists(select 1 from pg_proc where proname='perf_activate' and prosrc like '%phone_taken%')),
  (5,'perf-audit.sql','صفحة سجل النشاط',
     exists(select 1 from pg_proc where proname='perf_audit_log')),
  (6,'perf-sticky.sql','ملاحظات القلم اللاصقة',
     to_regclass('public.perf_stickies') is not null),
  (7,'perf-sticky-writers.sql','القلم للحزامي والمدراء',
     exists(select 1 from pg_policies where policyname='perf_stickies_insert' and with_check like '%sticky%')),
  (8,'perf-notices.sql','تحديثات إضافية من المطوّر',
     to_regclass('public.perf_notices') is not null),
  (9,'perf-usernames.sql','أسماء الدخول = البريد',
     exists(select 1 from public.perf_users where username='malhumayzi')),
  (10,'perf-task-delete.sql','حذف التكاليف',
     exists(select 1 from pg_policies where policyname='perf_tasks_delete' and qual like '%created_by_id%'))
)
select "الملف", "يفحص",
       case when "مُشغَّل" then '✅ مُشغَّل' else '❌ ناقص' end as "الحالة"
  from chk order by n;
