-- ============================================================
--  إضافة جهةٍ إلى أقسام الأعمال الرئيسية من «محفظتي»
--  ------------------------------------------------------------
--  جهةٌ في سجلّ الاستشاري قد لا يكون لها بندٌ في صفحة قسمها
--  (الأحساء مثلاً في الاستراتيجيات الوطنية)، فلا تظهر له ولا
--  يستطيع تحديثها. وإنشاء بندٍ في `perf_items` يتطلّب
--  `sections:edit` ولا يملكها الاستشاري.
--
--  فدالةٌ تنشئ البند نيابةً عنه بعد أن تتحقّق **بنفسها** أن الجهة
--  من جهاته — نفس حارس `perf_session_flag`. ويُكتب اسمُه في
--  `consultant` فيصل بنده محفظته، ويُنسخ القطاع من سجلّ الجهات.
--
--  وإن كان للجهة بندٌ أصلاً يُعاد معرّفه ولا يُنشأ ثانٍ.
--
--  idempotent — آمن للتشغيل أكثر من مرة
-- ============================================================

create or replace function public.perf_item_mine_add(
  p_section text, p_entity text, p_title text default ''
) returns text language plpgsql security definer set search_path = public as $$
declare
  v_id     text;
  v_me     text;
  v_sector text;
  v_n      text := public.perf_ar_norm(coalesce(p_entity, ''));
  v_title  text := btrim(coalesce(p_title, ''));
  /* حقل اسم الجهة يختلف باختلاف القسم */
  v_col    text := case p_section
                     when 'natstrat'  then 'owner'
                     when 'inststrat' then 'owner'
                     when 'cx'        then 'name'
                   end;
begin
  if v_col is null then raise exception 'قسم غير مسموح: %', p_section; end if;
  if v_n = '' then raise exception 'اسم الجهة مطلوب'; end if;
  if not (v_n = any(public.perf_my_entity_names())) then
    raise exception 'هذه الجهة ليست من جهاتك';
  end if;
  /* الوطنية: البند استراتيجيةٌ لا جهة، فللجهة الواحدة أكثر من بند */
  if p_section = 'natstrat' and v_title = '' then
    raise exception 'اسم الاستراتيجية مطلوب';
  end if;

  select i.id into v_id
    from public.perf_items i
   where i.section = p_section
     and public.perf_ar_norm(coalesce(i.data ->> v_col, '')) = v_n
     and (p_section <> 'natstrat'
          or public.perf_ar_norm(coalesce(i.data ->> 'name', '')) = public.perf_ar_norm(v_title))
   limit 1;
  if v_id is not null then return v_id; end if;

  select display_name into v_me from public.perf_users where id = public.perf_my_id();
  select e.sector into v_sector from public.perf_entities e
   where e.name_n = v_n and e.active limit 1;

  v_id := left(p_section, 4) || '-' || replace(gen_random_uuid()::text, '-', '');
  insert into public.perf_items (section, id, ord, data, updated_at, updated_by)
  values (
    p_section, v_id,
    coalesce((select max(ord) + 1 from public.perf_items where section = p_section), 1),
    jsonb_build_object(v_col, btrim(p_entity),
                       'consultant', coalesce(v_me, ''),
                       'sector', coalesce(v_sector, ''),
                       'demo', false)
      || case when p_section = 'natstrat'
              then jsonb_build_object('name', v_title, 'stage', 1)
              else '{}'::jsonb end,
    now(), coalesce(v_me, '')
  );
  return v_id;
end;
$$;
revoke all on function public.perf_item_mine_add(text, text, text) from public, anon;
grant execute on function public.perf_item_mine_add(text, text, text) to authenticated;


/* ------------------------------------------------------------
   تصحيح: المؤسسية تسمّي الجهة `owner` لا `name`
   ------------------------------------------------------------
   كان الحارس يقرأ `name` في المؤسسية وهو حقلٌ غير موجود فيها،
   فلا يصل الاستشاريَّ من بنودها إلا ما كُتب اسمه فيه `consultant`
   — وما شورك معه من جهاتٍ لا يراه ولا يحرّره. والواجهة صُحِّحت
   معها، فلو بقي هذا لعرضت ما يرفض الخادمُ حفظه.
   ------------------------------------------------------------ */
create or replace function public.perf_item_mine(p_section text, p_data jsonb)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v_me text; v_ent text;
begin
  select display_name into v_me from public.perf_users where id = public.perf_my_id();
  if v_me is null then return false; end if;

  if coalesce(btrim(p_data->>'consultant'), '') <> ''
     and public.perf_norm_name(p_data->>'consultant') = public.perf_norm_name(v_me) then
    return true;
  end if;

  v_ent := case p_section
             when 'natstrat'  then p_data->>'owner'
             when 'inststrat' then p_data->>'owner'
             when 'sessions'  then p_data->>'entity'
             else p_data->>'name'
           end;
  if coalesce(btrim(v_ent), '') = '' then return false; end if;
  return public.perf_ar_norm(v_ent) = any(public.perf_my_entity_names());
end;
$$;
revoke all on function public.perf_item_mine(text, jsonb) from public, anon;
grant execute on function public.perf_item_mine(text, jsonb) to authenticated;

select 'perf_item_mine_add' as "الدالة", 'جاهزة' as "الحالة"
union all
select 'perf_item_mine', 'تقرأ owner في المؤسسية';
