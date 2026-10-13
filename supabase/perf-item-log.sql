-- ============================================================
--  سجلّ تغييرات بنود الأقسام — منه يُبنى «الإنجاز الأسبوعي»
--  ------------------------------------------------------------
--  يُشغَّل من SQL Editor مرّة واحدة. idempotent، وليس فيه حذف بيانات.
--
--  المنصة كانت تحفظ **الحالة الآن** فقط: `perf_items.updated_at`
--  يقول إنّ أحداً عدّل البند، ولا يقول ما الذي تغيّر — فتصحيحُ
--  حرفٍ وتفعيلُ قياس جهةٍ سواء. وبهذا يستحيل اشتقاق منجزٍ من
--  التعديل.
--
--  هذا الملف يضيف جدولاً وtrigger يلتقطان **الحقل المتغيّر وقيمته
--  قبل وبعد** ومن غيّره ومتى. والواجهة تقرأ تغييرات الأسبوع
--  وتترجم ما يستحقّ منها إلى منجزات بقواعد مكتوبة في الكود —
--  فالتعديل الذي لا يعني شيئاً (اسمٌ صُحِّح) يبقى في السجلّ ولا
--  يظهر في التقرير.
--
--  **يبدأ من يوم تشغيله**: ما تغيّر قبله لا يعرفه أحد.
-- ============================================================

create table if not exists public.perf_item_log (
  id       bigserial primary key,
  at       timestamptz not null default now(),
  section  text not null,
  item_id  text not null,
  /* اسم البند وقت التغيير — فالسجلّ يُقرأ ولو حُذف البند بعده */
  name     text,
  field    text not null,
  old_val  text,
  new_val  text,
  by_name  text
);

create index if not exists perf_item_log_at on public.perf_item_log (at desc);
create index if not exists perf_item_log_sec on public.perf_item_log (section, at desc);

alter table public.perf_item_log enable row level security;
grant select on public.perf_item_log to authenticated;
revoke insert, update, delete on public.perf_item_log from authenticated;

/* القراءة لكل من دخل المنصة — كقراءة بنود الأقسام نفسها.
   والكتابة من الـtrigger وحده (security definer)، فلا يستطيع
   أحدٌ تزوير منجزٍ من الواجهة. */
drop policy if exists "perf_item_log_read" on public.perf_item_log;
create policy "perf_item_log_read" on public.perf_item_log
  for select to authenticated using (public.perf_signed_in());

/* اسم البند: أول ما يوجد من اسمٍ أو جهةٍ أو مالك */
create or replace function public.perf_item_name(d jsonb)
returns text language sql immutable as $$
  select coalesce(nullif(d->>'name',''), nullif(d->>'entity',''),
                  nullif(d->>'owner',''), nullif(d->>'title',''))
$$;

/* الحقول التي لا معنى لتسجيلها: محسوبةٌ أو تقنيةٌ بحتة */
create or replace function public.perf_item_skip(k text)
returns boolean language sql immutable as $$
  select k in ('stat','days','updated','updatedAt','ord','_t')
$$;

create or replace function public.perf_item_log_tg()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  k     text;
  ov    text;
  nv    text;
  nm    text;
  who   text;
begin
  nm  := coalesce(public.perf_item_name(new.data), new.id);
  who := nullif(new.updated_by, '');

  if (tg_op = 'INSERT') then
    /* البند الجديد سطرٌ واحد لا سطرٌ لكل حقل — وإلا أغرق أولُ
       رفعٍ لملفٍ السجلَّ بآلاف الأسطر */
    insert into public.perf_item_log (section, item_id, name, field, old_val, new_val, by_name)
    values (new.section, new.id, nm, '__new', null, null, who);
    return new;
  end if;

  /* المفاتيح في الحالتين: ما أُضيف وما حُذف وما تغيّر */
  for k in
    select key from jsonb_object_keys(coalesce(new.data,'{}'::jsonb)) as t(key)
    union
    select key from jsonb_object_keys(coalesce(old.data,'{}'::jsonb)) as t(key)
  loop
    if public.perf_item_skip(k) then continue; end if;
    ov := old.data->>k;
    nv := new.data->>k;
    if ov is distinct from nv then
      insert into public.perf_item_log (section, item_id, name, field, old_val, new_val, by_name)
      values (new.section, new.id, nm, k, ov, nv, who);
    end if;
  end loop;
  return new;
end $$;

revoke all on function public.perf_item_log_tg() from public, anon;

drop trigger if exists perf_items_log on public.perf_items;
create trigger perf_items_log
  after insert or update on public.perf_items
  for each row execute function public.perf_item_log_tg();

/* تنظيفٌ اختياري — السجلّ لا يُقرأ منه إلا أسابيع قليلة:
     select public.perf_item_log_prune(365);  */
create or replace function public.perf_item_log_prune(p_days int default 365)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  delete from public.perf_item_log
   where at < now() - make_interval(days => greatest(30, p_days));
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.perf_item_log_prune(int) from public, anon;

-- ------------------------------------------------------------
--  رابط المشاركة يرى المنجزات كما تراها الإدارة
--  ------------------------------------------------------------
--  `perf_shared_report` كانت تُرجع البنود والتكاليف والإعدادات.
--  والتقرير صار يُبنى من **سجلّ التغييرات** وطلبات التغيير
--  وتواريخ مراجعة جهات التواصل، فتُضاف الثلاثة — مقيَّدةً بأسبوع
--  الرابط وحده، فلا يتسرّب تاريخٌ لا يخصّه.
-- ------------------------------------------------------------
create or replace function public.perf_shared_report(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s     record;
  d0    date;
  d1    date;
  v_log jsonb := '[]'::jsonb;
  v_chg jsonb := '[]'::jsonb;
  v_con jsonb := '[]'::jsonb;
begin
  select * into s from public.perf_shares
   where token = p_token
     and (expires_at is null or expires_at > now());
  if not found then return null; end if;

  update public.perf_shares
     set views = views + 1, last_view = now()
   where token = p_token;

  d0 := s.week_start::date;
  d1 := d0 + 7;

  /* سجلّ التغييرات — أسبوع الرابط وحده */
  begin
    select coalesce(jsonb_agg(to_jsonb(x) order by x.at), '[]'::jsonb) into v_log
      from public.perf_item_log x
     where x.at >= d0::timestamptz and x.at < d1::timestamptz;
  exception when others then v_log := '[]'::jsonb;
  end;

  /* طلبات التغيير: المفتوح كله، والمغلق في آخر ١٨٠ يوماً — منها
     نسبة الالتزام ومقارنتها بالأسبوع الماضي */
  begin
    select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_chg
      from public.perf_change_requests x
     where x.closed_at is null or x.closed_at >= d0 - 180;
  exception when others then v_chg := '[]'::jsonb;
  end;

  /* جهات التواصل التي روجعت بياناتها في الأسبوع */
  begin
    select coalesce(jsonb_agg(jsonb_build_object('entity', e.name, 'reviewedAt', c.reviewed_at)), '[]'::jsonb)
      into v_con
      from public.perf_contacts c
      join public.perf_entities e on e.id = c.entity_id
     where c.reviewed_at >= d0::timestamptz and c.reviewed_at < d1::timestamptz;
  exception when others then v_con := '[]'::jsonb;
  end;

  return jsonb_build_object(
    'weekStart', s.week_start,
    'sectors',      (select coalesce(jsonb_agg(to_jsonb(x) order by x.ord), '[]'::jsonb) from public.perf_sectors x),
    'indicators',   (select coalesce(jsonb_agg(to_jsonb(x) order by x.ord), '[]'::jsonb) from public.perf_indicators x where x.active),
    'periods',      (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.perf_periods x),
    'targets',      (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.perf_targets x),
    'measurements', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.perf_measurements x),
    'tasks',        (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.perf_tasks x),
    'items',        (select coalesce(jsonb_agg(to_jsonb(x) order by x.ord), '[]'::jsonb) from public.perf_items x),
    'settings',     (select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) from public.perf_settings),
    'log',      v_log,
    'changes',  v_chg,
    'contacts', v_con
  );
end;
$$;
grant execute on function public.perf_shared_report(text) to anon, authenticated;

-- ------------------------------------------------------------
--  تحقّق
-- ------------------------------------------------------------
select 'الجدول' as "البند", count(*)::text as "القيمة" from public.perf_item_log
union all
select 'الـtrigger مركَّب؟',
       (select case when count(*) > 0 then 'نعم' else 'لا' end
          from pg_trigger where tgname = 'perf_items_log' and not tgisinternal)
union all
select 'سياسة القراءة',
       (select count(*)::text from pg_policy where polrelid = 'public.perf_item_log'::regclass);
