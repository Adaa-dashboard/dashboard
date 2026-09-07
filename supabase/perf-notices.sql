-- إعلان القلم: إنشاء + إصلاح + تشخيص في استعلام واحد
create table if not exists public.perf_notices (
  id       text primary key,
  title    text        not null,
  body     text        not null default '',
  at       timestamptz not null default now(),
  by_name  text        not null default 'المطوّر',
  until    date,
  audience text[]      not null default '{}'
);
alter table public.perf_notices enable row level security;
grant select on public.perf_notices to authenticated;
revoke insert, update, delete on public.perf_notices from authenticated;

drop policy if exists "perf_notices_read" on public.perf_notices;
create policy "perf_notices_read" on public.perf_notices
  for select to authenticated
  using (
    public.perf_signed_in()
    and (until is null or until >= current_date)
    and (
      cardinality(audience) = 0
      or exists (
        select 1 from public.perf_sessions s
         join public.perf_users u on u.id = s.app_user_id
        where s.user_id = auth.uid() and u.username = any(audience))
    ));

-- الإدراج لا يتوقف بخطأ: الجمهور يُبنى مما وُجد، والتشخيص أدناه يقول ما نقص
insert into public.perf_notices (id, title, body, audience)
select 'n-sticky',
  'جديد: القلم — ملاحظة لاصقة على أي مكان في الصفحة',
  'في أسفل يمين كل صفحة زرّ ✎. اضغطه ثم اضغط المكان الذي تريد الملاحظة عنده، '
  || 'فتُفتح ورقة صفراء هناك تكتب فيها ملاحظتك أو سؤالك.'
  || E'\n' ||
  'تختار مدّة بقائها: ٣ أيام · أسبوع · شهر · بلا مدة — وتختفي بانتهائها من نفسها.'
  || E'\n' ||
  'الورقة تُطوى إلى دبّوس صغير بزرّ (−) حتى لا تحجب ما تحتها، وتُسحب من رأسها إلى مكان آخر.'
  || E'\n' ||
  'وتصل من يفتح تلك الصفحة في «آخر التحديثات»، ومن يحرّرها يغلقها بـ«تمّت المعالجة» بعد الردّ.',
  coalesce((select array_agg(u.username) from public.perf_users u
             where u.active and public.perf_norm_name(u.display_name) in (
                   public.perf_norm_name('عبدالله الحزامي'),
                   public.perf_norm_name('عمر العتيق'),
                   public.perf_norm_name('سلطانه العرجاني'))), '{}')
on conflict (id) do update
  set title = excluded.title, body = excluded.body, audience = excluded.audience;

-- التشخيص
select 'وصل إلى' as "الفحص",
       case when cardinality(audience)=0 then '⚠️ فارغ ⇒ يظهر للجميع'
            else array_to_string(audience,' · ') end as "النتيجة"
  from public.perf_notices where id='n-sticky'
union all
select 'من لم يُعثر عليه',
       coalesce((select string_agg(n,' · ') from unnest(array[
                  'عبدالله الحزامي','عمر العتيق','سلطانه العرجاني']) n
                  where not exists (select 1 from public.perf_users u
                                     where u.active and public.perf_norm_name(u.display_name)
                                         = public.perf_norm_name(n))), '✅ الثلاثة موجودون')
union all
select 'اسم دخولي',
       coalesce((select username from public.perf_users where active
                  and public.perf_norm_name(display_name)
                    = public.perf_norm_name('سلطانه العرجاني')), '❌ لا حساب بهذا الاسم')
union all
select 'هل يظهر لي؟',
       case when exists (select 1 from public.perf_notices n, public.perf_users u
                          where n.id='n-sticky' and u.active
                            and public.perf_norm_name(u.display_name)
                              = public.perf_norm_name('سلطانه العرجاني')
                            and (cardinality(n.audience)=0 or u.username = any(n.audience)))
            then '✅ نعم' else '❌ لا' end;
