-- ============================================================
--  شريط الإعلانات المتحرّك
--  ------------------------------------------------------------
--  إعلانٌ قصير يكتبه صاحب صلاحية «إعلان» فيمرّ على المنصة كلها
--  أمام الجميع: «حدّثوا جهات الاتصال»، «رُفع ملف الاستراتيجيات».
--
--  **له مدّة لا حذفٌ يدوي**: الكاتب يحدّد ساعتين أو يومين فينتهي
--  وحده. إعلانٌ بلا نهاية يصير أثاثاً لا يُقرأ، ويبقى بعد زوال
--  سببه. و`until` عمودٌ لا حسبةٌ في الواجهة، فالانتهاء يسري على
--  الجميع في اللحظة نفسها.
--
--  ولونان بمعنىً لا بزينة: أحمر عاجلٌ جدّاً، أخضر تحديثٌ دوري.
--
--  تُقرأ النشطةُ وحدها من `perf_ticker_live()` — فلا يرى أحد
--  منتهياً ولا مُلغى، ولا تُقرأ الأسطر مباشرةً من الجدول.
--
--  idempotent — آمن للتشغيل أكثر من مرة
-- ============================================================

create table if not exists public.perf_ticker (
  id       text primary key,
  body     text        not null,
  tone     text        not null default 'green' check (tone in ('red', 'green')),
  by_id    bigint      references public.perf_users(id) on delete set null,
  by_name  text        not null default '',
  at       timestamptz not null default now(),
  until    timestamptz not null,
  active   boolean     not null default true
);
create index if not exists perf_ticker_live on public.perf_ticker (until desc) where active;
alter table public.perf_ticker enable row level security;
grant select, insert, update on public.perf_ticker to authenticated;
revoke delete on public.perf_ticker from authenticated;

/* القراءة: كلُّ من دخل — الإعلان للجميع بطبعه */
drop policy if exists perf_ticker_read on public.perf_ticker;
create policy perf_ticker_read on public.perf_ticker
  for select to authenticated using (public.perf_signed_in());

/* الكتابة: صاحب صلاحية «announce» وحده، وباسمه هو */
drop policy if exists perf_ticker_ins on public.perf_ticker;
create policy perf_ticker_ins on public.perf_ticker
  for insert to authenticated
  with check (public.perf_has_scope('announce') and by_id = public.perf_my_id());

/* الإنهاء المبكر: صاحبُ الإعلان، أو من يملك الصلاحية الكاملة */
drop policy if exists perf_ticker_upd on public.perf_ticker;
create policy perf_ticker_upd on public.perf_ticker
  for update to authenticated
  using (public.perf_has_scope('announce')
         and (by_id = public.perf_my_id() or public.perf_has_scope('admin')))
  with check (public.perf_has_scope('announce'));

/* ---------- ما يُعرض الآن ---------- */
create or replace function public.perf_ticker_live()
returns table (id text, body text, tone text, by_name text, until timestamptz, mine boolean)
language sql stable security definer set search_path = public as $$
  select k.id, k.body, k.tone, k.by_name, k.until,
         k.by_id is not distinct from public.perf_my_id()
    from public.perf_ticker k
   where k.active and k.until > now() and public.perf_signed_in()
   order by (k.tone = 'red') desc, k.at;
$$;
revoke all on function public.perf_ticker_live() from public, anon;
grant execute on function public.perf_ticker_live() to authenticated;

/* ---------- نشر إعلان ---------- */
/* المدّة بالساعات: الواجهة تعرض ساعتين ويوماً ويومين وأسبوعاً،
   والحدّ أربعة عشر يوماً — فوقها يصير الإعلان أثاثاً. */
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
  if v_me is null or not public.perf_has_scope('announce') then
    raise exception 'النشر لمن يملك صلاحية «إعلان»';
  end if;
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

/* ---------- إنهاء إعلان قبل موعده ---------- */
create or replace function public.perf_ticker_stop(p_id text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_me bigint := public.perf_my_id(); v_by bigint;
begin
  if v_me is null then raise exception 'غير مصرّح'; end if;
  select by_id into v_by from public.perf_ticker where id = p_id;
  if v_by is null and not found then return false; end if;
  if v_by is distinct from v_me and not public.perf_has_scope('admin') then
    raise exception 'الإنهاء لصاحب الإعلان';
  end if;
  update public.perf_ticker set active = false where id = p_id;
  return true;
end;
$$;
revoke all on function public.perf_ticker_stop(text) from public, anon;
grant execute on function public.perf_ticker_stop(text) to authenticated;

select 'perf_ticker' as "الجدول", count(*) as "إعلانات نشطة"
  from public.perf_ticker where active and until > now();
