"use client";

import { asset } from "@/lib/base";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ensureAnon, sb } from "@/lib/supa";
import { mergePrefs, type WeeklyPrefs } from "@/lib/weeklyPrefs";
import type { ChangeLite, ContactLite, LogRow, TaskLite } from "@/lib/achievements";
import { buildWeekReport, type ItemLite, type WeekReport } from "@/lib/weekReport";
import { listOf } from "@/lib/weeklyPrefs";
import WeeklyReportView from "@/app/dashboard/WeeklyReportView";

/* صفحة عامة: تُفتح برمز في الرابط بلا أي حساب.
   القاعدة تُرجع البيانات فقط إن كان الرمز صحيحاً وغير منتهٍ،
   والتقرير يُبنى هنا بنفس دوال المنصة — فما يراه المتلقّي هو
   ما تراه الإدارة، بما في ذلك الأقسام المخفاة من «تخصيص التقرير». */
function Shared() {
  const token = useSearchParams().get("t") || "";
  const [report, setReport] = useState<WeekReport | null>(null);
  const [prefs, setPrefs] = useState<WeeklyPrefs | null>(null);
  const [state, setState] = useState<"loading" | "gone" | "ready">("loading");

  useEffect(() => {
    (async () => {
      if (!token) return setState("gone");
      await ensureAnon();
      const { data, error } = await sb().rpc("perf_shared_report", { p_token: token });
      if (error || !data) return setState("gone");

      const weekStart = String(data.weekStart);
      const settings = (data.settings || {}) as Record<string, unknown>;
      const p = mergePrefs(settings["weekly_prefs"], settings[`weekly_wk_${weekStart}`]);

      /* الأسبوع كاملاً: من الأحد إلى السبت */
      const d = new Date(weekStart + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() + 6);
      const weekEnd = d.toISOString().slice(0, 10);

      const log = ((data.log || []) as Record<string, unknown>[]).map<LogRow>((r) => ({
        at: String(r.at || ""),
        section: String(r.section || ""),
        itemId: String(r.item_id || ""),
        name: String(r.name || ""),
        field: String(r.field || ""),
        oldVal: r.old_val == null ? "" : String(r.old_val),
        newVal: r.new_val == null ? "" : String(r.new_val),
        byName: String(r.by_name || ""),
      }));
      const changes = ((data.changes || []) as Record<string, unknown>[]).map<ChangeLite>((r) => ({
        code: String(r.code || ""),
        owner: String(r.owner_entity || ""),
        itemName: String(r.item_name || ""),
        sla: r.sla_days == null ? null : Number(r.sla_days),
        workDays: r.work_days == null ? null : Number(r.work_days),
        status: String(r.status || ""),
        closedAt: String(r.closed_at || ""),
      }));
      const tasks = ((data.tasks || []) as Record<string, unknown>[]).map<TaskLite>((r) => ({
        id: String(r.id || ""),
        title: String(r.title || ""),
        kind: String(r.kind || "task"),
        state: String(r.state || ""),
        completedAt: String(r.completed_at || ""),
      }));
      const contacts = ((data.contacts || []) as Record<string, unknown>[]).map<ContactLite>((r) => ({
        entity: String(r.entity || ""),
        reviewedAt: String(r.reviewedAt || ""),
      }));

      /* بنود الأقسام تأتي في حزمةٍ واحدة، فتُفرز هنا لحلقات الحالة */
      const items: Record<string, ItemLite[]> = {};
      for (const r of (data.items || []) as Record<string, unknown>[]) {
        const k = String(r.section || "");
        (items[k] = items[k] || []).push({
          id: String(r.id || ""),
          data: (r.data || {}) as Record<string, unknown>,
        });
      }

      setPrefs(p);
      setReport(
        buildWeekReport({
          weekStart, weekEnd, log, changes, tasks, contacts, items,
          on: p.on,
          next: listOf(p.texts?.next || ""),
        }),
      );
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
