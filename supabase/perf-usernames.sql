-- ============================================================
--  توحيد أسماء الدخول مع البريد الرسمي
--  اسم الدخول = ما قبل @ في بريد أداء.
--
--  ⚠️ هذا يغيّر ما يكتبه الموظف في شاشة الدخول. كلمات المرور
--     لا تتغيّر، والصلاحيات ولا البيانات لا تتأثر — لكن من كان
--     يدخل باسمه القديم لن يعمل معه بعد هذا الملف.
--     أبلِغ الموظفين باسمهم الجديد قبل التشغيل.
--
--  الأسماء أدناه مأخوذة من عمود «البريد الإلكتروني» في صفحة
--  الاستراتيجيات المؤسسية نفسها — لم يُخمَّن منها شيء.
-- ============================================================

-- ------------------------------------------------------------
--  ١) المراجعة قبل التنفيذ — شغّلها وحدها أولاً وراجع الجدول
-- ------------------------------------------------------------
with want(display_name, uname) as (values
  ('ثامر الضبيب',      'taldhubaib'),
  ('خالد الجرف',       'kaljurf'),
  ('خالد الخثلان',     'kalkhathlan'),
  ('رؤى الحماد',       'ralhammad'),
  ('ريما السكران',     'ralsakran'),
  ('عبدالاله الفوزان', 'aalfawzan'),
  ('عبدالرحمن الرميح', 'aalrumayh'),
  ('عبدالعزيز بن عون', 'aalawn'),
  ('عبدالله البكر',    'aalbakr'),
  ('عمر الظاهري',      'oaldhairi'),
  ('فارس السحيباني',   'falsuhaibani'),
  ('فاطمة القحطاني',   'falqahtani'),
  ('لمى المبدل',       'lmubaddel'),
  ('مشاعل الدايل',     'maldail'),
  ('هشام بياري',       'hbeyari'),
  ('هيفاء التركي',     'halturki'),
  ('وعد الشدي',        'walsheddi'),
  ('ياسر بخاري',       'ybukhari')
)
select w.display_name as "الاسم",
       coalesce(u.username, '— لا حساب —') as "اليوزر الحالي",
       w.uname as "سيصير",
       case when u.id is null then 'لا حساب — لن يتغيّر شيء'
            when lower(u.username) = w.uname then 'مطابق أصلاً'
            else 'سيتغيّر' end as "الأثر"
  from want w
  left join public.perf_users u
    on public.perf_norm_name(u.display_name) = public.perf_norm_name(w.display_name)
   and u.active
 order by 4, 1;

-- ------------------------------------------------------------
--  ٢) التنفيذ
--     يتوقّف بخطأ إن كان الاسم الجديد مأخوذاً من حساب آخر،
--     فلا يُكتب شيء نصفه.
-- ------------------------------------------------------------
do $$
declare r record; taken text;
begin
  for r in
    select * from (values
      ('ثامر الضبيب','taldhubaib'), ('خالد الجرف','kaljurf'),
      ('خالد الخثلان','kalkhathlan'), ('رؤى الحماد','ralhammad'),
      ('ريما السكران','ralsakran'), ('عبدالاله الفوزان','aalfawzan'),
      ('عبدالرحمن الرميح','aalrumayh'), ('عبدالعزيز بن عون','aalawn'),
      ('عبدالله البكر','aalbakr'), ('عمر الظاهري','oaldhairi'),
      ('فارس السحيباني','falsuhaibani'), ('فاطمة القحطاني','falqahtani'),
      ('لمى المبدل','lmubaddel'), ('مشاعل الدايل','maldail'),
      ('هشام بياري','hbeyari'), ('هيفاء التركي','halturki'),
      ('وعد الشدي','walsheddi'), ('ياسر بخاري','ybukhari')
    ) as t(display_name, uname)
  loop
    select u.display_name into taken
      from public.perf_users u
     where lower(u.username) = r.uname
       and public.perf_norm_name(u.display_name) <> public.perf_norm_name(r.display_name);
    if taken is not null then
      raise exception 'اسم الدخول % مأخوذ من %', r.uname, taken;
    end if;

    update public.perf_users
       set username = r.uname
     where active
       and public.perf_norm_name(display_name) = public.perf_norm_name(r.display_name)
       and username <> r.uname;
  end loop;
end $$;

-- ------------------------------------------------------------
--  ٣) التحقق: كل الحسابات النشطة وأسماء دخولها
-- ------------------------------------------------------------
select display_name as "الاسم", username as "اسم الدخول",
       coalesce(job_title,'—') as "المسمّى"
  from public.perf_users where active order by username;
