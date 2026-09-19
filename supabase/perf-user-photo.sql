-- ============================================================
--  صورة الموظف
--  ------------------------------------------------------------
--  تظهر في «أعلى الاستشاريين التزاماً» وفي محفظته. يرفعها الموظف
--  لنفسه، أو يرفعها صاحب صلاحية «المستخدمون» لغيره.
--
--  idempotent وليس فيه حذف بيانات. يُشغَّل بعد perf-changes.sql
-- ============================================================

alter table public.perf_users
  add column if not exists photo_url text not null default '';

-- قائمة الأسماء تُرجع الصورة كذلك
drop function if exists public.perf_people();
create or replace function public.perf_people()
returns table (id text, name text, role text, sector_ids text[],
               active boolean, is_lead boolean, job_title text, photo_url text)
language plpgsql security definer set search_path = public as $$
begin
  if not public.perf_signed_in() then raise exception 'forbidden'; end if;
  return query select u.id::text, u.display_name, u.role, u.sector_ids,
                      u.active, u.is_lead, u.job_title, u.photo_url
                 from public.perf_users u
                where u.active
                order by u.is_lead desc, u.display_name;
end;
$$;
revoke all on function public.perf_people() from public, anon;
grant execute on function public.perf_people() to authenticated;

/* تعيين الصورة: لنفسه دائماً، ولغيره بصلاحية «المستخدمون» —
   الحارس في القاعدة لا في الواجهة */
create or replace function public.perf_set_photo(p_id bigint, p_url text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_me bigint := public.perf_my_id();
begin
  if v_me is null then raise exception 'غير مصرّح'; end if;
  if p_id is distinct from v_me and not public.perf_has_scope('users') then
    raise exception 'الصورة يغيّرها صاحبها أو صاحب صلاحية «المستخدمون»';
  end if;
  update public.perf_users set photo_url = coalesce(btrim(p_url), '')
   where id = coalesce(p_id, v_me);
  return true;
end;
$$;
revoke all on function public.perf_set_photo(bigint, text) from public, anon;
grant execute on function public.perf_set_photo(bigint, text) to authenticated;

/* الصور تُرفع إلى مجلد avatars/ داخل سلّة الوثائق — القراءة عامة
   كما هي، والكتابة لكل مسجَّل في هذا المجلد وحده */
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    execute $p$drop policy if exists "perf_avatars_insert" on storage.objects$p$;
    execute $p$create policy "perf_avatars_insert" on storage.objects
      for insert to authenticated
      with check (bucket_id = 'docs' and name like 'avatars/%' and public.perf_signed_in())$p$;
    execute $p$drop policy if exists "perf_avatars_update" on storage.objects$p$;
    execute $p$create policy "perf_avatars_update" on storage.objects
      for update to authenticated
      using (bucket_id = 'docs' and name like 'avatars/%' and public.perf_signed_in())
      with check (bucket_id = 'docs' and name like 'avatars/%' and public.perf_signed_in())$p$;
  end if;
end $$;

select 'photo_url' as "العمود", 'جاهز' as "الحالة";
