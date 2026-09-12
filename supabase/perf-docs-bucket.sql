-- ============================================================
--  صلاحيات مخزن ملفات «منهجيات أداء» (bucket = docs)
--  ------------------------------------------------------------
--  جعْل المخزن Public يفتح **القراءة** عبر الرابط المباشر فقط.
--  أمّا الرفع والاستبدال والحذف فتمرّ من storage.objects وهي
--  محميّة بـ RLS، وبلا سياسة يفشل الرفع برسالة
--  "new row violates row-level security policy".
--  هذا الملف يضيف السياسات الأربع — آمن التكرار.
-- ============================================================
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    execute $q$ insert into storage.buckets (id, name, public)
                values ('docs','docs', true)
                on conflict (id) do update set public = true $q$;

    -- القراءة: مفتوحة (المنهجيات منشورة أصلاً على منصة المعرفة)
    execute $q$ drop policy if exists "docs_read" on storage.objects $q$;
    execute $q$ create policy "docs_read" on storage.objects
                for select using (bucket_id = 'docs') $q$;

    -- الرفع والاستبدال والحذف: لمن سجّل دخوله فقط.
    -- البوّابة الحقيقية لمن يضيف أو يحذف منهجية هي RLS على
    -- جدول perf_docs؛ والملف بلا صفٍّ في الجدول لا يظهر لأحد.
    execute $q$ drop policy if exists "docs_insert" on storage.objects $q$;
    execute $q$ create policy "docs_insert" on storage.objects
                for insert to authenticated with check (bucket_id = 'docs') $q$;

    execute $q$ drop policy if exists "docs_update" on storage.objects $q$;
    execute $q$ create policy "docs_update" on storage.objects
                for update to authenticated using (bucket_id = 'docs') $q$;

    execute $q$ drop policy if exists "docs_delete" on storage.objects $q$;
    execute $q$ create policy "docs_delete" on storage.objects
                for delete to authenticated using (bucket_id = 'docs') $q$;
  end if;
end $$;
