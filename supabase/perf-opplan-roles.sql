-- ============================================================
--  الخطة التشغيلية — تحديثٌ من محفظة الراعي والمسؤول
--  ------------------------------------------------------------
--  كان الموظف يعدّل ما أضافه هو وحده (`contributor`). وصار كل من
--  هو **راعي** البند أو **المسؤول** عنه يحدّثه من محفظته، فتنعكس
--  حالته وفعليُّه في صفحة الخطة مباشرة.
--
--  **حدّ التعديل مقصود**: غير صاحب المساهمة يغيّر الحالة والفعلي
--  والملاحظة فقط. المستهدفات واسم البند ومحفظته بنودُ خطةٍ
--  معتمدة، فلا تُمسّ إلا من صفحة الخطة بصلاحية `sections:edit`.
--
--  ويُطبَّع الاسم قبل المقارنة، وتُقسَّم الخانة على «·» و«،» و«/»
--  لأن المسؤول قد يكون أكثر من شخصٍ في خانةٍ واحدة.
--
--  يشمل أيضاً توحيد الحالات الأربع: «جديدة» و«مستمرة» ← «على المسار»
--  idempotent — يُشغَّل بعد perf-opplan.sql و perf-opplan-mine.sql
-- ============================================================

/* ---------- 1) توحيد الحالات ---------- */
update public.perf_items
   set data = data || jsonb_build_object('status', 'على المسار')
 where section = 'opplan'
   and data->>'status' in ('جديدة', 'مستمرة');

/* ---------- 2) هل البند يخصّ هذا الشخص؟ ---------- */
create or replace function public.perf_opplan_role(p_data jsonb, p_name text)
returns text language sql immutable set search_path = public as $$
  select case
    when public.perf_norm_name(coalesce(p_data->>'contributor','')) = public.perf_norm_name(p_name)
      then 'own'
    when exists (
      select 1
        from unnest(regexp_split_to_array(
               coalesce(p_data->>'sponsor','') || '·' || coalesce(p_data->>'assignee',''),
               '[·,،/|]+')) as n
       where public.perf_norm_name(btrim(n)) = public.perf_norm_name(p_name)
         and btrim(n) <> ''
    ) then 'role'
    else null
  end;
$$;

/* ---------- 3) الحفظ ---------- */
create or replace function public.perf_opplan_mine_save(p_id text, p_patch jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_me   text;
  v_row  public.perf_items;
  v_id   text := nullif(btrim(coalesce(p_id, '')), '');
  v_role text;
  v_ok   jsonb := '{}'::jsonb;
  k      text;
  v_allowed text[];
  /* كل الحقول — لصاحب المساهمة */
  full_set text[] := array['kind','name','owner','sponsor','assignee','status',
                           'itype','level','unit','yearTarget','note',
                           'q1t','q1a','q2t','q2a','q3t','q3a','q4t','q4a'];
  /* الحالة والفعلي والملاحظة — للراعي والمسؤول على بندٍ معتمد */
  role_set text[] := array['status','note','q1a','q2a','q3a','q4a'];
begin
  select display_name into v_me from public.perf_users where id = public.perf_my_id();
  if coalesce(btrim(v_me), '') = '' then raise exception 'غير مصرّح'; end if;

  if v_id is null then
    v_allowed := full_set;
  else
    select * into v_row from public.perf_items where section = 'opplan' and id = v_id;
    if not found then raise exception 'البند غير موجود'; end if;
    v_role := public.perf_opplan_role(v_row.data, v_me);
    if v_role is null then raise exception 'هذا البند لا يخصّك'; end if;
    v_allowed := case when v_role = 'own' then full_set else role_set end;
  end if;

  foreach k in array v_allowed loop
    if p_patch ? k then v_ok := v_ok || jsonb_build_object(k, p_patch -> k); end if;
  end loop;

  if v_id is null then
    if coalesce(btrim(v_ok->>'name'), '') = '' then raise exception 'اسم المساهمة مطلوب'; end if;
    v_id := 'op-c' || replace(gen_random_uuid()::text, '-', '');
    insert into public.perf_items (section, id, ord, data, updated_at, updated_by)
    values ('opplan', v_id,
            coalesce((select max(ord) + 1 from public.perf_items where section = 'opplan'), 300),
            /* `contributor` تُكتب هنا لا من الواجهة، فلا يُنسب أحدٌ مساهمةً لغيره */
            v_ok || jsonb_build_object('contributor', v_me),
            now(), v_me);
    return v_id;
  end if;

  if v_ok = '{}'::jsonb then return v_id; end if;
  update public.perf_items
     set data = data || v_ok, updated_at = now(), updated_by = v_me
   where section = 'opplan' and id = v_id;
  return v_id;
end;
$$;
revoke all on function public.perf_opplan_mine_save(text, jsonb) from public, anon;
grant execute on function public.perf_opplan_mine_save(text, jsonb) to authenticated;

/* ---------- 4) الحذف — مساهمتُه هو وحدها، لا بند خطةٍ معتمد ---------- */
create or replace function public.perf_opplan_mine_del(p_id text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_me text; v_row public.perf_items;
begin
  select display_name into v_me from public.perf_users where id = public.perf_my_id();
  if coalesce(btrim(v_me), '') = '' then raise exception 'غير مصرّح'; end if;
  select * into v_row from public.perf_items where section = 'opplan' and id = p_id;
  if not found then return false; end if;
  if public.perf_opplan_role(v_row.data, v_me) is distinct from 'own' then
    raise exception 'لا يُحذف إلا ما أضفته أنت';
  end if;
  delete from public.perf_items where section = 'opplan' and id = p_id;
  return true;
end;
$$;
revoke all on function public.perf_opplan_mine_del(text) from public, anon;
grant execute on function public.perf_opplan_mine_del(text) to authenticated;

/* ---------- 5) التحقق ---------- */
select 'لا حالة قديمة'       as "الفحص", count(*) = 0 as "صحيح"
  from public.perf_items where section='opplan' and data->>'status' in ('جديدة','مستمرة')
union all
select 'perf_opplan_role', count(*) = 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname='perf_opplan_role'
union all
select 'perf_opplan_mine_save', count(*) = 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname='perf_opplan_mine_save';

/* كم بنداً يخصّ كل شخص (راعياً أو مسؤولاً أو مساهماً) */
select u.display_name as "الاسم",
       count(*) filter (where public.perf_opplan_role(i.data, u.display_name) is not null) as "بنوده"
  from public.perf_users u
  cross join public.perf_items i
 where i.section = 'opplan' and u.active
 group by u.display_name
 having count(*) filter (where public.perf_opplan_role(i.data, u.display_name) is not null) > 0
 order by 2 desc;
