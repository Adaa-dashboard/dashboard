-- ============================================================
--  صلاحية الخطة التشغيلية — من يملكها، ومنحُها لأربعة
--  ------------------------------------------------------------
--  يُشغَّل من SQL Editor في Supabase. idempotent: تشغيله مرّتين
--  كتشغيله مرّة، ولا يحذف أي صلاحية أخرى يملكها الحساب.
--
--  الصلاحيتان:
--    opplan        فتح صفحة «الخطة التشغيلية» وتنزيل ملفها
--    opplan:edit   تعديل البنود ورفع ملف إكسل عليها
--  وفي المنصة: `admin` **لا يعني كل الصلاحيات** — العضوية صريحة.
-- ============================================================

-- ------------------------------------------------------------
--  ١) من يملكها الآن؟  (قبل أي تغيير)
-- ------------------------------------------------------------
select display_name          as "الاسم",
       username              as "الحساب",
       role                  as "الدور",
       case when scopes @> array['opplan']      then '✓' else '—' end as "يفتح الخطة",
       case when scopes @> array['opplan:edit'] then '✓' else '—' end as "يحرّرها",
       active                as "نشط"
  from public.perf_users
 order by (scopes @> array['opplan:edit']) desc, (scopes @> array['opplan']) desc, display_name;

-- ------------------------------------------------------------
--  ٢) المنح — الأسماء تُطابَق بعد تطبيع الهمزات والتاء المربوطة
--     والتشكيل، فلا يُفوِّت الاختلافُ الإملائيُّ أحداً
-- ------------------------------------------------------------
with norm as (
  select id, display_name,
         regexp_replace(
           translate(display_name, 'أإآةىـٱ', 'اااهيا'),
           '[ً-ْٰ]', '', 'g') as n
    from public.perf_users
), want(name) as (
  values ('سلطانة العرجاني'), ('رؤى الحماد'), ('عمر الظاهري'), ('ندى العمير')
), hit as (
  select distinct w.name, x.id, x.display_name
    from want w
    join norm x
      on regexp_replace(
           regexp_replace(translate(w.name, 'أإآةىـٱ', 'اااهيا'),
                          '[ً-ْٰ]', '', 'g'),
           '\s+', ' ', 'g') = regexp_replace(x.n, '\s+', ' ', 'g')
)
update public.perf_users u
   set scopes = (select array(select distinct unnest(
         coalesce(u.scopes, '{}') || array['opplan','opplan:edit'])))
  from hit
 where u.id = hit.id;

-- ------------------------------------------------------------
--  ٣) هل وُجد الأربعة؟ — الاسم الذي لم يُطابَق يظهر هنا، فيُصحَّح
--     إملاؤه أو يُضاف حسابه من «المستخدمون والصلاحيات»
-- ------------------------------------------------------------
with norm as (
  select display_name,
         regexp_replace(
           regexp_replace(translate(display_name, 'أإآةىـٱ', 'اااهيا'),
                          '[ً-ْٰ]', '', 'g'),
           '\s+', ' ', 'g') as n
    from public.perf_users
), want(name) as (
  values ('سلطانة العرجاني'), ('رؤى الحماد'), ('عمر الظاهري'), ('ندى العمير')
)
select w.name as "الاسم المطلوب",
       coalesce((select x.display_name from norm x
                  where x.n = regexp_replace(
                          regexp_replace(translate(w.name, 'أإآةىـٱ', 'اااهيا'),
                                         '[ً-ْٰ]', '', 'g'),
                          '\s+', ' ', 'g')
                  limit 1), '✗ لم يُعثر على حساب بهذا الاسم') as "الحساب في المنصة"
  from want w;

-- ------------------------------------------------------------
--  ٤) الحصيلة بعد المنح
-- ------------------------------------------------------------
select display_name as "الاسم",
       case when scopes @> array['opplan']      then '✓' else '—' end as "يفتح الخطة",
       case when scopes @> array['opplan:edit'] then '✓' else '—' end as "يحرّرها"
  from public.perf_users
 where scopes @> array['opplan']
 order by display_name;
