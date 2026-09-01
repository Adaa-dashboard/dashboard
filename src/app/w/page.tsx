"use client";

import { asset } from "@/lib/base";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ensureAnon, sb } from "@/lib/supa";
import { buildWeekly, type WeeklyInput, type WeeklyReport } from "@/lib/weekly";
import WeeklyView from "@/app/dashboard/WeeklyView";

/* صفحة عامة: تُفتح برمز في الرابط بلا أي حساب.
   القاعدة تُرجع البيانات فقط إن كان الرمز صحيحاً وغير منتهٍ. */
function Shared() {
  const token = useSearchParams().get("t") || "";
  const [report, setReport] = useState<WeeklyReport | null>(null);
  const [state, setState] = useState<"loading" | "gone" | "ready">("loading");

  useEffect(() => {
    (async () => {
      if (!token) return setState("gone");
      await ensureAnon();
      const { data, error } = await sb().rpc("perf_shared_report", { p_token: token });
      if (error || !data) return setState("gone");

      const targets: Record<string, number | number[]> = {};
      for (const r of data.targets || []) targets[`${r.sector_id}|${r.indicator_id}`] = r.value;

      const input: WeeklyInput = {
        measurements: (data.measurements || []).map((r: Record<string, unknown>) => ({
          sectorId: r.sector_id as string, indicatorId: r.indicator_id as string,
          actual: r.actual === null ? null : Number(r.actual),
          updatedAt: r.updated_at as string,
        })),
        sectors: (data.sectors || []).map((r: Record<string, unknown>) => ({
          id: r.id as string, name: r.name as string,
        })),
        indicators: (data.indicators || []).map((r: Record<string, unknown>) => ({
          id: r.id as string, name: r.name as string,
          unit: r.unit as "percent" | "number",
        })),
        tasks: (data.tasks || []).map((r: Record<string, unknown>) => ({
          id: r.id as string, title: r.title as string,
          assigneeId: r.assignee_id as string, createdById: r.created_by_id as string,
          dueDate: r.due_date as string, state: r.state as "ok" | "risk" | "done",
          updates: Array.isArray(r.updates) ? (r.updates as { text: string }[]) : [],
          completedAt: (r.completed_at as string) ?? undefined,
        })),
        // الرابط للاطّلاع فقط: لا تخرج أسماء الموظفين معه
        users: [],
        targets,
        statuses: data.settings?.statuses || [],
      };
      setReport(buildWeekly(String(data.weekStart), input));
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
      <WeeklyView report={report!} />
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
