-- ============================================================
--  إضافة جهة ببياناتها كاملةً — بنقاط تواصلها الثلاث
--  ------------------------------------------------------------
--  كانت الدالة تنشئ نقطةَ تواصلنا باسم المضيف وحده: بلا مسمّى
--  ولا جوال ولا بريد — فتُضاف الجهة ناقصةً ويُعاد تعبئتها يدوياً،
--  وهي بياناتٌ يعرفها النظام عنه أصلاً.
--
--  فصارت تملأها **من بياناته نفسها**: ما أرسلته الواجهة، وإلا من
--  آخر نقطةِ تواصلٍ له على جهةٍ أخرى، وإلا من سجلّ المستخدمين.
--  وتقبل نقاط الجهة ومكتب تحقيق الرؤية في النداء نفسه.
--
--  idempotent — آمن للتشغيل أكثر من مرة
-- ============================================================

drop function if exists public.perf_entity_add(text, text, text, text, text, text, text);

create or replace function public.perf_entity_add(
  p_name        text,
  p_kind        text default '',
  p_sector      text default '',
  p_note        text default '',
  p_their_name  text default '',
  p_their_phone text default '',
  p_their_email text default '',
  /* بياناتي أنا — تُملأ تلقائياً إن تُركت فارغة */
  p_my_title    text default '',
  p_my_phone    text default '',
  p_my_email    text default '',
  /* مسمّى نقطة تواصل الجهة، ونقطة مكتب تحقيق الرؤية */
  p_their_title text default '',
  p_vro_name    text default '',
  p_vro_title   text default '',
  p_vro_phone   text default '',
  p_vro_email   text default ''
) returns table (ent_id text, existed boolean, owner text)
language plpgsql security definer set search_path = public as $$
declare
  v_me    bigint := public.perf_my_id();
  v_name  text   := btrim(coalesce(p_name, ''));
  v_disp  text;
  v_id    text;
  v_exist boolean := false;
  v_owner text := '';
  v_title text;
  v_phone text;
  v_email text;
begin
  if v_me is null then raise exception 'غير مصرّح'; end if;
  if v_name = '' then raise exception 'اسم الجهة مطلوب'; end if;
  select u.display_name into v_disp from public.perf_users u where u.id = v_me;

  /* بياناتي: ما أُرسل ← آخر نقطةِ تواصلٍ لي ← سجلّ المستخدمين */
  select coalesce(nullif(btrim(p_my_title), ''), nullif(c.job_title, ''), nullif(u.job_title, ''), ''),
         coalesce(nullif(btrim(p_my_phone), ''), nullif(c.phone, ''),     nullif(u.phone, ''),     ''),
         coalesce(nullif(btrim(p_my_email), ''), nullif(c.email, ''),                              '')
    into v_title, v_phone, v_email
    from public.perf_users u
    left join lateral (
      select x.job_title, x.phone, x.email
        from public.perf_contacts x
       where x.side = 'نحن' and x.user_id = v_me
         and (coalesce(x.email, '') <> '' or coalesce(x.phone, '') <> '')
       order by x.at desc limit 1
    ) c on true
   where u.id = v_me;

  select e.id into v_id from public.perf_entities e
   where e.name_n = public.perf_ar_norm(v_name) limit 1;

  if v_id is null then
    v_id := 'ent-' || replace(gen_random_uuid()::text, '-', '');
    insert into public.perf_entities (id, name, kind, sector, note, active, added_by, added_by_name)
    values (v_id, v_name, coalesce(p_kind, ''), coalesce(p_sector, ''), coalesce(p_note, ''),
            true, v_me, coalesce(v_disp, ''));
  else
    v_exist := true;
    update public.perf_entities e set active = true where e.id = v_id and not e.active;
  end if;

  /* نقطة التواصل عندنا: أنا ببياناتي، ما لم تكن الجهة مسندةً لغيري */
  select c.name into v_owner from public.perf_contacts c
   where c.entity_id = v_id and c.side = 'نحن' and c.role = 'أساسي' limit 1;
  if v_owner is null then
    insert into public.perf_contacts (id, entity_id, side, role, name, job_title, phone, email, user_id)
    values ('con-' || replace(gen_random_uuid()::text, '-', ''), v_id, 'نحن', 'أساسي',
            coalesce(v_disp, ''), v_title, v_phone, v_email, v_me);
    v_owner := coalesce(v_disp, '');
  end if;

  /* نقطة التواصل من الجهة */
  if coalesce(btrim(p_their_name), '') <> '' or coalesce(btrim(p_their_phone), '') <> ''
     or coalesce(btrim(p_their_email), '') <> '' then
    if not exists (select 1 from public.perf_contacts c
                    where c.entity_id = v_id and c.side = 'الجهة' and c.role = 'أساسي') then
      insert into public.perf_contacts (id, entity_id, side, role, name, job_title, phone, email)
      values ('con-' || replace(gen_random_uuid()::text, '-', ''), v_id, 'الجهة', 'أساسي',
              btrim(coalesce(p_their_name, '')), btrim(coalesce(p_their_title, '')),
              btrim(coalesce(p_their_phone, '')), btrim(coalesce(p_their_email, '')));
    end if;
  end if;

  /* نقطة مكتب تحقيق الرؤية — طرفٌ ثالث مستقلّ */
  if coalesce(btrim(p_vro_name), '') <> '' or coalesce(btrim(p_vro_phone), '') <> ''
     or coalesce(btrim(p_vro_email), '') <> '' then
    if not exists (select 1 from public.perf_contacts c
                    where c.entity_id = v_id and c.side = 'VRO' and c.role = 'أساسي') then
      insert into public.perf_contacts (id, entity_id, side, role, name, job_title, phone, email)
      values ('con-' || replace(gen_random_uuid()::text, '-', ''), v_id, 'VRO', 'أساسي',
              btrim(coalesce(p_vro_name, '')), btrim(coalesce(p_vro_title, '')),
              btrim(coalesce(p_vro_phone, '')), btrim(coalesce(p_vro_email, '')));
    end if;
  end if;

  return query select v_id, v_exist, v_owner;
end;
$$;
revoke all on function public.perf_entity_add(text,text,text,text,text,text,text,text,text,text,text,text,text,text,text) from public, anon;
grant execute on function public.perf_entity_add(text,text,text,text,text,text,text,text,text,text,text,text,text,text,text) to authenticated;

select 'perf_entity_add' as "الدالة", 'تملأ بيانات صاحب الصفحة ونقاط الجهة والـVRO' as "الحالة";
