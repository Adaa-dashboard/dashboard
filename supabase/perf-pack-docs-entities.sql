-- ============================================================
--  حزمة واحدة: منهجيات أداء + الجهات ونقاط التواصل
--  ------------------------------------------------------------
--  تجمع خمسة ملفات بترتيبها الصحيح — والترتيب ليس تفصيلاً:
--  جداول الجهات تستعمل دالة توحيد النصّ المعرَّفة في أولها.
--
--  آمنة للتشغيل أكثر من مرة (idempotent)، وليس فيها حذف بيانات.
--  تُشغَّل دفعة واحدة في SQL Editor.
-- ============================================================



-- ===== [ perf-docs.sql ] ============================================

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


-- ===== [ perf-entities.sql ] ============================================

-- ============================================================
--  الجهات ونقاط التواصل
--  ------------------------------------------------------------
--  سجلٌّ مركزي واحد يجيب سؤالاً يتكرّر في القروبات: «هل عندنا
--  نقطة تواصل مع جهة كذا؟» — فيُقرأ من المنصة بلا سؤال أحد.
--
--  جدولان:
--    perf_entities  — الجهة (وزارة · هيئة · برنامج …)
--    perf_contacts  — نقطة تواصل: من عندنا (side='نحن') أو من
--                     الجهة (side='الجهة'). ونقطتنا تُربط بحساب
--                     الموظف، فتظهر الجهة في «جهاتي» بلا تعبئة.
--
--  القراءة لكل من دخل المنصة — فالمعرفة بلا بحث عنها هي المقصود.
--  الكتابة بصلاحية «entities:edit».
--  idempotent وليس فيه حذف بيانات.
--  يُشغَّل بعد perf-docs.sql (يستعمل perf_ar_norm منه).
-- ============================================================

create table if not exists public.perf_entities (
  id        text primary key,
  name      text not null,
  kind      text not null default '',          -- وزارة · هيئة · برنامج · مركز …
  sector    text not null default '',          -- القطاع في المركز
  note      text not null default '',
  active    boolean not null default true,
  at        timestamptz not null default now(),
  name_n    text generated always as (public.perf_ar_norm(name)) stored
);
create index if not exists perf_entities_name_n on public.perf_entities (name_n);
alter table public.perf_entities enable row level security;
grant select, insert, update, delete on public.perf_entities to authenticated;

drop policy if exists "perf_ent_read" on public.perf_entities;
create policy "perf_ent_read" on public.perf_entities
  for select to authenticated using (public.perf_signed_in());
drop policy if exists "perf_ent_write" on public.perf_entities;
create policy "perf_ent_write" on public.perf_entities
  for all to authenticated
  using (public.perf_has_scope('entities:edit'))
  with check (public.perf_has_scope('entities:edit'));

create table if not exists public.perf_contacts (
  id         text primary key,
  entity_id  text not null references public.perf_entities(id) on delete cascade,
  side       text not null default 'الجهة',    -- 'نحن' أو 'الجهة'
  name       text not null default '',
  job_title  text not null default '',
  email      text not null default '',
  phone      text not null default '',
  note       text not null default '',
  /* ربط نقطة تواصلنا بحساب الموظف — فتظهر الجهة في «جهاتي» عنده
     بلا أن يعبّئها، ويُعرف من يتولّاها إن غاب */
  user_id    bigint references public.perf_users(id) on delete set null,
  at         timestamptz not null default now(),
  name_n     text generated always as (public.perf_ar_norm(name || ' ' || job_title)) stored
);
create index if not exists perf_contacts_entity on public.perf_contacts (entity_id);
create index if not exists perf_contacts_user on public.perf_contacts (user_id);
alter table public.perf_contacts enable row level security;
grant select, insert, update, delete on public.perf_contacts to authenticated;

drop policy if exists "perf_con_read" on public.perf_contacts;
create policy "perf_con_read" on public.perf_contacts
  for select to authenticated using (public.perf_signed_in());
drop policy if exists "perf_con_write" on public.perf_contacts;
create policy "perf_con_write" on public.perf_contacts
  for all to authenticated
  using (public.perf_has_scope('entities:edit'))
  with check (public.perf_has_scope('entities:edit'));

-- ------------------------------------------------------------
--  البحث: «هل عندنا نقطة تواصل مع هيئة المقاولين؟»
--  يبحث في اسم الجهة وفي أسماء نقاط التواصل ومسمّياتها.
-- ------------------------------------------------------------
create or replace function public.perf_entities_find(p_q text, p_limit int default 8)
returns table (id text, name text, kind text, sector text,
               ours jsonb, theirs jsonb, hits int)
language sql stable security definer set search_path = public as $$
  with words as (
    select t from (select distinct unnest(string_to_array(public.perf_ar_norm(p_q), ' ')) as t) w
     where length(t) >= 3
       and t not in (public.perf_ar_norm('عندنا'), public.perf_ar_norm('هل'),
                     public.perf_ar_norm('نقطة'), public.perf_ar_norm('تواصل'),
                     public.perf_ar_norm('مع'), public.perf_ar_norm('احد'),
                     public.perf_ar_norm('من'), public.perf_ar_norm('في'))
  )
  select e.id, e.name, e.kind, e.sector,
         coalesce((select jsonb_agg(jsonb_build_object(
                     'name', c.name, 'jobTitle', c.job_title,
                     'email', c.email, 'phone', c.phone, 'note', c.note)
                   order by c.name)
                     from public.perf_contacts c
                    where c.entity_id = e.id and c.side = 'نحن'), '[]'::jsonb),
         coalesce((select jsonb_agg(jsonb_build_object(
                     'name', c.name, 'jobTitle', c.job_title,
                     'email', c.email, 'phone', c.phone, 'note', c.note)
                   order by c.name)
                     from public.perf_contacts c
                    where c.entity_id = e.id and c.side <> 'نحن'), '[]'::jsonb),
         (select count(*)::int from words x
           where e.name_n like '%' || x.t || '%'
              or exists (select 1 from public.perf_contacts c
                          where c.entity_id = e.id and c.name_n like '%' || x.t || '%')) as hits
    from public.perf_entities e
   where e.active and public.perf_signed_in()
     and (select count(*) from words x
           where e.name_n like '%' || x.t || '%'
              or exists (select 1 from public.perf_contacts c
                          where c.entity_id = e.id and c.name_n like '%' || x.t || '%')) > 0
   order by hits desc, e.name
   limit greatest(1, p_limit);
$$;
revoke all on function public.perf_entities_find(text, int) from public, anon;
grant execute on function public.perf_entities_find(text, int) to authenticated;

-- ------------------------------------------------------------
--  جهاتي: ما أنا نقطة التواصل فيه — تُقرأ في «محفظتي» بلا تعبئة
-- ------------------------------------------------------------
create or replace function public.perf_my_entities()
returns table (entity_id text, name text, kind text, sector text,
               my_role text, theirs jsonb)
language sql stable security definer set search_path = public as $$
  select e.id, e.name, e.kind, e.sector, coalesce(nullif(c.note,''), c.job_title),
         coalesce((select jsonb_agg(jsonb_build_object(
                     'name', x.name, 'jobTitle', x.job_title,
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

-- ------------------------------------------------------------
--  ربط نقاط تواصلنا بحسابات الموظفين بالاسم
--  يُشغَّل بعد كل استيراد — يطابق بالاسم المُوحَّد، ولا يلمس
--  ما رُبط يدوياً ولا يخمّن عند التشابه.
-- ------------------------------------------------------------
create or replace function public.perf_contacts_link()
returns table (linked int, unmatched int)
language plpgsql security definer set search_path = public as $$
declare v_linked int; v_un int;
begin
  if not public.perf_has_scope('entities:edit') then raise exception 'forbidden'; end if;

  update public.perf_contacts c
     set user_id = u.id
    from public.perf_users u
   where c.side = 'نحن' and c.user_id is null and u.active
     and public.perf_norm_name(u.display_name) = public.perf_norm_name(c.name);
  get diagnostics v_linked = row_count;

  select count(*)::int into v_un
    from public.perf_contacts c
   where c.side = 'نحن' and c.user_id is null;

  return query select v_linked, v_un;
end;
$$;
revoke all on function public.perf_contacts_link() from public, anon;
grant execute on function public.perf_contacts_link() to authenticated;

-- من لم يُربط — لمراجعته يدوياً
create or replace function public.perf_contacts_unlinked()
returns table (contact_id text, name text, entity text)
language sql stable security definer set search_path = public as $$
  select c.id, c.name, e.name
    from public.perf_contacts c
    join public.perf_entities e on e.id = c.entity_id
   where c.side = 'نحن' and c.user_id is null and public.perf_has_scope('entities:edit')
   order by c.name;
$$;
revoke all on function public.perf_contacts_unlinked() from public, anon;
grant execute on function public.perf_contacts_unlinked() to authenticated;


-- ------------------------------------------------------------
--  الأعمدة المُولَّدة لا تُحسب من جديد حين تتغيّر دالة التوحيد،
--  فتُحدَّث الصفوف لتُعاد حوسبتها. لا يغيّر بيانات.
-- ------------------------------------------------------------
update public.perf_entities set name = name;
update public.perf_contacts set name = name;

-- ------------------------------------------------------------
--  الصلاحية: الجهات يراها الجميع، وتحريرها لمالكة المنصة ومدير الإدارة
-- ------------------------------------------------------------
update public.perf_users
   set scopes = (select array(select distinct unnest(coalesce(scopes,'{}') || array['entities'])))
 where active;

update public.perf_users
   set scopes = (select array(select distinct unnest(coalesce(scopes,'{}') || array['entities:edit'])))
 where active
   and public.perf_norm_name(display_name) in (
         public.perf_norm_name('سلطانه العرجاني'),
         public.perf_norm_name('عبدالله الحزامي'));

select 'perf_entities' as "الجدول", count(*)::text as "عدد" from public.perf_entities
union all select 'perf_contacts', count(*)::text from public.perf_contacts;


-- ===== [ perf-entities-own.sql ] ============================================

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


-- ===== [ perf-contacts-role.sql ] ============================================

-- ============================================================
--  نقطة التواصل: أساسي وبديل
--  ------------------------------------------------------------
--  ملف الجهات يحمل لكل طرف شخصين: الأساسي ومن ينوب عنه. وهذا هو
--  بيت القصيد عملياً — حين لا يردّ الأساسي يُطلب البديل بلا سؤال.
--
--  idempotent وليس فيه حذف بيانات. يُشغَّل بعد perf-entities.sql
-- ============================================================

alter table public.perf_contacts
  add column if not exists role text not null default 'أساسي';   -- أساسي · بديل

create index if not exists perf_contacts_role on public.perf_contacts (entity_id, side, role);

-- «جهاتي» تُرجع الطرفين بأدوارهما
drop function if exists public.perf_my_entities();
create or replace function public.perf_my_entities()
returns table (entity_id text, name text, kind text, sector text,
               my_contact_id text, my_role text, mine jsonb, theirs jsonb)
language sql stable security definer set search_path = public as $$
  select e.id, e.name, e.kind, e.sector, c.id,
         coalesce(nullif(c.note,''), c.job_title),
         coalesce((select jsonb_agg(jsonb_build_object(
                     'id', x.id, 'role', x.role, 'name', x.name, 'jobTitle', x.job_title,
                     'email', x.email, 'phone', x.phone)
                   order by (x.role <> 'أساسي'), x.name)
                     from public.perf_contacts x
                    where x.entity_id = e.id and x.side = 'نحن'), '[]'::jsonb),
         coalesce((select jsonb_agg(jsonb_build_object(
                     'id', x.id, 'role', x.role, 'name', x.name, 'jobTitle', x.job_title,
                     'email', x.email, 'phone', x.phone)
                   order by (x.role <> 'أساسي'), x.name)
                     from public.perf_contacts x
                    where x.entity_id = e.id and x.side <> 'نحن'), '[]'::jsonb)
    from public.perf_contacts c
    join public.perf_entities e on e.id = c.entity_id and e.active
   where c.side = 'نحن' and c.user_id = public.perf_my_id()
   order by e.name;
$$;
revoke all on function public.perf_my_entities() from public, anon;
grant execute on function public.perf_my_entities() to authenticated;

-- والبحث يُرجع الدور كذلك، فيظهر «بديل» في جواب المساعد
create or replace function public.perf_entities_find(p_q text, p_limit int default 8)
returns table (id text, name text, kind text, sector text,
               ours jsonb, theirs jsonb, hits int)
language sql stable security definer set search_path = public as $$
  with words as (
    select t from (select distinct unnest(string_to_array(public.perf_ar_norm(p_q), ' ')) as t) w
     where length(t) >= 3
       and t not in (public.perf_ar_norm('عندنا'), public.perf_ar_norm('هل'),
                     public.perf_ar_norm('نقطة'), public.perf_ar_norm('تواصل'),
                     public.perf_ar_norm('مع'), public.perf_ar_norm('احد'),
                     public.perf_ar_norm('من'), public.perf_ar_norm('في'))
  )
  select e.id, e.name, e.kind, e.sector,
         coalesce((select jsonb_agg(jsonb_build_object(
                     'role', c.role, 'name', c.name, 'jobTitle', c.job_title,
                     'email', c.email, 'phone', c.phone, 'note', c.note)
                   order by (c.role <> 'أساسي'), c.name)
                     from public.perf_contacts c
                    where c.entity_id = e.id and c.side = 'نحن'), '[]'::jsonb),
         coalesce((select jsonb_agg(jsonb_build_object(
                     'role', c.role, 'name', c.name, 'jobTitle', c.job_title,
                     'email', c.email, 'phone', c.phone, 'note', c.note)
                   order by (c.role <> 'أساسي'), c.name)
                     from public.perf_contacts c
                    where c.entity_id = e.id and c.side <> 'نحن'), '[]'::jsonb),
         (select count(*)::int from words x
           where e.name_n like '%' || x.t || '%'
              or exists (select 1 from public.perf_contacts c
                          where c.entity_id = e.id and c.name_n like '%' || x.t || '%')) as hits
    from public.perf_entities e
   where e.active and public.perf_signed_in()
     and (select count(*) from words x
           where e.name_n like '%' || x.t || '%'
              or exists (select 1 from public.perf_contacts c
                          where c.entity_id = e.id and c.name_n like '%' || x.t || '%')) > 0
   order by hits desc, e.name
   limit greatest(1, p_limit);
$$;
revoke all on function public.perf_entities_find(text, int) from public, anon;
grant execute on function public.perf_entities_find(text, int) to authenticated;

select 'role' as "العمود", 'أُضيف' as "الحالة";


-- ===== [ perf-entities-extra.sql ] ============================================

-- ============================================================
--  لا يُهمل عمود + مراجعة ربعية لسجلّ الجهات
--  ------------------------------------------------------------
--  ١) الملف قد يحمل أعمدة لم تخطر ببالي (رقم الاتفاقية · تاريخ
--     التعميد · نوع الشراكة …). إهمالُها يعني ضياع معلومة دخلت
--     المنصة، فتُحفظ كما هي في extra وتُعرض في الصفحة. ومتى تبيّن
--     أن عموداً يستحق حقلاً خاصاً رُقّي إليه.
--
--  ٢) السجلّ يشيخ بلا مراجعة: الأشخاص ينتقلون وأرقامهم تتغيّر.
--     فلكل نقطة تواصل «آخر مراجعة»، ويُنبَّه الاستشاري كل ربع
--     حتى يؤكّد أو يصحّح. والتنبيه يزول بالتأكيد لا بالتجاهل.
--
--  idempotent وليس فيه حذف بيانات.
-- ============================================================

alter table public.perf_entities add column if not exists extra jsonb not null default '{}'::jsonb;
alter table public.perf_contacts add column if not exists extra jsonb not null default '{}'::jsonb;
alter table public.perf_contacts add column if not exists reviewed_at timestamptz;

/** الربع الحالي — «2026-Q3» */
create or replace function public.perf_quarter(p timestamptz default now())
returns text language sql immutable as $$
  select to_char(p, 'YYYY') || '-Q' || ceil(extract(month from p) / 3.0)::int;
$$;

/** جهاتي التي لم تُراجَع هذا الربع */
create or replace function public.perf_review_due()
returns table (entity_id text, entity text, contact_id text, reviewed_at timestamptz)
language sql stable security definer set search_path = public as $$
  select e.id, e.name, c.id, c.reviewed_at
    from public.perf_contacts c
    join public.perf_entities e on e.id = c.entity_id and e.active
   where c.side = 'نحن' and c.user_id = public.perf_my_id()
     and (c.reviewed_at is null
          or public.perf_quarter(c.reviewed_at) <> public.perf_quarter())
   order by e.name;
$$;
revoke all on function public.perf_review_due() from public, anon;
grant execute on function public.perf_review_due() to authenticated;

/** «راجعتُ بياناتي» — تُختم جهاتي كلها أو جهةٌ بعينها */
create or replace function public.perf_review_done(p_entity text default null)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.perf_contacts
     set reviewed_at = now()
   where side = 'نحن' and user_id = public.perf_my_id()
     and (p_entity is null or entity_id = p_entity);
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.perf_review_done(text) from public, anon;
grant execute on function public.perf_review_done(text) to authenticated;

/** من راجع ومن لم يراجع هذا الربع — لمن يملك «الجهات» */
create or replace function public.perf_review_status()
returns table (name text, entities int, reviewed int, last_at timestamptz)
language sql stable security definer set search_path = public as $$
  select u.display_name, count(*)::int,
         count(*) filter (where public.perf_quarter(c.reviewed_at) = public.perf_quarter())::int,
         max(c.reviewed_at)
    from public.perf_contacts c
    join public.perf_users u on u.id = c.user_id
   where c.side = 'نحن' and u.active and public.perf_has_scope('entities:edit')
   group by u.display_name
   order by 3, 1;
$$;
revoke all on function public.perf_review_status() from public, anon;
grant execute on function public.perf_review_status() to authenticated;

select public.perf_quarter() as "الربع الحالي";
