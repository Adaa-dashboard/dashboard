-- ============================================================
--  لا يُهمل عمود + مراجعة ربعية لسجلّ الجهات
--  ------------------------------------------------------------
--  ١) الملف قد يحمل أعمدة لم تخطر ببالي (رقم الاتفاقية · تاريخ
--     التعميد · نوع الشراكة …). إهمالُها يعني ضياع معلومة دخلت
--     المنصة، فتُحفظ كما هي في extra وتُعرض في الصفحة. ومتى تبيّن
--     أن عموداً يستحق حقلاً خاصاً رُقّي إليه.
--
--  ٢) السجلّ يشيخ بلا مراجعة: الأشخاص ينتقلون وأرقامهم تتغيّر.
--     فلكل نقطة تواصل «آخر مراجعة»، ويُنبَّه الاستشاري كل ربع
--     حتى يؤكّد أو يصحّح. والتنبيه يزول بالتأكيد لا بالتجاهل.
--
--  idempotent وليس فيه حذف بيانات.
-- ============================================================

alter table public.perf_entities add column if not exists extra jsonb not null default '{}'::jsonb;
alter table public.perf_contacts add column if not exists extra jsonb not null default '{}'::jsonb;
alter table public.perf_contacts add column if not exists reviewed_at timestamptz;

/** الربع الحالي — «2026-Q3» */
create or replace function public.perf_quarter(p timestamptz default now())
returns text language sql immutable as $$
  select to_char(p, 'YYYY') || '-Q' || ceil(extract(month from p) / 3.0)::int;
$$;

/** جهاتي التي لم تُراجَع هذا الربع */
create or replace function public.perf_review_due()
returns table (entity_id text, entity text, contact_id text, reviewed_at timestamptz)
language sql stable security definer set search_path = public as $$
  select e.id, e.name, c.id, c.reviewed_at
    from public.perf_contacts c
    join public.perf_entities e on e.id = c.entity_id and e.active
   where c.side = 'نحن' and c.user_id = public.perf_my_id()
     and (c.reviewed_at is null
          or public.perf_quarter(c.reviewed_at) <> public.perf_quarter())
   order by e.name;
$$;
revoke all on function public.perf_review_due() from public, anon;
grant execute on function public.perf_review_due() to authenticated;

/** «راجعتُ بياناتي» — تُختم جهاتي كلها أو جهةٌ بعينها */
create or replace function public.perf_review_done(p_entity text default null)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.perf_contacts
     set reviewed_at = now()
   where side = 'نحن' and user_id = public.perf_my_id()
     and (p_entity is null or entity_id = p_entity);
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.perf_review_done(text) from public, anon;
grant execute on function public.perf_review_done(text) to authenticated;

/** من راجع ومن لم يراجع هذا الربع — لمن يملك «الجهات» */
create or replace function public.perf_review_status()
returns table (name text, entities int, reviewed int, last_at timestamptz)
language sql stable security definer set search_path = public as $$
  select u.display_name, count(*)::int,
         count(*) filter (where public.perf_quarter(c.reviewed_at) = public.perf_quarter())::int,
         max(c.reviewed_at)
    from public.perf_contacts c
    join public.perf_users u on u.id = c.user_id
   where c.side = 'نحن' and u.active and public.perf_has_scope('entities:edit')
   group by u.display_name
   order by 3, 1;
$$;
revoke all on function public.perf_review_status() from public, anon;
grant execute on function public.perf_review_status() to authenticated;

select public.perf_quarter() as "الربع الحالي";
