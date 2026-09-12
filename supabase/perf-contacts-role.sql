-- ============================================================
--  نقطة التواصل: أساسي وبديل
--  ------------------------------------------------------------
--  ملف الجهات يحمل لكل طرف شخصين: الأساسي ومن ينوب عنه. وهذا هو
--  بيت القصيد عملياً — حين لا يردّ الأساسي يُطلب البديل بلا سؤال.
--
--  idempotent وليس فيه حذف بيانات. يُشغَّل بعد perf-entities.sql
-- ============================================================

alter table public.perf_contacts
  add column if not exists role text not null default 'أساسي';   -- أساسي · بديل

create index if not exists perf_contacts_role on public.perf_contacts (entity_id, side, role);

-- «جهاتي» تُرجع الطرفين بأدوارهما
drop function if exists public.perf_my_entities();
create or replace function public.perf_my_entities()
returns table (entity_id text, name text, kind text, sector text,
               my_contact_id text, my_role text, mine jsonb, theirs jsonb)
language sql stable security definer set search_path = public as $$
  select e.id, e.name, e.kind, e.sector, c.id,
         coalesce(nullif(c.note,''), c.job_title),
         coalesce((select jsonb_agg(jsonb_build_object(
                     'id', x.id, 'role', x.role, 'name', x.name, 'jobTitle', x.job_title,
                     'email', x.email, 'phone', x.phone)
                   order by (x.role <> 'أساسي'), x.name)
                     from public.perf_contacts x
                    where x.entity_id = e.id and x.side = 'نحن'), '[]'::jsonb),
         coalesce((select jsonb_agg(jsonb_build_object(
                     'id', x.id, 'role', x.role, 'name', x.name, 'jobTitle', x.job_title,
                     'email', x.email, 'phone', x.phone)
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

-- والبحث يُرجع الدور كذلك، فيظهر «بديل» في جواب المساعد
create or replace function public.perf_entities_find(p_q text, p_limit int default 8)
returns table (id text, name text, kind text, sector text,
               ours jsonb, theirs jsonb, hits int)
language sql stable security definer set search_path = public as $$
  with words as (
    select t from (select distinct unnest(string_to_array(public.perf_ar_norm(p_q), ' ')) as t) w
     where length(t) >= 3
       and t not in (public.perf_ar_norm('عندنا'), public.perf_ar_norm('هل'),
                     public.perf_ar_norm('نقطة'), public.perf_ar_norm('تواصل'),
                     public.perf_ar_norm('مع'), public.perf_ar_norm('احد'),
                     public.perf_ar_norm('من'), public.perf_ar_norm('في'))
  )
  select e.id, e.name, e.kind, e.sector,
         coalesce((select jsonb_agg(jsonb_build_object(
                     'role', c.role, 'name', c.name, 'jobTitle', c.job_title,
                     'email', c.email, 'phone', c.phone, 'note', c.note)
                   order by (c.role <> 'أساسي'), c.name)
                     from public.perf_contacts c
                    where c.entity_id = e.id and c.side = 'نحن'), '[]'::jsonb),
         coalesce((select jsonb_agg(jsonb_build_object(
                     'role', c.role, 'name', c.name, 'jobTitle', c.job_title,
                     'email', c.email, 'phone', c.phone, 'note', c.note)
                   order by (c.role <> 'أساسي'), c.name)
                     from public.perf_contacts c
                    where c.entity_id = e.id and c.side <> 'نحن'), '[]'::jsonb),
         (select count(*)::int from words x
           where e.name_n like '%' || x.t || '%'
              or exists (select 1 from public.perf_contacts c
                          where c.entity_id = e.id and c.name_n like '%' || x.t || '%')) as hits
    from public.perf_entities e
   where e.active and public.perf_signed_in()
     and (select count(*) from words x
           where e.name_n like '%' || x.t || '%'
              or exists (select 1 from public.perf_contacts c
                          where c.entity_id = e.id and c.name_n like '%' || x.t || '%')) > 0
   order by hits desc, e.name
   limit greatest(1, p_limit);
$$;
revoke all on function public.perf_entities_find(text, int) from public, anon;
grant execute on function public.perf_entities_find(text, int) to authenticated;

select 'role' as "العمود", 'أُضيف' as "الحالة";
