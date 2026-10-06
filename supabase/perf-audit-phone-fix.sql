-- ============================================================
--  إصلاح: «malformed array literal» يمنع أول دخول
--  ------------------------------------------------------------
--  في Postgres، `text[] || 'نص'` ملتبسٌ حين يكون النصّ حرفيّاً بلا
--  نوع: تُرجّح القاعدة `array_cat` فتحاول قراءة «الجوال» **مصفوفةً**
--  فتفشل. وبقيّة الإضافات نجت لأن فيها عموداً أو دالّة فصار نوعها
--  `text` صراحةً — والثلاثة المجرّدة وحدها هي العطب.
--
--  وأثرُه أن **أوّل دخولٍ لا يكتمل**: تفعيل الحساب يكتب رقم الجوال
--  أوّل مرّة، فيتغيّر العمود، فينفجر المؤرّخ، فتُلغى المعاملة كلها
--  ويرى الموظف الخطأ. ولا علاقة له برقمه ولا باسمه.
--
--  idempotent وليس فيه حذف بيانات: يُعيد تعريف الدالّة وحدها،
--  والمؤرّخ يعود يسجّل «الجوال» و«القطاعات» و«الصورة» كما يسجّل غيرها.
-- ============================================================

create or replace function public.perf_users_audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_who text := public.perf_audit_who(); ch text[] := '{}';
        v_add text[]; v_rem text[]; v_first_pw boolean := false;
begin
  if TG_OP = 'INSERT' then
    insert into public.perf_audit(who, kind, what, place)
    values (v_who, 'حساب', 'أُنشئ الحساب', new.display_name);
    return new;
  end if;

  if TG_OP = 'DELETE' then
    insert into public.perf_audit(who, kind, what, place)
    values (v_who, 'حساب', 'حُذف الحساب', old.display_name);
    return old;
  end if;

  if new.display_name is distinct from old.display_name then
    ch := ch || ('الاسم: ' || old.display_name || ' ← ' || new.display_name); end if;
  if new.username is distinct from old.username then
    ch := ch || ('اسم الدخول: ' || coalesce(old.username,'—') || ' ← ' || coalesce(new.username,'—')); end if;
  if new.phone is distinct from old.phone then ch := ch || 'الجوال'::text; end if;
  if coalesce(new.job_title,'') is distinct from coalesce(old.job_title,'') then
    ch := ch || ('المسمّى: ' || coalesce(nullif(new.job_title,''),'—')); end if;
  if new.role is distinct from old.role then
    ch := ch || ('الدور: ' || old.role || ' ← ' || new.role); end if;
  if new.is_lead is distinct from old.is_lead then
    ch := ch || (case when new.is_lead then 'صار مدير قطاع' else 'لم يعد مدير قطاع' end); end if;
  if new.active is distinct from old.active then
    ch := ch || (case when new.active then 'أُعيد تفعيله' else 'أُوقف الحساب' end); end if;
  if new.sector_ids is distinct from old.sector_ids then ch := ch || 'القطاعات'::text; end if;
  if new.photo_url is distinct from old.photo_url then ch := ch || 'الصورة'::text; end if;

  if coalesce(new.pass_hash,'') is distinct from coalesce(old.pass_hash,'') then
    v_first_pw := coalesce(old.pass_hash,'') = '' and coalesce(new.pass_hash,'') <> '';
    ch := ch || (case
      when coalesce(old.pass_hash,'') = '' then 'ضُبطت كلمة المرور لأول مرة'
      when coalesce(new.pass_hash,'') = '' then 'أُعيد الحساب إلى «بانتظار التفعيل»'
      else 'غُيِّرت كلمة المرور' end);
  end if;

  if new.scopes is distinct from old.scopes then
    select array(select unnest(coalesce(new.scopes,'{}'))
                 except select unnest(coalesce(old.scopes,'{}'))) into v_add;
    select array(select unnest(coalesce(old.scopes,'{}'))
                 except select unnest(coalesce(new.scopes,'{}'))) into v_rem;
    if coalesce(array_length(v_add,1),0) > 0 then
      ch := ch || ('مُنح: ' || public.perf_few(v_add)); end if;
    if coalesce(array_length(v_rem,1),0) > 0 then
      ch := ch || ('سُحب: ' || public.perf_few(v_rem)); end if;
  end if;

  -- لم يتغيّر إلا وقت الدخول ⇒ لا يُسجَّل
  if coalesce(array_length(ch,1),0) = 0 then return new; end if;

  /* من فعّل حسابه بنفسه لا جلسة له بعدُ لحظةَ التعديل، فيُنسب إليه —
     وذلك حين تُضبط كلمة المرور أول مرة وحدها، لا في كل تعديل يقع
     على حسابٍ غير مفعَّل */
  if v_who = '— خارج المنصة' and v_first_pw then
    v_who := new.display_name;
  end if;

  insert into public.perf_audit(who, kind, what, place)
  values (v_who, 'حساب', array_to_string(ch, ' · '), new.display_name);
  return new;
end;
$$;

-- تحقّق: إضافةُ نصٍّ مجرّد إلى مصفوفة بعد الإصلاح
do $$ declare ch text[] := '{}';
begin
  ch := ch || 'الجوال'::text;
  ch := ch || 'القطاعات'::text;
  raise notice 'الإصلاح سليم: %', array_to_string(ch, ' · ');
end $$;
