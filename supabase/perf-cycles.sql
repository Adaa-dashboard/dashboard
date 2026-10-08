-- ============================================================
--  دورة التحديث الدوري — زرٌّ في كل قسم وشريطٌ بمن لم يحدّث
--  ------------------------------------------------------------
--  يُشغَّل من SQL Editor مرة واحدة. idempotent، وليس فيه حذف بيانات.
--  يُشغَّل بعد: perf-changes.sql (فيه `perf_has_scope`)
--
--  الدورة سطرٌ واحد في `perf_settings` بمفتاح `cycle:<القسم>`:
--    { startedAt, startedBy, keys: [{k,label,sub}], dropped: [k] }
--  و«من لم يحدّث» تُحسب من البيانات نفسها: مفتاحٌ في `keys` لم
--  يُحدَّث أيُّ صفٍّ من صفوفه بعد `startedAt` ولم يُحذف يدوياً.
--  فلا تُخزَّن حالةٌ تكذب على البيانات.
--
--  القراءة: كل من سجّل دخوله (سياسة `perf_settings_read` القائمة).
--  الكتابة: من يملك `<القسم>:edit` — وهم أعضاء فريق ذلك القسم.
--  وبقيّة مفاتيح `perf_settings` تبقى لمدير الإدارة كما هي.
-- ============================================================

drop policy if exists "perf_settings_cycle_write" on public.perf_settings;
create policy "perf_settings_cycle_write" on public.perf_settings
  for all to authenticated
  using (
    key like 'cycle:%'
    and public.perf_has_scope(split_part(key, ':', 2) || ':edit')
  )
  with check (
    key like 'cycle:%'
    and public.perf_has_scope(split_part(key, ':', 2) || ':edit')
  );

-- تحقّق: السياسة موجودة
select polname as "السياسة"
  from pg_policy
 where polrelid = 'public.perf_settings'::regclass
   and polname = 'perf_settings_cycle_write';
