-- ============================================================
--  مساهمات الموظف في الخطة التشغيلية
--  ------------------------------------------------------------
--  ما يضيفه الموظف في «المساهمات في الخطة التشغيلية» بمحفظته
--  يظهر تحت محفظة مديره في صفحة الخطة — فالمساهمة بندٌ في الخطة
--  نفسها لا نسخةٌ منها في محفظة صاحبها.
--
--  والكتابة في `perf_items` تتطلّب `sections:edit`، ولا يملكها
--  الموظف. فدالةٌ واحدة تكتب نيابةً عنه بعد أن تتحقّق **بنفسها**
--  أن البند مساهمتُه هو: `data->>'contributor'` اسمُه.
--  فلا تُفتح سياسة الجدول لأحد، ولا يمسّ أحدٌ بنداً ليس له.
--
--  idempotent وليس فيه حذف بيانات. يُشغَّل بعد perf-opplan.sql
-- ============================================================

/* الحفظ: إنشاءٌ أو تحديثٌ لمساهمةٍ يملكها صاحب الجلسة */
create or replace function public.perf_opplan_mine_save(p_id text, p_patch jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_me  text;
  v_row public.perf_items;
  v_id  text := nullif(btrim(coalesce(p_id, '')), '');
  v_ok  jsonb := '{}'::jsonb;
  k     text;
  allowed text[] := array['kind','name','owner','sponsor','assignee','status',
                          'itype','level','unit','yearTarget','note',
                          'q1t','q1a','q2t','q2a','q3t','q3a','q4t','q4a'];
begin
  select display_name into v_me from public.perf_users where id = public.perf_my_id();
  if coalesce(btrim(v_me), '') = '' then raise exception 'غير مصرّح'; end if;

  foreach k in array allowed loop
    if p_patch ? k then v_ok := v_ok || jsonb_build_object(k, p_patch -> k); end if;
  end loop;

  if v_id is null then
    if coalesce(btrim(v_ok->>'name'), '') = '' then raise exception 'اسم المساهمة مطلوب'; end if;
    v_id := 'op-c' || replace(gen_random_uuid()::text, '-', '');
    insert into public.perf_items (section, id, ord, data, updated_at, updated_by)
    values ('opplan', v_id,
            coalesce((select max(ord) + 1 from public.perf_items where section = 'opplan'), 300),
            /* `contributor` تُكتب هنا لا من الواجهة، فلا يُنسب أحدٌ
               مساهمةً لغيره */
            v_ok || jsonb_build_object('contributor', v_me),
            now(), v_me);
    return v_id;
  end if;

  select * into v_row from public.perf_items where section = 'opplan' and id = v_id;
  if not found then raise exception 'المساهمة غير موجودة'; end if;
  if public.perf_norm_name(coalesce(v_row.data->>'contributor','')) <> public.perf_norm_name(v_me) then
    raise exception 'هذه المساهمة ليست لك';
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

/* الحذف: مساهمتُه وحدها */
create or replace function public.perf_opplan_mine_del(p_id text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_me text; v_row public.perf_items;
begin
  select display_name into v_me from public.perf_users where id = public.perf_my_id();
  if coalesce(btrim(v_me), '') = '' then raise exception 'غير مصرّح'; end if;
  select * into v_row from public.perf_items where section = 'opplan' and id = p_id;
  if not found then return false; end if;
  if public.perf_norm_name(coalesce(v_row.data->>'contributor','')) <> public.perf_norm_name(v_me) then
    raise exception 'هذه المساهمة ليست لك';
  end if;
  delete from public.perf_items where section = 'opplan' and id = p_id;
  return true;
end;
$$;
revoke all on function public.perf_opplan_mine_del(text) from public, anon;
grant execute on function public.perf_opplan_mine_del(text) to authenticated;

select 'perf_opplan_mine_save' as "الدالة", 'جاهزة' as "الحالة";
