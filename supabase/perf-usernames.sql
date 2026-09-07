-- ============================================================
--  توحيد أسماء الدخول مع البريد الرسمي
--  اسم الدخول = ما قبل @ في بريد أداء، بحروف صغيرة.
--
--  ⚠️ يغيّر ما يكتبه الموظف في شاشة الدخول. كلمات المرور
--     والصلاحيات والبيانات لا تتأثر. أبلِغ الموظفين قبل التشغيل.
--
--  المدراء الخمسة وحساب مالكة المنصة عُدِّلت أسماؤهم من الواجهة،
--  فليست في هذا الملف.
--
--  الدخول يخفض حروف ما يُكتب (perf_norm_user)، فالكتابة بحرف
--  كبير أو صغير سواء — والمخزَّن يبقى صغيراً.
-- ============================================================

-- ------------------------------------------------------------
--  ١) المراجعة — شغّلها وحدها أولاً وراجع الجدول
-- ------------------------------------------------------------
with want(display_name, uname) as (values
  ('ثامر الضبيب','taldhubaib'), ('خالد الجرف','kaljurf'),
  ('خالد الخثلان','kalkhathlan'), ('رؤى الحماد','ralhammad'),
  ('ريما السكران','ralsakran'), ('عبدالاله الفوزان','aalfawzan'),
  ('عبدالرحمن الرميح','aalrumayh'), ('عبدالعزيز بن عون','aalawn'),
  ('عبدالله البكر','aalbakr'), ('عمر الظاهري','oaldhairi'),
  ('فارس السحيباني','falsuhaibani'), ('فاطمة القحطاني','falqahtani'),
  ('لمى المبدل','lmubaddel'), ('مشاعل الدايل','maldail'),
  ('هشام بياري','hbeyari'), ('هيفاء التركي','halturki'),
  ('وعد الشدي','walsheddi'), ('ياسر بخاري','ybukhari'),
  ('محمد الحميزي','malhumayzi'), ('نورة النصار','nnassar'),
  ('ناصر الشايع','nshaya'), ('حمد العويس','halowais'),
  ('سارة العيسى','saleissa'), ('ندى العمير','nalomair')
)
select w.display_name as "الاسم",
       coalesce(u.username, '— لا حساب —') as "اليوزر الحالي",
       w.uname as "سيصير",
       case when u.id is null then 'لا حساب — لن يتغيّر شيء'
            when u.username = w.uname then 'مطابق أصلاً'
            else 'سيتغيّر' end as "الأثر"
  from want w
  left join public.perf_users u
    on public.perf_norm_name(u.display_name) = public.perf_norm_name(w.display_name)
   and u.active
 order by 4, 1;

-- ------------------------------------------------------------
--  ٢) التنفيذ — يتوقّف بخطأ إن كان الاسم مأخوذاً من حساب آخر،
--     فلا يُكتب نصف تغيير
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
      ('وعد الشدي','walsheddi'), ('ياسر بخاري','ybukhari'),
      ('محمد الحميزي','malhumayzi'), ('نورة النصار','nnassar'),
      ('ناصر الشايع','nshaya'), ('حمد العويس','halowais'),
      ('سارة العيسى','saleissa'), ('ندى العمير','nalomair')
    ) as t(display_name, uname)
  loop
    select u.display_name into taken
      from public.perf_users u
     where u.username = public.perf_norm_user(r.uname)
       and public.perf_norm_name(u.display_name) <> public.perf_norm_name(r.display_name);
    if taken is not null then
      raise exception 'اسم الدخول % مأخوذ من %', r.uname, taken;
    end if;

    update public.perf_users
       set username = public.perf_norm_user(r.uname)
     where active
       and public.perf_norm_name(display_name) = public.perf_norm_name(r.display_name)
       and username <> public.perf_norm_user(r.uname);
  end loop;
end $$;

-- ------------------------------------------------------------
--  ٣) التحقق: كل الحسابات النشطة وأسماء دخولها
-- ------------------------------------------------------------
select display_name as "الاسم", username as "اسم الدخول",
       coalesce(job_title,'—') as "المسمّى"
  from public.perf_users where active order by username;
