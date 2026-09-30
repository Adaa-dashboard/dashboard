-- ============================================================
--  الخطة التشغيلية — تاريخ البداية والنهاية و«حالة المساهمة»
--  ------------------------------------------------------------
--  أعمدة عرض «محفظة المساهمات» ستة: الاسم · الراعي · المسؤول ·
--  تاريخ البداية · تاريخ النهاية · حالة المساهمة. وكانت الثلاثة
--  الأخيرة ناقصة، فتُضاف هنا إلى الحقول المسموح بحفظها.
--
--  **حالة المساهمة (note) يكتبها الراعي والمسؤول** — فهي وصف ما
--  وصل إليه العمل، وهم أدرى به. أما التاريخان فمن الخطة المعتمدة
--  فلا يغيّرهما إلا صاحب المساهمة أو من يملك تحرير الخطة.
--
--  idempotent — يُشغَّل بعد perf-opplan-roles.sql
-- ============================================================

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
                           'itype','level','unit','yearTarget','note','start','end',
                           'q1t','q1a','q2t','q2a','q3t','q3a','q4t','q4a'];
  /* الحالة وحالة المساهمة والفعلي — للراعي والمسؤول على بندٍ معتمد */
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

select 'perf_opplan_mine_save' as "الدالة", 'تقبل start و end و note' as "الحالة";
