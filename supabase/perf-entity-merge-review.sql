-- ============================================================
--  دمج الجهات المكرّرة + المراجعة الربعية لكل جهة
--  ------------------------------------------------------------
--  ١) الرفع يطابق الجهة **بنصّ اسمها حرفياً**، فالجهة الواحدة
--     تُكتب مرتين بصيغتين («المؤسسة العامة للحبوب» و«اللجنة
--     المتخصصة – المؤسسة العامة للحبوب») فتصير جهتين في السجلّ،
--     ونقاط تواصلها موزّعة بينهما.
--
--     الحل شقّان: كشفُ المكرّر، ودمجُه. والدمج **لا يحذف**:
--     الاسم المهجور يصير اسماً بديلاً للباقية، فبنودُ الأقسام
--     التي تشير إليه تظلّ تُطابَق — ولذلك وُسِّعت
--     `perf_my_entity_names()` لتشمل الأسماء البديلة.
--
--  ٢) المراجعة الربعية موجودة وتُصفَّر مع كل ربع أصلاً
--     (`reviewed_at` يُقارَن بربع اليوم). الناقص أن يرى صاحبُ
--     صلاحية «الجهات» **أيَّ الجهات** لم تُراجَع، لا عدداً مجرّداً.
--
--  idempotent وليس فيه حذف بيانات (عدا نقطةَ تواصلٍ مكرّرة
--  حرفياً على الجهتين وقت الدمج). يُشغَّل بعد perf-entity-share.sql
-- ============================================================

-- ------------------------------------------------------------
--  ١) كشف المكرّر
-- ------------------------------------------------------------
/* حالتان: الاسم نفسه بعد التطبيع (فرقُ همزةٍ أو مسافة)، أو اسمٌ
   يحتوي الآخر كاملاً. والمقترَح إبقاءُ **الأقصر**: هو الاسم
   المعتمد في الملف غالباً، والأطول زيادةٌ لاحقة. والقرار للمستخدم
   في كل الأحوال — الدالة تقترح ولا تُنفّذ. */
create or replace function public.perf_entity_dups()
returns table (keep_id text, keep_name text, drop_id text, drop_name text, why text)
language sql stable security definer set search_path = public as $$
  select a.id, a.name, b.id, b.name, 'الاسم نفسه بعد التطبيع'
    from public.perf_entities a
    join public.perf_entities b
      on a.name_n = b.name_n and a.id < b.id
   where a.active and b.active and public.perf_has_scope('entities:edit')
  union all
  select b.id, b.name, a.id, a.name, 'اسمٌ يحتوي الآخر'
    from public.perf_entities a
    join public.perf_entities b
      on a.name_n <> b.name_n
     and length(b.name_n) >= 8
     and a.name_n like '%' || b.name_n || '%'
   where a.active and b.active and public.perf_has_scope('entities:edit')
   order by 2, 4;
$$;
revoke all on function public.perf_entity_dups() from public, anon;
grant execute on function public.perf_entity_dups() to authenticated;

/* الدمج: نقاط التواصل والمشاركات تنتقل، والاسم المهجور يصير
   اسماً بديلاً، والجهة المهجورة تُعطَّل ولا تُحذف. */
create or replace function public.perf_entity_merge(p_keep text, p_drop text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_moved int := 0; v_dup int := 0; v_keep_name text; v_drop_name text;
begin
  if not public.perf_has_scope('entities:edit') then
    raise exception 'الدمج لمن يملك صلاحية «الجهات»';
  end if;
  if p_keep = p_drop then raise exception 'لا تُدمج الجهة في نفسها'; end if;
  select name into v_keep_name from public.perf_entities where id = p_keep;
  select name into v_drop_name from public.perf_entities where id = p_drop;
  if v_keep_name is null or v_drop_name is null then raise exception 'جهة غير موجودة'; end if;

  -- نقطةٌ مكرّرة حرفياً على الطرف نفسه تُحذف بدل أن تُنقل فتتكرّر
  delete from public.perf_contacts d
   where d.entity_id = p_drop
     and exists (select 1 from public.perf_contacts k
                  where k.entity_id = p_keep and k.side = d.side
                    and public.perf_ar_norm(k.name) = public.perf_ar_norm(d.name));
  get diagnostics v_dup = row_count;

  update public.perf_contacts set entity_id = p_keep where entity_id = p_drop;
  get diagnostics v_moved = row_count;

  -- المشاركات إن كان جدولها منصَّباً
  if to_regclass('public.perf_entity_shares') is not null then
    delete from public.perf_entity_shares d
     where d.entity_id = p_drop
       and exists (select 1 from public.perf_entity_shares k
                    where k.entity_id = p_keep and k.grantee_id = d.grantee_id);
    update public.perf_entity_shares set entity_id = p_keep where entity_id = p_drop;
  end if;

  -- الاسم المهجور وأسماؤه البديلة تنضمّ إلى الباقية
  update public.perf_entities t
     set aliases = coalesce((
           select array_agg(distinct x)
             from unnest(t.aliases || array[v_drop_name]
                         || coalesce((select aliases from public.perf_entities where id = p_drop), '{}'::text[])) x
            where coalesce(btrim(x), '') <> ''
              and public.perf_ar_norm(x) <> t.name_n
         ), '{}'::text[])
   where t.id = p_keep;

  update public.perf_entities set active = false where id = p_drop;
  return jsonb_build_object('moved', v_moved, 'dropped', v_dup,
                            'keep', v_keep_name, 'merged', v_drop_name);
end;
$$;
revoke all on function public.perf_entity_merge(text, text) from public, anon;
grant execute on function public.perf_entity_merge(text, text) to authenticated;

-- ------------------------------------------------------------
--  أسماء جهاتي تشمل الأسماء البديلة — وإلا ضاعت بنودُ الاسم
--  المهجور من محفظة صاحبها بعد الدمج
-- ------------------------------------------------------------
create or replace function public.perf_my_entity_names()
returns text[] language sql stable security definer set search_path = public as $$
  with mine as (
    select e.id, e.name, e.aliases
      from public.perf_contacts c
      join public.perf_entities e on e.id = c.entity_id and e.active
     where c.side = 'نحن' and c.role = 'أساسي' and c.user_id = public.perf_my_id()
    union
    select e.id, e.name, e.aliases
      from public.perf_entity_shares s
      join public.perf_entities e on e.id = s.entity_id and e.active
     where s.grantee_id = public.perf_my_id() and s.level = 'edit'
  )
  select coalesce(array_agg(distinct n), '{}') from (
    select public.perf_ar_norm(name) as n from mine
    union
    select public.perf_ar_norm(a) from mine, unnest(aliases) a
     where coalesce(btrim(a), '') <> ''
  ) q;
$$;
revoke all on function public.perf_my_entity_names() from public, anon;
grant execute on function public.perf_my_entity_names() to authenticated;

-- ------------------------------------------------------------
--  ٢) المراجعة الربعية: أيُّ الجهات لم تُراجَع، لا عددُها فقط
-- ------------------------------------------------------------
/* الربع الحالي، والمستحقّ عليّ، وختمُه — تُعاد هنا فيكون الملف
   مكتفياً بنفسه ولو لم يُشغَّل perf-entities-extra.sql */
alter table public.perf_contacts add column if not exists reviewed_at timestamptz;

create or replace function public.perf_quarter(p timestamptz default now())
returns text language sql immutable as $$
  select to_char(p, 'YYYY') || '-Q' || ceil(extract(month from p) / 3.0)::int;
$$;

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

create or replace function public.perf_review_pending()
returns table (person text, entity_id text, entity text, reviewed_at timestamptz)
language sql stable security definer set search_path = public as $$
  select u.display_name, e.id, e.name, c.reviewed_at
    from public.perf_contacts c
    join public.perf_entities e on e.id = c.entity_id and e.active
    join public.perf_users  u on u.id = c.user_id and u.active
   where c.side = 'نحن' and public.perf_has_scope('entities:edit')
     and (c.reviewed_at is null
          or public.perf_quarter(c.reviewed_at) <> public.perf_quarter())
   order by u.display_name, e.name;
$$;
revoke all on function public.perf_review_pending() from public, anon;
grant execute on function public.perf_review_pending() to authenticated;

select public.perf_quarter() as "الربع الحالي", 'جاهز' as "الحالة";
