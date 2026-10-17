"use client";

/* ============================================================
   ربط «المشاريع الاستراتيجية» بلوحة متابعة المشروع
   (adaa-project.netlify.app — قاعدة بيانات أخرى مستقلة).

   اللوحة تحفظ المنجز الشهري لكل مخرج في `monthly_actuals`،
   وصفوفُها محميّةٌ بـ RLS لا يقرؤها إلا من سجّل دخوله. فالقراءة
   هنا عبر دالّة `project_outputs()` وحدها — `security definer`
   تُرجع **أربعة أعداد مجمّعة لا غير**، ومصرّحٌ بها لـ anon.
   فلا تتسرّب تفاصيل البنود ولا أسماؤها.

   العنوان والمفتاح ليسا سرّاً: هما في صفحة اللوحة المنشورة نفسها.
   ============================================================ */

import { createClient, SupabaseClient } from "@supabase/supabase-js";

export const PD_URL = "https://dgmakuenllpuzuupmeuf.supabase.co";
export const PD_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRnbWFrdWVubGxwdXp1dXBtZXVmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg5MzY3OTEsImV4cCI6MjA5NDUxMjc5MX0.ZGNOQjX_70wo0mXptFe5NXSHbkDFHKru81gdeOYvvRI";

/* جلسةٌ لا تُحفظ ولا تُجدَّد: هذا عميلٌ للقراءة العابرة، وحفظُها
   يصطدم بجلسة المنصة في المتصفح نفسه */
let c: SupabaseClient | null = null;
function pd(): SupabaseClient {
  if (!c) {
    c = createClient(PD_URL, PD_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, storageKey: "adaa-pdash-ro" },
    });
  }
  return c;
}

/** أسماء المخرجات ووحداتها — من لوحة متابعة المشروع نفسها */
const PD_NAMES = [
  { name: "المخرج الأول — مراجعة وتقييم الاستراتيجيات الواردة للمركز", unit: "تقرير" },
  { name: "المخرج الثاني — تقييم قابلية قياس بطاقات المؤشرات والمبادرات", unit: "خدمة" },
  { name: "المخرج الثالث — تقييم التزام الجهات بمعايير التوثيق", unit: "خدمة" },
  { name: "المخرج الرابع — تنفيذ الطلبات الواردة على المركز", unit: "تقرير" },
];

export type PdOut = { name: string; done: number; total: number; unit: string; pct: number };
export type PdSummary = { outs: PdOut[]; pct: number; updatedAt: string };

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** المنجز التراكمي لكل مخرج ونسبة إنجاز المشروع — أو `null` إن
    تعذّرت القراءة، فتبقى الأرقام المكتوبة يدوياً كما هي */
export async function loadProjectOutputs(): Promise<PdSummary | null> {
  try {
    const { data, error } = await pd().rpc("project_outputs");
    if (error || !data) return null;
    const d = data as Record<string, unknown>;
    const raw = Array.isArray(d.outs) ? (d.outs as Record<string, unknown>[]) : [];
    if (!raw.length) return null;
    const outs = raw.slice(0, 4).map((x, i) => {
      const done = num(x.done);
      const total = num(x.total);
      return {
        ...PD_NAMES[i],
        done,
        total,
        pct: total > 0 ? Math.max(0, Math.min(100, (done / total) * 100)) : 0,
      };
    });
    return { outs, pct: num(d.pct), updatedAt: String(d.updatedAt || "").slice(0, 10) };
  } catch {
    return null;
  }
}
