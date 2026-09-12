-- ============================================================
--  مكتبة الوثائق + معرفة المساعد الذكي
--  ------------------------------------------------------------
--  جدولان:
--    perf_docs        — الوثيقة نفسها (منهجية · نموذج · دليل …)
--                       وملفُها في تخزين المنصة، فيُنزَّل بضغطة.
--    perf_doc_chunks  — نصّها مقطّعاً بعناوينه وصفحاته، ليبحث
--                       فيه المساعد ويقتبس مع ذكر المصدر.
--
--  البحث العربي: يُخزَّن لكل مقطع نصٌّ «مُوحَّد» (بلا تشكيل، وألفه
--  وياؤه وتاؤه موحّدة) فيجد «الاستراتيجيه» ما كُتب «الإستراتيجية».
--  لا امتدادات ولا خدمات خارجية — دالة SQL بسيطة.
--
--  القراءة: كل من دخل المنصة. الكتابة: صلاحية «docs:edit».
--  idempotent وليس فيه حذف بيانات.
-- ============================================================

-- ------------------------------------------------------------
--  ١) توحيد النصّ العربي للبحث
-- ------------------------------------------------------------
create or replace function public.perf_ar_norm(p text)
returns text language sql immutable as $$
  /* توحيد النصّ قبل المطابقة — على النصّ المخزَّن والسؤال معاً:
     ١) إسقاط التشكيل والتطويل، وتوحيد الألف والياء والتاء المربوطة.
     ٢) توحيد «لا» و«ال» في رمز واحد: استخراج نصّ الـPDF يقلب
        حرفَي ليغاتورة لام‑ألف، فتُكتب «خلال» وتُستخرج «خالل».
     ٣) إسقاط سوابق التعريف من أول كل كلمة (ال · لل · وال · بال …):
        بلا هذا لا يجد سؤالٌ فيه «المهندسين» نصّاً فيه «للمهندسين»،
        وهي حالة تتكرّر في أسماء الجهات. */
  select regexp_replace(
    regexp_replace(
      lower(
        replace(replace(
          translate(
            regexp_replace(coalesce(p,''), '[ً-ْـ]', '', 'g'),
            'أإآٱىة', 'اااايه'),
          'لا', 'ﻻ'), 'ال', 'ﻻ')
      ),
      '(^|\s)(و|ف|ب|ك|ل)?(اﻻ|ﻻ|لل)', '\1', 'g'),
    '\s+', ' ', 'g');
$$;

-- ------------------------------------------------------------
--  ٢) الوثائق
-- ------------------------------------------------------------
create table if not exists public.perf_docs (
  id        text primary key,
  title     text not null,
  kind      text not null default 'منهجية',   -- منهجية · دليل · نموذج · محضر · عرض
  section   text not null default '',          -- ربطها بقسم من العناوين الأساسية
  tags      text[] not null default '{}',
  summary   text not null default '',
  file_path text not null default '',          -- المسار في تخزين المنصة
  file_name text not null default '',
  mime      text not null default '',
  size      bigint not null default 0,
  pages     int not null default 0,
  added_by  text not null default '',
  at        timestamptz not null default now(),
  active    boolean not null default true,
  title_n   text generated always as (public.perf_ar_norm(title)) stored
);
create index if not exists perf_docs_title_n on public.perf_docs (title_n);
alter table public.perf_docs enable row level security;
grant select, insert, update, delete on public.perf_docs to authenticated;

drop policy if exists "perf_docs_read" on public.perf_docs;
create policy "perf_docs_read" on public.perf_docs
  for select to authenticated using (public.perf_signed_in() and active);

drop policy if exists "perf_docs_write" on public.perf_docs;
create policy "perf_docs_write" on public.perf_docs
  for all to authenticated
  using (public.perf_has_scope('docs:edit'))
  with check (public.perf_has_scope('docs:edit'));

-- ------------------------------------------------------------
--  ٣) مقاطع النصّ
-- ------------------------------------------------------------
create table if not exists public.perf_doc_chunks (
  doc_id  text not null references public.perf_docs(id) on delete cascade,
  idx     int  not null,
  page    int  not null default 0,
  heading text not null default '',
  body    text not null default '',
  body_n  text generated always as (public.perf_ar_norm(heading || ' ' || body)) stored,
  primary key (doc_id, idx)
);
/* فهرس التسريع اختياري: يحتاج امتداد pg_trgm. إن لم يكن متاحاً
   يعمل البحث بلا فهرس — أبطأ قليلاً ولا يتعطّل. */
do $$
begin
  begin execute 'create extension if not exists pg_trgm'; exception when others then null; end;
  if exists (select 1 from pg_opclass where opcname = 'gin_trgm_ops') then
    execute 'create index if not exists perf_chunks_body_n on public.perf_doc_chunks using gin (body_n gin_trgm_ops)';
  end if;
end $$;
alter table public.perf_doc_chunks enable row level security;
grant select, insert, update, delete on public.perf_doc_chunks to authenticated;

drop policy if exists "perf_chunks_read" on public.perf_doc_chunks;
create policy "perf_chunks_read" on public.perf_doc_chunks
  for select to authenticated using (public.perf_signed_in());

drop policy if exists "perf_chunks_write" on public.perf_doc_chunks;
create policy "perf_chunks_write" on public.perf_doc_chunks
  for all to authenticated
  using (public.perf_has_scope('docs:edit'))
  with check (public.perf_has_scope('docs:edit'));

-- ------------------------------------------------------------
--  ٤) البحث: «أعطني ملف كذا» و«ما هي خطوات كذا»
--     الترتيب بعدد الكلمات التي وُجدت لا بأول ما صادف.
-- ------------------------------------------------------------
create or replace function public.perf_docs_find(p_q text, p_limit int default 5)
returns table (id text, title text, kind text, file_path text, file_name text,
               summary text, pages int, hits int)
language sql stable security definer set search_path = public as $$
  with w as (
    select unnest(string_to_array(public.perf_ar_norm(p_q), ' ')) as t
  ), words as (
    select t from w where length(t) >= 3
  )
  select d.id, d.title, d.kind, d.file_path, d.file_name, d.summary, d.pages,
         (select count(*)::int from words x
           where d.title_n like '%' || x.t || '%'
              or exists (select 1 from unnest(d.tags) g where public.perf_ar_norm(g) like '%' || x.t || '%')) as hits
    from public.perf_docs d
   where d.active and public.perf_signed_in()
     and (select count(*) from words x
           where d.title_n like '%' || x.t || '%'
              or exists (select 1 from unnest(d.tags) g where public.perf_ar_norm(g) like '%' || x.t || '%')) > 0
   order by hits desc, d.at desc
   limit greatest(1, p_limit);
$$;
revoke all on function public.perf_docs_find(text, int) from public, anon;
grant execute on function public.perf_docs_find(text, int) to authenticated;

drop function if exists public.perf_kb_search(text, int);
-- ============================================================
--  بحث المعرفة — ترجيح الكلمات النادرة
--  ------------------------------------------------------------
--  العدّ المجرّد للكلمات المتطابقة يُصعّد المقاطع المليئة بالكلمات
--  الشائعة («مؤشر» · «الأداء») فوق المقطع الذي فيه الكلمة المقصودة
--  («قطبية»). فصار وزن كل كلمة عكسَ شيوعها: النادرة تُرجّح، والشائعة
--  تكاد لا تؤثر، وكلماتُ السؤال الحشوية تُسقط أصلاً.
-- ============================================================
create or replace function public.perf_kb_search(p_q text, p_limit int default 4)
returns table (doc_id text, title text, page int, heading text, body text,
               file_path text, file_name text, score numeric)
language sql stable security definer set search_path = public as $$
  with raw as (
    select distinct unnest(string_to_array(public.perf_ar_norm(p_q), ' ')) as t
  ), words as (
    select t from raw
     where length(t) >= 3
       and t not in (  -- حشو السؤال: لا يدلّ على شيء
         public.perf_ar_norm('ما'), public.perf_ar_norm('هي'), public.perf_ar_norm('هو'),
         public.perf_ar_norm('كيف'), public.perf_ar_norm('وش'), public.perf_ar_norm('متى'),
         public.perf_ar_norm('اين'), public.perf_ar_norm('لماذا'), public.perf_ar_norm('معنى'),
         public.perf_ar_norm('يتم'), public.perf_ar_norm('عن'), public.perf_ar_norm('في'),
         public.perf_ar_norm('من'), public.perf_ar_norm('على'), public.perf_ar_norm('الى'),
         public.perf_ar_norm('ابي'), public.perf_ar_norm('اريد'), public.perf_ar_norm('عطني'),
         public.perf_ar_norm('ملف'), public.perf_ar_norm('وثيقة'))
  ), df as (  -- كم مقطعاً تظهر فيه كل كلمة
    select w.t, greatest(1, count(c.*)) as n
      from words w
      left join public.perf_doc_chunks c on c.body_n like '%' || w.t || '%'
     group by w.t
  ), tot as (select greatest(1, count(*))::numeric as n from public.perf_doc_chunks)
  select c.doc_id, d.title, c.page, c.heading, c.body, d.file_path, d.file_name,
         round(sum(ln((select n from tot) / df.n) + 0.1)::numeric, 3) as score
    from public.perf_doc_chunks c
    join public.perf_docs d on d.id = c.doc_id and d.active
    join df on c.body_n like '%' || df.t || '%'
   where public.perf_signed_in()
   group by c.doc_id, d.title, c.page, c.heading, c.body, d.file_path, d.file_name
  having count(*) >= least(2, (select count(*) from words))
   order by score desc, length(c.body) asc
   limit greatest(1, p_limit);
$$;
revoke all on function public.perf_kb_search(text, int) from public, anon;
grant execute on function public.perf_kb_search(text, int) to authenticated;

-- ------------------------------------------------------------
--  ٥) صلاحية رفع الوثائق — لمالكة المنصة ومدير الإدارة
-- ------------------------------------------------------------
update public.perf_users
   set scopes = (select array(select distinct unnest(coalesce(scopes,'{}') || array['docs:edit'])))
 where active
   and public.perf_norm_name(display_name) in (
         public.perf_norm_name('سلطانه العرجاني'),
         public.perf_norm_name('عبدالله الحزامي'));

select 'perf_docs' as "الجدول", count(*)::text as "عدد" from public.perf_docs
union all select 'perf_doc_chunks', count(*)::text from public.perf_doc_chunks;
