-- ============================================================
--  ربط بندٍ موجودٍ في صفحة القسم بـ«محفظتي»
--  ------------------------------------------------------------
--  «استراتيجية الأحساء موجودةٌ في صفحة الاستراتيجيات الوطنية ولا
--  أجدها في محفظتي، وإذا أضفتها حُسبت جهةً جديدة» — لأن البند لا
--  يصل المحفظة إلا بأحد أمرين: اسمُ الاستشاري مكتوبٌ فيه، أو جهتُه
--  مسندةٌ إليه نقطةَ تواصل أساسية. وإنشاءُ بندٍ جديد يضاعف
--  الاستراتيجية في الصفحة ويضيف جهةً إلى السجل.
--
--  فدالةٌ تربط البند **الموجود**: تكتب اسمي فيه `consultant`
--  فيصير من أعمالي، ويصل كلُّ ما أحدّثه إلى الصفحة نفسها.
--
--  الحارس: لا يُنتزع بندٌ مسندٌ إلى غيري — من كان اسمه فيه يبقى،
--  ونقلُه قرار صاحب الصفحة لا الاستشاري.
--
--  ومعها: توسيع حقول الاستراتيجيات الوطنية المسموح حفظُها من
--  المحفظة إلى **كل ما تعرضه بطاقة الصفحة** — محطات المراجعة
--  والفترة وتاريخ الاعتماد. فكانت المحفظة تعرض الرقم وتعجز عن
--  تحريك المحطة، فتبدو التحديثات «لم تنعكس».
--
--  idempotent — آمن للتشغيل أكثر من مرة، ولا يحذف شيئاً
-- ============================================================

create or replace function public.perf_item_mine_claim(p_section text, p_id text)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_row public.perf_items;
  v_me  text;
  v_c   text;
begin
  if p_section not in ('natstrat', 'inststrat', 'cx') then
    raise exception 'قسم غير مسموح: %', p_section;
  end if;

  select display_name into v_me from public.perf_users where id = public.perf_my_id();
  if coalesce(btrim(v_me), '') = '' then raise exception 'غير مصرّح'; end if;

  select * into v_row from public.perf_items where section = p_section and id = p_id;
  if not found then raise exception 'البند غير موجود'; end if;

  v_c := btrim(coalesce(v_row.data ->> 'consultant', ''));
  if v_c <> '' and public.perf_norm_name(v_c) <> public.perf_norm_name(v_me) then
    raise exception 'البند مسندٌ إلى % — نقلُه من صفحة القسم', v_c;
  end if;

  update public.perf_items
     set data = data || jsonb_build_object('consultant', v_me),
         updated_at = now(), updated_by = v_me
   where section = p_section and id = p_id;
  return true;
end;
$$;
revoke all on function public.perf_item_mine_claim(text, text) from public, anon;
grant execute on function public.perf_item_mine_claim(text, text) to authenticated;


/* فكُّ الربط: اسمي وحده يُمحى، ولا يمسّ أحدٌ بندَ غيره */
create or replace function public.perf_item_mine_release(p_section text, p_id text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_me text; v_c text;
begin
  select display_name into v_me from public.perf_users where id = public.perf_my_id();
  if coalesce(btrim(v_me), '') = '' then raise exception 'غير مصرّح'; end if;
  select btrim(coalesce(i.data ->> 'consultant', '')) into v_c
    from public.perf_items i where i.section = p_section and i.id = p_id;
  if v_c is null then return false; end if;
  if v_c = '' or public.perf_norm_name(v_c) <> public.perf_norm_name(v_me) then return false; end if;
  update public.perf_items
     set data = data || jsonb_build_object('consultant', ''), updated_at = now(), updated_by = v_me
   where section = p_section and id = p_id;
  return true;
end;
$$;
revoke all on function public.perf_item_mine_release(text, text) from public, anon;
grant execute on function public.perf_item_mine_release(text, text) to authenticated;


/* ------------------------------------------------------------
   حفظ المحفظة: الوطنية تكسب محطات المراجعة والفترة والاعتماد
   ------------------------------------------------------------
   `track` مصفوفةٌ من أربع حالات (0 لم يبدأ · 1 قيد التنفيذ ·
   2 مكتمل)، ومنها تُشتقّ «مقبولة فنياً» في بطاقة الصفحة.
   ومع كتابتها تُمحى بقايا `track0..3` القديمة: الواجهة تأخذ
   الأعلى من الاثنين، فلو بقيت المفاتيح المفردة لما نزلت محطةٌ
   عن حالتها القديمة ولو غُيّرت من المحفظة.
   ------------------------------------------------------------ */
create or replace function public.perf_item_mine_save(p_section text, p_id text, p_patch jsonb)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_row public.perf_items;
  v_ok  jsonb := '{}'::jsonb;
  v_me  text;
  k     text;
  allowed text[] := case p_section
    when 'natstrat'  then array['stage','kpisRep','kpisTot','initRep','initTot','meas','note',
                                'track','period','approvedAt']
    when 'inststrat' then array['rep','meet','meetAt','docs','docsState','target','live','phase','note']
    when 'cx'        then array['meet','survey','card','l1','freq','servTot','servPlan',
                                'counted','countedQ2','note',
                                'q0Share','q1Share','q2Share','q3Share','q4Share',
                                'q0Issue','q1Issue','q2Issue','q3Issue','q4Issue',
                                'q0Svc','q1Svc','q2Svc','q3Svc','q4Svc',
                                'q0Sat','q1Sat','q2Sat','q3Sat','q4Sat']
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
     set data = case when v_ok ? 'track'
                     then (data - 'track0' - 'track1' - 'track2' - 'track3')
                     else data end || v_ok,
         updated_at = now(), updated_by = coalesce(v_me, '')
   where section = p_section and id = p_id;
  return true;
end;
$$;
revoke all on function public.perf_item_mine_save(text, text, jsonb) from public, anon;
grant execute on function public.perf_item_mine_save(text, text, jsonb) to authenticated;

select 'perf_item_mine_claim'   as "الدالة", 'جاهزة' as "الحالة"
union all select 'perf_item_mine_release', 'جاهزة'
union all select 'perf_item_mine_save',    'الوطنية: + محطات المراجعة والفترة وتاريخ الاعتماد';
