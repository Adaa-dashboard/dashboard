-- ============================================================
--  صلاحية رؤية «منهجيات أداء»
--  ------------------------------------------------------------
--  الحزمة السابقة منحت 'docs:edit' (الرفع والحذف) ونسيت
--  الصلاحية الأساسية 'docs' (رؤية الصفحة)، فاختفى بند
--  «منهجيات أداء» من القائمة عند الجميع — في اللابتوب والجوال معاً.
--  المكتبة مرجع مشترك، فالرؤية للجميع والرفع يبقى محصوراً.
-- ============================================================
update public.perf_users
   set scopes = (select array(select distinct unnest(coalesce(scopes,'{}') || array['docs'])))
 where active
   and not ('docs' = any(coalesce(scopes,'{}')));

-- من يملك الرفع يرى الصفحة بداهةً
update public.perf_users
   set scopes = (select array(select distinct unnest(coalesce(scopes,'{}') || array['docs'])))
 where 'docs:edit' = any(coalesce(scopes,'{}'))
   and not ('docs' = any(coalesce(scopes,'{}')));

select display_name as "الاسم",
       ('docs'      = any(scopes)) as "يرى المنهجيات",
       ('docs:edit' = any(scopes)) as "يرفع",
       ('entities'  = any(scopes)) as "يرى الجهات"
  from public.perf_users
 where active
 order by display_name;
