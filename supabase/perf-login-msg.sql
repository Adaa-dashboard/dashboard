-- ============================================================
--  رسائل الدخول تقول السبب الحقيقي
--  ------------------------------------------------------------
--  شاشة «أول دخول» تطابق الجوال كاملاً، وشاشة «نسيت كلمة المرور»
--  تطابق آخر أربعة أرقام. ومن له كلمة مرور أصلاً لا تنفعه شاشةُ
--  أول دخول — فكان يرى «اسم المستخدم أو رقم الجوال غير صحيح»
--  وهو لم يخطئ في جواله، فيظنّ العطل في رقمه ويعيد المحاولة.
--
--  تُرجع الدالة الآن سبباً لكل حالة:
--    has_password  له كلمة مرور — يدخل بها، أو يستعيدها بآخر ٤
--    no_phone      له كلمة مرور ولا جوال — الاستعادة متعذّرة
--    locked        الجوال المخزَّن ليس رقماً صالحاً
--    phone         ما أدخله ليس رقماً صالحاً
--    phone_taken   الرقم مسجَّل لحسابٍ آخر
--    short         كلمة المرور أقل من ٦
--
--  idempotent وليس فيه حذف بيانات.
-- ============================================================

-- عمود «تاريخ التفعيل» إن لم يكن موجوداً — حتى يصحّ الإسناد أدناه
alter table public.perf_users add column if not exists activated_at timestamptz;

create or replace function public.perf_activate(
  p_username text, p_phone text, p_last4 text, p_password text, p_sectors text[]
) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare u record; v_first boolean; v_ok boolean; v_phone text; v_stored text;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if length(coalesce(p_password,'')) < 6 then return jsonb_build_object('error','short'); end if;

  select * into u from public.perf_users
   where username = public.perf_norm_user(p_username) and active;
  if not found then return null; end if;

  v_first  := (u.pass_hash is null or u.pass_hash = '');
  v_phone  := public.perf_norm_phone(p_phone);
  v_stored := regexp_replace(coalesce(u.phone,''), '[^0-9]', '', 'g');

  -- جوالٌ مخزَّن ليس رقماً (أرقام عربية · ناقص): قفلٌ لا خطأ في المُدخَل
  if coalesce(u.phone,'') <> '' and length(v_stored) < 12 then
    return jsonb_build_object('error','locked');
  end if;

  if v_first and coalesce(u.phone,'') = '' then
    -- لا جوال مسجَّل: يكتبه صاحب الحساب الآن، بشرط ألّا يكون لغيره
    if length(v_phone) < 12 then return jsonb_build_object('error','phone'); end if;
    if exists (select 1 from public.perf_users x where x.phone = v_phone and x.id <> u.id) then
      return jsonb_build_object('error','phone_taken');
    end if;
    v_ok := true;
  elsif not v_first and coalesce(u.phone,'') = '' then
    return jsonb_build_object('error','no_phone');
  elsif not v_first and coalesce(p_last4,'') = '' then
    -- **الحالة الغائبة**: جاء من شاشة «أول دخول» وحسابُه مفعَّل
    return jsonb_build_object('error','has_password');
  else
    v_ok := case when v_first
              then v_phone = u.phone
              else length(coalesce(p_last4,'')) = 4 and right(u.phone, 4) = p_last4
            end;
  end if;
  if not v_ok then return null; end if;

  update public.perf_users
     set pass_hash = crypt(p_password, gen_salt('bf')),
         phone = case when v_first and coalesce(phone,'') = '' then v_phone else phone end,
         activated_at = case when v_first then now() else activated_at end,
         sector_ids = case
           when v_first and u.role = 'manager'
                and coalesce(array_length(sector_ids,1),0) = 0
                and coalesce(array_length(p_sectors,1),0) > 0
             then p_sectors else sector_ids end,
         last_login = now()
   where id = u.id
   returning * into u;

  insert into public.perf_sessions (user_id, app_user_id, username, display_name, role, sector_ids)
  values (auth.uid(), u.id, u.username, u.display_name, u.role, u.sector_ids)
  on conflict (user_id) do update
    set app_user_id = excluded.app_user_id, username = excluded.username,
        display_name = excluded.display_name, role = excluded.role,
        sector_ids = excluded.sector_ids, granted_at = now();

  return jsonb_build_object('id', u.id::text, 'username', u.username,
    'name', u.display_name, 'role', u.role, 'sectorIds', u.sector_ids);
end;
$$;
revoke all on function public.perf_activate(text,text,text,text,text[]) from public, anon;
grant execute on function public.perf_activate(text,text,text,text,text[]) to authenticated;
