-- ============================================================
--  يُشغَّل على قاعدة **لوحة متابعة المشروع**
--  (dgmakuenllpuzuupmeuf) لا على قاعدة المنصة
--  ------------------------------------------------------------
--  يفتح نافذةً واحدةً ضيّقة تقرأ منها المنصةُ أرقامَ المخرجات:
--  أربعة أعداد مجمّعة ونسبة الإنجاز وتاريخ آخر تحديث — لا أسماء
--  بنود ولا صفوف تفاصيل ولا فواتير. وما عداها يبقى خلف RLS كما هو.
--
--  `security definer` لأن `monthly_actuals` محميّة: لا يقرؤها إلا
--  من سجّل دخوله. والدالّة لا تُرجع صفوفاً بل مجاميعها.
--
--  idempotent — يُعاد تشغيله بلا ضرر، ولا يمسّ أي بيانات.
-- ============================================================

create or replace function public.project_outputs()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with a as (
    select coalesce(sum(m1), 0)::numeric as d1,
           coalesce(sum(m2), 0)::numeric as d2,
           coalesce(sum(m3), 0)::numeric as d3,
           coalesce(sum(m4), 0)::numeric as d4,
           max(updated_at)               as up
      from public.monthly_actuals
  )
  select jsonb_build_object(
    'outs', jsonb_build_array(
      jsonb_build_object('i', 1, 'done', d1, 'total', 60),
      jsonb_build_object('i', 2, 'done', d2, 'total', 290),
      jsonb_build_object('i', 3, 'done', d3, 'total', 1230),
      jsonb_build_object('i', 4, 'done', d4, 'total', 22)
    ),
    /* نسبة الإنجاز **بالبنود الموزونة** كما في اللوحة نفسها:
       Σ (الكمية ÷ المستهدف) × وزن المخرج — لا دخل للمال فيها */
    'pct', round(
             least(100,
               d1 / 60    * 31.58 +
               d2 / 290   * 19.76 +
               d3 / 1230  * 18.60 +
               d4 / 22    * 30.05
             ), 1),
    'updatedAt', up
  )
  from a;
$$;

revoke all on function public.project_outputs() from public;
grant execute on function public.project_outputs() to anon, authenticated;

-- تحقّق: الأرقام التي ستظهر في المنصة
select public.project_outputs() as "مخرجات المشروع";
