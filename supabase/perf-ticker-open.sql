-- ============================================================
--  شريط الإعلانات: النشر لكل من دخل
--  ------------------------------------------------------------
--  كان النشر محصوراً بصلاحية «announce»، وصار لكل موظفٍ في
--  المنصة — بطلب صاحبة المنصة. فالإعلان خبرٌ قصير بمدّةٍ تنتهي
--  وحدها، لا قراراً يحتاج إذناً.
--
--  وتبقى حمايتان: **الإعلان باسم ناشره** لا يُنسب لغيره، و**لا
--  يُنهيه إلا صاحبُه أو صاحب الصلاحية الكاملة** — فالمفتوح للنشر
--  يحتاج من يكنس ما لا يصلح.
--
--  idempotent — يُشغَّل بعد perf-ticker.sql
-- ============================================================

/* الكتابة: كلُّ من دخل، وباسمه هو */
drop policy if exists perf_ticker_ins on public.perf_ticker;
create policy perf_ticker_ins on public.perf_ticker
  for insert to authenticated
  with check (public.perf_signed_in() and by_id = public.perf_my_id());

/* الإنهاء المبكر: صاحبُ الإعلان، أو من يملك الصلاحية الكاملة */
drop policy if exists perf_ticker_upd on public.perf_ticker;
create policy perf_ticker_upd on public.perf_ticker
  for update to authenticated
  using (public.perf_signed_in()
         and (by_id = public.perf_my_id() or public.perf_has_scope('admin')))
  with check (public.perf_signed_in());

/* ---------- ما يُعرض الآن: ومعه مَن يملك إنهاءه ---------- */
drop function if exists public.perf_ticker_live();
create or replace function public.perf_ticker_live()
returns table (id text, body text, tone text, by_name text, until timestamptz,
               mine boolean, can_stop boolean)
language sql stable security definer set search_path = public as $$
  select k.id, k.body, k.tone, k.by_name, k.until,
         k.by_id is not distinct from public.perf_my_id(),
         (k.by_id is not distinct from public.perf_my_id()) or public.perf_has_scope('admin')
    from public.perf_ticker k
   where k.active and k.until > now() and public.perf_signed_in()
   order by (k.tone = 'red') desc, k.at;
$$;
revoke all on function public.perf_ticker_live() from public, anon;
grant execute on function public.perf_ticker_live() to authenticated;

/* ---------- النشر: بلا صلاحية ---------- */
create or replace function public.perf_ticker_say(p_body text, p_tone text, p_hours int)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_me  bigint := public.perf_my_id();
  v_n   text;
  v_id  text;
  v_b   text := btrim(coalesce(p_body, ''));
  v_t   text := case when p_tone = 'red' then 'red' else 'green' end;
  v_h   int  := greatest(1, least(coalesce(p_hours, 24), 336));
begin
  if v_me is null then raise exception 'غير مصرّح'; end if;
  if v_b = '' then raise exception 'نصّ الإعلان مطلوب'; end if;
  if length(v_b) > 280 then raise exception 'الإعلان أطول من 280 حرفاً'; end if;

  select display_name into v_n from public.perf_users where id = v_me;
  v_id := 'tk-' || replace(gen_random_uuid()::text, '-', '');
  insert into public.perf_ticker (id, body, tone, by_id, by_name, until)
  values (v_id, v_b, v_t, v_me, coalesce(v_n, ''), now() + make_interval(hours => v_h));
  return v_id;
end;
$$;
revoke all on function public.perf_ticker_say(text, text, int) from public, anon;
grant execute on function public.perf_ticker_say(text, text, int) to authenticated;

select 'النشر' as "الصلاحية", 'لكل من دخل' as "الحالة"
union all select 'الإنهاء', 'لصاحب الإعلان أو صاحب الصلاحية الكاملة';
