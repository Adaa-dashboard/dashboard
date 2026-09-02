"use client";

import { sb, whoAmI } from "./supa";

/* ============================================================
   مخزن شخصي لكل مستخدم (perf_user_data).
   الصف مقصور على صاحبه بسياسة RLS، فما يُحفظ هنا لا يقرأه غيره
   ولو حاول من خارج الواجهة. يُستعمل للملاحظات ولإعداد الصفحة الخاصة.
   ============================================================ */

export async function loadUserData<T>(key: string, fallback: T): Promise<T> {
  const me = await whoAmI();
  if (!me) return fallback;
  const { data, error } = await sb()
    .from("perf_user_data")
    .select("value")
    .eq("app_user_id", Number(me.id))
    .eq("key", key)
    .maybeSingle();
  if (error || !data) return fallback;
  return (data.value as T) ?? fallback;
}

export async function saveUserData(key: string, value: unknown): Promise<string | null> {
  const me = await whoAmI();
  if (!me) return "غير مصرّح";
  const { error } = await sb()
    .from("perf_user_data")
    .upsert(
      { app_user_id: Number(me.id), key, value, updated_at: new Date().toISOString() },
      { onConflict: "app_user_id,key" }
    );
  return error ? error.message : null;
}
