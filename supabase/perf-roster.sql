-- ============================================================
--  الهيكل التنظيمي — إدارة عمليات الأداء
--  يضيف/يحدّث أسماء الفريق في public.perf_users فيظهرون في صفحة «الهيكل».
--
--  ⚠️ إضافي بالكامل: لا يحذف حساباً ولا يمسّ كلمة مرور ولا صلاحيات
--     حساب قائم. آمن للتشغيل أكثر من مرة (idempotent).
--
--  الجوال يُترك «لم يُسجَّل» — وهي قيمة لا تطابق أي رقم يُكتب،
--  فلا يستطيع أحد تفعيل حسابه قبل أن تُدخلي رقمه من صفحة
--  «المستخدمون والصلاحيات». هذا مقصود.
-- ============================================================

-- ------------------------------------------------------------
--  ١) القطاعات الأربعة — تُضاف إن كانت ناقصة، ولا يُغيَّر اسم موجود
-- ------------------------------------------------------------
insert into public.perf_sectors (id, name, ord) values
  ('sec-infra',  'قطاع البنية التحتية',      1),
  ('sec-social', 'قطاع الخدمات الاجتماعية',  2),
  ('sec-econ',   'القطاع المالي',            3),
  ('sec-gov',    'قطاع الشؤون الحكومية',     4)
on conflict (id) do nothing;

-- اسم «القطاع المالي» المحفوظ سابقاً هو «قطاع المالي والاقتصادي».
-- لتغييره إلى التسمية المختصرة أزيلي علامتَي التعليق من السطر التالي:
-- update public.perf_sectors set name = 'القطاع المالي' where id = 'sec-econ';

-- ------------------------------------------------------------
--  ٢) موازنة كتابة الاسم قبل المطابقة
--     «سلطانة» و«سلطانه» اسم واحد — بدون هذا يُنشأ حساب مكرّر
-- ------------------------------------------------------------
create or replace function public.perf_norm_name(p text)
returns text language sql immutable as $$
  select regexp_replace(
           translate(btrim(coalesce(p, '')), 'أإآةىؤئ', 'اااهييي'),
           '\s+', '', 'g');
$$;

-- ------------------------------------------------------------
--  ٣) الأشخاص
--     الحساب القائم (بالمعرّف أو بالاسم) يُحدَّث قطاعه ومسمّاه فقط،
--     ويبقى له رمزه وصلاحياته ودوره كما هي.
--     الحساب الجديد يُنشأ بصلاحيات العرض الأساسية نفسها التي
--     يملكها بقية الفريق: نظرة عامة · تفاصيل · مهام · الأقسام الخمسة.
--     «المستخدمون والصلاحيات» و«التحرير» لا يُمنحان لأحد هنا.
-- ------------------------------------------------------------
do $$
declare r record; v_id bigint;
begin
  for r in
    select * from (values
      -- الإدارة (بلا قطاع ⇒ يظهران تحت رأس الهيكل مباشرة)
      ('alhazami',    'عبدالله الحزامي',  'مدير إدارة عمليات الأداء',      '{}'::text[],            true ),
      ('alshaya',     'ناصر الشايع',      'مساعد مدير إدارة عمليات الأداء','{}'::text[],            false),

      -- قطاع الشؤون الحكومية
      ('alateeq',     'عمر العتيق',       'مدير قطاع الشؤون الحكومية',     '{sec-gov}'::text[],     true ),
      ('alfawzan',    'عبدالاله الفوزان',  null,                           '{sec-gov}'::text[],     false),
      ('bayari',      'هشام بياري',        null,                           '{sec-gov}'::text[],     false),
      ('aldayel',     'مشاعل الدايل',      null,                           '{sec-gov}'::text[],     false),
      ('aldbaib',     'ثامر الضبيب',       null,                           '{sec-gov}'::text[],     false),
      ('alowais',     'حمد العويس',        null,                           '{sec-gov}'::text[],     false),
      ('alshedi',     'وعد الشدي',         null,                           '{sec-gov}'::text[],     false),
      ('albaker',     'عبدالله البكر',     null,                           '{sec-gov}'::text[],     false),
      ('sultana',     'سلطانه العرجاني',   null,                           '{sec-gov}'::text[],     false),
      ('alissa',      'سارة العيسى',       null,                           '{sec-gov}'::text[],     false),

      -- القطاع المالي
      ('alghannam',   'بدر الغنام',       'مدير القطاع المالي',            '{sec-econ}'::text[],    true ),
      ('alhammad',    'رؤى الحماد',        null,                           '{sec-econ}'::text[],    false),
      ('alqahtani',   'فاطمة القحطاني',    null,                           '{sec-econ}'::text[],    false),
      ('alsuhaibani', 'فارس السحيباني',    null,                           '{sec-econ}'::text[],    false),
      ('alkhathlan',  'خالد الخثلان',      null,                           '{sec-econ}'::text[],    false),

      -- قطاع الخدمات الاجتماعية
      ('alfahmi',     'دعاء الفهمي',      'مدير قطاع الخدمات الاجتماعية',  '{sec-social}'::text[],  true ),
      ('alrumaih',    'عبدالرحمن الرميح',  null,                           '{sec-social}'::text[],  false),
      ('aljarf',      'خالد الجرف',        null,                           '{sec-social}'::text[],  false),
      ('alturki',     'هيفاء التركي',      null,                           '{sec-social}'::text[],  false),

      -- قطاع البنية التحتية
      ('alhaqqas',    'معاذ الهقاص',      'مدير قطاع البنية التحتية',      '{sec-infra}'::text[],   true ),
      ('almubaddal',  'لمى المبدل',        null,                           '{sec-infra}'::text[],   false),
      ('alsukran',    'ريما السكران',      null,                           '{sec-infra}'::text[],   false),
      ('alomair',     'ندى العمير',        null,                           '{sec-infra}'::text[],   false),
      ('bukhari',     'ياسر بخاري',        null,                           '{sec-infra}'::text[],   false),
      ('aldhahri',    'عمر الظاهري',       null,                           '{sec-infra}'::text[],   false),
      ('binawn',      'عبدالعزيز بن عون',  null,                           '{sec-infra}'::text[],   false),
      ('alhumaizi',   'محمد الحميزي',      null,                           '{sec-infra}'::text[],   false),
      ('noura',       'نورة النصار',       null,                           '{sec-infra}'::text[],   false)
    ) as t(username, display_name, job_title, sector_ids, is_lead)
  loop
    -- المطابقة: اسم المستخدم أولاً، ثم الاسم المكتوب بعد موازنة الهمزات والتاء
    select id into v_id
      from public.perf_users
     where username = public.perf_norm_user(r.username)
        or public.perf_norm_name(display_name) = public.perf_norm_name(r.display_name)
     order by (username = public.perf_norm_user(r.username)) desc, id
     limit 1;

    if v_id is null then
      insert into public.perf_users
        (username, display_name, phone, pass_hash, role, sector_ids, active, scopes, is_lead, job_title)
      values
        (public.perf_norm_user(r.username), r.display_name, 'لم يُسجَّل', null, 'manager',
         r.sector_ids, true,
         array['overview','details','tasks',
               'sessions','natstrat','inststrat','outputs','projects'],
         r.is_lead, r.job_title);
    else
      update public.perf_users set
        display_name = r.display_name,
        sector_ids   = r.sector_ids,
        is_lead      = r.is_lead,
        active       = true,
        job_title    = coalesce(r.job_title, job_title)   -- لا يمسح مسمّى مكتوباً
      where id = v_id;
    end if;
  end loop;
end $$;

-- ------------------------------------------------------------
--  ٤) مدير القطاع يحتاج صلاحية المستهدفات — تُضاف ولا تُسحب من أحد
-- ------------------------------------------------------------
update public.perf_users
   set scopes = scopes || array['targets']
 where is_lead and not (scopes @> array['targets']);

-- ------------------------------------------------------------
--  ٥) المراجعة: هكذا سيظهر الهيكل
-- ------------------------------------------------------------
select coalesce(s.name, 'الإدارة (بلا قطاع)') as "القطاع",
       u.display_name as "الاسم",
       coalesce(u.job_title, '') as "المسمّى",
       u.is_lead as "مدير قطاع",
       u.username as "اسم المستخدم",
       (u.pass_hash is not null) as "مُفعَّل"
  from public.perf_users u
  left join public.perf_sectors s on s.id = u.sector_ids[1]
 where u.active
 order by coalesce(s.ord, 0), u.is_lead desc, u.display_name;
