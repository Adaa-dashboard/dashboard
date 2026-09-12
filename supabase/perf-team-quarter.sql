-- ============================================================
--  تغطية الاجتماعات الربعية على مستوى الإدارة
--  ------------------------------------------------------------
--  كل استشاري يسجّل في محفظته جهاته واجتماعاتها الربعية
--  (أربعة مربّعات للسنة). المحافظ خاصة: لا يقرؤها إلا صاحبها
--  ومديره. وهذه الدالة لا تفتح المحافظ — تُرجع **أعداداً فقط**:
--  كم جهة لصاحب المحفظة، وكم منها عُقد اجتماع ربعها الحالي.
--  لا أسماء جهات ولا محتوى ولا ملاحظات.
--
--  من يراها:
--    · صاحب صلاحية «المستخدمون» (مالكة المنصة) — كل الحسابات النشطة
--    · مديرٌ بلا قطاع محدَّد (مدير الإدارة) — كل الحسابات، فهو ليس
--      مربوطاً بقطاع واحد بل بالإدارة كلها
--    · مدير قطاع — من يشاركونه قطاعه وحدهم
--    · وغيرهم: لا شيء إطلاقاً
--
--  idempotent · لا يحذف بيانات ولا يغيّرها.
-- ============================================================

drop function if exists public.perf_team_quarter();

create or replace function public.perf_team_quarter()
returns table (user_name text, done int, total int)
language sql stable security definer set search_path = public as $$
  with me as (
    select u.id, u.is_lead, u.sector_ids,
           (coalesce(u.scopes,'{}') @> array['users']
             or (u.is_lead and coalesce(array_length(u.sector_ids,1),0) = 0)) as boss
      from public.perf_users u
     where u.id = public.perf_my_id() and u.active
  ),
  -- الربع الحالي بترقيم 1..4
  q as (select (extract(quarter from now())::int) as n),
  seen as (
    select u.id, u.display_name
      from public.perf_users u, me
     where u.active
       and (me.boss or (me.is_lead and u.sector_ids && me.sector_ids))
  )
  select s.display_name::text,
         count(*) filter (
           where coalesce((p.data -> 'q' ->> (q.n - 1))::text, '0') not in ('0','false','null','')
         )::int as done,
         count(*)::int as total
    from seen s
    join public.perf_portfolio p
      on p.app_user_id = s.id and p.section = 'entities'
   cross join q
   group by s.display_name
  having count(*) > 0
   order by s.display_name;
$$;

revoke all on function public.perf_team_quarter() from public, anon;
grant execute on function public.perf_team_quarter() to authenticated;

select * from public.perf_team_quarter();
