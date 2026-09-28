-- ============================================================
--  «الأعمال الرئيسية» في محفظتي — الاستشاري يحرّر بنود جهاته
--  ------------------------------------------------------------
--  كان تحرير أقسام المنصة محصوراً بصلاحية «تحرير بيانات الأقسام»،
--  فالاستشاري يرى استراتيجيات جهاته ولا يحدّثها — فتُنقل الأرقام
--  يدوياً ويختلف ما في المحفظة عمّا في الصفحة.
--
--  الآن: دالةٌ واحدة تكتب نيابةً عنه بعد أن تتحقّق **بنفسها** أن
--  البند من جهاته، وتقتصر على حقولٍ مسموحة لكل قسم. فلا تُفتح
--  سياسة الجدول لأحد، ولا يستطيع أحدٌ تعديل ما ليس له.
--
--  «من جهاتي» = اسم الاستشاري في البند نفسه (عمود «الاستشاري»
--  في ملف تجربة المستفيد)، أو أن جهته مسندةٌ إليّ **نقطةَ تواصل
--  أساسية** في سجلّ الجهات — البديل لا يملك التحرير.
--
--  idempotent وليس فيه حذف بيانات. يُشغَّل بعد perf-entities-own.sql
-- ============================================================

/* أسماء جهاتي مُطبَّعة — التي أنا نقطة تواصلها الأساسية من المركز */
create or replace function public.perf_my_entity_names()
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct public.perf_ar_norm(e.name)), '{}')
    from public.perf_contacts c
    join public.perf_entities e on e.id = c.entity_id and e.active
   where c.side = 'نحن' and c.role = 'أساسي' and c.user_id = public.perf_my_id();
$$;
revoke all on function public.perf_my_entity_names() from public, anon;
grant execute on function public.perf_my_entity_names() to authenticated;

/* هل هذا البند من أعمالي؟ */
create or replace function public.perf_item_mine(p_section text, p_data jsonb)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v_me text; v_ent text;
begin
  select display_name into v_me from public.perf_users where id = public.perf_my_id();
  if v_me is null then return false; end if;

  -- اسمي مكتوبٌ في البند (ملف تجربة المستفيد فيه عمود «الاستشاري»)
  if coalesce(btrim(p_data->>'consultant'), '') <> ''
     and public.perf_norm_name(p_data->>'consultant') = public.perf_norm_name(v_me) then
    return true;
  end if;

  -- وإلا: جهةُ البند من جهاتي
  v_ent := case p_section
             when 'natstrat' then p_data->>'owner'
             when 'sessions' then p_data->>'entity'
             else p_data->>'name'
           end;
  if coalesce(btrim(v_ent), '') = '' then return false; end if;
  return public.perf_ar_norm(v_ent) = any(public.perf_my_entity_names());
end;
$$;
revoke all on function public.perf_item_mine(text, jsonb) from public, anon;
grant execute on function public.perf_item_mine(text, jsonb) to authenticated;

/* الحفظ: دمج حقولٍ مسموحة في بندٍ من جهاتي.
   الدمج لا الاستبدال — فلا يمحو الاستشاري حقلاً لا يراه. */
create or replace function public.perf_item_mine_save(p_section text, p_id text, p_patch jsonb)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_row public.perf_items;
  v_ok  jsonb := '{}'::jsonb;
  v_me  text;
  k     text;
  allowed text[] := case p_section
    when 'natstrat'  then array['stage','kpisRep','kpisTot','initRep','initTot','meas','note']
    when 'inststrat' then array['meet','docs','live','note']
    when 'cx'        then array['meet','survey','counted','note']
    when 'sessions'  then array['done','perf','kpiBad','kpiTot','initBad','initTot','esc','note','quarter']
    else array[]::text[]
  end;
begin
  if coalesce(array_length(allowed, 1), 0) = 0 then
    raise exception 'قسم غير مسموح: %', p_section;
  end if;

  select * into v_row from public.perf_items where section = p_section and id = p_id;
  if not found then return false; end if;
  if not public.perf_item_mine(p_section, v_row.data) then
    raise exception 'هذا البند ليس من جهاتك';
  end if;

  foreach k in array allowed loop
    if p_patch ? k then v_ok := v_ok || jsonb_build_object(k, p_patch -> k); end if;
  end loop;
  if v_ok = '{}'::jsonb then return false; end if;

  select display_name into v_me from public.perf_users where id = public.perf_my_id();
  update public.perf_items
     set data = data || v_ok, updated_at = now(), updated_by = coalesce(v_me, '')
   where section = p_section and id = p_id;
  return true;
end;
$$;
revoke all on function public.perf_item_mine_save(text, text, jsonb) from public, anon;
grant execute on function public.perf_item_mine_save(text, text, jsonb) to authenticated;

/* «تحتاج جلسة مراجعة أداء» ⇒ تُفتح للجهة بطاقةٌ في صفحة الجلسات.
   لا تُحذف عند إلغاء العلامة: الجلسة عملٌ قائم، إلغاؤها قرار
   صاحب الصفحة لا الاستشاري. */
create or replace function public.perf_session_flag(p_entity text, p_quarter text default '')
returns text language plpgsql security definer set search_path = public as $$
declare v_id text; v_me text; v_n text := public.perf_ar_norm(coalesce(p_entity, ''));
begin
  if v_n = '' then raise exception 'اسم الجهة مطلوب'; end if;
  if not (v_n = any(public.perf_my_entity_names())) then
    raise exception 'هذه الجهة ليست من جهاتك';
  end if;

  select i.id into v_id from public.perf_items i
   where i.section = 'sessions' and public.perf_ar_norm(i.data->>'entity') = v_n
   limit 1;
  if v_id is not null then return v_id; end if;

  select display_name into v_me from public.perf_users where id = public.perf_my_id();
  v_id := 'sess-' || replace(gen_random_uuid()::text, '-', '');
  insert into public.perf_items (section, id, ord, data, updated_at, updated_by)
  values ('sessions', v_id,
          coalesce((select max(ord) + 1 from public.perf_items where section = 'sessions'), 1),
          jsonb_build_object('entity', btrim(p_entity), 'quarter', coalesce(p_quarter, ''),
                             'done', 0, 'demo', false),
          now(), coalesce(v_me, ''));
  return v_id;
end;
$$;
revoke all on function public.perf_session_flag(text, text) from public, anon;
grant execute on function public.perf_session_flag(text, text) to authenticated;

select 'perf_item_mine_save' as "الدالة", 'جاهزة' as "الحالة";
