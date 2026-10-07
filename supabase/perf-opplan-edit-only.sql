-- ============================================================
--  تعديل الخطة التشغيلية — لهؤلاء الأربعة وحدهم
--  ------------------------------------------------------------
--  سلطانة العرجاني · رؤى الحماد · عمر الظاهري · ندى العمير
--
--  يُشغَّل من SQL Editor في Supabase. idempotent: تشغيله مرّتين
--  كتشغيله مرّة.
--
--  الصلاحيتان:
--    opplan        فتح الصفحة وتنزيل ملفها   — تبقى للجميع
--    opplan:edit   إضافة البنود وتعديلها ورفع الإكسل — للأربعة فقط
--
--  **وهذا الملف يسحبها ممّن سواهم**، بخلاف `perf-opplan-grant.sql`
--  الذي يمنح ولا يسحب. وفي المنصة `admin` **لا يعني كل الصلاحيات**،
--  فالعضوية صريحة ولا تُستنتج من الدور.
-- ============================================================

-- ------------------------------------------------------------
--  ١) من يحرّرها الآن؟ (قبل أي تغيير)
-- ------------------------------------------------------------
select display_name as "الاسم", username as "الحساب", role as "الدور",
       case when scopes @> array['opplan:edit'] then '✓' else '—' end as "يحرّرها",
       active as "نشط"
  from public.perf_users
 where scopes @> array['opplan:edit']
 order by display_name;

-- ------------------------------------------------------------
--  ٢) الأربعة — الأسماء تُطابَق بعد تطبيع الهمزات والتاء المربوطة
--     والتشكيل والمسافات، فلا يُفوِّت الاختلافُ الإملائيُّ أحداً
-- ------------------------------------------------------------
create or replace function public.perf_nm(p text)
returns text language sql immutable as $$
  select regexp_replace(
           regexp_replace(translate(coalesce(p,''), 'أإآةىـٱ', 'اااهيا'),
                          '[ً-ْٰ]', '', 'g'),
           '\s+', ' ', 'g')
$$;

with want(name) as (
  values ('سلطانة العرجاني'), ('رؤى الحماد'), ('عمر الظاهري'), ('ندى العمير')
), hit as (
  select u.id
    from public.perf_users u
    join want w on public.perf_nm(u.display_name) = public.perf_nm(w.name)
)
update public.perf_users u
   set scopes = (select array(select distinct unnest(
         coalesce(u.scopes, '{}') || array['opplan','opplan:edit'])))
  from hit
 where u.id = hit.id
   and not (coalesce(u.scopes,'{}') @> array['opplan','opplan:edit']);

-- ------------------------------------------------------------
--  ٣) السحب ممّن سواهم — «بس» تعني بس
-- ------------------------------------------------------------
with want(name) as (
  values ('سلطانة العرجاني'), ('رؤى الحماد'), ('عمر الظاهري'), ('ندى العمير')
)
update public.perf_users u
   set scopes = array_remove(coalesce(u.scopes,'{}'), 'opplan:edit')
 where coalesce(u.scopes,'{}') @> array['opplan:edit']
   and not exists (select 1 from want w
                    where public.perf_nm(u.display_name) = public.perf_nm(w.name));

-- ------------------------------------------------------------
--  ٤) هل وُجد الأربعة؟ — الاسم الذي لم يُطابَق يظهر هنا، فيُصحَّح
--     إملاؤه أو يُضاف حسابه من «المستخدمون والصلاحيات»
-- ------------------------------------------------------------
with want(name) as (
  values ('سلطانة العرجاني'), ('رؤى الحماد'), ('عمر الظاهري'), ('ندى العمير')
)
select w.name as "الاسم المطلوب",
       coalesce((select u.display_name from public.perf_users u
                  where public.perf_nm(u.display_name) = public.perf_nm(w.name)
                  limit 1), '✗ لم يُعثر على حساب بهذا الاسم') as "الحساب في المنصة"
  from want w;

-- ------------------------------------------------------------
--  ٥) الحصيلة — يجب أن تكون أربعة أسطر لا غير
-- ------------------------------------------------------------
select display_name as "الاسم", username as "الحساب", active as "نشط"
  from public.perf_users
 where scopes @> array['opplan:edit']
 order by display_name;
