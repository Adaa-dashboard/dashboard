-- ============================================================
--  «فريقي» — مدير القطاع يطّلع على أعمال موظفي قطاعه
--  ------------------------------------------------------------
--  سياسة قراءة المحفظة اليوم تعرف مسارين: صاحبها، ومَن مُنِح
--  صراحةً. ومسار المدير كان موجوداً في نسخة أقدم ثم أُزيل عمداً.
--  هذا الملف يعيده — محصوراً في القطاع: يرى المديرُ من يشاركونه
--  قطاعه، ولا يرى قطاعاً غيره. وصاحب صلاحية «المستخدمون» لا
--  يدخل من هذا الباب.
--
--  الكتابة لا تتغيّر: لصاحب المحفظة وحده ولو كان الناظر مديره.
--  والملاحظات والتقويم خارج هذا كلّه — جدولها الخاص لا يقرؤه
--  إلا صاحبه، فلا يراها مدير ولا مالك المنصة.
--
--  idempotent وليس فيه حذف بيانات.
-- ============================================================

create or replace function public.perf_can_see_pf(p_uid bigint, p_section text)
returns boolean language sql stable security definer set search_path = public as $$
  select p_uid = public.perf_my_id()
      -- منحٌ صريح من صاحب المحفظة، بأقسامه المحدَّدة
      or exists (
           select 1 from public.perf_portfolio_grants g
            where g.owner_id = p_uid
              and g.grantee_id = public.perf_my_id()
              and (g.scopes @> array['*'] or g.scopes @> array[p_section]))
      -- مدير القطاع على قطاعه — كل أقسام المحفظة
      or exists (
           select 1
             from public.perf_users me
             join public.perf_users u on u.id = p_uid
            where me.id = public.perf_my_id()
              and me.is_lead and me.active and u.active
              and u.id <> me.id
              and u.sector_ids && me.sector_ids);
$$;
revoke all on function public.perf_can_see_pf(bigint, text) from public, anon;
grant execute on function public.perf_can_see_pf(bigint, text) to authenticated;

-- من سيرى مَن — للمراجعة
select m.display_name as "المدير",
       coalesce(string_agg(u.display_name, ' · ' order by u.display_name), '— لا أحد —') as "فريقه"
  from public.perf_users m
  left join public.perf_users u
    on u.active and u.id <> m.id and u.sector_ids && m.sector_ids
 where m.active and m.is_lead
 group by m.display_name
 order by m.display_name;
