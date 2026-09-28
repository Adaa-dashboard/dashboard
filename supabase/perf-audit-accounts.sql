-- ============================================================
--  سجل النشاط — تعديلات الحسابات والجهات والوثائق
--  ------------------------------------------------------------
--  السجل كان يرصد ما يُكتب في جداول العمل: بنود الأقسام والقياسات
--  والمستهدفات والمهام والملاحظات والمحفظة. وكان **لا يرصد تعديل
--  الحسابات إطلاقاً**: من غيّر صلاحيات من · من أوقف حساباً · من
--  غيّر كلمة مروره · من أضاف حساباً أو حذفه. فجدول `perf_users`
--  ليس فيه تاريخ، والتعديل يكتب فوق القديم فيضيع.
--
--  الحلّ: جدول `perf_audit` يُكتب من **trigger داخل القاعدة**، فلا
--  تستطيع الواجهة تجاوزه ولا تزويره، ويلتقط أي تعديل مهما كان
--  مصدره — من الشاشة أو من SQL Editor.
--
--  ويضيف إلى `perf_audit_log`: الجهات · الوثائق · رفع طلبات
--  التغيير. والملف **شامل لما في perf-usage.sql**، فتشغيله يكفي.
--
--  لا يُعرض محتوى شيء: الأسماء والأوقات وما تغيّر وحدها.
--  idempotent وليس فيه حذف بيانات. يُشغَّل بعد perf-audit.sql
-- ============================================================

-- ------------------------------------------------------------
--  ١) جدول السجل
-- ------------------------------------------------------------
create table if not exists public.perf_audit (
  id    bigserial primary key,
  at    timestamptz not null default now(),
  who   text not null default '—',
  kind  text not null,
  what  text not null default '',
  place text not null default ''
);
create index if not exists perf_audit_at on public.perf_audit (at desc);
alter table public.perf_audit enable row level security;
-- لا سياسة قراءة ولا كتابة: الكتابة من trigger، والقراءة عبر
-- perf_audit_log وحدها — وهي security definer تتحقق من الصلاحية
revoke all on public.perf_audit from anon, authenticated;

-- ------------------------------------------------------------
--  ٢) من يفعل الآن — اسم صاحب الجلسة، أو «خارج المنصة»
-- ------------------------------------------------------------
create or replace function public.perf_audit_who()
returns text language plpgsql stable security definer set search_path = public as $$
declare v text;
begin
  select u.display_name into v
    from public.perf_users u where u.id = public.perf_my_id();
  return coalesce(nullif(btrim(coalesce(v,'')), ''), '— خارج المنصة');
exception when others then
  return '— خارج المنصة';
end;
$$;

/* قائمةٌ مختصرة: أربعة أسماء ثم عددُ الباقي — قائمة الصلاحيات
   كاملةً تملأ خانة السجل وتُخفي ما قبلها */
create or replace function public.perf_few(p text[], p_max int default 4)
returns text language sql immutable as $$
  select case
    when coalesce(array_length(p,1),0) = 0 then '—'
    when array_length(p,1) <= p_max then array_to_string(p, ' · ')
    else array_to_string(p[1:p_max], ' · ') || ' و' || (array_length(p,1) - p_max)::text || ' غيرها'
  end;
$$;

-- ------------------------------------------------------------
--  ٣) تعديلات الحسابات — trigger صفّي
--     الدخول وحده لا يُسجَّل: `last_login` تتغيّر مع كل دخول،
--     وتسجيلها يغرق السجل بما لا يفيد.
-- ------------------------------------------------------------
create or replace function public.perf_users_audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_who text := public.perf_audit_who(); ch text[] := '{}'; v_add text[]; v_rem text[];
begin
  if TG_OP = 'INSERT' then
    insert into public.perf_audit(who, kind, what, place)
    values (v_who, 'حساب', 'أُنشئ الحساب', new.display_name);
    return new;
  end if;

  if TG_OP = 'DELETE' then
    insert into public.perf_audit(who, kind, what, place)
    values (v_who, 'حساب', 'حُذف الحساب', old.display_name);
    return old;
  end if;

  if new.display_name is distinct from old.display_name then
    ch := ch || ('الاسم: ' || old.display_name || ' ← ' || new.display_name); end if;
  if new.username is distinct from old.username then
    ch := ch || ('اسم الدخول: ' || coalesce(old.username,'—') || ' ← ' || coalesce(new.username,'—')); end if;
  if new.phone is distinct from old.phone then ch := ch || 'الجوال'; end if;
  if coalesce(new.job_title,'') is distinct from coalesce(old.job_title,'') then
    ch := ch || ('المسمّى: ' || coalesce(nullif(new.job_title,''),'—')); end if;
  if new.role is distinct from old.role then
    ch := ch || ('الدور: ' || old.role || ' ← ' || new.role); end if;
  if new.is_lead is distinct from old.is_lead then
    ch := ch || (case when new.is_lead then 'صار مدير قطاع' else 'لم يعد مدير قطاع' end); end if;
  if new.active is distinct from old.active then
    ch := ch || (case when new.active then 'أُعيد تفعيله' else 'أُوقف الحساب' end); end if;
  if new.sector_ids is distinct from old.sector_ids then ch := ch || 'القطاعات'; end if;
  if new.photo_url is distinct from old.photo_url then ch := ch || 'الصورة'; end if;

  if coalesce(new.pass_hash,'') is distinct from coalesce(old.pass_hash,'') then
    ch := ch || (case
      when coalesce(old.pass_hash,'') = '' then 'ضُبطت كلمة المرور لأول مرة'
      when coalesce(new.pass_hash,'') = '' then 'أُعيد الحساب إلى «بانتظار التفعيل»'
      else 'غُيِّرت كلمة المرور' end);
  end if;

  if new.scopes is distinct from old.scopes then
    select array(select unnest(coalesce(new.scopes,'{}'))
                 except select unnest(coalesce(old.scopes,'{}'))) into v_add;
    select array(select unnest(coalesce(old.scopes,'{}'))
                 except select unnest(coalesce(new.scopes,'{}'))) into v_rem;
    if coalesce(array_length(v_add,1),0) > 0 then
      ch := ch || ('مُنح: ' || public.perf_few(v_add)); end if;
    if coalesce(array_length(v_rem,1),0) > 0 then
      ch := ch || ('سُحب: ' || public.perf_few(v_rem)); end if;
  end if;

  -- لم يتغيّر إلا وقت الدخول ⇒ لا يُسجَّل
  if coalesce(array_length(ch,1),0) = 0 then return new; end if;

  /* من فعّل حسابه بنفسه لا جلسة له بعدُ لحظةَ التعديل، فيُنسب إليه */
  if v_who = '— خارج المنصة' and coalesce(old.pass_hash,'') = '' then
    v_who := new.display_name;
  end if;

  insert into public.perf_audit(who, kind, what, place)
  values (v_who, 'حساب', array_to_string(ch, ' · '), new.display_name);
  return new;
end;
$$;

drop trigger if exists perf_users_audit_tg on public.perf_users;
create trigger perf_users_audit_tg
  after insert or update or delete on public.perf_users
  for each row execute function public.perf_users_audit();

-- ------------------------------------------------------------
--  ٤) نقطة التواصل: من عدّلها
--     الجدول ليس فيه عمود للمعدِّل، فتُختم الصفوف باسم صاحب
--     الجلسة عند كل كتابة — قبل الحفظ، فلا تحتاج الواجهة تغييراً.
-- ------------------------------------------------------------
alter table public.perf_contacts add column if not exists by_name text not null default '';

create or replace function public.perf_contacts_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.by_name := public.perf_audit_who();
  new.at := now();
  return new;
end;
$$;

drop trigger if exists perf_contacts_stamp_tg on public.perf_contacts;
create trigger perf_contacts_stamp_tg
  before insert or update on public.perf_contacts
  for each row execute function public.perf_contacts_stamp();

-- ------------------------------------------------------------
--  ٥) السجل الكامل
--     ما يُكتب دفعةً واحدة (رفع ملف الجهات · ملف طلبات التغيير ·
--     نقاط التواصل) يُجمَّع سطراً واحداً لكل شخص في اليوم، وإلا
--     أغرق رفعٌ واحد السجلَّ بمئات الأسطر وأخفى ما سواه.
-- ------------------------------------------------------------
create or replace function public.perf_audit_log(p_days int default 30, p_limit int default 400)
returns table (at timestamptz, who text, kind text, what text, "where" text)
language sql stable security definer set search_path = public as $$
  with since as (select now() - make_interval(days => greatest(1, p_days)) as t)
  select * from (
    -- تعديلات الحسابات — من الجدول المكتوب بـ trigger
    select a.at, a.who, a.kind, a.what, a.place
      from public.perf_audit a where a.at >= (select t from since)
    union all
    -- بنود الأقسام
    select i.updated_at, coalesce(nullif(i.updated_by,''), '—'), 'قسم',
           coalesce(nullif(i.data->>'name',''), nullif(i.data->>'owner',''),
                    nullif(i.data->>'entity',''), i.id),
           case i.section
             when 'sessions' then 'جلسات مراجعة الأداء'
             when 'natstrat' then 'الاستراتيجيات الوطنية'
             when 'inststrat' then 'الاستراتيجيات المؤسسية'
             when 'outputs' then 'المخرجات الوطنية'
             when 'cx' then 'أعمال قياس تجربة المستفيد'
             when 'projects' then 'المشاريع الاستراتيجية'
             else i.section end
      from public.perf_items i where i.updated_at >= (select t from since)
    union all
    select m.updated_at, coalesce(nullif(m.updated_by,''), '—'), 'قياس',
           coalesce(ind.name, m.indicator_id) || ' = ' || coalesce(m.actual::text,'—'),
           coalesce(sec.name, m.sector_id)
      from public.perf_measurements m
      left join public.perf_indicators ind on ind.id = m.indicator_id
      left join public.perf_sectors sec on sec.id = m.sector_id
     where m.updated_at >= (select t from since)
    union all
    select g.at, coalesce(nullif(g.by_name,''), '—'), 'مستهدف',
           coalesce(ind.name, g.indicator_id) || ': ' ||
           coalesce(g.old_value::text,'—') || ' ← ' || coalesce(g.new_value::text,'—'),
           coalesce(sec.name, g.sector_id)
      from public.perf_target_log g
      left join public.perf_indicators ind on ind.id = g.indicator_id
      left join public.perf_sectors sec on sec.id = g.sector_id
     where g.at >= (select t from since)
    union all
    -- ملاحظة على مؤشر — بلا نصّها
    select n.at, coalesce(nullif(n.by_name,''), '—'), 'ملاحظة',
           coalesce(ind.name, n.indicator_id), coalesce(sec.name, n.sector_id)
      from public.perf_notes n
      left join public.perf_indicators ind on ind.id = n.indicator_id
      left join public.perf_sectors sec on sec.id = n.sector_id
     where n.at >= (select t from since)
    union all
    -- ملاحظة لاصقة (القلم) — الصفحة وحدها بلا نصّها
    select s.at, coalesce(nullif(s.by_name,''), '—'), 'ملاحظة لاصقة',
           '— (لا يُعرض النص)',
           case s.page
             when 'overview' then 'نظرة عامة'
             when 'details' then 'المؤشرات التفصيلية'
             when 'sessions' then 'جلسات مراجعة الأداء'
             when 'natstrat' then 'الاستراتيجيات الوطنية'
             when 'inststrat' then 'الاستراتيجيات المؤسسية'
             when 'outputs' then 'المخرجات الوطنية'
             when 'cx' then 'أعمال قياس تجربة المستفيد'
             when 'projects' then 'المشاريع الاستراتيجية'
             when 'weekly' then 'الإنجاز الأسبوعي'
             else s.page end
      from public.perf_stickies s where s.at >= (select t from since)
    union all
    -- بنود محفظته — الاسم والقسم بلا محتوى
    select pf.updated_at, coalesce(nullif(pu.display_name,''), '—'), 'محفظتي',
           coalesce(nullif(pf.data->>'name',''), nullif(pf.data->>'title',''),
                    nullif(pf.data->>'entity',''), pf.id),
           case pf.section
             when 'entities' then 'جهاتي ومساهماتها'
             when 'projects' then 'مشاريعي'
             when 'ops' then 'أعمالي التشغيلية'
             else pf.section end
      from public.perf_portfolio pf
      left join public.perf_users pu on pu.id = pf.app_user_id
     where pf.updated_at >= (select t from since)
    union all
    -- ملاحظاته وتقويمه الخاص: وقت التحديث وحده، ولا يُقرأ محتواه
    select ud.updated_at, coalesce(nullif(uu.display_name,''), '—'),
           case ud.key when 'notes' then 'ملاحظاته الخاصة' else 'صفحته الخاصة' end,
           '— (خاصة به — لا يُعرض محتواها)', 'محفظتي'
      from public.perf_user_data ud
      left join public.perf_users uu on uu.id = ud.app_user_id
     where ud.updated_at >= (select t from since)
    union all
    select t.created_at, coalesce(nullif(cu.display_name,''), '—'),
           case when t.kind = 'assignment' then 'تكليف' else 'مهمة' end,
           t.title, coalesce(au.display_name, '—')
      from public.perf_tasks t
      left join public.perf_users cu on cu.id::text = t.created_by_id
      left join public.perf_users au on au.id::text = t.assignee_id
     where t.created_at >= (select t from since)
    union all
    -- ردّ على مهمة — بلا نصّه
    select (u->>'at')::timestamptz, coalesce(nullif(u->>'byName',''), '—'), 'ردّ',
           '— (لا يُعرض النص)', t.title
      from public.perf_tasks t,
           lateral jsonb_array_elements(coalesce(t.updates,'[]'::jsonb)) u
     where (u->>'at') is not null and (u->>'at')::timestamptz >= (select t from since)
    union all
    select g.granted_at, coalesce(nullif(g.granted_by,''), '—'), 'تفويض',
           gu.display_name || ' — ' || case when g.can_edit then 'تحرير' else 'اطّلاع' end,
           g.section
      from public.perf_section_grants g
      left join public.perf_users gu on gu.id = g.grantee_id
     where g.granted_at >= (select t from since)
    union all
    -- الجهات المضافة — مجمَّعة لكل شخص في اليوم
    select max(e.at), coalesce(nullif(e.added_by_name,''), '—'), 'جهات',
           'أُضيفت ' || count(*)::text || ' جهة', '—'
      from public.perf_entities e where e.at >= (select t from since)
     group by coalesce(nullif(e.added_by_name,''), '—'), date_trunc('day', e.at)
    union all
    -- نقاط التواصل — مجمَّعة كذلك (الرفع يكتب المئات دفعةً)
    select max(c.at), coalesce(nullif(c.by_name,''), '—'), 'نقاط تواصل',
           'كُتبت ' || count(*)::text || ' نقطة تواصل', '—'
      from public.perf_contacts c where c.at >= (select t from since)
     group by coalesce(nullif(c.by_name,''), '—'), date_trunc('day', c.at)
    union all
    -- الوثائق
    select d.at, coalesce(nullif(d.added_by,''), '—'), 'وثيقة', d.title,
           coalesce(nullif(d.kind,''), '—')
      from public.perf_docs d where d.at >= (select t from since)
    union all
    -- رفع ملف طلبات التغيير — مجمَّع لكل رفعة
    select max(cr.updated_at), coalesce(nullif(cr.updated_by,''), '—'), 'طلبات التغيير',
           'رفع ملف — ' || count(*)::text || ' طلباً', '—'
      from public.perf_change_requests cr where cr.updated_at >= (select t from since)
     group by coalesce(nullif(cr.updated_by,''), '—'), date_trunc('day', cr.updated_at)
  ) x(at, who, kind, what, "where")
  where public.perf_has_scope('audit')
  order by at desc
  limit greatest(1, p_limit);
$$;
revoke all on function public.perf_audit_log(int, int) from public, anon;
grant execute on function public.perf_audit_log(int, int) to authenticated;

-- ------------------------------------------------------------
--  ٦) التنظيف عند الحاجة — من SQL Editor وحده
--     select public.perf_audit_prune(180);
-- ------------------------------------------------------------
create or replace function public.perf_audit_prune(p_days int default 180)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  delete from public.perf_audit where at < now() - make_interval(days => greatest(30, p_days));
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.perf_audit_prune(int) from public, anon, authenticated;

select 'perf_audit' as "الجدول", 'جاهز' as "الحالة";
