"use client";

import { asset } from "@/lib/base";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ensureAnon, sb } from "@/lib/supa";
import { buildWeekly2, type AsgRow, type WeeklyReport2 } from "@/lib/weeklyReport";
import { AUTO_SECTIONS, mergePrefs, type WeeklyPrefs } from "@/lib/weeklyPrefs";
import { weekSummary, type Item, type SectionKey, type WeekSum } from "@/app/dashboard/Sections";
import WeeklyReportView from "@/app/dashboard/WeeklyReportView";

/* صفحة عامة: تُفتح برمز في الرابط بلا أي حساب.
   القاعدة تُرجع البيانات فقط إن كان الرمز صحيحاً وغير منتهٍ،
   والتقرير يُبنى هنا بنفس دوال المنصة — فما يراه المتلقّي هو
   ما تراه الإدارة، بما في ذلك الأقسام المخفاة من «تخصيص التقرير». */
function Shared() {
  const token = useSearchParams().get("t") || "";
  const [report, setReport] = useState<WeeklyReport2 | null>(null);
  const [prefs, setPrefs] = useState<WeeklyPrefs | null>(null);
  const [state, setState] = useState<"loading" | "gone" | "ready">("loading");

  useEffect(() => {
    (async () => {
      if (!token) return setState("gone");
      await ensureAnon();
      const { data, error } = await sb().rpc("perf_shared_report", { p_token: token });
      if (error || !data) return setState("gone");

      const weekStart = String(data.weekStart);
      const rows = (data.items || []) as { section: string; id: string; data: Record<string, unknown>; updated_at?: string }[];
      const sections: Partial<Record<SectionKey, Item[]>> = {};
      const summaries: Partial<Record<SectionKey, WeekSum>> = {};
      for (const k of AUTO_SECTIONS) {
        const list = rows
          .filter((r) => r.section === k)
          .map((r) => ({ id: r.id, ord: 100, data: r.data || {}, updatedAt: r.updated_at }));
        sections[k] = list as Item[];
        summaries[k] = weekSummary(k, list as Item[]);
      }

      const settings = (data.settings || {}) as Record<string, unknown>;
      const p = mergePrefs(settings["weekly_prefs"], settings[`weekly_wk_${weekStart}`]);

      const asg = ((data.tasks || []) as Record<string, unknown>[]).map((r) => ({
        id: String(r.id),
        title: String(r.title || ""),
        kind: String(r.kind || "task"),
        state: String(r.state || ""),
        dueDate: (r.due_date as string) || "",
        createdAt: (r.created_at as string) || "",
        completedAt: (r.completed_at as string) || "",
      })) as AsgRow[];

      setPrefs(p);
      setReport(buildWeekly2(weekStart, sections, summaries, asg, p, new Date().toISOString().slice(0, 10)));
      setState("ready");
    })();
  }, [token]);

  if (state === "loading") return <div className="empty">جارٍ التحميل...</div>;

  if (state === "gone") {
    return (
      <div className="wk-gone">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={asset("/adaa-logo.png")} alt="أداء" className="wk-logo" />
        <b>الرابط غير صالح</b>
        <span>انتهت صلاحية هذا الرابط أو أُلغي. اطلب رابطًا جديدًا من إدارة عمليات الأداء.</span>
      </div>
    );
  }

  return (
    <>
      <WeeklyReportView report={report!} prefs={prefs!} />
      <p className="wk-ro no-print">هذه نسخة للاطّلاع فقط.</p>
    </>
  );
}

export default function SharedPage() {
  return (
    <main className="wk-public">
      <Suspense fallback={<div className="empty">جارٍ التحميل...</div>}>
        <Shared />
      </Suspense>
    </main>
  );
}
