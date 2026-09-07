/* ============================================================
   بناء التقرير الأسبوعي من أقسام المنصة نفسها.

   لا رقم مخزَّن ولا لقطة محفوظة: كل شيء يُحسب لحظة الفتح من
   البنود وتواريخ تحديثها، فما يظهر في التقرير هو ما في الصفحات.

   «هذا الأسبوع مقارنةً بالماضي» = عدد البنود التي تحرّكت في مدى
   كل أسبوع (updatedAt). لا نخترع لقطةً لم تُؤخذ.
   ============================================================ */

import type { SectionKey, WeekSum } from "@/app/dashboard/Sections";
import { AUTO_SECTIONS, listOf, type WeeklyPrefs } from "@/lib/weeklyPrefs";

export type RawItem = { id: string; data: Record<string, unknown>; updatedAt?: unknown };

export type AsgState = "done" | "late" | "risk" | "open";
export type WeeklyAsg = {
  id: string;
  title: string;
  at: string;
  state: AsgState;
  stateAr: string;
  next: string;
  challenge: string;
  support: string;
};

export type WeeklyCell = {
  k: SectionKey;
  name: string;
  moved: number;
  prev: number;
  sum: WeekSum;
};

export type WeeklyReport2 = {
  weekStart: string;
  weekEnd: string;
  overall: number | null;
  overallPrev: number | null;
  cells: WeeklyCell[];
  asg: WeeklyAsg[];
  facts: { n: number; label: string }[];
  texts: { next: string; support: string; challenges: string; priorities: string[] };
};

export const SEC_NAME: Record<SectionKey, string> = {
  sessions: "جلسات مراجعة الأداء",
  natstrat: "الاستراتيجيات الوطنية",
  inststrat: "الاستراتيجيات المؤسسية",
  outputs: "المخرجات الوطنية",
  cx: "أعمال قياس تجربة المستفيد",
  projects: "المشاريع الاستراتيجية",
};

export function weekStartOf(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.toISOString().slice(0, 10);
}
export function shiftDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const day = (v: unknown) => (typeof v === "string" ? v.slice(0, 10) : "");
const inRange = (v: unknown, a: string, b: string) => {
  const t = day(v);
  return !!t && t >= a && t <= b;
};

export type AsgRow = {
  id: string;
  title: string;
  kind?: string;
  state?: string;
  dueDate?: string;
  createdAt?: string;
  completedAt?: string;
};

/** نص الحالة كما يقرؤه المتلقّي — لا رموز داخلية */
function asgState(r: AsgRow, todayISO: string): { state: AsgState; ar: string } {
  if (r.state === "done") return { state: "done", ar: "مكتمل" };
  if (r.dueDate && r.dueDate < todayISO) return { state: "late", ar: "متأخر" };
  if (r.state === "risk") return { state: "risk", ar: "متعثر" };
  return { state: "open", ar: "قيد المعالجة" };
}

export function buildWeekly2(
  weekStart: string,
  sections: Partial<Record<SectionKey, RawItem[]>>,
  summaries: Partial<Record<SectionKey, WeekSum>>,
  assignments: AsgRow[],
  prefs: WeeklyPrefs,
  todayISO: string,
): WeeklyReport2 {
  const weekEnd = shiftDays(weekStart, 6);
  const pStart = shiftDays(weekStart, -7);
  const pEnd = shiftDays(weekStart, -1);

  const cells: WeeklyCell[] = [];
  for (const k of AUTO_SECTIONS) {
    if (!prefs.on[k]) continue;
    const items = sections[k] || [];
    const sum = summaries[k];
    if (!sum) continue;
    cells.push({
      k,
      name: SEC_NAME[k],
      moved: items.filter((x) => inRange(x.updatedAt, weekStart, weekEnd)).length,
      prev: items.filter((x) => inRange(x.updatedAt, pStart, pEnd)).length,
      sum,
    });
  }

  /* الأداء العام = متوسط تقدّم الأقسام التي لها غاية معتمدة.
     ما لا غاية له لا يدخل المتوسط ولا يُخفّضه.
     تنبيه: هذا غير «الأداء العام» في «نظرة عامة» — ذاك يُحسب من
     القياسات والمستهدفات (المحقق ÷ المستهدف)، وهذا من تقدّم
     الأقسام نحو غاياتها. رقمان بالاسم نفسه حتى تُعتمد صيغة واحدة. */
  const ratios: number[] = [];
  for (const c of cells) {
    const p = c.sum.prog;
    if (p && p.of > 0) ratios.push(Math.min(100, Math.round((p.done / p.of) * 100)));
  }
  const overall = ratios.length
    ? Math.round(ratios.reduce((a, b) => a + b, 0) / ratios.length)
    : null;

  /* التكاليف: المفتوحة كلها + ما أُغلق داخل الأسبوع */
  const asgRows = assignments
    .filter((r) => (r.kind || "task") === "assignment")
    .filter((r) => r.state !== "done" || inRange(r.completedAt, weekStart, weekEnd))
    .sort((a, b) => (a.dueDate || a.createdAt || "").localeCompare(b.dueDate || b.createdAt || ""));

  const asg: WeeklyAsg[] = asgRows.map((r) => {
    const st = asgState(r, todayISO);
    const g = (f: string) => (prefs.texts[`asg:${r.id}:${f}`] || "").trim();
    return {
      id: r.id,
      title: r.title,
      at: day(r.createdAt) || day(r.dueDate),
      state: st.state,
      stateAr: st.ar,
      next: g("next"),
      challenge: g("challenge"),
      support: g("support"),
    };
  });

  const movedTot = cells.reduce((a, c) => a + c.moved, 0);
  const facts = [
    { n: movedTot, label: "بندًا تحرّك هذا الأسبوع" },
    { n: asg.filter((a) => a.state !== "done").length, label: "تكليفًا قيد المعالجة" },
    { n: asg.filter((a) => !!a.support).length, label: "تكليفًا يحتاج دعمًا" },
  ];

  /* الأسبوع الماضي بنفس المعادلة — لكن التقدّم لا يُستعاد بأثر
     رجعي، فالمقارنة تكون على الحركة لا على النسبة */
  const overallPrev = null;

  return {
    weekStart,
    weekEnd,
    overall,
    overallPrev,
    cells,
    asg,
    facts,
    texts: {
      next: (prefs.texts.next || "").trim(),
      support: (prefs.texts.support || "").trim(),
      challenges: (prefs.texts.challenges || "").trim(),
      priorities: listOf(prefs.texts.priorities || ""),
    },
  };
}
