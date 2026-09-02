"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { writeXlsx, type SheetOut } from "@/lib/sheet";
import { can as hasScope } from "@/lib/scopes";
import { evaluate, type Band } from "@/lib/calc";

/* ============================================================
   نسخة احتياطية شخصية — لكل مستخدم، بلا صلاحية خاصة.
   الغاية أن يبقى عمله بين يديه لو انقطع الاتصال باللوحة:
   قياساته وملاحظاته ومهامه وتكاليفه وما يتصل به.
   تُبنى في المتصفح من نفس البيانات المعروضة له، فلا تكشف
   النسخة شيئاً لا يراه أصلاً.
   ============================================================ */

type Me = { id: string; name: string; role: string; sectorIds: string[]; scopes: string[] };
type Sector = { id: string; name: string };
type Indicator = { id: string; name: string; unit: "percent" | "number" };
type RefLike = {
  sectors: Sector[];
  indicators: Indicator[];
  statuses: Band[];
  targets: Record<string, number | number[]>;
};

type M = { sectorId: string; indicatorId: string; target: number | null; actual: number | null; updatedAt: string };
type Task = {
  id: string; title: string; description?: string; assigneeId: string; priority: string;
  dueDate: string; state: string; kind?: string; createdById: string; createdAt: string;
  completedAt?: string; updates: { text: string; byName: string; at: string }[];
};
type Note = { id: string; sectorId: string; indicatorId: string; text: string; byId: string; byName: string; at: string };
type Change = {
  code: string; program: string; itemCode: string; itemName: string; owner: string;
  category: string; reviewType: string; classification: string;
  sla: number | null; workDays: number | null; status: string; lastSeen: string;
};
type Person = { id: string; name: string };

const todayISO = () => new Date().toISOString().slice(0, 10);

function annualTarget(targets: RefLike["targets"], key: string): number | null {
  const v = targets[key];
  if (v == null) return null;
  return Array.isArray(v) ? v.reduce((a, b) => a + (Number(b) || 0), 0) : Number(v);
}

const STATE_AR: Record<string, string> = {
  ok: "على المسار",
  risk: "فيها تحدٍ",
  done: "مكتملة",
};

export default function Backup({
  me,
  refData,
  t,
  onClose,
}: {
  me: Me;
  refData: RefLike;
  t: (ar: string, en: string) => string;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [ms, setMs] = useState<M[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [changes, setChanges] = useState<Change[]>([]);
  const [people, setPeople] = useState<Person[]>([]);

  const seesAllSectors = hasScope(me.scopes, "details:all");
  const seesAllTasks = hasScope(me.scopes, "tasks:all");
  const seesChanges = hasScope(me.scopes, "changes");

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const [m, tk, nt, ch] = await Promise.all([
        apiFetch("/api/measurements").then((r) => r.json()),
        apiFetch("/api/tasks").then((r) => r.json()),
        apiFetch("/api/notes").then((r) => r.json()),
        seesChanges ? apiFetch("/api/changes").then((r) => r.json()) : Promise.resolve({ changes: [] }),
      ]);
      const mine = (sid: string) => seesAllSectors || me.sectorIds.includes(sid);
      setMs(((m.measurements || []) as M[]).filter((x) => mine(x.sectorId)));
      setTasks(
        ((tk.tasks || []) as Task[]).filter(
          (x) => seesAllTasks || x.assigneeId === me.id || x.createdById === me.id
        )
      );
      setPeople(tk.people || []);
      setNotes(((nt.notes || []) as Note[]).filter((n) => n.byId === me.id || mine(n.sectorId)));
      setChanges((ch.changes || []) as Change[]);
    } catch {
      setErr(t("تعذّر تجهيز النسخة — تأكدي من الاتصال.", "Could not prepare the backup."));
    }
    setLoading(false);
  }, [me.id, me.sectorIds, seesAllSectors, seesAllTasks, seesChanges, t]);

  useEffect(() => {
    load();
  }, [load]);

  const sName = (id: string) => refData.sectors.find((s) => s.id === id)?.name || id;
  const iName = (id: string) => refData.indicators.find((i) => i.id === id)?.name || id;
  const pName = (id: string) => people.find((p) => p.id === id)?.name || "—";
  const kindOf = (x: Task) => (x.kind === "assignment" ? "assignment" : "task");

  /* ---------- الجداول: مصدر واحد لملف إكسل وللطباعة ---------- */
  function kpiRows(): (string | number | null)[][] {
    const head = ["القطاع", "المؤشر", "الوحدة", "المستهدف", "الفعلي", "نسبة الإنجاز %", "الحالة", "آخر تحديث"];
    const rows = ms.map((m) => {
      const ind = refData.indicators.find((i) => i.id === m.indicatorId);
      const tgt = m.target ?? annualTarget(refData.targets, `${m.sectorId}|${m.indicatorId}`);
      const r = evaluate(m.actual, tgt, refData.statuses);
      return [
        sName(m.sectorId),
        iName(m.indicatorId),
        ind?.unit === "percent" ? "نسبة" : "عدد",
        tgt,
        m.actual,
        r.achievement != null ? Math.round(r.achievement) : null,
        r.label || "—",
        (m.updatedAt || "").slice(0, 10),
      ];
    });
    return [head, ...rows];
  }

  function taskRows(kind: "task" | "assignment"): (string | number | null)[][] {
    const head = ["العنوان", "الوصف", "المسؤول", "الأهمية", "تنتهي", "الحالة", "أنشأها", "تاريخ الإنشاء", "آخر تحديث"];
    const rows = tasks
      .filter((x) => kindOf(x) === kind)
      .map((x) => {
        const last = x.updates?.length ? x.updates[x.updates.length - 1] : null;
        return [
          x.title,
          x.description || "",
          pName(x.assigneeId),
          x.priority === "high" ? "مهمة جداً" : "متوسطة",
          x.dueDate,
          STATE_AR[x.state] || x.state,
          pName(x.createdById),
          (x.createdAt || "").slice(0, 10),
          last ? `${last.byName}: ${last.text}` : "",
        ];
      });
    return [head, ...rows];
  }

  function noteRows(): (string | number | null)[][] {
    const head = ["القطاع", "المؤشر", "الملاحظة", "الكاتب", "التاريخ"];
    return [
      head,
      ...notes.map((n) => [sName(n.sectorId), iName(n.indicatorId), n.text, n.byName, (n.at || "").slice(0, 10)]),
    ];
  }

  function changeRows(): (string | number | null)[][] {
    const head = [
      "الرمز", "اسم البرنامج/الاستراتيجية", "كود المبادرة / المؤشر", "اسم المبادرة/ المؤشر",
      "الجهة المالكة", "فئة الطلب", "نوع المراجعة", "التصنيف",
      "اتفاقية مستوى الخدمة", "أيام العمل", "المتبقي", "الحالة",
    ];
    return [
      head,
      ...changes.map((c) => [
        c.code, c.program, c.itemCode, c.itemName, c.owner, c.category, c.reviewType,
        c.classification, c.sla, c.workDays,
        c.sla != null && c.workDays != null ? c.sla - c.workDays : null,
        c.status === "closed" ? "تمت المراجعة" : "مفتوح",
      ]),
    ];
  }

  function infoRows(): (string | number | null)[][] {
    return [
      ["البند", "القيمة"],
      ["الاسم", me.name],
      ["الدور", me.role === "admin" ? "مدير الإدارة" : "مدير قطاع"],
      ["القطاعات", me.sectorIds.map(sName).join(" · ") || (seesAllSectors ? "كل القطاعات" : "—")],
      ["تاريخ النسخة", todayISO()],
      ["المصدر", "لوحة إدارة عمليات الأداء — مركز أداء"],
    ];
  }

  const SECTIONS: { name: string; rows: (string | number | null)[][] }[] = [
    { name: "معلومات النسخة", rows: infoRows() },
    { name: "المؤشرات", rows: kpiRows() },
    { name: "المهام", rows: taskRows("task") },
    { name: "التكاليف", rows: taskRows("assignment") },
    { name: "الملاحظات", rows: noteRows() },
    ...(seesChanges ? [{ name: "طلبات التغيير", rows: changeRows() }] : []),
  ];

  const counts = {
    kpis: ms.length,
    tasks: tasks.filter((x) => kindOf(x) === "task").length,
    asg: tasks.filter((x) => kindOf(x) === "assignment").length,
    notes: notes.length,
    changes: seesChanges ? changes.length : 0,
  };

  function downloadExcel() {
    const sheets: SheetOut[] = SECTIONS.map((s) => ({ name: s.name, rows: s.rows }));
    const url = URL.createObjectURL(writeXlsx(sheets));
    const a = document.createElement("a");
    a.href = url;
    a.download = `نسخة-${me.name}-${todayISO()}.xlsx`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  /** الطباعة في نافذة مستقلة: تنسيق ثابت لا يتأثر بأنماط اللوحة */
  function downloadPdf() {
    const esc = (v: unknown) =>
      String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const table = (rows: (string | number | null)[][]) => {
      if (rows.length < 2) return '<p class="none">لا توجد بيانات.</p>';
      const [head, ...body] = rows;
      return (
        '<table><thead><tr>' +
        head.map((h) => `<th>${esc(h)}</th>`).join("") +
        "</tr></thead><tbody>" +
        body.map((r) => "<tr>" + r.map((c) => `<td>${esc(c)}</td>`).join("") + "</tr>").join("") +
        "</tbody></table>"
      );
    };
    const html =
      `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">` +
      `<title>نسخة احتياطية — ${esc(me.name)} — ${todayISO()}</title><style>
        @page { size: A4 landscape; margin: 12mm; }
        body { font-family: "Noto Sans Arabic","Segoe UI",Tahoma,sans-serif; color:#12211d; margin:0; }
        h1 { font-size:19px; color:#00584c; margin:0 0 2px; }
        .sub { color:#6d7f7a; font-size:12px; margin-bottom:16px; }
        h2 { font-size:15px; color:#00584c; margin:20px 0 6px; page-break-after:avoid; }
        table { width:100%; border-collapse:collapse; font-size:11px; margin-bottom:6px; }
        th { background:#00584c; color:#fff; padding:6px; text-align:start; }
        td { border-bottom:1px solid #dfe9e6; padding:5px 6px; vertical-align:top; }
        tr { page-break-inside:avoid; }
        .none { color:#6d7f7a; font-size:12px; }
        .ft { margin-top:18px; color:#8a9a95; font-size:10.5px; border-top:1px solid #dfe9e6; padding-top:6px; }
      </style></head><body>` +
      `<h1>نسخة احتياطية من بيانات اللوحة</h1>` +
      `<div class="sub">${esc(me.name)} · ${todayISO()} · لوحة إدارة عمليات الأداء — مركز أداء</div>` +
      SECTIONS.map((s) => `<h2>${esc(s.name)}</h2>${table(s.rows)}`).join("") +
      `<div class="ft">نسخة شخصية للحفظ — المرجع الرسمي يبقى اللوحة.</div>` +
      `</body></html>`;

    const w = window.open("", "_blank");
    if (!w) {
      setErr(t("امنعي حجب النوافذ المنبثقة ثم أعيدي المحاولة.", "Allow pop-ups and try again."));
      return;
    }
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 400);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="m-h">
          <h3>{t("نسخة احتياطية من بياناتك", "Your data backup")}</h3>
          <button className="mx" onClick={onClose} aria-label="close">
            ✕
          </button>
        </div>
        <div className="m-b">
          {err && <div className="alert alert-error">{err}</div>}
          <p className="bk-note">
            {t(
              "نسخة بكل ما يخصّك في اللوحة: قياسات قطاعاتك وملاحظاتك ومهامك وتكاليفك — تحفظينها عندك فتبقى بين يديك لو انقطع الاتصال باللوحة.",
              "Everything that concerns you in the dashboard, saved on your device."
            )}
          </p>

          {loading ? (
            <div className="empty">{t("جارٍ التجهيز...", "Preparing...")}</div>
          ) : (
            <>
              <div className="bk-counts">
                <span>
                  {t("قياسات", "KPIs")} <b>{counts.kpis}</b>
                </span>
                <span>
                  {t("مهام", "Tasks")} <b>{counts.tasks}</b>
                </span>
                <span>
                  {t("تكاليف", "Assignments")} <b>{counts.asg}</b>
                </span>
                <span>
                  {t("ملاحظات", "Notes")} <b>{counts.notes}</b>
                </span>
                {seesChanges && (
                  <span>
                    {t("طلبات تغيير", "Changes")} <b>{counts.changes}</b>
                  </span>
                )}
              </div>

              <div className="bk-actions">
                <button className="bk-card" onClick={downloadExcel}>
                  <span className="ic">⬇</span>
                  <b>{t("تحميل Excel", "Download Excel")}</b>
                  <span className="s">{t("ملف xlsx بورقة لكل قسم", "One sheet per section")}</span>
                </button>
                <button className="bk-card" onClick={downloadPdf}>
                  <span className="ic">🖨</span>
                  <b>{t("تحميل PDF", "Download PDF")}</b>
                  <span className="s">
                    {t("تُفتح نافذة الطباعة — اختاري «حفظ بصيغة PDF»", "Print dialog → Save as PDF")}
                  </span>
                </button>
              </div>
            </>
          )}
        </div>
        <div className="m-f">
          <button className="btn btn-ghost btn-sm" onClick={onClose}>
            {t("إغلاق", "Close")}
          </button>
        </div>
      </div>
    </div>
  );
}
