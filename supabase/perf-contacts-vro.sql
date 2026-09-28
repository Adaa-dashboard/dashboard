-- ============================================================
--  نقاط التواصل الثلاث: المركز · الجهة · مكتب تحقيق الرؤية
--  ------------------------------------------------------------
--  كان الطرفان اثنين فقط (`side`: «نحن» و«الجهة»)، ومنسوب مكتب
--  تحقيق الرؤية (VRO) يُسجَّل ضمن «الجهة» فيختلط بنقطة اتصالها.
--  وهو طرفٌ ثالث فعلاً: من المنظومة لا من الجهاز.
--
--  `side` عمود نصّي بلا قيدٍ، فلا يحتاج ترحيلاً — تكفي إعادةُ
--  «جهاتي» لتُرجع `side` مع كل نقطة، فتفرزها الواجهة ثلاثاً.
--  الصفوف القديمة تبقى «الجهة»، وتُنقل يدوياً من نافذة «جهاتي».
--
--  idempotent وليس فيه حذف بيانات. يُشغَّل بعد perf-contacts-role.sql
-- ============================================================

drop function if exists public.perf_my_entities();
create or replace function public.perf_my_entities()
returns table (entity_id text, name text, kind text, sector text,
               my_contact_id text, my_role text, mine jsonb, theirs jsonb)
language sql stable security definer set search_path = public as $$
  select e.id, e.name, e.kind, e.sector, c.id,
         coalesce(nullif(c.note,''), c.job_title),
         coalesce((select jsonb_agg(jsonb_build_object(
                     'id', x.id, 'side', x.side, 'role', x.role, 'name', x.name,
                     'jobTitle', x.job_title, 'email', x.email, 'phone', x.phone)
                   order by (x.role <> 'أساسي'), x.name)
                     from public.perf_contacts x
                    where x.entity_id = e.id and x.side = 'نحن'), '[]'::jsonb),
         coalesce((select jsonb_agg(jsonb_build_object(
                     'id', x.id, 'side', x.side, 'role', x.role, 'name', x.name,
                     'jobTitle', x.job_title, 'email', x.email, 'phone', x.phone)
                   order by (x.role <> 'أساسي'), x.name)
                     from public.perf_contacts x
                    where x.entity_id = e.id and x.side <> 'نحن'), '[]'::jsonb)
    from public.perf_contacts c
    join public.perf_entities e on e.id = c.entity_id and e.active
   where c.side = 'نحن' and c.user_id = public.perf_my_id()
   order by e.name;
$$;
revoke all on function public.perf_my_entities() from public, anon;
grant execute on function public.perf_my_entities() to authenticated;

select 'perf_my_entities' as "الدالة", 'تُرجع side الآن' as "الحالة";
