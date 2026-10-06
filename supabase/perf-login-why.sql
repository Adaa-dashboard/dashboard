-- ============================================================
--  لماذا لا يُكمل الموظفُ الجديد أول دخول؟ — تشخيصٌ يقرأ ولا يغيّر
--  ------------------------------------------------------------
--  يُشغَّل من SQL Editor. **اكتب الاسم والجوال في السطر الأول فقط**،
--  ثم شغّل الملف كلّه. يُحاكي ما تفعله دالّة الدخول حرفاً بحرف
--  ويقول أين تتوقّف.
-- ============================================================

with q(username, typed_phone) as (
  values ('ضع_اسم_المستخدم', 'ضع_الجوال_كما_كتبه')   -- ← غيّر هذين وحدهما
), u as (
  select q.username as typed_user, q.typed_phone,
         x.id, x.display_name, x.username, x.active, x.phone,
         coalesce(x.pass_hash,'') <> '' as has_pw
    from q left join public.perf_users x
      on x.username = public.perf_norm_user(q.username)
)
select
  typed_user                                   as "ما كُتب في الاسم",
  coalesce(display_name, '— لا حساب بهذا الاسم —') as "الحساب الموجود",
  public.perf_norm_phone(typed_phone)           as "الجوال بعد التوحيد",
  coalesce(nullif(phone,''), '— فارغ —')        as "الجوال المخزَّن",
  case
    when id is null
      then '✗ لا حساب بهذا الاسم — راجعي اسم المستخدم في «المستخدمون والصلاحيات»'
    when not active
      then '✗ الحساب موقوف — فعّليه'
    when coalesce(phone,'') <> '' and length(regexp_replace(phone,'[^0-9]','','g')) < 12
      then '✗ الجوال المخزَّن ليس رقماً صالحاً — صحّحيه'
    when has_pw
      then '✗ له كلمة مرور بالفعل: يدخل من شاشة الدخول العادية، أو «نسيت كلمة المرور» بآخر ٤ أرقام'
    when coalesce(phone,'') = '' and length(public.perf_norm_phone(typed_phone)) < 12
      then '✗ لا جوال مخزَّن، والمكتوب ليس رقماً صالحاً — يكتبه كاملاً بصيغة صفر خمسة…'
    when coalesce(phone,'') = ''
      then '✓ لا جوال مخزَّن: سيُسجَّل ما يكتبه الآن ويكمل الدخول'
    when public.perf_norm_phone(typed_phone) = phone
      then '✓ الجوال مطابق — أول دخول يُفترض أن ينجح'
    else '✗ الجوال لا يطابق المخزَّن. صحّحي المخزَّن، أو اتركي خانة الجوال فارغة ليكتبه هو'
  end                                           as "التشخيص"
  from u;

-- ------------------------------------------------------------
--  نسخٌ مكرّرة من دوال الدخول — وجودُ أكثر من نسخة بنفس الاسم
--  يجعل القاعدة تنادي القديمة أحياناً، فيختلف السلوك بلا سبب ظاهر
-- ------------------------------------------------------------
select p.proname as "الدالة",
       pg_get_function_identity_arguments(p.oid) as "وسائطها"
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('perf_activate','perf_save_user','perf_norm_phone')
 order by p.proname, "وسائطها";

-- ------------------------------------------------------------
--  آخر الحسابات المضافة وحالتها
-- ------------------------------------------------------------
select display_name as "الاسم", username as "الحساب",
       case when coalesce(phone,'') = '' then '— فارغ —'
            else '…' || right(regexp_replace(phone,'[^0-9]','','g'),4) end as "آخر ٤",
       length(regexp_replace(coalesce(phone,''),'[^0-9]','','g')) as "عدد الأرقام",
       case when coalesce(pass_hash,'') <> '' then '✓' else '—' end as "له كلمة مرور",
       case when active then '✓' else '—' end as "نشط"
  from public.perf_users
 order by id desc
 limit 12;
