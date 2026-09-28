-- ============================================================
--  مشاركة الجهة: الأساسي يفتحها لبديله
--  ------------------------------------------------------------
--  التحرير كان مقصوراً على نقطة التواصل **الأساسية**، فالبديل يرى
--  الجهة في «جهاتي» ولا يجدها في أعماله الرئيسية ولا يعرف لماذا.
--
--  الآن: الأساسي يقرّر. يفتحها لبديله «اطّلاع فقط» أو «اطّلاع
--  وتعديل»، ويسحبها متى شاء. والقرار قرارُه وحده — لا المدير ولا
--  البديل نفسه.
--
--  الحارس في القاعدة لا في الواجهة: `perf_my_entity_names()` هي
--  التي تقول ما أملك تحريره، و`perf_item_mine()` تسأل عنها قبل أي
--  كتابة. فمستوى «اطّلاع فقط» لا يكتب شيئاً ولو زُوّرت الواجهة.
--
--  idempotent وليس فيه حذف بيانات. يُشغَّل بعد perf-contacts-vro.sql
-- ============================================================

create table if not exists public.perf_entity_shares (
  entity_id  text   not null references public.perf_entities(id) on delete cascade,
  grantee_id bigint not null references public.perf_users(id)    on delete cascade,
  level      text   not null default 'view' check (level in ('view', 'edit')),
  by_id      bigint,
  created_at timestamptz not null default now(),
  primary key (entity_id, grantee_id)
);
create index if not exists perf_entity_shares_grantee on public.perf_entity_shares (grantee_id);
alter table public.perf_entity_shares enable row level security;

/* هل أنا نقطة التواصل الأساسية لهذه الجهة؟ — داخل دالة، لأن ما في
   جسم السياسة يجري بصلاحية السائل و`authenticated` لا يقرأ الجداول */
create or replace function public.perf_entity_primary(p_entity text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.perf_contacts c
     where c.entity_id = p_entity and c.side = 'نحن'
       and c.role = 'أساسي' and c.user_id = public.perf_my_id()
  );
$$;
revoke all on function public.perf_entity_primary(text) from public, anon;
grant execute on function public.perf_entity_primary(text) to authenticated;

/* القراءة: صاحبُ المنح ومن مُنح له. الكتابة: الأساسي وحده —
   وكلّها تمرّ أصلاً بدالتَي الإدارة أدناه */
drop policy if exists "perf_esh_read" on public.perf_entity_shares;
create policy "perf_esh_read" on public.perf_entity_shares
  for select to authenticated
  using (grantee_id = public.perf_my_id() or public.perf_entity_primary(entity_id));

drop policy if exists "perf_esh_write" on public.perf_entity_shares;
create policy "perf_esh_write" on public.perf_entity_shares
  for all to authenticated
  using (public.perf_entity_primary(entity_id))
  with check (public.perf_entity_primary(entity_id));

-- ------------------------------------------------------------
--  ما أملك تحريره: جهاتي بدور «أساسي» + ما شورِك معي بمستوى edit
-- ------------------------------------------------------------
create or replace function public.perf_my_entity_names()
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct n), '{}') from (
    select public.perf_ar_norm(e.name) as n
      from public.perf_contacts c
      join public.perf_entities e on e.id = c.entity_id and e.active
     where c.side = 'نحن' and c.role = 'أساسي' and c.user_id = public.perf_my_id()
    union
    select public.perf_ar_norm(e.name)
      from public.perf_entity_shares s
      join public.perf_entities e on e.id = s.entity_id and e.active
     where s.grantee_id = public.perf_my_id() and s.level = 'edit'
  ) q;
$$;
revoke all on function public.perf_my_entity_names() from public, anon;
grant execute on function public.perf_my_entity_names() to authenticated;

-- ------------------------------------------------------------
--  «جهاتي» تُرجع مستواي في كل جهة، ومعرّفات نقاط المركز، ومن
--  شورِكت معهم — فتعرض الواجهة ما يُحرَّر وما يُقرأ وما يُمنح
-- ------------------------------------------------------------
drop function if exists public.perf_my_entities();
create or replace function public.perf_my_entities()
returns table (entity_id text, name text, kind text, sector text,
               my_contact_id text, my_role text, my_level text,
               mine jsonb, theirs jsonb, shares jsonb)
language sql stable security definer set search_path = public as $$
  select e.id, e.name, e.kind, e.sector, c.id,
         coalesce(nullif(c.note,''), c.job_title),
         case when c.role = 'أساسي' then 'primary'
              else coalesce((select s.level from public.perf_entity_shares s
                              where s.entity_id = e.id and s.grantee_id = public.perf_my_id()),
                            'none') end,
         coalesce((select jsonb_agg(jsonb_build_object(
                     'id', x.id, 'userId', x.user_id, 'side', x.side, 'role', x.role,
                     'name', x.name, 'jobTitle', x.job_title, 'email', x.email, 'phone', x.phone)
                   order by (x.role <> 'أساسي'), x.name)
                     from public.perf_contacts x
                    where x.entity_id = e.id and x.side = 'نحن'), '[]'::jsonb),
         coalesce((select jsonb_agg(jsonb_build_object(
                     'id', x.id, 'side', x.side, 'role', x.role, 'name', x.name,
                     'jobTitle', x.job_title, 'email', x.email, 'phone', x.phone)
                   order by (x.role <> 'أساسي'), x.name)
                     from public.perf_contacts x
                    where x.entity_id = e.id and x.side <> 'نحن'), '[]'::jsonb),
         coalesce((select jsonb_agg(jsonb_build_object('userId', s.grantee_id, 'level', s.level))
                     from public.perf_entity_shares s
                    where s.entity_id = e.id), '[]'::jsonb)
    from public.perf_contacts c
    join public.perf_entities e on e.id = c.entity_id and e.active
   where c.side = 'نحن' and c.user_id = public.perf_my_id()
   order by e.name;
$$;
revoke all on function public.perf_my_entities() from public, anon;
grant execute on function public.perf_my_entities() to authenticated;

-- ------------------------------------------------------------
--  منحُ المشاركة وسحبها — للأساسي وحده، و'none' تسحبها
-- ------------------------------------------------------------
create or replace function public.perf_entity_share_set(
  p_entity text, p_user bigint, p_level text
) returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not public.perf_entity_primary(p_entity) then
    raise exception 'المشاركة لنقطة التواصل الأساسية لهذه الجهة وحدها';
  end if;
  if p_user = public.perf_my_id() then
    raise exception 'لا تُشارك جهتك مع نفسك';
  end if;
  /* لا تُمنح إلا لمن هو نقطة تواصلٍ من المركز على الجهة نفسها —
     المشاركة توسيعُ دورٍ قائم لا إسنادٌ جديد */
  if not exists (select 1 from public.perf_contacts c
                  where c.entity_id = p_entity and c.side = 'نحن' and c.user_id = p_user) then
    raise exception 'هذا الشخص ليس نقطة تواصل من المركز على هذه الجهة';
  end if;

  if coalesce(p_level, 'none') = 'none' then
    delete from public.perf_entity_shares where entity_id = p_entity and grantee_id = p_user;
    return true;
  end if;
  if p_level not in ('view', 'edit') then
    raise exception 'مستوى غير معروف: %', p_level;
  end if;

  insert into public.perf_entity_shares (entity_id, grantee_id, level, by_id)
  values (p_entity, p_user, p_level, public.perf_my_id())
  on conflict (entity_id, grantee_id)
    do update set level = excluded.level, by_id = excluded.by_id, created_at = now();
  return true;
end;
$$;
revoke all on function public.perf_entity_share_set(text, bigint, text) from public, anon;
grant execute on function public.perf_entity_share_set(text, bigint, text) to authenticated;

select 'perf_entity_shares' as "الجدول", 'جاهز' as "الحالة";
