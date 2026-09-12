-- ============================================================
--  الاستشاري يحرّر جهاته من صفحته، وينعكس في السجلّ مباشرة
--  ------------------------------------------------------------
--  السجلّ المركزي واحد، لكن أقرب الناس إلى صحّته هو من يتولّى
--  الجهة. فمن كان نقطة تواصلها يعدّل بياناتها من «محفظتي»:
--  مسمّاه فيها، ونقطة تواصل الجهة واسمها وهاتفها وبريدها — ويضيف
--  نقطة تواصل جديدة إن استجدّت.
--
--  وما لا يملكه: اسم الجهة نفسها، ولا نقلها لغيره، ولا جهةٌ ليس
--  نقطةَ تواصلها. تلك تبقى بصلاحية «entities:edit».
--
--  idempotent وليس فيه حذف بيانات. يُشغَّل بعد perf-entities.sql
-- ============================================================

/** هل أنا نقطة التواصل المسنَدة لهذه الجهة؟ */
create or replace function public.perf_owns_entity(p_entity text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.perf_contacts c
     where c.entity_id = p_entity and c.side = 'نحن'
       and c.user_id = public.perf_my_id());
$$;
revoke all on function public.perf_owns_entity(text) from public, anon;
grant execute on function public.perf_owns_entity(text) to authenticated;

-- التعديل: صاحب الصلاحية الكاملة، أو من يتولّى الجهة
drop policy if exists "perf_con_write" on public.perf_contacts;
create policy "perf_con_write" on public.perf_contacts
  for all to authenticated
  using (public.perf_has_scope('entities:edit') or public.perf_owns_entity(entity_id))
  with check (public.perf_has_scope('entities:edit') or public.perf_owns_entity(entity_id));

/* حارسٌ إضافي في القاعدة لا في الواجهة: من يتولّى الجهة لا يغيّر
   إسنادها — لا ينزعه عن نفسه ولا يمنحه لغيره. والصلاحية الكاملة
   وحدها تفعل ذلك. */
create or replace function public.perf_contacts_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.perf_has_scope('entities:edit') then return new; end if;
  if tg_op = 'UPDATE' and new.side = 'نحن'
     and (new.user_id is distinct from old.user_id or new.side is distinct from old.side) then
    raise exception 'إسناد الجهة يغيّره صاحب صلاحية «الجهات» وحده';
  end if;
  if tg_op = 'INSERT' and new.side = 'نحن' and new.user_id is distinct from public.perf_my_id() then
    raise exception 'لا تُسند الجهة لغيرك';
  end if;
  return new;
end;
$$;
drop trigger if exists perf_contacts_guard_t on public.perf_contacts;
create trigger perf_contacts_guard_t
  before insert or update on public.perf_contacts
  for each row execute function public.perf_contacts_guard();

-- ------------------------------------------------------------
--  «جهاتي» تُرجع نقاط التواصل بمعرّفاتها ليُعدَّل عليها
-- ------------------------------------------------------------
drop function if exists public.perf_my_entities();
create or replace function public.perf_my_entities()
returns table (entity_id text, name text, kind text, sector text,
               my_contact_id text, my_role text, theirs jsonb)
language sql stable security definer set search_path = public as $$
  select e.id, e.name, e.kind, e.sector, c.id,
         coalesce(nullif(c.note,''), c.job_title),
         coalesce((select jsonb_agg(jsonb_build_object(
                     'id', x.id, 'name', x.name, 'jobTitle', x.job_title,
                     'email', x.email, 'phone', x.phone) order by x.name)
                     from public.perf_contacts x
                    where x.entity_id = e.id and x.side <> 'نحن'), '[]'::jsonb)
    from public.perf_contacts c
    join public.perf_entities e on e.id = c.entity_id and e.active
   where c.side = 'نحن' and c.user_id = public.perf_my_id()
   order by e.name;
$$;
revoke all on function public.perf_my_entities() from public, anon;
grant execute on function public.perf_my_entities() to authenticated;

select 'perf_owns_entity' as "الدالة", 'جاهزة' as "الحالة";
