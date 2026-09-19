-- ============================================================
--  أسماء بديلة للجهة
--  ------------------------------------------------------------
--  اسم الجهة في ملف منصة الرؤية قد يخالف اسمها في السجلّ («وزارة
--  الشؤون البلدية والقروية والإسكان» مقابل «وزارة البلديات»)،
--  فلا يُنسب طلبها إلى أحد ولا يدخل في أي نسبة.
--
--  الحلّ: تُسجَّل صيغة الملف اسماً بديلاً للجهة، فتُطابَق تلقائياً
--  في كل رفعٍ بعدها. لا يُغيَّر اسم الجهة المعتمد.
--
--  idempotent وليس فيه حذف بيانات. يُشغَّل بعد perf-entities.sql
-- ============================================================

alter table public.perf_entities
  add column if not exists aliases text[] not null default '{}';

/* الإضافة لمن يحرّر الجهات أو لمن يرفع ملف الطلبات — فهو أعرف
   الناس بصيغ الأسماء في الملف. والاسم يُحفظ كما ورد، والمطابقة
   تتم بعد التطبيع في الواجهة. */
create or replace function public.perf_entity_alias(p_entity text, p_alias text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_alias text := btrim(coalesce(p_alias, ''));
begin
  if not (public.perf_has_scope('entities:edit') or public.perf_has_scope('changes:upload')) then
    raise exception 'الأسماء البديلة لمن يحرّر الجهات أو يرفع ملف الطلبات';
  end if;
  if v_alias = '' then raise exception 'الاسم البديل مطلوب'; end if;
  update public.perf_entities e
     set aliases = (select array(select distinct unnest(coalesce(e.aliases, '{}') || array[v_alias])))
   where e.id = p_entity;
  return found;
end;
$$;
revoke all on function public.perf_entity_alias(text, text) from public, anon;
grant execute on function public.perf_entity_alias(text, text) to authenticated;

select 'aliases' as "العمود", 'جاهز' as "الحالة";
