-- ============================================================
--  تحديثات إضافية من المطوّر — إعلانٌ داخل «آخر التحديثات»
--  يُشغَّل بعد perf-sticky.sql. idempotent وليس فيه حذف بيانات.
-- ============================================================

-- ------------------------------------------------------------
--  ١) الجدول
--     audience فارغاً = للجميع، وإلا فأسماء دخول بعينها.
--     until فارغاً = يبقى، وإلا يختفي بانقضاء تاريخه.
-- ------------------------------------------------------------
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

-- القراءة: للجميع إن كان الإعلان عاماً، وإلا لمن سُمّي فيه
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

-- الكتابة من SQL Editor وحده — لا يكتبها أحد من الواجهة
revoke insert, update, delete on public.perf_notices from authenticated;

-- ------------------------------------------------------------
--  ٢) أول إعلان: القلم والملاحظات اللاصقة
-- ------------------------------------------------------------
insert into public.perf_notices (id, title, body, audience) values (
  'n-sticky',
  'جديد: القلم — ملاحظة لاصقة على أي مكان في الصفحة',
  'في أسفل يمين كل صفحة زرّ ✎. اضغطه ثم اضغط المكان الذي تريد الملاحظة عنده، '
  || 'فتُفتح ورقة صفراء هناك تكتب فيها ملاحظتك أو سؤالك.'
  || E'\n' ||
  'تختار مدّة بقائها: ٣ أيام · أسبوع · شهر · بلا مدة — وتختفي بانتهائها من نفسها.'
  || E'\n' ||
  'الورقة تُطوى إلى دبّوس صغير بزرّ (−) حتى لا تحجب ما تحتها، وتُسحب من رأسها إلى مكان آخر.'
  || E'\n' ||
  'وتصل من يفتح تلك الصفحة في «آخر التحديثات»، ومن يحرّرها يغلقها بـ«تمّت المعالجة» بعد الردّ.',
  array['aalhizami','oalateeq','sultana']
) on conflict (id) do update
  set title = excluded.title, body = excluded.body, audience = excluded.audience;

-- ------------------------------------------------------------
--  ٣) المراجعة
-- ------------------------------------------------------------
select title as "العنوان",
       case when cardinality(audience) = 0 then 'الجميع'
            else array_to_string(audience, ' · ') end as "لمن",
       coalesce(until::text, 'بلا انتهاء') as "حتى"
  from public.perf_notices order by at desc;

-- ============================================================
--  لإضافة إعلان جديد لاحقاً:
--    insert into public.perf_notices (id, title, body, audience)
--    values ('n-xxx', 'العنوان', 'الشرح', array['aalhizami','sultana']);
--  (audience فارغاً ⇒ للجميع)
-- ============================================================
