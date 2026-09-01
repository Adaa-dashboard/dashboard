"use client";

import { createClient, SupabaseClient } from "@supabase/supabase-js";

/* مفتاح النشر وعنوان المشروع ليسا سرّاً: يظهران لأي أحد يفتح اللوحة،
   تماماً كما في لوحة متابعة المشروع. الحماية الحقيقية في سياسات RLS
   داخل قاعدة البيانات، لا في إخفاء المفتاح. */
export const SB_URL = "https://kzmlrwsvvnbnumwjfrwq.supabase.co";
export const SB_KEY = "sb_publishable_nwT0c1Eg4Z8i7bZCklx6DQ_KmrhlzwX";

let client: SupabaseClient | null = null;
export function sb(): SupabaseClient {
  if (!client) {
    client = createClient(SB_URL, SB_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: "adaa-perf-auth" },
    });
  }
  return client;
}

/** جلسة مجهولة تُنشأ مرة واحدة لكل جهاز — هي حامل هوية الدخول. */
export async function ensureAnon(): Promise<void> {
  const s = sb();
  const { data } = await s.auth.getSession();
  if (!data.session) await s.auth.signInAnonymously();
}

export type Me = {
  id: string;
  name: string;
  username: string;
  role: "admin" | "manager";
  sectorIds: string[];
};

/** من أنا؟ يُقرأ من جدول الجلسات — لا يُصدَّق ما في المتصفح. */
export async function whoAmI(): Promise<Me | null> {
  const s = sb();
  const { data: sess } = await s.auth.getSession();
  if (!sess.session) return null;
  const { data, error } = await s
    .from("perf_sessions")
    .select("app_user_id, username, display_name, role, sector_ids")
    .maybeSingle();
  if (error || !data) return null;
  return {
    id: String(data.app_user_id),
    name: data.display_name,
    username: data.username,
    role: data.role,
    sectorIds: data.sector_ids || [],
  };
}

export async function signOut(): Promise<void> {
  await sb().auth.signOut();
}
