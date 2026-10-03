"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { apiFetch } from "@/lib/api";
import { loadUserData, saveUserData } from "@/lib/userdata";
import { sb } from "@/lib/supa";
import { commitStats, ownerMap, nrm, type CommitRow } from "@/lib/commit";
import { Cal } from "./Tools";
import { EMPTY_NOTES, firstLine, preview, whenAr, type NotesData } from "./Notes";
import { PIcon, IconPicker } from "./pickicons";
import { IconGear } from "./icons";
import MyEntities, { contribsOf, sumOf } from "./Entities";
import { publishUndo } from "@/lib/undoBus";
import { useLogos, logoKey, SESS_SHORT, INST_COLS, INST_SECTORS, CX_COLS, CX_QS, cxStagesOf, SECTION_TITLE } from "./Sections";
import { OP_OWNERS, OP_STATUSES, opFix, opRoles, opStatus, opTone } from "./OpPlan";
import { initials, toneOf } from "@/lib/entlogo";
import { ANNUAL_GOALS, GOALS_WEIGHT, goalsScore, type GoalRow } from "@/lib/goals";
import { asset } from "@/lib/base";

/* ============================================================
   محفظتي — الصفحة الشخصية لكل موظف.
   مهامه (المسندة من مديره وما يضيفه لنفسه) وتقويمه وملاحظاته،
   ثم مشاريعه الاستراتيجية وأعماله التشغيلية.
   كل بند بطاقة تُضغط فتفتح جدولها، أو جدولاً مفروداً — حسب
   اختياره. الترتيب والقالب واللون والخلفية تخصّه وحده.
   ============================================================ */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Rec = Record<string, any>;
type T = (ar: string, en: string) => string;
type Me = { id: string; name: string; role: string; jobTitle?: string; scopes: string[] };
type Person = { id: string; name: string; role?: string; isLead?: boolean; sectorIds?: string[] };

export type Row = { section: string; id: string; ord: number; data: Rec; updatedAt?: string };

const num = (v: unknown, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const txt = (v: unknown) => (v === null || v === undefined ? "" : String(v));
/** تاريخ اليوم بصيغة YYYY-MM-DD */
const todayISO = () => new Date().toISOString().slice(0, 10);
/** مفتاح تاريخ الإدخال — يُختم على كل بند جديد ويبقى قابلاً للتعديل */
const ADDED = "addedAt";
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/* صياغة العدد بالعربية: يوم · يومان · أيام · يوماً */
function arCount(n: number, w: [string, string, string, string]) {
  if (n === 1) return w[0];
  if (n === 2) return w[1];
  if (n >= 3 && n <= 10) return `${n} ${w[2]}`;
  return `${n} ${w[3]}`;
}
/** الفرق بالسنوات والأشهر والأيام — بحساب أطوال الأشهر الحقيقية */
function since(iso: string): { y: number; m: number; d: number } | null {
  if (!iso) return null;
  const a = new Date(iso);
  if (isNaN(a.getTime())) return null;
  const b = new Date();
  if (a > b) return null;
  let y = b.getFullYear() - a.getFullYear();
  let m = b.getMonth() - a.getMonth();
  let d = b.getDate() - a.getDate();
  if (d < 0) {
    m--;
    d += new Date(b.getFullYear(), b.getMonth(), 0).getDate();
  }
  if (m < 0) {
    y--;
    m += 12;
  }
  return { y, m, d };
}
function sinceLabel(iso: string): string {
  const s = since(iso);
  if (!s) return "";
  const parts: string[] = [];
  if (s.y) parts.push(arCount(s.y, ["سنة", "سنتان", "سنوات", "سنة"]));
  if (s.m) parts.push(arCount(s.m, ["شهر", "شهران", "أشهر", "شهراً"]));
  if (s.d) parts.push(arCount(s.d, ["يوم", "يومان", "أيام", "يوماً"]));
  return parts.length ? parts.join(" و") : "اليوم";
}

/* ---------------- الويدجت المتاحة ---------------- */
export type WKey = string;

type WDef = {
  key: WKey;
  label: string;
  group: string;
  icon: string;
  color: string;
  section?: string; // قسم البيانات في perf_portfolio
};

export const WIDGETS: WDef[] = [
  /* الصف الأول: التقويم يميناً والملاحظات يساراً بارتفاع واحد،
     وتحتهما «مهامي» بعرض الصفحة كاملاً */
  { key: "calendar", label: "التقويم", group: "top", icon: "calendar", color: "#1a9d5c" },
  { key: "notes", label: "ملاحظاتي", group: "top", icon: "note", color: "#c9a020" },
  { key: "tasks", label: "مهامي", group: "top", icon: "clipboard", color: "#016b5f" },

  /* الأعمال الرئيسية — ما يقوم به الاستشاري على جهاته، وكلٌّ منها
     مربوط بصفحة قسمه في المنصة */
  /* درجات أخضر أداء الثلاث — الأعمال الرئيسية عائلةٌ واحدة تُقرأ
     كذلك بلمحة، لا ألواناً متفرّقة بلا معنى */
  { key: "natstrat", label: "الاستراتيجيات الوطنية", group: "main", icon: "map", color: "#00584c", section: "natstrat" },
  { key: "inststrat", label: "الاستراتيجيات المؤسسية", group: "main", icon: "building", color: "#016b5f", section: "inststrat" },
  { key: "cx", label: "قياس تجربة المستفيد", group: "main", icon: "user-check", color: "#008b84", section: "cx" },

  { key: "projects", label: "المشاريع الاستراتيجية", group: "projects", icon: "rocket", color: "#0f8a8a", section: "projects" },

  /* الأعمال التشغيلية — الطلبات اليومية */
  { key: "changes", label: "طلبات التغيير", group: "ops", icon: "exchange", color: "#c9a020", section: "changes" },
  { key: "reverse", label: "طلبات العكس", group: "ops", icon: "undo", color: "#e07a3a", section: "reverse" },
  /* «توثيق قيم المؤشرات/المبادرات» هو الاسم المعتمد لما كان
     «طلبات تحديث سير العمل» — المفتاح والقسم كما هما فلا تضيع بياناته */
  { key: "workflow", label: "توثيق قيم المؤشرات/المبادرات", group: "ops", icon: "workflow", color: "#a24160", section: "workflow" },

  { key: "contrib", label: "المساهمات في الخطة التشغيلية", group: "contribs", icon: "puzzle", color: "#7a5cd1", section: "contrib" },

  /* خطة التطوير الفردية — نموذج الموارد البشرية نفسه بلا ترويسته:
     الاسم والمسمّى والمدير وتواريخ التقييم معروفةٌ في المنصة
     أصلاً، فلا تُكتب مرّةً ثانية */
  { key: "devplan", label: "خطتي التطويرية", group: "dev", icon: "trend", color: "#2f7fd1", section: "devplan" },

  /* بقيا من الترتيب السابق — مخفيّان افتراضياً ولا تضيع بياناتهما،
     ويُعادان من «تخصيص محفظتي» عند الحاجة */
  { key: "strategies", label: "جهاتي ومساهماتها", group: "main", icon: "map", color: "#016b5f", section: "entities" },
  { key: "quarterly", label: "التقارير الربعية", group: "main", icon: "calendar-check", color: "#1a9d5c", section: "entities" },
];

/** عناوين المجموعات بترتيب ظهورها */
export const GROUPS: { id: string; label: [string, string] }[] = [
  { id: "main", label: ["الأعمال الرئيسية", "Core work"] },
  { id: "ops", label: ["الأعمال التشغيلية", "Operational work"] },
  { id: "contribs", label: ["المساهمات في الخطة التشغيلية", "Operational plan contributions"] },
  { id: "projects", label: ["المشاريع الاستراتيجية", "Strategic projects"] },
  { id: "dev", label: ["خطة التطوير الفردية", "Individual development plan"] },
];
const BASE_MAP: Record<string, WDef> = Object.fromEntries(WIDGETS.map((w) => [w.key, w]));
/** عنوان كل مجموعة بمعرّفها */
const GMAP: Record<string, { id: string; label: [string, string] }> =
  Object.fromEntries(GROUPS.map((g) => [g.id, g]));

const CCOLORS = ["#016b5f", "#1a9d5c", "#2f7fd1", "#7a5cd1", "#a24160", "#c9a020", "#e07a3a", "#0f8a8a"];

/* ---------------- تفضيلات الصفحة ---------------- */
/** بند يضيفه المستخدم بنفسه — مفتاحه يبدأ بـ cw- وبياناته في قسم بالاسم نفسه */
export type CustomW = { key: string; label: string; icon: string; color: string; group: string };
/** قسم يضيفه المستخدم فوق «الأعمال التشغيلية» أو تحته */
export type CustomSec = { id: string; label: string };

type Prefs = {
  mode: "tiles" | "table";
  layout: "two" | "one" | "three" | "main";
  order: string[];
  /** ترتيب الأقسام نفسها — لكلٍّ ترتيبُه: هذا يبدأ بالتقويم
      وملاحظاته، وذاك يبدأ بأعماله ويُنزل التقويم آخراً */
  secOrder?: string[];
  hidden: string[];
  color: string;
  bg: string;
  bgDim: number;
  custom: CustomW[];
  sections: CustomSec[];
  /** تاريخ الانضمام لأداء — يظهر في رأس الصفحة */
  joined: string;
  /** تغيير اسم أو أيقونة أو لون أي بند — بما فيه الأصلية */
  look: Record<string, { label?: string; icon?: string; color?: string }>;
  /** أعمدة جداول الأقسام كما عدّلها صاحب المحفظة — المفتاح اسم القسم.
      غيابُه يعني الأعمدة الافتراضية */
  cols?: Record<string, Col[]>;
  /** إخفاء عمود «تاريخ الإدخال» في قسم بعينه — الظهور هو الأصل */
  noStamp?: Record<string, boolean>;
  /** أرقام الأهداف السنوية التي لا مصدر لها في المنصة — بالمعرّف
      في `ANNUAL_GOALS`. المحسوب آلياً لا يُحفظ هنا فلا يتجمّد. */
  goals?: Record<string, number>;
  /** علامة ترحيل الترتيب الافتراضي الجديد */
  v2?: boolean;
  /** علامة ترحيل هيكل «الأعمال الرئيسية» */
  v3?: boolean;
};
/** الأقسام بترتيبها الافتراضي — «top» قسمٌ بلا عنوان فوق البقية */
export const SEC_ALL = ["top", "main", "ops", "contribs", "projects", "dev"];
export const SEC_LABEL: Record<string, string> = {
  top: "التقويم والملاحظات والمهام",
  main: "الأعمال الرئيسية",
  ops: "الأعمال التشغيلية",
  contribs: "المساهمات في الخطة التشغيلية",
  projects: "المشاريع الاستراتيجية",
  dev: "خطة التطوير الفردية",
};

/** ما يبقى مخفيّاً في الترتيب الجديد — بياناته باقية ويُعاد من التخصيص */
const HIDE_V3 = ["strategies", "quarterly"];
const DEFAULT_PREFS: Prefs = {
  mode: "tiles",
  layout: "two",
  order: WIDGETS.map((w) => w.key),
  hidden: [...HIDE_V3],
  color: "#00584c",
  bg: "",
  bgDim: 35,
  custom: [],
  sections: [],
  joined: "",
  look: {},
  cols: {},
};

/* أعمدة كل قسم — تُستعمل في الجداول وفي نافذة الإدخال */
type Col = { k: string; label: string; kind?: "num" | "text" | "date" | "sel"; opts?: string[]; w?: number };
const COLS: Record<string, Col[]> = {
  /* الأعمال الرئيسية — الأعمدة نفسها التي تُعبَّأ في صفحة القسم،
     فما يكتبه الاستشاري هنا هو ما يظهر هناك. و«الاجتماع الربعي»
     و«المحضر» يبقيان في المحفظة ولا ينعكسان في صفحة القسم. */
  natstrat: [
    { k: "name", label: "الاستراتيجية", w: 3 },
    { k: "owner", label: "الجهة المالكة", w: 2 },
    { k: "stage", label: "حالة الاعتماد", kind: "sel",
      opts: ["طور الإعداد/التحديث", "قيد المراجعة", "معتمدة من اللجنة", "معتمدة من مجلس الوزراء"] },
    { k: "kpis", label: "المؤشرات", kind: "num" },
    { k: "inits", label: "المبادرات", kind: "num" },
    { k: "meet", label: "الاجتماع الربعي", kind: "sel", opts: ["لم يُعقد", "عُقد"] },
    { k: "minutes", label: "رابط المحضر", w: 2 },
    { k: "needSess", label: "تحتاج جلسة مراجعة أداء", kind: "sel", opts: ["لا", "نعم"] },
    { k: "note", label: "ملاحظة", w: 3 },
  ],
  inststrat: [
    { k: "name", label: "الجهة", w: 3 },
    { k: "stage", label: "الحالة", kind: "sel", opts: ["لم تبدأ", "عُقد الاجتماع التعريفي", "الوثائق مستلمة", "فُعِّل القياس"] },
    { k: "kpis", label: "المؤشرات", kind: "num" },
    { k: "inits", label: "المبادرات", kind: "num" },
    { k: "meet", label: "الاجتماع الربعي", kind: "sel", opts: ["لم يُعقد", "عُقد"] },
    { k: "minutes", label: "رابط المحضر", w: 2 },
    { k: "needSess", label: "تحتاج جلسة مراجعة أداء", kind: "sel", opts: ["لا", "نعم"] },
    { k: "note", label: "ملاحظة", w: 3 },
  ],
  cx: [
    { k: "name", label: "الجهاز", w: 3 },
    { k: "stage", label: "المرحلة", kind: "sel", opts: ["لم تبدأ", "في التهيئة", "في القياس", "صدر التقرير"] },
    { k: "services", label: "عدد الخدمات", kind: "num" },
    { k: "meet", label: "الاجتماع الربعي", kind: "sel", opts: ["لم يُعقد", "عُقد"] },
    { k: "minutes", label: "رابط المحضر", w: 2 },
    { k: "note", label: "ملاحظة", w: 3 },
  ],
  entities: [
    { k: "name", label: "اسم الجهة أو الاستراتيجية", w: 3 },
    { k: "type", label: "النوع", kind: "sel", opts: ["مؤسسية", "وطنية", "مناطقية", "برنامج"] },
    { k: "initiatives", label: "عدد المبادرات", kind: "num" },
    { k: "kpis", label: "عدد المؤشرات", kind: "num" },
    { k: "note", label: "آخر تحديث", w: 3 },
  ],
  contrib: [
    { k: "kind", label: "النوع", kind: "sel", opts: ["مؤشر", "مبادرة", "مكاسب سريعة"] },
    { k: "name", label: "البند", w: 3 },
    { k: "status", label: "الحالة", kind: "sel", opts: ["قيد العمل", "بانتظار بيانات", "مكتمل"] },
    { k: "pct", label: "نسبة الإنجاز ٪", kind: "num" },
    { k: "closed", label: "تاريخ الإغلاق", kind: "date" },
  ],
  changes: [
    { k: "code", label: "رمز المؤشر", w: 2 },
    { k: "entity", label: "الجهة", w: 2 },
    { k: "status", label: "الحالة", kind: "sel", opts: ["قيد العمل", "متأخر", "مغلقة"] },
    { k: "days", label: "الأيام", kind: "num" },
  ],
  reverse: [
    { k: "code", label: "رقم الطلب", w: 2 },
    { k: "status", label: "الحالة", kind: "sel", opts: ["قيد العمل", "مغلقة"] },
  ],
  workflow: [
    { k: "code", label: "رقم الطلب", w: 2 },
    { k: "status", label: "الحالة", kind: "sel", opts: ["قيد العمل", "مغلقة"] },
  ],
  custom: [
    { k: "name", label: "البند", w: 3 },
    { k: "status", label: "الحالة", kind: "sel", opts: ["قيد العمل", "بانتظار", "مكتمل"] },
    { k: "pct", label: "نسبة الإنجاز ٪", kind: "num" },
    { k: "note", label: "ملاحظة", w: 2 },
    { k: "date", label: "التاريخ", kind: "date" },
  ],
  /* نموذج «الخطة التطويرية» كما في ملف الموارد البشرية، بلا جدول
     الترويسة (الموظف · المسمّى · المدير · تواريخ التقييم والانضمام)
     — تلك بياناتٌ تعرفها المنصة، وإعادةُ كتابتها بابُ تناقض.
     و«حالة الاكتمال» عنوانها يحوي «حالة»، فعدّادُ البطاقة ونسبةُ
     الهدف السنوي يقرآنها بلا استثناءٍ خاص. */
  devplan: [
    { k: "kind", label: "نوع الجدارة", kind: "sel", opts: ["سلوكية", "مهنية"] },
    { k: "name", label: "الجدارة ذات الأولوية", w: 2 },
    { k: "steps", label: "الخطوات لتطوير الجدارة", w: 3 },
    { k: "measure", label: "مقياس النجاح", w: 2 },
    { k: "due", label: "التاريخ المتوقع لتحقيق الجدارة", kind: "date" },
    { k: "now", label: "المستوى الحالي", kind: "sel", opts: ["مبتدئ", "متوسط", "متقدم", "خبير"] },
    { k: "need", label: "المستوى المطلوب", kind: "sel", opts: ["مبتدئ", "متوسط", "متقدم", "خبير"] },
    { k: "how", label: "آلية التطوير", kind: "sel",
      opts: ["تدريب بالممارسة", "تدريب عن طريق المنصة", "دورة تدريبية", "إرشاد وتوجيه", "مشروع عملي"] },
    { k: "state", label: "حالة الاكتمال", kind: "sel", opts: ["لم تبدأ", "قيد التنفيذ", "مكتملة"] },
    { k: "final", label: "التقييم النهائي", w: 2 },
  ],
  projects: [
    { k: "name", label: "اسم المشروع", w: 2 },
    { k: "desc", label: "الوصف", w: 3 },
    { k: "status", label: "الحالة" },
    { k: "mine", label: "مهامي", w: 2 },
  ],
};

/** اسم الصف كما يعرفه صاحبه — لتلميح سهم التراجع */
function labelOfRow(r: Row): string {
  const d = r.data as Record<string, unknown>;
  for (const k of ["name", "title", "entity", "text", "desc"]) {
    const v = d[k];
    if (typeof v === "string" && v.trim()) return v.trim().slice(0, 60);
  }
  return r.id;
}

/* ---------------- تحميل صفوف المحفظة ---------------- */
function usePortfolio(userId?: string) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loaded, setLoaded] = useState(false);
  const rowsRef = useRef<Row[]>([]);
  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);
  const busId = useRef(`pf:${Math.random().toString(36).slice(2)}`).current;
  useEffect(() => () => publishUndo(busId, null), [busId]);

  const load = useCallback(async () => {
    const r = await apiFetch(`/api/portfolio${userId ? `?user=${userId}` : ""}`);
    const d = await r.json().catch(() => ({}));
    setRows(Array.isArray(d.items) ? d.items : []);
    setLoaded(true);
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(
    async (section: string, id: string, data: Rec, ord = 100) => {
      await apiFetch("/api/portfolio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ section, id: id || "pf-" + newId(), data, ord }),
      });
      await load();
    },
    [load],
  );

  const saveMany = useCallback(
    async (items: { section: string; id?: string; data: Rec; ord?: number }[]) => {
      if (!items.length) return;
      await apiFetch("/api/portfolio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      await load();
    },
    [load],
  );

  /* الحذف يلتقط الصف قبل إزالته، فسهم التراجع يعيده بمعرّفه
     وترتيبه وبياناته كما كان — لا نسخة جديدة منه */
  const remove = useCallback(
    async (section: string, id: string) => {
      const before = rowsRef.current.find((r) => r.section === section && r.id === id);
      await apiFetch(`/api/portfolio?section=${section}&id=${encodeURIComponent(id)}`, { method: "DELETE" });
      await load();
      if (!before) return;
      publishUndo(busId, {
        kind: "delete",
        label: labelOfRow(before),
        run: async () => {
          await apiFetch("/api/portfolio", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ section, id, data: before.data, ord: before.ord }),
          });
          publishUndo(busId, null);
          await load();
          return null;
        },
      });
    },
    [load, busId],
  );

  const of = useCallback((section: string) => rows.filter((r) => r.section === section), [rows]);
  return { rows, of, loaded, reload: load, save, saveMany, remove };
}

/* ---------------- مهامي ---------------- */
type Task = {
  id: string; title: string; description?: string; assigneeId: string; createdById: string;
  dueDate: string; state: string; kind?: string; priority: string;
  updates?: { by?: string; byName?: string; text: string; at: string }[];
};

function dueTone(d: string, state: string) {
  if (state === "done" || state === "hold") return "";
  if (!d) return "";
  const days = Math.round((new Date(d).getTime() - Date.now()) / 86400000);
  return days < 0 ? "r" : days <= 2 ? "a" : "";
}
function dueLabel(d: string, t: T) {
  if (!d) return t("بلا موعد", "No due date");
  const days = Math.round((new Date(d).getTime() - new Date(new Date().toISOString().slice(0, 10)).getTime()) / 86400000);
  if (days === 0) return t("اليوم", "Today");
  if (days === 1) return t("غداً", "Tomorrow");
  if (days === 2) return t("بعد يومين", "In 2 days");
  if (days < 0) return `${t("متأخرة", "Late")} ${Math.abs(days)} ${t("يوم", "d")}`;
  return d;
}

function TasksWidget({ me, t, onCount }: { me: Me; t: T; onCount?: (n: number) => void }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [filter, setFilter] = useState<"all" | "boss" | "self">("all");
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [newT, setNewT] = useState({ title: "", dueDate: "" });
  /* حدّ العرض خمسة، وما زاد خلف زر — في الأعمدة وفي تحديثات المهمة */
  const [moreCol, setMoreCol] = useState<Record<string, boolean>>({});
  const [moreUpd, setMoreUpd] = useState<Record<string, boolean>>({});
  const LIMIT = 5;

  const [people, setPeople] = useState<Person[]>([]);
  const [busy, setBusy] = useState(false);
  const tBusId = useRef(`pf-tasks:${Math.random().toString(36).slice(2)}`).current;
  useEffect(() => () => publishUndo(tBusId, null), [tBusId]);

  const load = useCallback(async () => {
    const d = await apiFetch("/api/tasks").then((r) => r.json()).catch(() => ({}));
    const mine: Task[] = (d.tasks || []).filter((x: Task) => x.assigneeId === me.id);
    setTasks(mine);
    setPeople(d.people || []);
    onCount?.(mine.filter((x) => x.state !== "done").length);
  }, [me.id, onCount]);
  useEffect(() => {
    void load();
  }, [load]);

  const isBoss = (x: Task) => x.createdById !== me.id;

  /* ثلاثة أعمدة: المهام (مفتوحة وموعدها لم يمضِ) · المتأخرة · المكتملة.
     التقسيم بالحالة، والشرائح فوقه تقسّم بالمصدر — فلا يتكرر المعنى. */
  const colOf = (x: Task): "open" | "late" | "done" => {
    if (x.state === "done") return "done";
    /* المعلَّقة ليست متأخرة: موعدها مضى لأنها موقوفة */
    if (x.state === "hold") return "open";
    const d = x.dueDate
      ? Math.round((new Date(x.dueDate).getTime() - new Date(new Date().toISOString().slice(0, 10)).getTime()) / 86400000)
      : 99;
    return d < 0 ? "late" : "open";
  };

  const shown = tasks.filter((x) => (filter === "boss" ? isBoss(x) : filter === "self" ? !isBoss(x) : true));

  async function addUpdate(id: string) {
    const text = draft.trim();
    if (!text) return;
    await apiFetch(`/api/tasks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    setDraft("");
    setOpen(null);
    await load();
  }
  async function done(id: string) {
    await apiFetch(`/api/tasks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: "done" }),
    });
    await load();
  }
  async function del(id: string) {
    if (!confirm(t("حذف المهمة؟", "Delete task?"))) return;
    const before = tasks.find((x) => x.id === id);
    const r = await apiFetch(`/api/tasks/${id}`, { method: "DELETE" }).then((x) => x.json()).catch(() => ({}));
    if (r?.error) {
      alert(r.error);
      return;
    }
    await load();
    if (!before) return;
    publishUndo(tBusId, {
      kind: "delete",
      label: before.title,
      run: async () => {
        const back = await apiFetch("/api/tasks/restore", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ task: before }),
        }).then((x) => x.json()).catch(() => ({}));
        publishUndo(tBusId, null);
        if (back?.error) {
          alert(back.error);
          return back.error as string;
        }
        await load();
        return null;
      },
    });
  }
  async function create() {
    const title = newT.title.trim();
    if (!title) return;
    await apiFetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, assigneeId: me.id, dueDate: newT.dueDate || null, priority: "normal" }),
    });
    setNewT({ title: "", dueDate: "" });
    setAdding(false);
    await load();
  }

  /* ---- بيانات تجريبية للعرض ----
     مهام من مديري وأخرى ذاتية، لتوضيح شكل الصفحة قبل تعبئتها.
     معرّفاتها تبدأ بـ tsk-demo- فتُعرف وتُحذف دفعة واحدة. */
  const hasDemo = tasks.some((x) => x.id.startsWith("tsk-demo-"));
  const bossId = useMemo(() => {
    const mine = people.find((x) => x.id === me.id);
    const mySec = mine?.sectorIds || [];
    const lead = people.find(
      (x) => x.id !== me.id && x.isLead && x.sectorIds?.some((sc) => mySec.includes(sc))
    );
    return (lead || people.find((x) => x.id !== me.id && x.isLead))?.id || "";
  }, [people, me.id]);

  async function seedDemo() {
    if (!bossId) {
      alert(t("لم يُعثر على حساب المدير — يلزم تشغيل ملف الهيكل أولاً.", "Manager account not found."));
      return;
    }
    const day = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
    const bossName = people.find((x) => x.id === bossId)?.name || "";
    const rows = [
      { id: "tsk-demo-p1", title: "إعداد ملخّص تنفيذي لجاهزية الاستراتيجيات الوطنية قبل جلسة المجلس",
        createdById: bossId, dueDate: day(4), state: "ok", priority: "high",
        updates: [{ id: "d1", text: "الملخّص يُرفع بصيغة عرض من 5 شرائح.", byId: bossId, byName: bossName, at: new Date(Date.now() - 2 * 86400000).toISOString() }] },
      { id: "tsk-demo-p2", title: "مراجعة الجهات ذات قابلية القياس المنخفضة ورفع التوصيات",
        createdById: bossId, dueDate: day(-3), state: "ok", priority: "high", updates: [] },
      { id: "tsk-demo-p3", title: "تحديث بيانات الاستراتيجيات المؤسسية لقطاع الشؤون الاقتصادية",
        createdById: bossId, dueDate: day(-8), state: "done", priority: "mid", updates: [] },
      { id: "tsk-demo-p4", title: "تجهيز عرض الإنجاز الأسبوعي للإدارة",
        createdById: me.id, dueDate: day(2), state: "ok", priority: "mid", updates: [] },
      { id: "tsk-demo-p5", title: "متابعة استلام وثائق الاستراتيجيات المتبقية من الجهات",
        createdById: me.id, dueDate: day(9), state: "ok", priority: "mid", updates: [] },
      { id: "tsk-demo-p6", title: "توحيد أسماء الجهات في ملف الاستراتيجيات المؤسسية",
        createdById: me.id, dueDate: day(-5), state: "done", priority: "mid", updates: [] },
    ].map((x) => ({ ...x, assigneeId: me.id, kind: "task" }));
    setBusy(true);
    const r = await apiFetch("/api/tasks/demo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tasks: rows }),
    });
    setBusy(false);
    if (!r.ok) {
      alert(t("تعذّر إضافة البيانات التجريبية.", "Could not add demo data."));
      return;
    }
    await load();
  }

  async function clearDemo() {
    if (!confirm(t("حذف كل المهام التجريبية؟", "Delete all demo tasks?"))) return;
    setBusy(true);
    const r = await apiFetch("/api/tasks/demo?kind=task", { method: "DELETE" });
    setBusy(false);
    if (!r.ok) {
      alert(t("تعذّر الحذف — يحتاج صلاحية مدير الإدارة.", "Delete needs admin."));
      return;
    }
    await load();
  }

  const chip = (k: typeof filter, label: string, n: number) => (
    <span className={filter === k ? "on" : ""} onClick={() => setFilter(k)}>
      {label} ({n})
    </span>
  );

  const COLS: { key: "open" | "late" | "done"; title: string; color: string }[] = [
    { key: "open", title: t("المهام", "Tasks"), color: "#016b5f" },
    { key: "late", title: t("المتأخرة", "Overdue"), color: "#d34a4a" },
    { key: "done", title: t("المكتملة", "Completed"), color: "#5aaba2" },
  ];

  function TaskCard({ x }: { x: Task }) {
    const boss = isBoss(x);
    const ups = Array.isArray(x.updates) ? x.updates : [];
    return (
      <div className={`tk2c ${boss ? "boss" : ""}`}>
        <div className="ttl">{x.title}</div>
        <div className="mt">
          <span className="from">{boss ? t("من مديري", "From manager") : t("ذاتية", "Self")}</span>
          <span className="due">{dueLabel(x.dueDate, t)}</span>
        </div>
        <div className="acts">
          <span className="ac2" onClick={() => setOpen(open === x.id ? null : x.id)}>
            {ups.length ? `${ups.length} ${t("تحديثات", "updates")}` : `+ ${t("تحديث", "Update")}`}
          </span>
          {x.state !== "done" && (
            <span className="ac2" onClick={() => done(x.id)}>
              ✓ {t("إنهاء", "Done")}
            </span>
          )}
          {boss ? (
            <span className="lock" title={t("مسندة من مديرك — لا يمكن حذفها", "Assigned by your manager")}>
              🔒
            </span>
          ) : (
            <span className="ac2 del2" onClick={() => del(x.id)}>
              ✕
            </span>
          )}
        </div>
        {open === x.id && (
          <div className="upd">
            {(moreUpd[x.id] ? ups : ups.slice(-LIMIT)).map((u, i) => (
              <div className="u" key={i}>
                <b>{u.byName || ""}:</b>
                <span>{u.text}</span>
                <span className="d">{txt(u.at).slice(0, 10)}</span>
              </div>
            ))}
            {ups.length > LIMIT && (
              <button className="moreln" onClick={() => setMoreUpd({ ...moreUpd, [x.id]: !moreUpd[x.id] })}>
                {moreUpd[x.id]
                  ? t("عرض أقل", "Show less")
                  : `${t("عرض تحديثات أخرى", "More updates")} (${ups.length - LIMIT})`}
              </button>
            )}
            <div className="updbox">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={t("اكتب تحديثاً يظهر لمديرك…", "Write an update…")}
                onKeyDown={(e) => e.key === "Enter" && addUpdate(x.id)}
              />
              <button className="btn btn-sm" onClick={() => addUpdate(x.id)}>
                {t("إرسال", "Send")}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="tfil">
        {chip("all", t("الكل", "All"), tasks.length)}
        {chip("boss", t("مهام موكلة لي", "Assigned to me"), tasks.filter(isBoss).length)}
        {chip("self", t("مهامي", "My own"), tasks.filter((x) => !isBoss(x)).length)}
      </div>

      <div className="tkboard">
        {COLS.map((c) => {
          const list = shown.filter((x) => colOf(x) === c.key);
          const vis = moreCol[c.key] ? list : list.slice(0, LIMIT);
          return (
            <div className="tkcol" key={c.key}>
              <div className="h" style={{ ["--c" as string]: c.color }}>
                {c.title}
                <b>{list.length}</b>
              </div>
              {vis.map((x) => (
                <TaskCard key={x.id} x={x} />
              ))}
              {list.length > LIMIT && (
                <button className="moreln" onClick={() => setMoreCol({ ...moreCol, [c.key]: !moreCol[c.key] })}>
                  {moreCol[c.key]
                    ? t("عرض أقل", "Show less")
                    : `${t("عرض مهام أخرى", "More tasks")} (${list.length - LIMIT})`}
                </button>
              )}
              {!list.length && <div className="pf-none sm">—</div>}
            </div>
          );
        })}
      </div>

      {adding ? (
        <div className="updbox" style={{ marginTop: 8 }}>
          <input
            autoFocus
            value={newT.title}
            onChange={(e) => setNewT({ ...newT, title: e.target.value })}
            placeholder={t("عنوان المهمة", "Task title")}
          />
          <input
            type="date"
            value={newT.dueDate}
            onChange={(e) => setNewT({ ...newT, dueDate: e.target.value })}
            style={{ maxWidth: 150 }}
          />
          <button className="btn btn-sm" onClick={create}>
            {t("إضافة", "Add")}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => setAdding(false)}>
            {t("إلغاء", "Cancel")}
          </button>
        </div>
      ) : (
        <div className="addrow" onClick={() => setAdding(true)}>
          + {t("مهمة جديدة لنفسي", "New task for me")}
        </div>
      )}

      <div className="demorow">
        {hasDemo ? (
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={clearDemo}>
            {t("حذف البيانات التجريبية", "Remove demo data")}
          </button>
        ) : (
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={seedDemo}>
            {t("إضافة بيانات تجريبية للعرض", "Add demo data")}
          </button>
        )}
      </div>
    </>
  );
}

/* ---------------- ملاحظاتي ---------------- */
/** أكثر ما يُعرض من الملاحظات في المحفظة */
const PIN_MAX = 4;

function NotesWidget({ t, onOpen }: { t: T; onOpen: () => void }) {
  const [data, setData] = useState<NotesData>(EMPTY_NOTES);
  useEffect(() => {
    void loadUserData<NotesData>("notes", EMPTY_NOTES).then((d) => setData(d || EMPTY_NOTES));
  }, []);
  const sorted = [...(data.notes || [])].sort((a, b) => txt(b.updatedAt).localeCompare(txt(a.updatedAt)));
  /* **المثبَّتة وحدها**: المحفظة لوحةُ ما يعني صاحبها الآن، لا
     أرشيفَ ملاحظاته. وآخرُ ما ثُبِّت أعلاها، وأربعٌ حدّاً — فوقها
     يصير الصندوق قائمةً تُمرَّر لا لوحةً تُقرأ بلمحة. */
  const pinned = sorted
    .filter((n) => !!n.pinnedAt)
    .sort((a, b) => txt(b.pinnedAt).localeCompare(txt(a.pinnedAt)));
  const list = pinned.slice(0, PIN_MAX);
  /* الميزة الأقل وضوحاً في المنصة: التاريخ يُقرأ من نص الملاحظة.
     فيُشرح هنا حتى يُكتشف، ويختفي الشرح متى ظهر أثره — أي متى صار
     لملاحظة موعد — فلا يبقى تنبيهاً دائماً لمن عرفه. */
  const gotIt = sorted.some((n) => !!n.due);
  return (
    <>
      {!gotIt && (
        <div className="nt-tip">
          <b>اكتب التاريخ داخل الملاحظة</b>
          <span>
«بكرة الساعة 9 اجتماع الديوان» — يُقرأ الموعد ويظهر في التقويم.
            وتُفهم: اليوم · بكرة · الأحد · الأربعاء 2:30 · بعد أسبوع · 15 سبتمبر.
          </span>
        </div>
      )}
      <div className="nts">
        {list.map((n) => (
          <div className="nt2 pin" key={n.id}>
            <div className="t">{firstLine(n)}</div>
            <div className="x">{preview(n)}</div>
            <div className="m">{whenAr(n.updatedAt)}</div>
          </div>
        ))}
        {!list.length && (
          <div className="pf-none">
            {sorted.length
              ? t(
                  "لا ملاحظة مثبَّتة — ثبِّت ما تريد رؤيته هنا بالدبوس 📌 من «ملاحظاتي».",
                  "Pin a note to see it here.",
                )
              : t("لا توجد ملاحظات بعد.", "No notes yet.")}
          </div>
        )}
      </div>
      {pinned.length > PIN_MAX && (
        <div className="pf-hint">
          {t(
            `مثبَّتٌ ${pinned.length} — تُعرض أحدث ${PIN_MAX}.`,
            `${pinned.length} pinned — showing the latest ${PIN_MAX}.`,
          )}
        </div>
      )}
      <div className="addrow" onClick={onOpen}>
        + {t("ملاحظة جديدة", "New note")}
      </div>
    </>
  );
}

/* ---------------- جدول قسم ---------------- */
function SectionTable({
  section,
  sectionKey,
  rows,
  cols,
  custom,
  stamp = true,
  onStamp,
  t,
  onSave,
  onDelete,
  onImport,
  onCols,
}: {
  section: string;
  sectionKey?: string;
  rows: Row[];
  /** أعمدة هذا الجدول — المعدَّلة إن عُدِّلت، وإلا الافتراضية */
  cols: Col[];
  /** هل الأعمدة الحالية معدَّلة؟ عندها يظهر خيار استرجاع الافتراضية */
  custom?: boolean;
  /** ختم تاريخ الإدخال: عمود يُملأ تلقائياً ويبقى قابلاً للتعديل */
  stamp?: boolean;
  onStamp?: (on: boolean) => void;
  t: T;
  onSave: (id: string, data: Rec) => void;
  onDelete: (id: string) => void;
  onImport: () => void;
  /** حفظ أعمدة الجدول — null يعيدها للافتراضي */
  onCols?: (cols: Col[] | null) => void;
}) {
  void sectionKey;
  const [edit, setEdit] = useState<Row | "new" | null>(null);
  const [menu, setMenu] = useState(false);
  const [colsOpen, setColsOpen] = useState(false);
  /* القائمة تُغلق بالضغط خارجها — وإلا بقيت مفتوحة فوق النافذة */
  useEffect(() => {
    if (!menu) return;
    const h = () => setMenu(false);
    window.addEventListener("click", h);
    return () => window.removeEventListener("click", h);
  }, [menu]);
  return (
    <>
      <div className="pf-tb">
        <button className="b" onClick={onImport}>
          ⬆ {t("رفع إكسل / لصق", "Import")}
        </button>
        <button className="b" onClick={() => setEdit("new")}>
          + {t("إضافة صف", "Add row")}
        </button>
        {onCols && (
          <span className="pf-gear" onClick={(e) => e.stopPropagation()}>
            <button
              className={`b ${menu ? "on" : ""}`}
              onClick={() => setMenu(!menu)}
              title={t("إعدادات الجدول", "Table settings")}
              aria-label={t("إعدادات الجدول", "Table settings")}
            >
              ⚙
            </button>
            {menu && (
              <div className="pf-menu">
                <button onClick={() => { setMenu(false); setEdit("new"); }}>
                  {t("إضافة صف", "Add row")}
                </button>
                <button
                  onClick={() => {
                    setMenu(false);
                    onCols([...cols, { k: newColKey(cols), label: t("عمود جديد", "New column") }]);
                    setColsOpen(true);
                  }}
                >
                  {t("إضافة عمود", "Add column")}
                </button>
                <button onClick={() => { setMenu(false); setColsOpen(true); }}>
                  {t("تعديل الأعمدة…", "Edit columns…")}
                </button>
                <button onClick={() => { setMenu(false); onImport(); }}>
                  {t("لصق جدول بأعمدته…", "Paste a table with its columns…")}
                </button>
                {onStamp && (
                  <button onClick={() => { setMenu(false); onStamp(!stamp); }}>
                    {stamp
                      ? t("إخفاء عمود تاريخ الإدخال", "Hide the added-on column")
                      : t("إظهار عمود تاريخ الإدخال", "Show the added-on column")}
                  </button>
                )}
                {custom && (
                  <button
                    className="dg"
                    onClick={() => {
                      setMenu(false);
                      if (confirm(t("إرجاع الأعمدة الافتراضية؟ الصفوف تبقى كما هي.", "Restore default columns? Rows are kept.")))
                        onCols(null);
                    }}
                  >
                    {t("إرجاع الأعمدة الافتراضية", "Restore default columns")}
                  </button>
                )}
              </div>
            )}
          </span>
        )}
        <span className="cnt">
          {t("إجمالي", "Total")}: {rows.length}
        </span>
      </div>
      <div className="pf-tw">
        <table className="pf-t">
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c.k}>{c.label}</th>
              ))}
              {stamp && <th style={{ width: 110 }}>{t("تاريخ الإدخال", "Added on")}</th>}
              <th style={{ width: 70 }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                {cols.map((c, i) => (
                  <td key={c.k} className={i === 0 ? "nm" : ""}>
                    {c.kind === "sel" && r.data[c.k] ? (
                      <span className="chip">{txt(r.data[c.k])}</span>
                    ) : (
                      txt(r.data[c.k]) || "—"
                    )}
                  </td>
                ))}
                {stamp && <td className="stamp">{txt(r.data[ADDED]) || "—"}</td>}
                <td className="acts3">
                  <span onClick={() => setEdit(r)}>{t("تعديل", "Edit")}</span>
                  <span className="del" onClick={() => onDelete(r.id)}>
                    {t("حذف", "Delete")}
                  </span>
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={cols.length + (stamp ? 2 : 1)} className="pf-none">
                  {t("لا توجد بيانات — أضف بنداً أو ارفع ملفاً.", "No data yet.")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {edit && (
        <RowForm
          cols={cols}
          stamp={stamp}
          row={edit === "new" ? null : edit}
          t={t}
          onClose={(data) => {
            if (data) onSave(edit === "new" ? "" : edit.id, data);
            setEdit(null);
          }}
        />
      )}
      {colsOpen && onCols && (
        <ColsModal
          cols={cols}
          t={t}
          onClose={() => setColsOpen(false)}
          onSave={(next) => {
            onCols(next);
            setColsOpen(false);
          }}
        />
      )}
    </>
  );
}

/** مفتاح عمود جديد لا يصادم الموجود — البيانات تُحفظ به */
function newColKey(cols: Col[]): string {
  const used = new Set(cols.map((c) => c.k));
  for (let i = 1; i < 200; i++) if (!used.has(`c${i}`)) return `c${i}`;
  return "c" + Date.now().toString(36);
}

/** أعمدة مشتقّة من صف عناوين مُلصَق أو مرفوع */
function colsFromHead(head: string[]): Col[] {
  const out: Col[] = [];
  head.forEach((h, i) => {
    const label = txt(h).trim();
    out.push({ k: `c${i + 1}`, label: label || `عمود ${i + 1}` });
  });
  return out.length ? out : [{ k: "c1", label: "البند" }];
}

/* ---------------- أعمدة الجدول ----------------
   التعديل هنا لا يمسّ صفاً واحداً: حذف عمود يخفي قيمه ولا يمحوها
   من الصف، فإرجاعه يعيدها كما كانت. */
function ColsModal({
  cols,
  t,
  onClose,
  onSave,
}: {
  cols: Col[];
  t: T;
  onClose: () => void;
  onSave: (cols: Col[]) => void;
}) {
  const [list, setList] = useState<Col[]>(() => cols.map((c) => ({ ...c })));
  const set = (i: number, p: Partial<Col>) =>
    setList((v) => v.map((c, j) => (i === j ? { ...c, ...p } : c)));
  const move = (i: number, d: number) =>
    setList((v) => {
      const n = [...v];
      const j = i + d;
      if (j < 0 || j >= n.length) return v;
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="m-h">
          <h3>{t("أعمدة الجدول", "Table columns")}</h3>
          <button className="mx" onClick={onClose} aria-label="close">
            ✕
          </button>
        </div>
        <div className="pf-cols">
          {list.map((c, i) => (
            <div className="pf-col" key={c.k}>
              <input
                value={c.label}
                onChange={(e) => set(i, { label: e.target.value })}
                placeholder={t("اسم العمود", "Column name")}
              />
              <select value={c.kind || "text"} onChange={(e) => set(i, { kind: e.target.value as Col["kind"] })}>
                <option value="text">{t("نص", "Text")}</option>
                <option value="num">{t("رقم", "Number")}</option>
                <option value="date">{t("تاريخ", "Date")}</option>
                <option value="sel">{t("قائمة", "List")}</option>
              </select>
              <button className="ic" onClick={() => move(i, -1)} title={t("لأعلى", "Up")}>↑</button>
              <button className="ic" onClick={() => move(i, 1)} title={t("لأسفل", "Down")}>↓</button>
              <button
                className="ic dg"
                onClick={() => setList((v) => v.filter((_, j) => j !== i))}
                title={t("حذف العمود", "Delete column")}
              >
                ✕
              </button>
              {c.kind === "sel" && (
                <input
                  className="opts"
                  value={(c.opts || []).join(" · ")}
                  onChange={(e) =>
                    set(i, { opts: e.target.value.split(/[·,|\n]/).map((x) => x.trim()).filter(Boolean) })
                  }
                  placeholder={t("خيارات القائمة مفصولة بـ ·", "Options separated by ·")}
                />
              )}
            </div>
          ))}
          <button
            className="pf-addcol"
            onClick={() => setList((v) => [...v, { k: newColKey(v), label: "" }])}
          >
            + {t("إضافة عمود", "Add column")}
          </button>
        </div>
        <div className="pf-hint">
          {t(
            "حذف عمود يخفي قيمه ولا يمحوها — إرجاعه يعيدها كما كانت.",
            "Removing a column hides its values; it does not delete them.",
          )}
        </div>
        <div className="m-f">
          <button className="btn btn-ghost" onClick={onClose}>
            {t("إلغاء", "Cancel")}
          </button>
          <button
            className="btn"
            onClick={() => onSave(list.filter((c) => c.label.trim()).map((c) => ({ ...c, label: c.label.trim() })))}
          >
            {t("حفظ", "Save")}
          </button>
        </div>
      </div>
    </div>
  );
}

function RowForm({
  cols,
  row,
  stamp = true,
  t,
  onClose,
}: {
  cols: Col[];
  row: Row | null;
  /** ختم تاريخ الإدخال — يُملأ بتاريخ اليوم للبند الجديد */
  stamp?: boolean;
  t: T;
  onClose: (data: Rec | null) => void;
}) {
  /* البند الجديد يُختم بتاريخ اليوم فوراً — والحقل ظاهر فمن أراد
     تاريخاً غيره غيّره قبل الحفظ أو بعده */
  const [form, setForm] = useState<Rec>(() => ({
    ...(row?.data || {}),
    ...(stamp && !txt(row?.data?.[ADDED]) ? { [ADDED]: todayISO() } : {}),
  }));
  return (
    <div className="modal-overlay" onClick={() => onClose(null)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="m-h">
          <h3>{row ? t("تعديل بند", "Edit") : t("بند جديد", "New item")}</h3>
          <button className="mx" onClick={() => onClose(null)} aria-label="close">
            ✕
          </button>
        </div>
        <div className="sx-form">
          {cols.map((c) => (
            <label key={c.k}>
              <span>{c.label}</span>
              {c.kind === "sel" ? (
                <select value={form[c.k] ?? ""} onChange={(e) => setForm({ ...form, [c.k]: e.target.value })}>
                  <option value="">—</option>
                  {(c.opts || []).map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type={c.kind === "num" ? "number" : "text"}
                  placeholder={c.kind === "date" ? "YYYY-MM-DD" : ""}
                  value={form[c.k] ?? ""}
                  onChange={(e) => setForm({ ...form, [c.k]: e.target.value })}
                />
              )}
            </label>
          ))}
          {stamp && (
            <label>
              <span>{t("تاريخ الإدخال", "Added on")}</span>
              <input
                className="cell-date"
                dir="ltr"
                placeholder="YYYY-MM-DD"
                value={txt(form[ADDED])}
                onChange={(e) => setForm({ ...form, [ADDED]: e.target.value })}
              />
            </label>
          )}
        </div>
        <div className="m-f">
          <button className="btn btn-ghost" onClick={() => onClose(null)}>
            {t("إلغاء", "Cancel")}
          </button>
          <button className="btn" onClick={() => onClose(form)}>
            {t("حفظ", "Save")}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- التقارير الربعية ---------------- */
/** ما أملكه في الجهة: أساسيها · مُنحت تعديلاً · اطّلاعاً · لا شيء */
type MyLevel = "primary" | "edit" | "view" | "none";
type RegRow = {
  entityId: string; name: string; kind: string; sector: string;
  myContactId: string; ours?: Contact[]; theirs?: Contact[];
  myLevel?: MyLevel;
  /** المنوح لهم على هذه الجهة — يراها أساسيُّها ليديرها */
  shares?: { userId: number | string; level: string }[];
};
const LV_EDIT = new Set<MyLevel>(["primary", "edit"]);
const LV_SEE = new Set<MyLevel>(["primary", "edit", "view"]);
const SHARE_OPT: { v: string; l: string }[] = [
  { v: "none", l: "بلا مشاركة" },
  { v: "view", l: "اطّلاع فقط" },
  { v: "edit", l: "اطّلاع وتعديل" },
];

/* ============================================================
   الأعمال الرئيسية — بنود جهاتي من صفحات الأقسام
   ------------------------------------------------------------
   الجدول يُقرأ من `perf_items` لا من نسخةٍ في المحفظة: ما يراه
   الاستشاري هنا هو ما في صفحة القسم، وتعديلُه يصل إليها بالدالة
   `perf_item_mine_save` التي تتحقّق في القاعدة أن البند من جهاته.

   و«الاجتماعات الربعية» و«رابط المحضر» بيانات محفظةٍ لا قسم —
   تبقى هنا ولا تظهر في صفحة القسم، كما طلبت المستخدمة.
   ============================================================ */
type MainSec = "natstrat" | "inststrat" | "cx";
/** الأقسام التي تُقرأ هنا — الثلاثة الرئيسية وجلسات المراجعة معها،
    فبطاقة «متعثّرة» تعرض أرقام الجلسة وتكتبها في بندها نفسه */
type ReadSec = MainSec | "sessions";
const READ_SECS: ReadSec[] = ["natstrat", "inststrat", "cx", "sessions"];
export type MineRow = { id: string; ord: number; data: Rec };

/** بنود جهاتي في الأقسام الثلاثة — تُقرأ مرّةً للصفحة كلها، فتشترك
    فيها البطاقةُ وعدّادُها والشرائحُ الصغيرة ولا تتكرّر الطلبات */
function useMineWork(reg: RegRow[], meName: string) {
  const [all, setAll] = useState<Record<ReadSec, MineRow[]>>({ natstrat: [], inststrat: [], cx: [], sessions: [] });
  const [loaded, setLoaded] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let live = true;
    void Promise.all(
      READ_SECS.map(async (k) => {
        const r = await apiFetch(`/api/items?section=${k}`);
        const d = await r.json().catch(() => ({}));
        return [k, Array.isArray(d.items) ? (d.items as MineRow[]) : []] as const;
      }),
    )
      .then((pairs) => {
        if (!live) return;
        const m = { natstrat: [], inststrat: [], cx: [], sessions: [] } as Record<ReadSec, MineRow[]>;
        for (const [k, v] of pairs) m[k] = v;
        setAll(m);
      })
      .catch(() => {})
      .finally(() => live && setLoaded(true));
    return () => {
      live = false;
    };
  }, [nonce]);

  /* جهاتي على مستويين: ما أراه وما أحرّره.
     الأساسي يحرّر، والبديل لا يرى شيئاً حتى يُشاركه الأساسي —
     «اطّلاع فقط» أو «اطّلاع وتعديل». والحارس في القاعدة لا هنا. */
  const [seeNames, editNames] = useMemo(() => {
    const see = new Set<string>();
    const edit = new Set<string>();
    for (const x of reg) {
      const lv = (x.myLevel || "primary") as MyLevel;
      if (LV_SEE.has(lv)) see.add(nrm(x.name));
      if (LV_EDIT.has(lv)) edit.add(nrm(x.name));
    }
    return [see, edit];
  }, [reg]);

  const mine = useMemo(() => {
    const pick = (k: MainSec) =>
      all[k].filter((it) => {
        const c = txt(it.data.consultant).trim();
        if (c && nrm(c) === nrm(meName)) return true;
        return seeNames.has(nrm(txt(it.data[MAIN_ENT[k]])));
      });
    return { natstrat: pick("natstrat"), inststrat: pick("inststrat"), cx: pick("cx") } as Record<MainSec, MineRow[]>;
  }, [all, seeNames, meName]);

  /** هل أحرّر بند هذا القسم؟ — اسمي فيه، أو جهتُه مما أحرّره */
  const canEdit = useCallback(
    (k: MainSec, d: Rec) => {
      const c = txt(d.consultant).trim();
      if (c && nrm(c) === nrm(meName)) return true;
      return editNames.has(nrm(txt(d[MAIN_ENT[k]])));
    },
    [editNames, meName],
  );

  const patch = useCallback((k: ReadSec, id: string, p: Rec) => {
    setAll((v) => ({ ...v, [k]: v[k].map((x) => (x.id === id ? { ...x, data: { ...x.data, ...p } } : x)) }));
  }, []);

  return { mine, sess: all.sessions, loaded, patch, canEdit, reload: () => setNonce((n) => n + 1) };
}

/** شرائح صغيرة تحت رقم البطاقة — أهمّ ما في القسم بلا فتحه */
function mainChips(sec: MainSec, rows: MineRow[]): { k: string; v: number }[] {
  const n = (f: (d: Rec) => boolean) => rows.filter((r) => f(r.data)).length;
  if (sec === "natstrat")
    return [
      { k: "معتمدة من مجلس الوزراء", v: n((d) => num(d.stage, 1) === 4) },
      { k: "قيد المراجعة والاعتماد", v: n((d) => [2, 3].includes(num(d.stage, 1))) },
      { k: "في طور الإعداد", v: n((d) => num(d.stage, 1) === 1) },
      { k: "قابلية قياسها 100٪", v: n((d) => num(d.meas) >= 100) },
    ];
  if (sec === "inststrat")
    return [
      { k: "جارٍ قياسها", v: n((d) => txt(d.live) === "مفعل") },
      { k: "الوثائق مستلمة", v: n((d) => txt(d.docs) === "✓") },
      { k: "عُقد الاجتماع التعريفي", v: n((d) => txt(d.meet) === "تم") },
    ];
  return [
    { k: "صدر لها تقرير", v: n((d) => Object.keys(d).some((x) => x.endsWith("Issue") && txt(d[x]) === "✅")) },
    { k: "احتُسبت في المؤشر", v: n((d) => num(d.counted) === 1) },
    { k: "عُقد الاجتماع التعريفي", v: n((d) => txt(d.meet) === "تم") },
  ];
}



/* ============================================================
   إضافة جهة إلى السجلّ المركزي وإسنادها إليّ
   ------------------------------------------------------------
   الجهة تُضاف حيث تُقرأ: في «الجهات ونقاط التواصل». وتُسند لمن
   أضافها نقطةَ تواصلٍ أساسية من المركز، فتظهر في محفظته وفي
   قوائم إضافة الأقسام. وإن كانت مسجّلةً ومسندةً لغيره فلا تُنتزع
   منه — تُذكر باسم متولّيها ليطلب مشاركتها.
   ============================================================ */
/** مجموعةُ حقولِ نقطةِ تواصل — الأربعة نفسها في كل طرف */
function CtFields({
  t, pre, f, set, dis,
}: {
  t: T;
  pre: string;
  f: Rec;
  set: (k: string, v: string) => void;
  dis?: boolean;
}) {
  const F: [string, string, string][] = [
    ["Name", "الاسم", "Name"],
    ["Title", "المسمّى الوظيفي", "Job title"],
    ["Phone", "الجوال", "Phone"],
    ["Email", "البريد الإلكتروني", "Email"],
  ];
  return (
    <div className="op-f">
      {F.map(([k, ar, en]) => (
        <label key={k}>
          <span>{t(ar, en)}</span>
          <input value={txt(f[pre + k])} disabled={dis} onChange={(e) => set(pre + k, e.target.value)} />
        </label>
      ))}
    </div>
  );
}

function NewEntity({ t, onDone }: { t: T; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<Rec>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [bad, setBad] = useState(false);
  const set = (k: string, v: string) => setF((o) => ({ ...o, [k]: v }));

  /* نقطةُ تواصلي على جهةٍ أخرى تحمل بياناتي — تُنسخ منها فتظهر
     معبّأةً من أول لحظة بدل أن تُكتب في كل جهة من جديد. والقاعدة
     تملؤها كذلك لو وصلت فارغة، فالتعبئة مضمونة لا مظهرية. */
  useEffect(() => {
    if (!open) return;
    void apiFetch("/api/entities/mine")
      .then((r) => r.json())
      .then((d) => {
        const rows = (Array.isArray(d.mine) ? d.mine : []) as RegRow[];
        for (const x of rows) {
          const c = (x.ours || []).find((y: Contact) => String(y.id) === String(x.myContactId));
          if (c && (txt(c.phone) || txt(c.email))) {
            setF((o) => ({
              ...o,
              myName: txt(c.name),
              myTitle: txt(o.myTitle) || txt(c.jobTitle),
              myPhone: txt(o.myPhone) || txt(c.phone),
              myEmail: txt(o.myEmail) || txt(c.email),
            }));
            return;
          }
        }
      })
      .catch(() => {});
  }, [open]);

  async function go() {
    const name = txt(f.name).trim();
    if (!name || busy) return;
    setBusy(true);
    setMsg("");
    const r = await apiFetch("/api/entities/add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        kind: txt(f.kind),
        sector: txt(f.sector),
        myTitle: txt(f.myTitle),
        myPhone: txt(f.myPhone),
        myEmail: txt(f.myEmail),
        theirName: txt(f.theirName),
        theirTitle: txt(f.theirTitle),
        theirPhone: txt(f.theirPhone),
        theirEmail: txt(f.theirEmail),
        vroName: txt(f.vroName),
        vroTitle: txt(f.vroTitle),
        vroPhone: txt(f.vroPhone),
        vroEmail: txt(f.vroEmail),
      }),
    })
      .then((x) => x.json())
      .catch(() => ({ error: "تعذّر الاتصال" }));
    setBusy(false);
    if (r?.error) {
      setBad(true);
      setMsg(String(r.error));
      return;
    }
    setBad(false);
    setMsg(
      r.existed
        ? t(
            `«${name}» مسجّلة في السجلّ — نقطة التواصل فيها: ${r.owner || "—"}`,
            `Already in the registry — contact: ${r.owner || "—"}`,
          )
        : t(`أُضيفت «${name}» وأُسندت إليك ببياناتك ونقاط تواصلها.`, "Added."),
    );
    if (!r.existed) setF((o) => ({ myName: o.myName, myTitle: o.myTitle, myPhone: o.myPhone, myEmail: o.myEmail }));
    onDone();
  }

  if (!open)
    return (
      <div className="newent-c">
        <button className="newent-b" onClick={() => setOpen(true)}>
          + {t("إضافة جهة", "Add an entity")}
        </button>
        <span>
          {t(
            "تُضاف إلى سجلّ «الجهات ونقاط التواصل» بنقاط تواصلها الثلاث، وتُسند إليك ببياناتك.",
            "Added to the central registry with its three contacts.",
          )}
        </span>
      </div>
    );

  return (
    <div className="newent">
      <div className="newent-h">
        <b>{t("إضافة جهة", "Add an entity")}</b>
        <button onClick={() => setOpen(false)}>{t("إغلاق", "Close")}</button>
      </div>

      <div className="newent-s first">{t("بيانات الجهة", "Entity")}</div>
      <div className="op-f">
        <label className="wide">
          <span>{t("اسم الجهة", "Entity name")}</span>
          <input value={txt(f.name)} onChange={(e) => set("name", e.target.value)} />
        </label>
        <label>
          <span>{t("التصنيف", "Kind")}</span>
          <input
            list="ent-kinds"
            value={txt(f.kind)}
            placeholder={t("وزارة · هيئة · برنامج · مركز", "Ministry · Authority …")}
            onChange={(e) => set("kind", e.target.value)}
          />
          <datalist id="ent-kinds">
            {["وزارة", "هيئة", "برنامج", "مركز", "مكتب", "مناطقية", "جامعة", "اتحاد", "أمانة"].map((k) => (
              <option key={k} value={k} />
            ))}
          </datalist>
        </label>
        <label>
          <span>{t("القطاع", "Sector")}</span>
          <select value={txt(f.sector)} onChange={(e) => set("sector", e.target.value)}>
            <option value="">{t("— اختر —", "— pick —")}</option>
            {INST_SECTORS.map((x) => (
              <option key={x} value={x}>{x}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="newent-s">
        {t("نقطة التواصل من مركز أداء — أساسي", "Our contact — primary")}
        <i>{txt(f.myName) || t("أنت", "You")}</i>
      </div>
      <CtFields t={t} pre="my" f={f} set={set} />

      <div className="newent-s">{t("نقطة التواصل من الجهة — أساسي", "Entity contact — primary")}</div>
      <CtFields t={t} pre="their" f={f} set={set} />

      <div className="newent-s">{t("نقطة التواصل من مكتب تحقيق الرؤية (VRO)", "VRO contact")}</div>
      <CtFields t={t} pre="vro" f={f} set={set} />

      {msg && <div className={`newent-m ${bad ? "bad" : ""}`}>{msg}</div>}
      <div className="newent-f">
        <button className="btn btn-sm" disabled={busy || !txt(f.name).trim()} onClick={() => void go()}>
          {busy ? t("يُضاف…", "Adding…") : t("إضافة الجهة", "Add")}
        </button>
        <em>
          {t(
            "ما يُترك فارغاً يُضاف لاحقاً من بطاقة الجهة — وبديلُ كلِّ طرفٍ يُضاف منها كذلك.",
            "Anything left blank can be filled later from the entity card.",
          )}
        </em>
      </div>
    </div>
  );
}

/* ============================================================
   إضافة جهة إلى قسمٍ من الأعمال الرئيسية
   ------------------------------------------------------------
   الاختيار من **جهات الاستشاري نفسه** لا بالكتابة الحرة: الحارس
   في القاعدة يرفض ما سواها، فقائمةٌ تمنع الخطأ قبل وقوعه. وتُستبعد
   منها ما له بندٌ أصلاً، إلا في الوطنية — فللجهة الواحدة أكثر من
   استراتيجية، والتمييز باسمها.
   ============================================================ */
/** قيمةُ خيار «جهة ليست في القائمة» — لا تُطابق اسم جهةٍ حقيقية */
const NEW_ENT = "\u0000new";

function AddMainEnt({
  sec, have, busy, t, onClose, onAdd,
}: {
  sec: MainSec;
  have: string[];
  busy: boolean;
  t: T;
  onClose: () => void;
  onAdd: (entity: string, title: string, fresh: boolean) => void;
}) {
  const [mine, setMine] = useState<{ name: string }[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [ent, setEnt] = useState("");
  const [title, setTitle] = useState("");
  /* جهةٌ خارج القائمة: تُضاف إلى سجلّ الجهات وتُسند إليّ، ثم يُنشأ
     بندُها في القسم — خطوتان من ضغطةٍ واحدة. */
  const [fresh, setFresh] = useState("");

  useEffect(() => {
    void apiFetch("/api/entities/mine")
      .then((r) => r.json())
      .then((d) => setMine(Array.isArray(d.mine) ? (d.mine as { name: string }[]) : []))
      .catch(() => setMine([]))
      .finally(() => setLoaded(true));
  }, []);

  const hv = useMemo(() => new Set(have.map((x) => nrm(x)).filter(Boolean)), [have]);
  const opts = useMemo(() => {
    const names = Array.from(new Set(mine.map((m) => txt(m.name).trim()).filter(Boolean)));
    names.sort((a, b) => a.localeCompare(b, "ar"));
    return sec === "natstrat" ? names : names.filter((n) => !hv.has(nrm(n)));
  }, [mine, hv, sec]);

  const isNat = sec === "natstrat";
  const isNew = ent === NEW_ENT;
  const name = isNew ? fresh.trim() : ent;
  const ok = !!name && (!isNat || !!title.trim());

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="m-h">
          <h3>{t(`إضافة جهة إلى ${SECTION_TITLE[sec][0]}`, "Add an entity")}</h3>
          <button className="mx" onClick={onClose} aria-label="close">✕</button>
        </div>

        {!loaded ? (
          <div className="pf-none">{t("جارٍ التحميل…", "Loading…")}</div>
        ) : (
          <>
            {!opts.length && (
              <div className="pf-none">
                {mine.length
                  ? t("كل جهاتك لها بندٌ في هذا القسم — تُضاف جهةٌ جديدة من الخيار أدناه.", "All yours are here.")
                  : t(
                      "لا توجد جهات مسندة إليك في «الجهات ونقاط التواصل» — تُضاف جهةٌ جديدة من الخيار أدناه.",
                      "No entities assigned to you.",
                    )}
              </div>
            )}
            <div className="op-f">
              <label className="wide">
                <span>{t("الجهة", "Entity")}</span>
                <select value={ent} onChange={(e) => setEnt(e.target.value)}>
                  <option value="">{t("— اختر من جهاتك —", "— pick —")}</option>
                  {opts.map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                  <option value={NEW_ENT}>{t("— جهة ليست في القائمة —", "— not listed —")}</option>
                </select>
              </label>
              {isNew && (
                <label className="wide">
                  <span>{t("اسم الجهة الجديدة", "New entity name")}</span>
                  <input
                    value={fresh}
                    placeholder={t("كما تُكتب في سجلّ الجهات", "As written in the registry")}
                    onChange={(e) => setFresh(e.target.value)}
                  />
                </label>
              )}
              {isNat && (
                <label className="wide">
                  <span>{t("اسم الاستراتيجية", "Strategy name")}</span>
                  <input
                    value={title}
                    placeholder={t("مثال: استراتيجية التنمية بمنطقة الأحساء", "Strategy name")}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </label>
              )}
            </div>
            <p className="muted" style={{ fontSize: 11.5, lineHeight: 1.7 }}>
              {t(
                "القائمة هي الجهات المسندة إليك في «الجهات ونقاط التواصل» — أنت نقطةُ تواصلها الأساسية من المركز، أو شورِكت معك.",
                "The list is the entities assigned to you.",
              )}
              <br />
              {isNew
                ? t(
                    `الجهة الجديدة تُضاف إلى سجلّ الجهات وتُسند إليك، ثم يُنشأ بندُها في «${SECTION_TITLE[sec][0]}».`,
                    "A new entity is added to the registry, assigned to you, then created here.",
                  )
                : t(
                    `يُنشأ البند في صفحة «${SECTION_TITLE[sec][0]}» باسمك استشارياً، ويظهر هنا في محفظتك لتحدّثه.`,
                    "Created on the section page with you as the consultant.",
                  )}
            </p>
          </>
        )}

        <div className="m-f">
          <button className="btn btn-ghost" onClick={onClose}>{t("إلغاء", "Cancel")}</button>
          <button className="btn" disabled={!ok || busy} onClick={() => onAdd(name, title.trim(), isNew)}>
            {busy ? t("يُضاف…", "Adding…") : t("إضافة", "Add")}
          </button>
        </div>
      </div>
    </div>
  );
}

const NAT_STAGE = ["طور الإعداد/التحديث", "قيد المراجعة", "معتمدة من اللجنة", "معتمدة من مجلس الوزراء"];

/* ============================================================
   حقول كل قسم في بطاقة المحفظة
   ------------------------------------------------------------
   كان لكل قسم حقلٌ واحد («الاجتماع التعريفي» في تجربة المستفيد
   مثلاً)، فالاستشاري لا يحرّك جهته في مراحل الصفحة من محفظته.
   الآن تُعرض حقول القسم الجوهرية كلها.

   العناوين والخيارات **مستوردة من `Sections.tsx`** لا منسوخة:
   خيارٌ يُضاف هناك يظهر هنا من نفسه ولا تفترق القائمتان.
   ============================================================ */
type Fld = { k: string; label: string; opts?: string[]; kind?: "num" | "bool" | "text"; wide?: boolean };
/** حقول رقمية أو ثنائية لا يكفيها نصٌّ حرّ */
const FLD_NUM = new Set(["servTot", "servPlan", "kpisRep", "kpisTot", "initRep", "initTot", "meas"]);
const FLD_BOOL = new Set(["counted", "countedQ2"]);
function fldOf(cols: { k: string; label: string; opts?: string[] }[], keys: string[]): Fld[] {
  return keys
    .map((k) => cols.find((c) => c.k === k))
    .filter((c): c is { k: string; label: string; opts?: string[] } => !!c)
    .map((c) => ({
      k: c.k,
      label: c.label,
      opts: c.opts,
      kind: c.opts ? undefined : FLD_BOOL.has(c.k) ? "bool" : FLD_NUM.has(c.k) ? "num" : "text",
    }));
}
const MAIN_FIELDS: Record<MainSec, Fld[]> = {
  natstrat: [
    { k: "meas", label: "قابلية القياس ٪", kind: "num" },
    { k: "kpisRep", label: "مؤشرات ممثَّلة", kind: "num" },
    { k: "kpisTot", label: "إجمالي المؤشرات", kind: "num" },
    { k: "initRep", label: "مبادرات ممثَّلة", kind: "num" },
    { k: "initTot", label: "إجمالي المبادرات", kind: "num" },
  ],
  inststrat: fldOf(INST_COLS, ["rep", "meet", "meetAt", "docs", "docsState", "target", "live", "phase"]),
  cx: fldOf(CX_COLS, ["meet", "survey", "card", "l1", "freq", "servTot", "servPlan", "counted", "countedQ2"]),
};
/** حقول الربع في تجربة المستفيد — تُعرض لربعٍ واحد مختار، وإلا صارت عشرين حقلاً */
const CX_QF: Fld[] = [
  { k: "Share", label: "مشاركة النتائج" },
  { k: "Issue", label: "إصدار التقرير" },
  { k: "Svc", label: "خدمات بمؤشر رضا", kind: "num" },
  { k: "Sat", label: "مؤشر الرضا", kind: "num" },
];

/** حقل نصّي حرّ يحفظ عند الخروج منه */
function TextBox({
  value, ph, ltr, dis, onSave,
}: {
  value: string;
  ph?: string;
  ltr?: boolean;
  dis?: boolean;
  onSave: (v: string) => void;
}) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <input
      value={v}
      placeholder={ph}
      disabled={dis}
      dir={ltr ? "ltr" : undefined}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== value && onSave(v)}
    />
  );
}

/** خانة حقلٍ واحد — قائمةً أو رقماً أو نعم/لا أو نصّاً */
function FldBox({ f, v, dis, onPut }: { f: Fld; v: unknown; dis?: boolean; onPut: (v: unknown) => void }) {
  const cls = f.wide ? "wide" : undefined;
  if (f.opts)
    return (
      <label className={cls}>
        <span>{f.label}</span>
        <select value={txt(v)} disabled={dis} onChange={(e) => onPut(e.target.value)}>
          {f.opts.map((o) => (
            <option key={o} value={o}>
              {o || "—"}
            </option>
          ))}
        </select>
      </label>
    );
  if (f.kind === "bool")
    return (
      <label className={cls}>
        <span>{f.label}</span>
        <select
          value={num(v) === 1 ? "نعم" : txt(v) ? "لا" : ""}
          disabled={dis}
          onChange={(e) => onPut(e.target.value === "نعم" ? 1 : e.target.value === "لا" ? 0 : "")}
        >
          {["", "نعم", "لا"].map((o) => (
            <option key={o} value={o}>
              {o || "—"}
            </option>
          ))}
        </select>
      </label>
    );
  if (f.kind === "num")
    return (
      <label className={cls}>
        <span>{f.label}</span>
        <input type="number" value={num(v) || ""} disabled={dis} onChange={(e) => onPut(Number(e.target.value) || 0)} />
      </label>
    );
  return (
    <label className={cls}>
      <span>{f.label}</span>
      <TextBox value={txt(v)} dis={dis} onSave={onPut} />
    </label>
  );
}
/** الحقل الذي يحمل اسم جهة البند في كل قسم */
/* المؤسسية تسمّي الجهة `owner` كالوطنية — كانت هنا `name` فلا
   يطابق شيءٌ، فتُعرض بنودها بلا اسمٍ ولا شعار ولا تصل من شاركها
   صاحبُها إلا إن كان اسمه في `consultant`. */
const MAIN_ENT: Record<MainSec, string> = { natstrat: "owner", inststrat: "owner", cx: "name" };
/** عنوان الصف: الاستراتيجية في الوطنية، والجهة في البقية */
const MAIN_TITLE: Record<MainSec, string> = { natstrat: "name", inststrat: "owner", cx: "name" };

const QLABS = ["الربع الأول", "الربع الثاني", "الربع الثالث", "الربع الرابع"];
const YR_NOW = new Date().getFullYear();
/** سنواتُ الاجتماعات المعروضة — الجارية وما قبلها وما بعدها */
const MW_YEARS = [YR_NOW - 1, YR_NOW, YR_NOW + 1];

/* الاجتماعات الربعية تُحفظ **بالسنة**: `qy = {"2026":[0,0,0,0]}`.
   كانت مصفوفةً واحدة بلا سنة، فاجتماعاتُ ٢٠٢٧ تكتب فوق ٢٠٢٦ ولا
   يُعرف أيُّ ربعٍ من أيّ سنة. القديم يُقرأ للسنة الجارية فلا يضيع. */
const qMap = (ex: Rec): Record<string, number[]> =>
  ex.qy && typeof ex.qy === "object" ? (ex.qy as Record<string, number[]>) : {};
function qOf(ex: Rec, yr: number): number[] {
  const m = qMap(ex)[String(yr)];
  if (Array.isArray(m)) return m;
  if (yr === YR_NOW && Array.isArray(ex.q)) return ex.q as number[];
  return [0, 0, 0, 0];
}
function qSet(ex: Rec, yr: number, v: number[]): Rec {
  return { ...ex, qy: { ...qMap(ex), [String(yr)]: v }, ...(yr === YR_NOW ? { q: v } : {}) };
}

/* روابط كل ربع على حدة: العرض والمحضر (أو التقرير في تجربة
   المستفيد). كان رابطاً واحداً لكل الأرباع، فمحضرُ الربع الثاني
   يكتب فوق الأول ولا يُعرف أيُّهما. */
type QLink = { deck?: string; min?: string };
const qlMap = (ex: Rec): Record<string, QLink[]> =>
  ex.ql && typeof ex.ql === "object" ? (ex.ql as Record<string, QLink[]>) : {};
function qlOf(ex: Rec, yr: number, i: number): QLink {
  const a = qlMap(ex)[String(yr)];
  return (Array.isArray(a) && a[i]) || {};
}
function qlSet(ex: Rec, yr: number, i: number, v: QLink): Rec {
  const m = qlMap(ex);
  const a = Array.isArray(m[String(yr)]) ? [...m[String(yr)]] : [{}, {}, {}, {}];
  while (a.length < 4) a.push({});
  a[i] = { ...a[i], ...v };
  return { ...ex, ql: { ...m, [String(yr)]: a } };
}
/** عنوان المجموعة الربعية — تجربة المستفيد تقاريرُ لا اجتماعات */
const Q_TITLE: Record<MainSec, [string, string]> = {
  natstrat: ["عقد الاجتماعات الربعية للجهة لعام", "Quarterly meetings held in"],
  inststrat: ["عقد الاجتماعات الربعية للجهة لعام", "Quarterly meetings held in"],
  cx: ["التقارير الربعية للجهة لعام", "Quarterly reports in"],
};
/** تسمية حقلَي الرابط — عرضٌ ومحضر للاجتماع، وتقريرٌ لتجربة المستفيد */
const Q_LINKS: Record<MainSec, [string, string][]> = {
  natstrat: [["deck", "رابط العرض"], ["min", "رابط المحضر"]],
  inststrat: [["deck", "رابط العرض"], ["min", "رابط المحضر"]],
  cx: [["deck", "رابط التقرير"], ["min", "رابط المرفقات"]],
};

/* ============================================================
   معايير تحديد الجهات ذات الأداء المنخفض
   ------------------------------------------------------------
   من «آلية عمل جلسة مراجعة الأداء للأجهزة العامة» — المركز
   الوطني لقياس أداء الأجهزة العامة، أكتوبر ٢٠٢٥ (الشريحتان ٦ و٧).
   تكفي **أيٌّ** منها لعدّ الجهة ذات أداء منخفض:
     ١. عنصران متعثّران فأكثر، تكرّر تعثّرهما على مدى فترتَي قياس
        متتاليتين، **و** أداء الجهاز العام ≤ ٧٠٪
     ٢. عدد العناصر المتعثرة ٥ عناصر أو أكثر
     ٣. تعثّر مبادرة ميزانيتها مليار ريال أو أكثر
   ولذلك لا تُفتح علامة «تحتاج جلسة مراجعة أداء» قبل انطباق أحدها:
   الجلسة تُعقد بمعيار لا برأي. ============================================================ */
type CritVals = { perf: number; kpiBad: number; initBad: number; rep2: number; bigInit: number };
const CRIT_TEXT = [
  "عنصران متعثّران فأكثر تكرّر تعثّرهما فترتَي قياس متتاليتين، والأداء العام 70٪ فأقل",
  "5 عناصر متعثّرة أو أكثر",
  "تعثّر مبادرة ميزانيتها مليار ريال أو أكثر",
];
function lowPerf(v: CritVals): { ok: boolean; hit: string[] } {
  const bad = v.kpiBad + v.initBad;
  const hit: string[] = [];
  /* الأداء العام غير المُدخَل (صفر) لا يُعدّ ≤ ٧٠٪ — وإلا انطبق المعيار على كل جهة لم تُقيَّم */
  if (bad >= 2 && v.rep2 === 1 && v.perf > 0 && v.perf <= 70) hit.push(CRIT_TEXT[0]);
  if (bad >= 5) hit.push(CRIT_TEXT[1]);
  if (v.bigInit === 1) hit.push(CRIT_TEXT[2]);
  return { ok: hit.length > 0, hit };
}

/** حقل نصّي يحفظ عند الخروج منه لا مع كل حرف */
function NoteBox({ value, ph, rows, dis, onSave }: { value: string; ph: string; rows?: number; dis?: boolean; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <textarea
      className="mw-note"
      rows={rows || 2}
      value={v}
      disabled={dis}
      placeholder={ph}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== value && onSave(v)}
    />
  );
}

function MainWork({
  sec, rows, sess, loaded, extras, canEdit, t, onExtra, onPatch, onReload, full,
}: {
  sec: MainSec;
  /** بنود جهاتي في هذا القسم — تُقرأ مرّةً في الصفحة وتُمرَّر هنا */
  rows: MineRow[];
  /** بنود صفحة جلسات مراجعة الأداء — تُطابَق بالجهة */
  sess: MineRow[];
  loaded: boolean;
  /** بيانات المحفظة الإضافية — المفتاح `sec:itemId` */
  extras: Record<string, Rec>;
  /** هل أحرّر هذا البند؟ «اطّلاع فقط» يقرأ ولا يكتب */
  canEdit: (sec: MainSec, d: Rec) => boolean;
  t: T;
  onExtra: (key: string, data: Rec) => void;
  onPatch: (sec: MainSec | "sessions", id: string, patch: Rec) => void;
  onReload: () => void;
  /** داخل النافذة: الجدول كاملاً. وفي البطاقة: أول ثلاثة صفوف */
  full?: boolean;
}) {
  const [msg, setMsg] = useState("");
  const [yr, setYr] = useState(YR_NOW);
  /* ربعُ تجربة المستفيد المعروض — آخر أرباع الملف افتراضاً */
  const [cxq, setCxq] = useState(CX_QS[CX_QS.length - 1].k);
  /* تجربة المستفيد تُفتح قائمةَ أسماءٍ بشعاراتها: حقولها كثيرة،
     فعرضُها كلها لكل جهة يجعل النافذة جداراً من الصناديق. الجهة
     تُفتح بالضغط على اسمها. */
  const [shown2, setShown2] = useState<Record<string, boolean>>({});
  /* إضافة جهة إلى القسم — تُفتح من الشريط داخل النافذة */
  const [add, setAdd] = useState<{ entity: string; title: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const logos = useLogos();

  /* بطاقة الجلسة لكل جهة — بها تُعرض أرقام التعثّر وتُحرَّر */
  const sessBy = useMemo(() => {
    const m = new Map<string, MineRow>();
    for (const r of sess) {
      const k = nrm(txt(r.data.entity));
      if (k && !m.has(k)) m.set(k, r);
    }
    return m;
  }, [sess]);

  async function put(id: string, patch: Rec, section: MainSec | "sessions" = sec) {
    /* تفاؤلياً في الشاشة، ثم يُحفظ — والفشل يُعيد القراءة */
    onPatch(section, id, patch);
    const r = await apiFetch("/api/items/mine", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ section, id, patch }),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      setMsg(d.error || t("تعذّر الحفظ", "Save failed"));
      onReload();
    } else setMsg("");
  }

  async function addEntity(entity: string, title: string, fresh: boolean) {
    setAdding(true);
    /* جهةٌ خارج القائمة: تُسجَّل أولاً وتُسند إليّ، وإلا رفضها حارسُ
       القاعدة — فهو يسأل «أهي من جهاتك؟» لا «أموجودةٌ هي؟» */
    if (fresh) {
      const e = await apiFetch("/api/entities/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: entity }),
      })
        .then((x) => x.json())
        .catch(() => ({ error: "تعذّر الاتصال" }));
      if (e?.error) {
        setAdding(false);
        setMsg(String(e.error));
        return;
      }
    }
    const r = await apiFetch("/api/items/mine/add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ section: sec, entity, title }),
    });
    setAdding(false);
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      setMsg(txt(d.error) || t("تعذّرت الإضافة", "Could not add"));
      return;
    }
    setAdd(null);
    setMsg(
      t(
        `أُضيفت «${entity}» — تظهر الآن هنا وفي صفحة ${SECTION_TITLE[sec][0]}`,
        `Added — it now appears on the ${sec} page too`,
      ),
    );
    onReload();
  }

  async function flagSession(entity: string, on: boolean, key: string, ex: Rec, seed: Rec) {
    onExtra(key, { ...ex, needSess: on ? 1 : 0 });
    if (!on) return;
    const r = await apiFetch("/api/items/session-flag", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entity, quarter: `${QLABS[Math.floor(new Date().getMonth() / 3)]} ${YR_NOW}` }),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      setMsg(d.error || t("تعذّر فتح بطاقة الجلسة", "Could not open a session card"));
      return;
    }
    const d = await r.json().catch(() => ({}));
    /* إجماليّا المؤشرات والمبادرات معروفان هنا، فيُنقلان للبطاقة
       حتى تُقرأ «٣ من ١٥» في صفحة الجلسات بلا إدخالٍ ثانٍ.
       وللبطاقة الجديدة وحدها: بطاقةٌ قائمة قد تحمل أرقاماً أدقّ. */
    const id = txt(d.id);
    const seed0: Rec = {};
    for (const [k, v] of Object.entries(seed)) if (num(v) > 0) seed0[k] = v;
    if (id && !sessBy.has(nrm(entity)) && Object.keys(seed0).length) await put(id, seed0, "sessions");
    setMsg(t("فُتحت بطاقة في صفحة جلسات مراجعة الأداء", "A session card was opened"));
    onReload();
  }

  if (!loaded) return <div className="pf-none">{t("جارٍ التحميل…", "Loading…")}</div>;

  const shown = full ? rows : rows.slice(0, 3);

  return (
    <div className={`mw ${full ? "grid" : ""}`}>
      {msg && <div className="mw-msg">{msg}</div>}
      {full && (
        <div className="mw-bar">
          <select value={yr} onChange={(e) => setYr(Number(e.target.value))}>
            {MW_YEARS.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          <b>{t(`${rows.length} جهة`, `${rows.length} entities`)}</b>
          <button className="mw-add" onClick={() => setAdd({ entity: "", title: "" })}>
            + {t("إضافة جهة", "Add entity")}
          </button>
        </div>
      )}
      {!rows.length && (
        <div className="pf-none">
          {t(
            "لا توجد بنود مسندة إليك — تُسنَد بأن تكون نقطة التواصل الأساسية لجهتها في «الجهات ونقاط التواصل»، أو تُضاف من زرّ «إضافة جهة».",
            "Nothing assigned to you yet.",
          )}
        </div>
      )}
      {add && (
        <AddMainEnt
          sec={sec}
          have={rows.map((r) => txt(r.data[MAIN_ENT[sec]]))}
          busy={adding}
          t={t}
          onClose={() => setAdd(null)}
          onAdd={addEntity}
        />
      )}
      {shown.map((it) => {
        const key = `${sec}:${it.id}`;
        const ex = extras[key] || {};
        const q = qOf(ex, yr);
        const ent = txt(it.data[MAIN_ENT[sec]]);
        const entN = ent || txt(it.data.name);
        const sr = sessBy.get(nrm(entN));
        /* بطاقةُ جلسةٍ قائمةٌ للجهة تعني أنها متعثّرة فعلاً — تُعرَض
           معلَّمة، ومن يرفع العلامة يُسجَّل رفعُه فلا تعود تلقائياً */
        const need = ex.needSess === undefined ? !!sr : num(ex.needSess) === 1;
        const sd = sr?.data || {};
        const sAt = Math.max(0, Math.min(SESS_SHORT.length, num(sd.done)));
        /* أرقام التقييم: من بطاقة الجلسة متى وُجدت — فهي مصدرُها في
           صفحة الجلسات — وإلا من المحفظة قبل أن تُفتح البطاقة */
        const cv: CritVals = {
          perf: num(sr ? sd.perf : ex.perf),
          kpiBad: num(sr ? sd.kpiBad : ex.kpiBad),
          initBad: num(sr ? sd.initBad : ex.initBad),
          rep2: num(ex.rep2),
          bigInit: num(ex.bigInit),
        };
        const lp = lowPerf(cv);
        /* الحقل الواحد يكتب في المحفظة، ويُمرَّر لبطاقة الجلسة إن فُتحت */
        const setEx = (patch: Rec) => {
          onExtra(key, { ...ex, ...patch });
          if (!sr) return;
          const mir: Rec = {};
          for (const f of ["perf", "kpiBad", "initBad"]) if (f in patch) mir[f] = patch[f];
          if (Object.keys(mir).length) void put(sr.id, mir, "sessions");
        };
        /* جهةٌ شورِكت معي «اطّلاع فقط» تُقرأ ولا تُحرَّر */
        const ro = !canEdit(sec, it.data);
        /* الطيّ لتجربة المستفيد وحدها وداخل النافذة فقط */
        const foldable = sec === "cx" && !!full;
        const open2 = !foldable || !!shown2[it.id];
        return (
          <div className={`mw-row ${foldable ? "fold" : ""} ${open2 ? "on" : ""}`} key={it.id}>
            <div
              className="mw-h"
              onClick={foldable ? () => setShown2((v) => ({ ...v, [it.id]: !v[it.id] })) : undefined}
            >
              <EntFace name={entN} logo={logos[logoKey(entN)]} />
              <span className="mw-t">
                <b>{txt(it.data[MAIN_TITLE[sec]]) || "—"}</b>
                {sec === "natstrat" && ent && <em>{ent}</em>}
              </span>
              {ro && <i className="mw-ro">{t("اطّلاع فقط", "Read only")}</i>}
              {foldable && <i className="fold-a">{open2 ? "▴" : "▾"}</i>}
            </div>
            {open2 && (
              <>

            <div className="mw-f">
              {sec === "natstrat" && (
                <label className="wide">
                  <span>{t("حالة الاعتماد", "Approval")}</span>
                  <select
                    value={NAT_STAGE[Math.max(0, Math.min(3, num(it.data.stage, 1) - 1))]}
                    disabled={ro}
                    onChange={(e) => void put(it.id, { stage: NAT_STAGE.indexOf(e.target.value) + 1 })}
                  >
                    {NAT_STAGE.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {MAIN_FIELDS[sec].map((f) => (
                <FldBox key={f.k} f={f} v={it.data[f.k]} dis={ro} onPut={(v) => void put(it.id, { [f.k]: v })} />
              ))}
            </div>

            {/* تجربة المستفيد: مرحلةُ الجهة **محسوبة** من هذه الحقول
                كما في ورقة Dashboard، فلا تُختار اختياراً — تُعرض
                لتُرى نتيجةُ ما غُيّر فوراً، وحقول الربع تحتها */}
            {sec === "cx" && (
              <>
                <div className="mw-stg">
                  <span className="k">{t("المرحلة في صفحة تجربة المستفيد", "Stage on the BEX page")}</span>
                  {cxStagesOf(it.data).map((g) => (
                    <i key={g.k} style={{ ["--c" as string]: g.c }}>
                      {g.ar}
                    </i>
                  ))}
                  {!cxStagesOf(it.data).length && <em>{t("لم تُصنَّف بعد", "Unclassified")}</em>}
                </div>
                <div className="mw-f">
                  <label>
                    <span>{t("الربع", "Quarter")}</span>
                    <select value={cxq} onChange={(e) => setCxq(e.target.value)}>
                      {CX_QS.map((q) => (
                        <option key={q.k} value={q.k}>
                          {q.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {CX_QF.map((f) => (
                    <FldBox
                      key={f.k}
                      /* الخيارات من عمود الملف نفسه، والعنوان مختصرٌ هنا
                         لأن الربع مكتوبٌ في القائمة المجاورة */
                      f={{ ...f, opts: CX_COLS.find((c) => c.k === cxq + f.k)?.opts }}
                      v={it.data[cxq + f.k]}
                      dis={ro}
                      onPut={(v) => void put(it.id, { [cxq + f.k]: v })}
                    />
                  ))}
                </div>
              </>
            )}

            {/* الاجتماعات (أو التقارير) الربعية — بيانات محفظة، لا
                تظهر في صفحة القسم. الأرقام وحدها كانت لا تدلّ على
                شيء، فصار لها عنوانٌ وأسماء أرباع صريحة. */}
            <div className="mw-qs">
              <span className="qh">
                {t(Q_TITLE[sec][0], Q_TITLE[sec][1])} <i>{yr}</i>
              </span>
              <div className="qrow">
                {QLABS.map((lb, i) => (
                  <button
                    key={lb}
                    className={`qb ${q[i] ? "on" : ""}`}
                    disabled={ro}
                    title={`${lb} ${yr}`}
                    onClick={() => {
                      const n = [...q];
                      n[i] = n[i] ? 0 : 1;
                      onExtra(key, qSet(ex, yr, n));
                    }}
                  >
                    Q{i + 1}
                  </button>
                ))}
              </div>
              {/* روابط الربع تظهر بتعليمه: كلٌّ في خانته الخاصة */}
              {QLABS.map((lb, i) =>
                q[i] ? (
                  <div className="qlk" key={lb}>
                    <b>Q{i + 1}</b>
                    {Q_LINKS[sec].map(([f, ph]) => (
                      <TextBox
                        key={f}
                        value={txt(qlOf(ex, yr, i)[f as keyof QLink])}
                        ph={t(`${ph} في الشير فولدر…`, ph)}
                        ltr
                        dis={ro}
                        onSave={(v) => onExtra(key, qlSet(ex, yr, i, { [f]: v }))}
                      />
                    ))}
                  </div>
                ) : null,
              )}
            </div>

            <NoteBox
              value={txt(ex.note)}
              dis={ro}
              ph={t("ملاحظات…", "Notes…")}
              onSave={(v) => onExtra(key, { ...ex, note: v })}
            />

            {sec !== "cx" && (
              <>
                {/* تقييم التعثّر بمعايير الآلية — قبل العلامة لا بعدها،
                    فالعلامة نتيجةُ المعايير لا مدخلاً مستقلاً عنها */}
                <div className="mw-crit">
                  <div className="mw-f">
                    <label>
                      <span>{t("الأداء العام ٪", "Overall %")}</span>
                      <input
                        type="number"
                        value={cv.perf || ""}
                        disabled={ro}
                        onChange={(e) => setEx({ perf: Number(e.target.value) || 0 })}
                      />
                    </label>
                    <label>
                      <span>{t("مؤشرات متعثّرة", "KPIs at risk")}</span>
                      <input
                        type="number"
                        value={cv.kpiBad || ""}
                        disabled={ro}
                        onChange={(e) => setEx({ kpiBad: Number(e.target.value) || 0 })}
                      />
                    </label>
                    <label>
                      <span>{t("مبادرات متعثّرة", "Initiatives at risk")}</span>
                      <input
                        type="number"
                        value={cv.initBad || ""}
                        disabled={ro}
                        onChange={(e) => setEx({ initBad: Number(e.target.value) || 0 })}
                      />
                    </label>
                  </div>
                  <label className="mw-ck">
                    <input
                      type="checkbox"
                      checked={cv.rep2 === 1}
                      disabled={ro}
                      onChange={(e) => setEx({ rep2: e.target.checked ? 1 : 0 })}
                    />
                    <span>{t("تكرّر التعثّر فترتَي قياس متتاليتين", "Repeated two periods")}</span>
                  </label>
                  <label className="mw-ck">
                    <input
                      type="checkbox"
                      checked={cv.bigInit === 1}
                      disabled={ro}
                      onChange={(e) => setEx({ bigInit: e.target.checked ? 1 : 0 })}
                    />
                    <span>{t("تعثّر مبادرة ميزانيتها مليار ريال أو أكثر", "A ≥1bn initiative at risk")}</span>
                  </label>
                </div>

                <label
                  className={`mw-ns ${lp.ok ? "hot" : "off"}`}
                  title={
                    lp.ok
                      ? t(`ينطبق: ${lp.hit.join(" · ")}`, lp.hit.join(" · "))
                      : t(
                          `لا تنطبق معايير الآلية بعد — تكفي إحداها: ${CRIT_TEXT.join(" · ")}`,
                          "No criterion met yet",
                        )
                  }
                >
                  <input
                    type="checkbox"
                    checked={need}
                    disabled={ro || (!lp.ok && !need)}
                    onChange={(e) =>
                      void flagSession(entN, e.target.checked, key, ex, {
                        kpiTot: num(it.data.kpisTot),
                        initTot: num(it.data.initTot),
                        kpiBad: cv.kpiBad,
                        initBad: cv.initBad,
                        perf: cv.perf,
                      })
                    }
                  />
                  <span>{t("متعثّرة — تحتاج جلسة مراجعة أداء", "Needs a performance review session")}</span>
                </label>
                <div className={`mw-why ${lp.ok ? "on" : ""}`}>
                  {lp.ok
                    ? t(`ينطبق: ${lp.hit[0]}`, lp.hit[0])
                    : t("لا تنطبق معايير التعثّر بعد", "No low-performance criterion met")}
                </div>

                {/* تفاصيل الجلسة — تُكتب في بطاقة الجهة بصفحة الجلسات
                    نفسها، فما يُدخَل هنا هو ما يُقرأ هناك */}
                {need &&
                  (sr ? (
                    <div className="mw-esc">
                      <div className="mw-f">
                        <label className="wide">
                          <span>{t("المرحلة الحالية", "Current stage")}</span>
                          <select value={sAt} disabled={ro} onChange={(e) => void put(sr.id, { done: Number(e.target.value) }, "sessions")}>
                            {SESS_SHORT.map((x, i) => (
                              <option key={x} value={i}>
                                {i + 1}. {x}
                              </option>
                            ))}
                            <option value={SESS_SHORT.length}>{t("اكتملت الجلسة", "Completed")}</option>
                          </select>
                        </label>
                      </div>
                      <NoteBox
                        value={txt(sd.note)}
                        dis={ro}
                        ph={t("ملاحظات على تعثّر الجهة — تظهر في بطاقتها بصفحة الجلسات…", "Notes shown on the session card…")}
                        onSave={(v) => void put(sr.id, { note: v }, "sessions")}
                      />
                    </div>
                  ) : (
                    <div className="mw-hint">
                      {t("تُفتح بطاقة الجهة في صفحة الجلسات…", "Opening the session card…")}
                    </div>
                  ))}
              </>
            )}
              </>
            )}
          </div>
        );
      })}
      {!full && rows.length > shown.length && (
        <div className="mw-more">{t(`و${rows.length - shown.length} غيرها`, `+${rows.length - shown.length} more`)}</div>
      )}
    </div>
  );
}

function Quarterly({ rows, t, onToggle }: { rows: Row[]; t: T; onToggle: (r: Row, q: number) => void }) {
  const curQ = Math.floor(new Date().getMonth() / 3) + 1;
  if (!rows.length) return <div className="pf-none">{t("لا توجد جهات بعد — تُضاف من «جهاتي ومساهماتها».", "Add your entities first.")}</div>;
  return (
    <div className="qg">
      {rows.map((r) => {
        const q: number[] = Array.isArray(r.data.q) ? r.data.q : [0, 0, 0, 0];
        return (
          <div className="qt" key={r.id}>
            <div className="nm">{txt(r.data.name)}</div>
            <div className="qs">
              {[0, 1, 2, 3].map((i) => (
                <button
                  key={i}
                  className={`qq ${q[i] ? "ok" : i + 1 === curQ ? "now" : ""}`}
                  onClick={() => onToggle(r, i)}
                  title={`${t("الربع", "Q")} ${i + 1}`}
                >
                  <span>ر{i + 1}</span>
                  <b>{q[i] ? "✓" : i + 1 === curQ ? "•" : ""}</b>
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ============================================================
   طلبات جهاتي — من الجدول المركزي لا من المحفظة
   ------------------------------------------------------------
   مصدرها ملف طلبات التغيير اليومي الذي يُرفع في «نظرة عامة»،
   فتظهر عند كل استشاري في جهاته من نفسها. **لا تُحرَّر هنا**:
   تواريخُها ومددُها من الملف، وأي تعديل في المحفظة يضيع مع أول
   رفعٍ تالٍ — فالعرض قراءةٌ صريحة لا حقولَ إدخال.

   كانت تُعرض ستةَ صفوف فقط بلا مدى زمني. الآن السنة كلها بفلترٍ
   عليها، والقائمة تمرّر داخلها بدل أن تُقتطع.
   ============================================================ */
type CrRow = {
  code: string; owner: string; itemName: string; program?: string; category?: string;
  sla: number | null; workDays: number | null; status: string; firstSeen?: string; closedAt?: string;
};
const crLate = (c: CrRow) => c.sla != null && c.workDays != null && c.workDays >= c.sla;
const crYear = (c: CrRow) => txt(c.firstSeen).slice(0, 4);

function CrBox({
  rows, yr, setYr, t,
}: {
  rows: CrRow[];
  yr: string;
  setYr: (v: string) => void;
  t: T;
}) {
  const years = useMemo(() => {
    const set = new Set(rows.map(crYear).filter(Boolean));
    set.add(String(YR_NOW));
    return [...set].sort().reverse();
  }, [rows]);
  const list = useMemo(
    () =>
      rows
        .filter((c) => yr === "*" || crYear(c) === yr)
        .sort((a, b) => Number(crLate(b)) - Number(crLate(a)) || (b.workDays ?? 0) - (a.workDays ?? 0)),
    [rows, yr],
  );
  const late = list.filter(crLate).length;

  return (
    <div className="pf-cr">
      <div className="pf-cr-h">
        <b>{t("طلبات جهاتي", "My entities' requests")}</b>
        <select className="cr-yr" value={yr} onChange={(e) => setYr(e.target.value)}>
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
          <option value="*">{t("كل السنوات", "All years")}</option>
        </select>
        <span>
          {t(
            `${list.length} طلباً${late ? ` · ${late} متأخراً` : ""} — من ملف طلبات التغيير اليومي، لا تُعدَّل هنا`,
            `${list.length} requests — from the daily file, read-only`,
          )}
        </span>
      </div>
      {!list.length ? (
        <div className="pf-none sm">{t("لا توجد طلبات لجهاتك في هذه السنة.", "No requests this year.")}</div>
      ) : (
        <div className="cr-list">
          {list.map((c) => (
            <div className={`pf-cr-r ${crLate(c) ? "late" : ""}`} key={c.code}>
              <span className="n">
                {c.itemName || c.code}
                {c.category && <em>{c.category}</em>}
              </span>
              <span className="o">{c.owner}</span>
              <span className="s">{c.status}</span>
              <span className="d">
                {c.workDays ?? "—"}/{c.sla ?? "—"} {t("يوم", "d")}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------- المساهمات: ثلاثة أعمدة ---------------- */
const KINDS = ["مؤشر", "مبادرة", "مكاسب سريعة"];
/* ============================================================
   المساهمات في الخطة التشغيلية — مربوطة بصفحة الخطة
   ------------------------------------------------------------
   ما يضيفه الموظف هنا **بندٌ في الخطة التشغيلية نفسها** يظهر تحت
   محفظة المدير الذي يختاره، لا نسخةً محلية في محفظته. والكتابة
   عبر `perf_opplan_mine_save` التي تتحقّق في القاعدة أن البند
   مساهمتُه وتكتب اسمه بنفسها — فلا تُفتح سياسة `perf_items` لأحد.
   ============================================================ */
const CONTRIB_KINDS: { k: string; label: string }[] = [
  { k: "kpi", label: "مؤشرات" },
  { k: "init", label: "مبادرات" },
  { k: "win", label: "مكاسب سريعة" },
];
/** قيمة مُدخَلة فعلاً — الصفر قيمة، والفراغ ليس صفراً */
const has = (v: unknown) => v !== undefined && v !== null && String(v).trim() !== "";
const ROLE_TONE: Record<string, string> = {
  راعي: "sp",
  مسؤول: "as",
  "صاحب المحفظة": "ow",
  مساهمة: "ct",
};

/** بندٌ من الخطة يخصّ صاحب الجلسة، ومعه أدواره فيه */
export type MyOp = { id: string; data: Rec; roles: string[]; own: boolean };

/** كل ما يخصّ شخصاً في الخطة التشغيلية — راعياً كان أو مسؤولاً أو مساهماً */
export function myOpItems(all: { id: string; data: Rec }[], meName: string): MyOp[] {
  const n = nrm(meName);
  return all
    .map((x) => opFix(x.data))
    .map((d, i) => ({
      id: all[i].id,
      data: d,
      roles: opRoles(d, meName),
      own: nrm(txt(d.contributor)) === n,
    }))
    .filter((x) => x.roles.length > 0);
}

function Contrib({ rows, meName, t }: { rows: Row[]; meName: string; t: T }) {
  const [mine, setMine] = useState<MyOp[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [msg, setMsg] = useState("");
  const [edit, setEdit] = useState<MyOp | null>(null);
  const [add, setAdd] = useState<Rec | null>(null);

  const load = useCallback(() => {
    void apiFetch("/api/items?section=opplan")
      .then((r) => r.json())
      .then((d) => {
        const all = (Array.isArray(d.items) ? d.items : []) as { id: string; data: Rec }[];
        setMine(myOpItems(all, meName));
      })
      .catch(() => setMine([]))
      .finally(() => setLoaded(true));
  }, [meName]);
  useEffect(() => load(), [load]);

  async function put(id: string | null, patch: Rec) {
    const r = await apiFetch("/api/opplan/mine", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: id || "", patch }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      setMsg(txt(j.error) || t("تعذّر الحفظ", "Save failed"));
      return false;
    }
    setMsg("");
    load();
    return true;
  }
  async function del(id: string) {
    if (!confirm(t("حذف هذه المساهمة من الخطة التشغيلية؟", "Delete this contribution?"))) return;
    const r = await apiFetch(`/api/opplan/mine/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setMsg(txt(j.error) || t("تعذّر الحذف", "Delete failed"));
      return;
    }
    load();
  }

  if (!loaded) return <div className="pf-none">{t("جارٍ التحميل…", "Loading…")}</div>;

  const nRole = (r: string) => mine.filter((x) => x.roles.includes(r)).length;
  const nSt = (st: string) => mine.filter((x) => opStatus(x.data) === st).length;

  return (
    <div className="cb">
      <div className="cb-h">
        <span>
          {t(
            "كل بندٍ في الخطة التشغيلية أنت راعيه أو المسؤول عنه يظهر هنا. التحديث من هنا يصل صفحة «الخطة التشغيلية» مباشرة.",
            "Every plan item you sponsor or own. Updates here reach the plan page.",
          )}
        </span>
        <button
          onClick={() =>
            setAdd({ kind: "win", owner: OP_OWNERS[0], status: "على المسار", assignee: meName, unit: "عدد" })
          }
        >
          + {t("مساهمة جديدة", "New")}
        </button>
      </div>
      {msg && <div className="cb-msg">{msg}</div>}

      {/* الرقم أولاً: كم بنداً يخصّني، وبأي دور، وعلى أي حال */}
      <div className="cb-sum">
        <div className="tot">
          <b>{mine.length}</b>
          <span>{t("بنداً يخصّك في الخطة", "items")}</span>
        </div>
        <div className="brk">
          <span className="r sp">{t("راعٍ", "Sponsor")} <b>{nRole("راعي")}</b></span>
          <span className="r as">{t("مسؤول", "Owner")} <b>{nRole("مسؤول")}</b></span>
          {CONTRIB_KINDS.map(({ k, label }) => (
            <span className="r kd" key={k}>
              {label} <b>{mine.filter((x) => txt(x.data.kind) === k).length}</b>
            </span>
          ))}
        </div>
        <div className="brk st">
          {OP_STATUSES.map((st) => (
            <span className={`r ${opTone(st)}`} key={st}>
              {st} <b>{nSt(st)}</b>
            </span>
          ))}
        </div>
      </div>

      <div className="c3">
        {CONTRIB_KINDS.map(({ k, label }) => {
          const list = mine.filter((r) => txt(r.data.kind) === k);
          return (
            <div className="col2" key={k}>
              <div className="h">
                {label}
                <b>{list.length}</b>
              </div>
              {list.map((r) => {
                const st = opStatus(r.data);
                return (
                  <div className="li cb-li" key={r.id}>
                    <span className="n">{txt(r.data.name)}</span>
                    <div className="mt">
                      {r.roles.map((x) => (
                        <i className={ROLE_TONE[x] || "ow"} key={x}>{x}</i>
                      ))}
                      <span className="o">{txt(r.data.owner)}</span>
                      {st && <span className={`stc ${opTone(st)}`}>{st}</span>}
                      <button className="up" onClick={() => setEdit(r)}>
                        {t("تحديث", "Update")}
                      </button>
                      {r.own && (
                        <button className="x" title={t("حذف", "Delete")} onClick={() => void del(r.id)}>✕</button>
                      )}
                    </div>
                  </div>
                );
              })}
              {!list.length && <div className="pf-none sm">—</div>}
            </div>
          );
        })}
      </div>

      {/* بنودٌ قديمة بقيت في المحفظة قبل الربط — تُنقل بضغطة */}
      {rows.length > 0 && (
        <div className="cb-old">
          <b>{t(`مساهمات قديمة في محفظتك · ${rows.length}`, `${rows.length} local`)}</b>
          <em>{t("سُجّلت قبل الربط بالخطة، فلا تظهر فيها — انقلها لتصل محفظة مديرها.", "Not linked yet")}</em>
          {rows.map((r) => (
            <div className="li cb-li" key={r.id}>
              <span className="n">{txt(r.data.name)}</span>
              <div className="mt">
              <span className="o">{txt(r.data.kind)}</span>
              <button
                className="mv"
                onClick={async () => {
                  const kind = txt(r.data.kind).includes("مؤشر")
                    ? "kpi"
                    : txt(r.data.kind).includes("مبادر")
                      ? "init"
                      : "win";
                  await put(null, {
                    kind,
                    name: txt(r.data.name),
                    owner: OP_OWNERS[0],
                    status: "على المسار",
                  });
                }}
              >
                {t("نقل إلى الخطة", "Move")}
              </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {edit && (
        <ContribEdit
          it={edit}
          t={t}
          onClose={() => setEdit(null)}
          onSave={async (patch) => {
            if (await put(edit.id, patch)) setEdit(null);
          }}
        />
      )}

      {add && (
        <AddContrib
          f={add}
          setF={setAdd}
          meName={meName}
          t={t}
          onClose={() => setAdd(null)}
          onAdd={async (d) => {
            if (await put(null, d)) setAdd(null);
          }}
        />
      )}
    </div>
  );
}

/* ============================================================
   إضافة مساهمة — بكل حقول بند الخطة
   ------------------------------------------------------------
   كان النموذج أربعة حقول (البند · النوع · المحفظة · الحالة)، فتصل
   الخطةَ مساهمةٌ بلا راعٍ ولا مسؤول ولا أرقام، وقد طُلب صراحةً أن
   لكل مساهمة **راعياً ومسؤولاً**. فصار النموذج كنموذج الخطة نفسه،
   والمسؤول يبدأ باسم المضيف لأنه الغالب.
   ============================================================ */
function AddContrib({
  f, setF, meName, t, onClose, onAdd,
}: {
  f: Rec;
  setF: (v: Rec) => void;
  meName: string;
  t: T;
  onClose: () => void;
  onAdd: (d: Rec) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const kind = txt(f.kind);
  const set = (k: string, v: unknown) => setF({ ...f, [k]: v });
  /* تبديل النوع يُسقط حقول النوع السابق: الأرباع والمستهدف
     للمؤشر وحده، ونوع المبادرة للمبادرة وحدها. وبدون ذلك يبقى ما
     كُتب قبل التبديل فيُحفظ مع مبادرةٍ لا أرباع لها. */
  const setKind = (v: string) => {
    const n: Rec = { ...f, kind: v };
    if (v !== "kpi")
      for (const k of ["level", "unit", "yearTarget",
                       "q1t","q1a","q2t","q2a","q3t","q3a","q4t","q4a"]) delete n[k];
    if (v !== "init") delete n.itype;
    setF(n);
  };
  const numOrDel = (k: string, v: string) => {
    const n = { ...f };
    if (v.trim() === "") delete n[k];
    else n[k] = Number(v);
    setF(n);
  };
  const val = (k: string) => (has(f[k]) ? String(f[k]) : "");

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="m-h">
          <h3>{t("مساهمة في الخطة التشغيلية", "New contribution")}</h3>
          <button className="mx" onClick={onClose} aria-label="close">✕</button>
        </div>

        <div className="op-f">
          <label className="wide">
            <span>{t("البند", "Item")}</span>
            <textarea rows={2} value={txt(f.name)} onChange={(e) => set("name", e.target.value)} />
          </label>
          <label>
            <span>{t("النوع", "Kind")}</span>
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              {CONTRIB_KINDS.map(({ k, label }) => (
                <option key={k} value={k}>{label}</option>
              ))}
            </select>
          </label>
          <label>
            <span>{t("محفظة المدير", "Portfolio")}</span>
            <select value={txt(f.owner)} onChange={(e) => set("owner", e.target.value)}>
              {OP_OWNERS.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          </label>
          <label>
            <span>{t("الراعي", "Sponsor")}</span>
            <input
              list="op-owners"
              value={txt(f.sponsor)}
              placeholder={t("اسم الراعي", "Sponsor")}
              onChange={(e) => set("sponsor", e.target.value)}
            />
            <datalist id="op-owners">
              {OP_OWNERS.map((o) => (
                <option key={o} value={o} />
              ))}
            </datalist>
          </label>
          <label>
            <span>{t("المسؤول", "Responsible")}</span>
            <input
              value={txt(f.assignee)}
              placeholder={meName}
              onChange={(e) => set("assignee", e.target.value)}
            />
          </label>
          <label>
            <span>{t("الحالة", "Status")}</span>
            <select value={txt(f.status)} onChange={(e) => set("status", e.target.value)}>
              {OP_STATUSES.map((x) => (
                <option key={x} value={x}>{x}</option>
              ))}
            </select>
          </label>

          {kind === "init" && (
            <label>
              <span>{t("نوع المبادرة", "Type")}</span>
              <select value={txt(f.itype)} onChange={(e) => set("itype", e.target.value)}>
                <option value="">{t("— اختر —", "— pick —")}</option>
                <option value="استراتيجية">استراتيجية</option>
                <option value="تشغيلية">تشغيلية</option>
              </select>
            </label>
          )}
          {kind === "kpi" && (
            <>
              <label>
                <span>{t("المستوى", "Level")}</span>
                <select value={has(f.level) ? Number(f.level) : 3}
                        onChange={(e) => set("level", Number(e.target.value))}>
                  <option value={1}>مستوى أول</option>
                  <option value={2}>مستوى ثانٍ</option>
                  <option value={3}>مستوى ثالث</option>
                </select>
              </label>
              <label>
                <span>{t("الوحدة", "Unit")}</span>
                <select value={txt(f.unit) || "عدد"} onChange={(e) => set("unit", e.target.value)}>
                  <option value="عدد">{t("عدد", "count")}</option>
                  <option value="%">٪</option>
                </select>
              </label>
              <label>
                <span>{t("المستهدف العام", "Year target")}</span>
                <input type="number" value={val("yearTarget")}
                       onChange={(e) => numOrDel("yearTarget", e.target.value)} />
              </label>
            </>
          )}
        </div>

        {kind === "kpi" && (
          <>
            <div className="op-qh">
              {t("مستهدف وفعلي كل ربع — الفراغ يعني لم يُدخَل بعد", "Quarterly")}
            </div>
            <div className="op-q">
              {[1, 2, 3, 4].map((i) => (
                <div className="r" key={i}>
                  <b>Q{i}</b>
                  <label>
                    <span>{t("المستهدف", "Target")}</span>
                    <input type="number" value={val(`q${i}t`)}
                           onChange={(e) => numOrDel(`q${i}t`, e.target.value)} />
                  </label>
                  <label>
                    <span>{t("الفعلي", "Actual")}</span>
                    <input type="number" value={val(`q${i}a`)}
                           onChange={(e) => numOrDel(`q${i}a`, e.target.value)} />
                  </label>
                </div>
              ))}
            </div>
          </>
        )}

        <div className="op-f">
          <label>
            <span>{t("تاريخ البداية", "Start")}</span>
            <input value={txt(f.start)} placeholder={t("مثال: 1 يناير 2026م", "e.g. Jan 2026")}
                   onChange={(e) => set("start", e.target.value)} />
          </label>
          <label>
            <span>{t("تاريخ النهاية", "End")}</span>
            <input value={txt(f.end)} placeholder={t("مثال: 31 ديسمبر 2026م", "e.g. Dec 2026")}
                   onChange={(e) => set("end", e.target.value)} />
          </label>
        </div>

        <label className="op-note">
          <span>{t("حالة المساهمة", "Progress")}</span>
          <textarea rows={3} value={txt(f.note)}
                    placeholder={t("أين وصل العمل؟", "Where does it stand?")}
                    onChange={(e) => set("note", e.target.value)} />
        </label>

        <div className="m-f">
          <button className="btn btn-ghost" onClick={onClose}>{t("إلغاء", "Cancel")}</button>
          <button
            className="btn"
            disabled={busy || !txt(f.name).trim()}
            onClick={async () => {
              setBusy(true);
              /* المسؤول الفارغ = المضيف نفسه، وهو الغالب */
              await onAdd({ ...f, assignee: txt(f.assignee).trim() || meName });
              setBusy(false);
            }}
          >
            {t("إضافة", "Add")}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   تحديث بندٍ من الخطة من داخل المحفظة
   ------------------------------------------------------------
   **الراعي والمسؤول يحدّثان الحالة والفعلي والملاحظة فقط.**
   المستهدفات واسم البند والمحفظة بنودُ خطةٍ معتمدة، فلا تُعدَّل
   إلا من صفحة الخطة بصلاحية التحرير — إلا أن تكون المساهمة
   مساهمتَه هو فيملك كل حقولها.
   ============================================================ */
function ContribEdit({
  it, t, onClose, onSave,
}: {
  it: MyOp;
  t: T;
  onClose: () => void;
  onSave: (patch: Rec) => Promise<void>;
}) {
  const [f, setF] = useState<Rec>({ ...it.data });
  const [busy, setBusy] = useState(false);
  const kind = txt(it.data.kind);
  const isKpi = kind === "kpi";
  const set = (k: string, v: unknown) => setF((o) => ({ ...o, [k]: v }));
  const numOrNull = (k: string, v: string) => set(k, v.trim() === "" ? null : Number(v));
  const val = (k: string) => {
    const v = f[k];
    return v === undefined || v === null || v === "" ? "" : String(v);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="m-h">
          <h3>{t("تحديث بند الخطة", "Update plan item")}</h3>
          <button className="mx" onClick={onClose} aria-label="close">✕</button>
        </div>

        <div className="cb-ed">
          <p className="nm">{txt(it.data.name)}</p>
          <p className="mt">
            {it.roles.map((r) => (
              <i className={ROLE_TONE[r] || "ow"} key={r}>{r}</i>
            ))}
            <span>{t("محفظة", "Portfolio")} <b>{txt(it.data.owner) || "—"}</b></span>
            {has(it.data.sponsor) && <span>{t("الراعي", "Sponsor")} <b>{txt(it.data.sponsor)}</b></span>}
            {has(it.data.assignee) && <span>{t("المسؤول", "Owner")} <b>{txt(it.data.assignee)}</b></span>}
          </p>
        </div>

        <div className="op-f">
          {it.own && (
            <label className="wide">
              <span>{t("البند", "Item")}</span>
              <textarea rows={2} value={txt(f.name)} onChange={(e) => set("name", e.target.value)} />
            </label>
          )}
          <label>
            <span>{t("الحالة", "Status")}</span>
            <select value={txt(f.status)} onChange={(e) => set("status", e.target.value)}>
              <option value="">
                {isKpi ? t("تلقائي من الأرباع", "Auto") : t("— اختر —", "— pick —")}
              </option>
              {OP_STATUSES.map((x) => (
                <option key={x} value={x}>{x}</option>
              ))}
            </select>
          </label>
          {it.own && (
            <label>
              <span>{t("محفظة المدير", "Portfolio")}</span>
              <select value={txt(f.owner)} onChange={(e) => set("owner", e.target.value)}>
                {OP_OWNERS.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            </label>
          )}
        </div>

        {isKpi && (
          <>
            <div className="op-qh">
              {t("الفعلي لكل ربع — المستهدف معتمدٌ في الخطة فلا يُعدَّل هنا", "Quarterly actuals")}
            </div>
            <div className="op-q">
              {[1, 2, 3, 4].map((i) => (
                <div className="r" key={i}>
                  <b>Q{i}</b>
                  <label>
                    <span>{t("المستهدف", "Target")}</span>
                    <input value={has(it.data[`q${i}t`]) ? String(it.data[`q${i}t`]) : "—"} readOnly disabled />
                  </label>
                  <label>
                    <span>{t("الفعلي", "Actual")}</span>
                    <input type="number" value={val(`q${i}a`)}
                           onChange={(e) => numOrNull(`q${i}a`, e.target.value)} />
                  </label>
                </div>
              ))}
            </div>
          </>
        )}

        {it.own && (
          <div className="op-f">
            <label>
              <span>{t("تاريخ البداية", "Start")}</span>
              <input value={txt(f.start)} onChange={(e) => set("start", e.target.value)} />
            </label>
            <label>
              <span>{t("تاريخ النهاية", "End")}</span>
              <input value={txt(f.end)} onChange={(e) => set("end", e.target.value)} />
            </label>
          </div>
        )}
        {!it.own && (has(it.data.start) || has(it.data.end)) && (
          <p className="cb-dt">
            {t("البداية", "Start")} <b>{txt(it.data.start) || "—"}</b>
            {" · "}
            {t("النهاية", "End")} <b>{txt(it.data.end) || "—"}</b>
          </p>
        )}

        <label className="op-note">
          <span>{t("حالة المساهمة", "Progress")}</span>
          <textarea
            rows={3}
            value={txt(f.note)}
            placeholder={t("أين وصل العمل؟", "Where does it stand?")}
            onChange={(e) => set("note", e.target.value)}
          />
        </label>

        <div className="m-f">
          <button className="btn btn-ghost" onClick={onClose}>{t("إلغاء", "Cancel")}</button>
          <button
            className="btn"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const patch: Rec = { status: txt(f.status), note: txt(f.note) };
              if (isKpi) for (const i of [1, 2, 3, 4]) patch[`q${i}a`] = f[`q${i}a`] ?? null;
              if (it.own) {
                patch.name = txt(f.name);
                patch.owner = txt(f.owner);
                patch.start = txt(f.start);
                patch.end = txt(f.end);
              }
              await onSave(patch);
              setBusy(false);
            }}
          >
            {t("حفظ", "Save")}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- بطاقة مختصرة ---------------- */
function Tile({
  w,
  count,
  sub,
  pct,
  warn,
  chips,
  onOpen,
  onHide,
  onEdit,
  dragProps,
}: {
  w: WDef;
  count: number;
  sub: string;
  pct: number;
  warn?: string;
  /** مربعات صغيرة تفصّل الرقم — تحلّ محلّ شريط النسبة حين تُمرَّر */
  chips?: { k: string; v: number }[];
  onOpen: () => void;
  onHide: () => void;
  onEdit: () => void;
  dragProps: Rec;
}) {
  return (
    <div className="tile" style={{ ["--c" as string]: w.color }} onClick={onOpen} {...dragProps}>
      <span className="grip" title="اسحب" onClick={(e) => e.stopPropagation()}>
        ⋮⋮
      </span>
      <span
        className="edit"
        title="تغيير الاسم والأيقونة"
        onClick={(e) => {
          e.stopPropagation();
          onEdit();
        }}
      >
        ✎
      </span>
      <span
        className="hide"
        title="إخفاء"
        onClick={(e) => {
          e.stopPropagation();
          onHide();
        }}
      >
        ✕
      </span>
      <div className="num2">{count}</div>
      {warn ? <span className="warn">{warn}</span> : null}
      {/* الأيقونة أُزيلت من وجه البطاقة بطلب المستخدمة — تُختار لاحقاً،
          وتبقى محفوظة وتظهر في رأس النافذة */}
      <h4>{w.label}</h4>
      <span className="rule" />
      <div className="sb2">{sub}</div>
      {chips && chips.length > 0 ? (
        <div className="chips3">
          {chips.map((c) => (
            <span className="ch3" key={c.k}>
              <b>{c.v}</b>
              {c.k}
            </span>
          ))}
        </div>
      ) : (
        <div className="ft2">
          <span className="bar4">
            <i style={{ width: `${pct}%`, background: w.color }} />
          </span>
          <span className="pc" style={{ color: w.color }}>
            {pct}%
          </span>
        </div>
      )}
      <span className="go">↩ اضغط للتفاصيل</span>
    </div>
  );
}

/* ---------------- نافذة جهاتي ---------------- */
type Contact = {
  id?: string; name?: string; role?: string; jobTitle?: string;
  email?: string; phone?: string;
  /** الطرف: «نحن» (المركز) · «الجهة» · «VRO» (مكتب تحقيق الرؤية) */
  side?: string;
};

/* ============================================================
   أطراف التواصل الثلاثة
   ------------------------------------------------------------
   كان الطرفان اثنين، ومنسوب مكتب تحقيق الرؤية يُسجَّل ضمن «الجهة»
   فيختلط بنقطة اتصالها — وهو من المنظومة لا من الجهاز.

   الصفوف القديمة كلها `side = 'الجهة'`، فتُستدَلّ VRO من مسمّى
   الوظيفة («مكتب تحقيق الرؤية» أو VRO) حتى تُنقل يدوياً. الاستدلال
   عرضٌ فقط: لا يكتب شيئاً في القاعدة.
   ============================================================ */
const SIDE_US = "نحن";
const SIDE_VRO = "VRO";
const isVro = (c: Contact) =>
  txt(c.side) === SIDE_VRO ||
  /vro|تحقيق الرؤية|تحقيق الرويه|تحقيق الرؤيه/i.test(`${txt(c.jobTitle)} ${txt(c.role)}`);
const CT_ROLES = ["أساسي", "بديل"];
const CT_SIDES: { v: string; l: string }[] = [
  { v: "الجهة", l: "من الجهة" },
  { v: SIDE_VRO, l: "من مكتب تحقيق الرؤية (VRO)" },
];

/** وجه الجهة — شعارها إن وُجد، وإلا حرفان بلونٍ من اسمها */
function EntFace({ name, logo }: { name: string; logo?: string }) {
  const c = toneOf(name);
  return (
    <span className="ec-lg" style={{ background: c + "1f", color: c }}>
      <i>{initials(name)}</i>
      {logo && (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img src={asset(`/logos/${logo}`)} alt="" loading="lazy" />
      )}
    </span>
  );
}

/* ============================================================
   نقاط التواصل — تُحرَّر من «جهاتي» مباشرةً
   ------------------------------------------------------------
   كانت البطاقة عرضاً فقط تحيل إلى صفحة «الجهات ونقاط التواصل»،
   والاستشاري يفتح محفظته ليجد رقماً قديماً فلا يملك تصحيحه.
   الآن يحرّر نقاط **جهته** من مكانها.

   الحارس RLS لا الواجهة: `perf_contacts` تسمح لمن يتولّى الجهة
   أو لصاحب صلاحية «الجهات»، فالخادم يردّ 403 لغيرهما ويُعرض ردّه.
   ونقاط المركز (side = نحن) تبقى عرضاً: إسنادُ زميلٍ لجهة قرارٌ
   يُدار في صفحة السجلّ لا من محفظة فرد.
   ============================================================ */
function ContactRow({
  c, entityId, editable, start, me, sides, t, onDone, onCancel,
}: {
  c: Contact;
  entityId: string;
  editable: boolean;
  /** سطرٌ جديد يُفتح محرَّراً من أوّله */
  start?: boolean;
  /** هذه النقطة هي أنا — تُعلَّم فيعرف صاحبها أن بياناته هي المعروضة */
  me?: boolean;
  /** الأطراف التي يمكن نقل النقطة بينها — فارغة لنقاط المركز */
  sides?: { v: string; l: string }[];
  t: T;
  onDone: () => void;
  onCancel?: () => void;
}) {
  const [ed, setEd] = useState<Contact | null>(start ? { ...c } : null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function put() {
    const d = ed || {};
    if (!txt(d.name).trim()) {
      setErr(t("الاسم مطلوب", "Name is required"));
      return;
    }
    setBusy(true);
    setErr("");
    const r = await apiFetch("/api/entities/contact", {
      method: c.id ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: c.id || "",
        entityId,
        side: txt(d.side) || (sides ? sides[0].v : "الجهة"),
        role: txt(d.role) || "أساسي",
        name: txt(d.name).trim(),
        jobTitle: txt(d.jobTitle).trim(),
        email: txt(d.email).trim(),
        phone: txt(d.phone).trim(),
      }),
    });
    setBusy(false);
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setErr(txt(j.error) || t("تعذّر الحفظ", "Save failed"));
      return;
    }
    setEd(null);
    onDone();
  }

  async function del() {
    if (!c.id) return;
    if (!confirm(t("حذف نقطة التواصل هذه؟", "Delete this contact?"))) return;
    setBusy(true);
    setErr("");
    const r = await apiFetch(`/api/entities/contact/${c.id}`, { method: "DELETE" });
    setBusy(false);
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setErr(txt(j.error) || t("تعذّر الحذف", "Delete failed"));
      return;
    }
    onDone();
  }

  if (ed)
    return (
      <div className="ct-ed">
        <input
          value={txt(ed.name)}
          placeholder={t("الاسم", "Name")}
          onChange={(e) => setEd({ ...ed, name: e.target.value })}
        />
        <input
          value={txt(ed.jobTitle)}
          placeholder={t("المسمّى الوظيفي", "Job title")}
          onChange={(e) => setEd({ ...ed, jobTitle: e.target.value })}
        />
        <input
          dir="ltr"
          value={txt(ed.email)}
          placeholder="name@entity.gov.sa"
          onChange={(e) => setEd({ ...ed, email: e.target.value })}
        />
        <input
          dir="ltr"
          value={txt(ed.phone)}
          placeholder="05XXXXXXXX"
          onChange={(e) => setEd({ ...ed, phone: e.target.value })}
        />
        <select value={txt(ed.role) || "أساسي"} onChange={(e) => setEd({ ...ed, role: e.target.value })}>
          {CT_ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        {sides && (
          <select
            value={isVro(ed) ? SIDE_VRO : "الجهة"}
            onChange={(e) => setEd({ ...ed, side: e.target.value })}
          >
            {sides.map((x) => (
              <option key={x.v} value={x.v}>
                {x.l}
              </option>
            ))}
          </select>
        )}
        <div className="ct-act">
          <button className="ok" disabled={busy} onClick={() => void put()}>
            {t("حفظ", "Save")}
          </button>
          <button
            onClick={() => {
              setEd(null);
              setErr("");
              onCancel?.();
            }}
          >
            {t("إلغاء", "Cancel")}
          </button>
          {c.id && (
            <button className="del" disabled={busy} onClick={() => void del()}>
              {t("حذف", "Delete")}
            </button>
          )}
        </div>
        {err && <div className="ct-err">{err}</div>}
      </div>
    );

  const role = (c.role || "أساسي").trim();
  return (
    <div className="ct-line">
      <span className="ct-n">
        {c.name || "—"}
        <i className={role === "أساسي" ? "pri" : ""}>{role}</i>
        {me && <i className="mine">{t("أنت", "You")}</i>}
        {c.jobTitle && <em>{c.jobTitle}</em>}
      </span>
      <span className="ct-c" dir="ltr">
        {c.email && <a href={`mailto:${c.email}`}>{c.email}</a>}
        {c.phone && <a href={`tel:${c.phone}`}>{c.phone}</a>}
      </span>
      {editable && (
        <button className="ct-pen" title={t("تعديل", "Edit")} onClick={() => setEd({ ...c })}>
          ✎
        </button>
      )}
      {err && <div className="ct-err">{err}</div>}
    </div>
  );
}

/** مجموعة نقاط تواصل — عنوانها وسطورها وزرّ إضافةٍ إليها */
function CtGroup({
  title, list, entityId, editable, sides, newSide, myId, t, onDone,
}: {
  title: string;
  list: Contact[];
  entityId: string;
  editable: boolean;
  sides?: { v: string; l: string }[];
  /** الطرف الذي تُنشأ عليه النقطة الجديدة */
  newSide?: string;
  myId?: string;
  t: T;
  onDone: () => void;
}) {
  const [adding, setAdding] = useState(false);
  return (
    <div className="ct-grp">
      <b>
        {title}
        {editable && (
          <button className="ct-add" onClick={() => setAdding(true)}>
            + {t("إضافة", "Add")}
          </button>
        )}
      </b>
      {list.map((c, i) => (
        <ContactRow
          key={c.id || i}
          c={c}
          entityId={entityId}
          editable={editable}
          me={!!myId && c.id === myId}
          sides={sides}
          t={t}
          onDone={onDone}
        />
      ))}
      {adding && (
        <ContactRow
          c={{ side: newSide, role: list.some((x) => (x.role || "أساسي") === "أساسي") ? "بديل" : "أساسي" }}
          entityId={entityId}
          editable
          start
          sides={sides}
          t={t}
          onDone={() => {
            setAdding(false);
            onDone();
          }}
          onCancel={() => setAdding(false)}
        />
      )}
      {!list.length && !adding && (
        <div className="ct-none">{t("لا توجد نقطة تواصل مسجّلة", "No contact yet")}</div>
      )}
    </div>
  );
}

/* بطاقة جهة من سجلّ المركز — شعارها وقطاعها وأطرافها الثلاثة.
   كانت تُخفي نقطةَ صاحب المحفظة نفسه («البديل وحده يظهر»)، فيفتح
   الاستشاري جهاته ولا يرى اسمه ولا بريده ولا جواله. الآن تُعرض
   نقاط المركز كلها بأدوارها، ونقطتُه معلَّمةً «أنت». */
/* صفُّ مشاركةٍ مع بديل: الأساسي يفتح جهته له «اطّلاع فقط» أو
   «اطّلاع وتعديل»، ويسحبها متى شاء. القرار قرارُ الأساسي وحده —
   والقاعدة هي التي تتحقّق، لا هذه القائمة. */
function ShareRow({
  entityId, c, level, t, onDone,
}: {
  entityId: string;
  c: Contact & { userId?: number | string };
  level: string;
  t: T;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function set(v: string) {
    setBusy(true);
    setErr("");
    const r = await apiFetch("/api/entities/share", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entityId, userId: c.userId, level: v }),
    });
    setBusy(false);
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setErr(txt(j.error) || t("تعذّر الحفظ", "Save failed"));
      return;
    }
    onDone();
  }
  return (
    <div className="ct-sh">
      <span>{c.name || "—"}</span>
      <select value={level} disabled={busy} onChange={(e) => void set(e.target.value)}>
        {SHARE_OPT.map((o) => (
          <option key={o.v} value={o.v}>
            {t(o.l, o.v)}
          </option>
        ))}
      </select>
      {err && <div className="ct-err">{err}</div>}
    </div>
  );
}

function EntCard({
  x, logo, t, onDone,
}: {
  x: RegRow;
  logo?: string;
  t: T;
  onDone: () => void;
}) {
  const ours = x.ours || [];
  const theirs = (x.theirs || []).filter((c) => !isVro(c));
  const vro = (x.theirs || []).filter(isVro);
  const lvl = (x.myLevel || "primary") as MyLevel;
  return (
    <div className="ecard">
      <div className="ec-h">
        <EntFace name={x.name} logo={logo} />
        <span className="ec-n">
          <b>{x.name}</b>
          {x.sector && <em>{x.sector}</em>}
        </span>
      </div>

      {/* نقاط المركز إسنادٌ يُدار في صفحة السجلّ، فتُعرض ولا تُحرَّر */}
      <CtGroup
        title={t("من مركز أداء", "From Adaa")}
        list={ours}
        entityId={x.entityId}
        editable={false}
        myId={x.myContactId}
        t={t}
        onDone={onDone}
      />

      {/* المنح كلُّه في مكانٍ واحد: «منح صلاحية» داخل الإعدادات.
          هنا تُقال الحالة فقط، فلا يتكرّر مكانان للشيء نفسه. */}
      {lvl === "view" && (
        <div className="ct-lv">{t("شورِكت معك: اطّلاع فقط", "Shared with you: view only")}</div>
      )}
      {lvl === "edit" && (
        <div className="ct-lv ok">{t("شورِكت معك: اطّلاع وتعديل", "Shared with you: edit")}</div>
      )}
      <CtGroup
        title={t("من الجهة", "From the entity")}
        list={theirs}
        entityId={x.entityId}
        editable
        sides={CT_SIDES}
        newSide="الجهة"
        t={t}
        onDone={onDone}
      />
      <CtGroup
        title={t("من مكتب تحقيق الرؤية (VRO)", "From the VRO")}
        list={vro}
        entityId={x.entityId}
        editable
        sides={CT_SIDES}
        newSide={SIDE_VRO}
        t={t}
        onDone={onDone}
      />
    </div>
  );
}

function EntitiesModal({
  rows,
  reg,
  t,
  onClose,
  onSave,
  onDelete,
  onReload,
}: {
  rows: Row[];
  reg: RegRow[];
  t: T;
  onClose: () => void;
  onSave: (id: string, data: Rec) => void;
  onDelete: (id: string) => void;
  /** إعادة قراءة سجلّ جهاتي بعد تعديل نقطة تواصل */
  onReload: () => void;
}) {
  const [edit, setEdit] = useState<Row | null>(null);
  const logos = useLogos();
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="m-h">
          <h3>{t("جهاتي", "My entities")}</h3>
          <span className="cnt2">
            {new Set([
              ...rows.map((r) => txt(r.data.name).trim()).filter(Boolean),
              ...reg.map((x) => x.name.trim()).filter(Boolean),
            ]).size}{" "}
            {t("جهة", "entities")}
          </span>
          <button className="mx" onClick={onClose} aria-label="close">
            ✕
          </button>
        </div>
        {reg.length > 0 && (
          <div className="erow2-h">
            <b>{t("من سجلّ المركز — مسندة إليك", "From the registry")}</b>
            <span>
              {t(
                "نقاط الجهة ومكتب تحقيق الرؤية تُحرَّر من هنا · نقاط المركز تُسنَد من صفحة «الجهات ونقاط التواصل»",
                "Entity and VRO contacts are editable here",
              )}
            </span>
          </div>
        )}
        <div className="ecards">
          {reg.map((x) => (
            <EntCard key={x.entityId} x={x} logo={logos[logoKey(x.name)]} t={t} onDone={onReload} />
          ))}
        </div>
        <div>
          {rows.map((r) => (
            <div className="erow2" key={r.id}>
              {edit?.id === r.id ? (
                <>
                  <input
                    className="grow"
                    value={txt(edit.data.name)}
                    onChange={(e) => setEdit({ ...edit, data: { ...edit.data, name: e.target.value } })}
                  />
                  <select
                    value={txt(edit.data.type)}
                    onChange={(e) => setEdit({ ...edit, data: { ...edit.data, type: e.target.value } })}
                  >
                    {["مؤسسية", "وطنية", "مناطقية", "برنامج"].map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                  </select>
                  <span
                    className="ac"
                    onClick={() => {
                      onSave(r.id, edit.data);
                      setEdit(null);
                    }}
                  >
                    {t("حفظ", "Save")}
                  </span>
                </>
              ) : (
                <>
                  <span className="n">
                    {txt(r.data.name)}
                    <em>
                      {txt(r.data.type)}
                      {num(r.data.initiatives) ? ` · ${num(r.data.initiatives)} مبادرة` : ""}
                      {num(r.data.kpis) ? ` · ${num(r.data.kpis)} مؤشراً` : ""}
                    </em>
                  </span>
                  <span className="ac" onClick={() => setEdit(r)}>
                    {t("تعديل", "Edit")}
                  </span>
                  <span className="ac del" onClick={() => onDelete(r.id)}>
                    {t("حذف", "Delete")}
                  </span>
                </>
              )}
            </div>
          ))}
          {!rows.length && <div className="pf-none">{t("لا توجد جهات بعد.", "No entities yet.")}</div>}
          {/* الإضافة صارت إلى **سجلّ الجهات** لا إلى سطرٍ محليّ في
              المحفظة: السطر المحليّ كان بلا نقاط تواصل ولا شعار ولا
              وجودٍ في صفحة الجهات، وتصنيفُه (مؤسسية/وطنية) لا محلّ
              له هنا. والجهة المضافة تعود ببطاقتها أعلاه فتُعبَّأ
              نقاطُها الثلاث. */}
          <NewEntity t={t} onDone={onReload} />
        </div>
      </div>
    </div>
  );
}

/* ---------------- من يرى محفظتي ----------------
   المحفظة خاصة بصاحبها: لا يراها مديره ولا أي أحد إلا بمنحٍ منه.
   المنح للاطّلاع فقط — لا يكتب الممنوح له شيئاً، والحراسة في RLS. */
type Grant = { userId: string; name: string; jobTitle?: string; scopes: string[]; at?: string };
/** موظف في قطاع المدير — حجم محفظته وآخر تحديث فيها */
type TeamRow = { userId: string; name: string; jobTitle: string; count: number; lastAt: string };

/* خيارات المنح بأقسام perf_portfolio لا بالويدجت:
   «البرامج والاستراتيجيات» و«التقارير الربعية» يقرآن قسم entities
   نفسه، فلا يمكن فصلهما — جُمعا في خيار واحد صراحةً بدل إيهام
   المستخدم بأنه فصلهما وهو لم يفعل. */
const SHARE_OPTS: { k: string; label: string }[] = [
  { k: "tasks", label: "مهامي" },
  { k: "entities", label: "الجهات — البرامج والاستراتيجيات والتقارير الربعية" },
  { k: "projects", label: "المشاريع الاستراتيجية" },
  { k: "contrib", label: "المساهمات في الخطة التشغيلية" },
  { k: "changes", label: "طلبات التغيير" },
  { k: "reverse", label: "طلبات العكس" },
  { k: "workflow", label: "توثيق قيم المؤشرات/المبادرات" },
];
/* أقسامٌ لا تُعرض جدولاً في محفظةٍ مُطَّلَعٍ عليها: `mainx` بياناتٌ
   مساعدة مفاتيحها «القسم:معرّف البند»، فجدولُها صفوفُ رموز بلا
   معنى — تُعرض داخل «الأعمال الرئيسية» في مكانها الصحيح */
const SH_SKIP = new Set(["mainx"]);

function GrantsBox({ prefs, meId, t }: { prefs: Prefs; meId: string; t: T }) {
  const [grants, setGrants] = useState<Grant[]>([]);
  const [people, setPeople] = useState<{ id: string; name: string }[]>([]);
  const [who, setWho] = useState("");
  const [sel, setSel] = useState<string[]>(["*"]);
  const [msg, setMsg] = useState("");

  const opts = useMemo(
    () => [...SHARE_OPTS, ...prefs.custom.map((c) => ({ k: c.key, label: c.label }))],
    [prefs.custom],
  );

  const load = useCallback(async () => {
    const [g, ppl] = await Promise.all([
      apiFetch("/api/portfolio/grants").then((r) => r.json()).catch(() => ({})),
      apiFetch("/api/people").then((r) => r.json()).catch(() => ({})),
    ]);
    setGrants(Array.isArray(g.grants) ? g.grants : []);
    setPeople((ppl.people || []).filter((x: Rec) => String(x.id) !== meId));
  }, [meId]);
  useEffect(() => {
    void load();
  }, [load]);

  const all = sel.includes("*");
  const toggle = (k: string) =>
    setSel((old) => (old.includes(k) ? old.filter((x) => x !== k) : [...old.filter((x) => x !== "*"), k]));

  async function give() {
    if (!who) {
      setMsg(t("اختر الشخص أولاً", "Pick a person"));
      return;
    }
    const scopes = all ? ["*"] : sel;
    if (!scopes.length) {
      setMsg(t("اختر ما تريد مشاركته", "Pick what to share"));
      return;
    }
    const r = await apiFetch("/api/portfolio/grants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: who, scopes }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      setMsg(d.error || t("تعذّر الحفظ", "Failed"));
      return;
    }
    setWho("");
    setSel(["*"]);
    setMsg("");
    await load();
  }

  async function drop(id: string, name: string) {
    if (!confirm(t(`سحب صلاحية ${name} على محفظتك؟`, `Revoke ${name}?`))) return;
    await apiFetch(`/api/portfolio/grants?user=${encodeURIComponent(id)}`, { method: "DELETE" });
    await load();
  }

  const label = (g: Grant) =>
    g.scopes.includes("*")
      ? t("كل المحفظة", "Everything")
      : g.scopes.map((k) => opts.find((o) => o.k === k)?.label || k).join(" · ");

  /* بلا عنوانٍ هنا: «من يرى محفظتي» مكتوبٌ فوقه في نافذة التخصيص،
     فتكراره يجعل عنواناً واحداً مرّتين في شاشةٍ واحدة */
  return (
    <>
      <p className="gr-hint">
        {t(
          "المحفظة خاصة — لا يراها أحد. والمنح للاطّلاع فقط، ويُسحب في أي وقت.",
          "Your portfolio is private. Grant read access to whoever you choose.",
        )}
      </p>

      {grants.length > 0 && (
        <div className="gr-list">
          {grants.map((g) => (
            <div className="gr-row" key={g.userId}>
              <b>{g.name}</b>
              <span>{label(g)}</span>
              <button onClick={() => drop(g.userId, g.name)} title={t("سحب الصلاحية", "Revoke")}>
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="gr-add">
        <select value={who} onChange={(e) => setWho(e.target.value)}>
          <option value="">{t("— اختر شخصاً —", "— Pick a person —")}</option>
          {people.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
        <div className="gr-scopes">
          <label className={all ? "on" : ""}>
            <input type="checkbox" checked={all} onChange={() => setSel(all ? [] : ["*"])} />
            {t("كل المحفظة", "Everything")}
          </label>
          {opts.map((o) => (
            <label key={o.k} className={!all && sel.includes(o.k) ? "on" : ""}>
              <input
                type="checkbox"
                disabled={all}
                checked={all || sel.includes(o.k)}
                onChange={() => toggle(o.k)}
              />
              {o.label}
            </label>
          ))}
        </div>
        <button className="btn btn-sm" onClick={give}>
          {t("منح الصلاحية", "Grant")}
        </button>
        {msg && <div className="gr-msg">{msg}</div>}
      </div>
      <p className="gr-hint sm">
        {t(
          "الملاحظات والتقويم لا يشملهما المنح.",
          "Your notes and calendar are never shared.",
        )}
      </p>
    </>
  );
}

/* ============================================================
   الأعمال الرئيسية في محفظةٍ مُطَّلَعٍ عليها
   ------------------------------------------------------------
   بنودُها ليست في `perf_portfolio` بل في `perf_items`، تُنتقى
   بجهات صاحبها. فكان المدير يفتح محفظة استشاريٍّ فلا يرى **أهمّ**
   ما فيها: استراتيجياته وجهاته — يرى طلباته ومهامه فقط.

   جهاتُ صاحب المحفظة تُستنتج من سجلّ الجهات: نقطةُ تواصلٍ من
   المركز مسندةٌ إليه بدور «أساسي». بلا دالةٍ جديدة في القاعدة.
   ============================================================ */
function SharedMain({
  ownerId, ownerName, extras, t,
}: {
  ownerId: string;
  ownerName: string;
  /** بيانات المحفظة المساعدة لصاحبها — الأرباع والملاحظات */
  extras: Record<string, Rec>;
  t: T;
}) {
  const [items, setItems] = useState<Record<MainSec, MineRow[]>>({ natstrat: [], inststrat: [], cx: [] });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      const [en, ...secs] = await Promise.all([
        apiFetch("/api/entities").then((r) => r.json()).catch(() => ({})),
        ...(["natstrat", "inststrat", "cx"] as MainSec[]).map((k) =>
          apiFetch(`/api/items?section=${k}`).then((r) => r.json()).catch(() => ({})),
        ),
      ]);
      if (!live) return;
      const names = new Set<string>();
      for (const e of (Array.isArray(en.entities) ? en.entities : []) as Rec[]) {
        const ours = (Array.isArray(e.ours) ? e.ours : []) as Rec[];
        if (ours.some((c) => String(c.userId || "") === ownerId && txt(c.role || "أساسي") === "أساسي"))
          names.add(nrm(txt(e.name)));
      }
      const out = { natstrat: [], inststrat: [], cx: [] } as Record<MainSec, MineRow[]>;
      (["natstrat", "inststrat", "cx"] as MainSec[]).forEach((k, i) => {
        const all = (Array.isArray(secs[i]?.items) ? secs[i].items : []) as MineRow[];
        out[k] = all.filter((it) => {
          const c = txt(it.data.consultant).trim();
          if (c && nrm(c) === nrm(ownerName)) return true;
          return names.has(nrm(txt(it.data[MAIN_ENT[k]])));
        });
      });
      setItems(out);
      setLoaded(true);
    })();
    return () => {
      live = false;
    };
  }, [ownerId, ownerName]);

  if (!loaded) return null;
  const any = (["natstrat", "inststrat", "cx"] as MainSec[]).some((k) => items[k].length);
  if (!any) return null;

  return (
    <>
      {(["natstrat", "inststrat", "cx"] as MainSec[]).map((k) =>
        items[k].length ? (
          <div className="sh-sec" key={k}>
            <h3>
              {t(WIDGETS.find((w) => w.key === k)?.label || k, k)} <b>{items[k].length}</b>
            </h3>
            <div className="tblwrap">
              <table>
                <thead>
                  <tr>
                    <th>{t("البند", "Item")}</th>
                    {MAIN_FIELDS[k].slice(0, 4).map((f) => (
                      <th key={f.k}>{f.label}</th>
                    ))}
                    <th>{t("الأرباع", "Quarters")}</th>
                    <th>{t("ملاحظات", "Notes")}</th>
                  </tr>
                </thead>
                <tbody>
                  {items[k].map((it) => {
                    const ex = extras[`${k}:${it.id}`] || {};
                    const q = qOf(ex, YR_NOW);
                    return (
                      <tr key={it.id}>
                        <td>{txt(it.data[MAIN_TITLE[k]]) || txt(it.data[MAIN_ENT[k]]) || "—"}</td>
                        {MAIN_FIELDS[k].slice(0, 4).map((f) => (
                          <td key={f.k}>{txt(it.data[f.k]) || "—"}</td>
                        ))}
                        <td>{q.some(Boolean) ? q.map((v, i) => (v ? `Q${i + 1}` : null)).filter(Boolean).join(" · ") : "—"}</td>
                        <td>{txt(ex.note) || "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : null,
      )}
    </>
  );
}

/* ---------------- محفظة شورِكت معي (اطّلاع فقط) ---------------- */
function SharedView({ owner, t, onBack }: { owner: Grant; t: T; onBack: () => void }) {
  const pf = usePortfolio(owner.userId);
  const bySection = useMemo(() => {
    const m: Record<string, Row[]> = {};
    for (const r of pf.rows) if (!SH_SKIP.has(r.section)) (m[r.section] = m[r.section] || []).push(r);
    return m;
  }, [pf.rows]);
  const extras = useMemo(() => {
    const m: Record<string, Rec> = {};
    for (const r of pf.rows) if (r.section === "mainx") m[r.id] = r.data;
    return m;
  }, [pf.rows]);

  const secLabel = (k: string) => SHARE_OPTS.find((o) => o.k === k)?.label || k;

  return (
    <div className="pf shared">
      <div className="sh-head">
        <button className="btn2" onClick={onBack}>
          ← {t("رجوع لمحفظتي", "Back")}
        </button>
        <div>
          <b>{owner.name}</b>
          {owner.jobTitle && <em>{owner.jobTitle}</em>}
        </div>
        <span className="sh-tag">{t("اطّلاع فقط", "Read only")}</span>
      </div>

      <SharedMain ownerId={owner.userId} ownerName={owner.name} extras={extras} t={t} />

      {!pf.loaded ? (
        <div className="pf-none">{t("جارٍ التحميل...", "Loading...")}</div>
      ) : !Object.keys(bySection).length ? (
        <div className="pf-none">{t("لا توجد بنودٌ أضافها في الأقسام المشتركة معك.", "Nothing shared yet.")}</div>
      ) : (
        Object.entries(bySection).map(([sec, rows]) => {
          const cols = COLS[sec] || [{ k: "name", label: "البند" }];
          return (
            <div className="sh-sec" key={sec}>
              <h3>
                {secLabel(sec)} <b>{rows.length}</b>
              </h3>
              <div className="tblwrap">
                <table>
                  <thead>
                    <tr>
                      {cols.map((c) => (
                        <th key={c.k}>{c.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id}>
                        {cols.map((c) => (
                          <td key={c.k}>{txt(r.data?.[c.k]) || "—"}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

/* ============================================================
   مشاركة جهاتي — الجزء الثاني من «منح صلاحية»
   ------------------------------------------------------------
   المنح نوعان مختلفان لا يُجمعان في آلية واحدة، فجُمعا في مكان
   واحد بدل نافذتين:

     · «من يرى محفظتي» — أقسامُ محفظتي الخاصة (مهامي، مساهماتي…)
       اطّلاعاً فقط ولأيّ زميل. بياناتها بياناتي وحدي.
     · «مشاركة جهاتي» — جهةٌ بعينها من سجلّ المركز، لبديلها وحده،
       اطّلاعاً **أو تعديلاً**. بياناتها بيانات المنصة لا محفظتي،
       فالتعديل فيها يصل صفحة القسم ويُنسب لمن حرّره.

   ولذلك بقيا آليتين: الأولى أقسامٌ بلا كتابة، والثانية جهةٌ
   بكتابة. المشترك هو المكان فقط.
   ============================================================ */
function EntShareBox({ t }: { t: T }) {
  const [reg, setReg] = useState<RegRow[]>([]);
  const load = useCallback(() => {
    void apiFetch("/api/entities/mine")
      .then((r) => r.json())
      .then((d) => setReg(Array.isArray(d.mine) ? (d.mine as RegRow[]) : []))
      .catch(() => setReg([]));
  }, []);
  useEffect(() => load(), [load]);

  /* جهاتي التي أنا أساسيُّها ولها زميلٌ آخر من المركز */
  const rows = useMemo(
    () =>
      reg
        .filter((x) => (x.myLevel || "primary") === "primary")
        .map((x) => ({
          x,
          alts: (x.ours || []).filter(
            (c) => c.id !== x.myContactId && (c as { userId?: number | string }).userId,
          ) as (Contact & { userId?: number | string })[],
        }))
        .filter((r) => r.alts.length > 0),
    [reg],
  );

  return (
    <>
      <div className="sec3">{t("مشاركة جهاتي مع بديلها", "Share my entities")}</div>
      <p className="gr-hint sm">
        {t(
          "جهةٌ بعينها لبديلها وحده — «اطّلاع فقط» يقرأ ولا يكتب، و«اطّلاع وتعديل» يحدّث صفحة القسم كما تحدّثها أنت ويُسجَّل باسمه. تُسحب متى شئت.",
          "Per entity, to its alternate only. View-only reads; edit writes to the section page under their name.",
        )}
      </p>
      {!rows.length ? (
        <div className="pf-none sm">
          {t(
            "لا توجد جهةٌ أنت أساسيُّها ولها زميلٌ آخر من المركز.",
            "No entity of yours has another Adaa contact.",
          )}
        </div>
      ) : (
        <div className="esh">
          {rows.map(({ x, alts }) => (
            <div className="esh-r" key={x.entityId}>
              <b>{x.name}</b>
              {alts.map((c) => (
                <ShareRow
                  key={c.id}
                  entityId={x.entityId}
                  c={c}
                  level={
                    (x.shares || []).find((s2) => String(s2.userId) === String(c.userId ?? ""))?.level || "none"
                  }
                  t={t}
                  onDone={load}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/* ---------------- نافذة التخصيص ---------------- */
const SWATCHES = [
  "#00584c", "#016b5f", "#1a9d5c", "#0f8a8a", "#2f7fd1", "#123a6b",
  "#7a5cd1", "#a24160", "#c9a020", "#e07a3a", "#4e615c", "#12211d",
];


/* ============================================================
   أهدافي السنوية — سبعة مؤشرات بأوزانها
   ------------------------------------------------------------
   الصفّ يعرض المؤشر ومستهدفه ووزنه والمحقّق ونسبته وشريطها، ثم
   سطراً يقول **من أين جاء الرقم**: من صفحة قسمٍ في المنصة أو
   بإدخالٍ يدوي. فلا رقمٌ بلا سند، ولا يُظنّ المحسوبُ مكتوباً.

   وما لا مصدر له بعد يُكتب رقمه في خانةٍ داخل صفّه — لا نافذةٍ
   ثانية: الهدف أمام عينه حين يكتب.
   ============================================================ */
function GoalsModal({
  rows,
  score,
  t,
  onClose,
  onSet,
}: {
  rows: GoalRow[];
  score: { pct: number | null; have: number; weight: number };
  t: T;
  onClose: () => void;
  onSet: (id: string, v: number | null) => void;
}) {
  /* أصناف خاصّة بهذه القائمة: `ok`/`nt` العامّة مستعملةٌ في
     المنصّة لأشياء أخرى، فالاشتراك فيها يجرّ تنسيقها معه */
  const tone = (p: number | null) =>
    p === null ? "gl-nt" : p >= 100 ? "gl-ok" : p >= 60 ? "gl-nw" : "gl-no";
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="m-h">
          <h3>{t("أهدافي السنوية", "My annual goals")}</h3>
          <button className="mx" onClick={onClose} aria-label="close">✕</button>
        </div>

        <div className="gl-sum">
          <div className="gl-big">
            <b>{score.pct === null ? "—" : `${score.pct}%`}</b>
            <span>{t("نسبة التحقيق المرجَّحة", "Weighted achievement")}</span>
          </div>
          <div className="gl-note">
            {score.pct === null
              ? t("لم يُرصد أي مؤشر بعد.", "Nothing measured yet.")
              : t(
                  `محسوبة على ${score.have} من ${rows.length} مؤشرات رُصدت، وزنها ${score.weight} من ${GOALS_WEIGHT}. والمؤشر الذي لم يُرصد لا يُحتسب صفراً.`,
                  `Over ${score.have}/${rows.length} measured KPIs (${score.weight}/${GOALS_WEIGHT} weight).`,
                )}
          </div>
        </div>

        <div className="gl-list">
          {rows.map((g, i) => (
            <div className={`gl-i ${tone(g.pct)}`} key={g.id}>
              <div className="gl-t">
                <span className="n">{i + 1}. {g.kpi}</span>
                <span className="w">{t("الوزن", "Weight")} {g.weight}</span>
              </div>
              <div className="gl-m">
                <em>
                  {t("المستهدف", "Target")} <b>{g.target}{g.unit === "%" ? "%" : ""}</b>
                </em>
                <em>
                  {t("المحقّق", "Achieved")}{" "}
                  {g.typed ? (
                    <input
                      type="number"
                      min={0}
                      max={g.target}
                      className="gl-in"
                      value={g.got === null ? "" : g.got}
                      placeholder="—"
                      onChange={(e) =>
                        onSet(g.id, e.target.value.trim() === "" ? null : Math.max(0, num(e.target.value)))
                      }
                    />
                  ) : (
                    <b>{g.got === null ? "—" : `${g.got}${g.unit === "%" ? "%" : ""}`}</b>
                  )}
                </em>
                <em className="p">{g.pct === null ? "—" : `${g.pct}%`}</em>
              </div>
              <div className="gl-bar">
                <i style={{ width: `${g.pct ?? 0}%` }} />
              </div>
              <div className="gl-src">{g.src}</div>
            </div>
          ))}
        </div>

        <p className="muted" style={{ fontSize: 11, lineHeight: 1.8 }}>
          {t(
            "الأهداف نفسها لكل موظفي الإدارة، وأوزانها من نظام الموارد البشرية. وما يُقرأ من المنصة يتحدّث وحده كلّما حدّثت صفحة قسمك — فلا تُدخله هنا.",
            "Same goals for everyone; platform-read values update themselves.",
          )}
        </p>

        <div className="m-f">
          <button className="btn btn-ghost" onClick={onClose}>{t("إغلاق", "Close")}</button>
        </div>
      </div>
    </div>
  );
}


function CustomModal({
  prefs,
  t,
  meId,
  leads,
  secOrder,
  onClose,
  onChange,
}: {
  prefs: Prefs;
  t: T;
  meId: string;
  /** مدراء القطاع الذين يطّلعون على المحفظة — يُعرَّف بهم هنا */
  leads: string[];
  secOrder: string[];
  onClose: () => void;
  onChange: (p: Partial<Prefs>) => void;
}) {
  const moveSec = (i: number, d: number) => {
    const a = [...secOrder];
    const j = i + d;
    if (j < 0 || j >= a.length) return;
    [a[i], a[j]] = [a[j], a[i]];
    onChange({ secOrder: a });
  };
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState("");

  async function upload(f: File) {
    if (f.size > 3 * 1024 * 1024) {
      setBusy(t("الصورة أكبر من 3 ميغابايت", "Image larger than 3MB"));
      return;
    }
    setBusy(t("جارٍ الرفع...", "Uploading..."));
    const ext = (f.name.split(".").pop() || "jpg").toLowerCase();
    const path = `${meId}/bg-${Date.now()}.${ext}`;
    const { error } = await sb().storage.from("portfolio").upload(path, f, { upsert: true });
    if (error) {
      setBusy(t("تعذّر الرفع — تأكد من تفعيل مساحة التخزين", "Upload failed"));
      return;
    }
    const { data } = sb().storage.from("portfolio").getPublicUrl(path);
    onChange({ bg: data.publicUrl });
    setBusy("");
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="m-h">
          <h3>{t("تخصيص محفظتي", "Customize")}</h3>
          <button className="mx" onClick={onClose} aria-label="close">
            ✕
          </button>
        </div>

        <div className="sec3">{t("لون الصفحة", "Page color")}</div>
        <div className="sws">
          {SWATCHES.map((c) => (
            <span
              key={c}
              className={`sw2 ${prefs.color.toLowerCase() === c ? "on" : ""}`}
              style={{ background: c }}
              onClick={() => onChange({ color: c })}
            />
          ))}
          <label className="more3" title={t("جميع الألوان", "All colors")}>
            <input type="color" value={prefs.color} onChange={(e) => onChange({ color: e.target.value })} />
          </label>
        </div>
        <div className="hexrow">
          <span>{t("أو اكتب الكود", "Or type the code")}</span>
          <input
            value={prefs.color}
            onChange={(e) => onChange({ color: e.target.value })}
            spellCheck={false}
          />
          <span className="sw2 sm" style={{ background: prefs.color }} />
        </div>

        <div className="sec3">{t("خلفية الصفحة", "Background")}</div>
        <div className="drop" onClick={() => file.current?.click()}>
          <b>{t("اضغط لاختيار صورة من جهازك", "Choose an image")}</b>
          {t("PNG · JPG — الحد 3 ميغابايت", "PNG · JPG — max 3MB")}
        </div>
        <input
          ref={file}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
          }}
        />
        {busy && <div className="pf-hint">{busy}</div>}
        {prefs.bg && (
          <>
            <div className="bgprev">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={prefs.bg} alt="" className="p on" />
              <span className="p none" onClick={() => onChange({ bg: "" })}>
                {t("بلا خلفية", "None")}
              </span>
            </div>
            <div className="rng">
              <span>{t("تعتيم الخلفية", "Dim")}</span>
              <input
                type="range"
                min={0}
                max={80}
                value={prefs.bgDim}
                onChange={(e) => onChange({ bgDim: Number(e.target.value) })}
              />
              <b>{prefs.bgDim}%</b>
            </div>
          </>
        )}

        <div className="sec3">{t("شكل العرض", "View")}</div>
        <div className="viewtog in-modal">
          <span className={prefs.mode === "tiles" ? "on" : ""} onClick={() => onChange({ mode: "tiles" })}>
            ◫ {t("بطاقات", "Tiles")}
          </span>
          <span className={prefs.mode === "table" ? "on" : ""} onClick={() => onChange({ mode: "table" })}>
            ▤ {t("جداول", "Tables")}
          </span>
        </div>

        {/* ترتيب الأقسام — لكلٍّ ترتيبُه: هذا يبدأ بتقويمه
            وملاحظاته، وذاك يبدأ بأعماله ويُنزلهما آخراً */}
        <div className="sec3">{t("ترتيب الأقسام", "Section order")}</div>
        <div className="secord">
          {secOrder.map((id, i) => (
            <div className="r" key={id}>
              <b>{i + 1}</b>
              <span>{SEC_LABEL[id] || id}</span>
              <button disabled={i === 0} onClick={() => moveSec(i, -1)} title={t("أعلى", "Up")}>▲</button>
              <button disabled={i === secOrder.length - 1} onClick={() => moveSec(i, 1)} title={t("أسفل", "Down")}>▼</button>
            </div>
          ))}
          <button className="rst" onClick={() => onChange({ secOrder: SEC_ALL })}>
            ↺ {t("الترتيب الافتراضي للأقسام", "Reset sections")}
          </button>
        </div>

        <div className="sec3">{t("البنود الظاهرة", "Visible items")}</div>
        <div className="pf-arr in-modal">
          {WIDGETS.map((w) => {
            const on = !prefs.hidden.includes(w.key);
            return (
              <span
                key={w.key}
                className={`b ${on ? "on" : ""}`}
                onClick={() =>
                  onChange({
                    hidden: on ? [...prefs.hidden, w.key] : prefs.hidden.filter((x) => x !== w.key),
                  })
                }
              >
                {w.label} {on ? "✓" : "+"}
              </span>
            );
          })}
        </div>
        <div className="secord-f">
          <button className="rst" onClick={() => onChange({ hidden: [] })}>
            ↺ {t("إظهار كل البنود", "Show all")}
          </button>
        </div>

        {/* من يرى محفظتي: التعريف بمن يطّلع، ثم المنح */}
        <div className="sec3">{t("من يرى محفظتي", "Who sees my portfolio")}</div>
        <div className="seenby">
          {leads.length ? (
            <>
              <b>{t("مدير قطاعك يطّلع على أعمال محفظتك", "Your manager can view your portfolio")}</b>
              <em>
                {t(
                  `${leads.join(" · ")} — اطّلاع فقط، ولا يستطيع التعديل. وملاحظاتك وتقويمك لا يراهما أحد.`,
                  `${leads.join(" · ")} — read only. Your notes and calendar stay private.`,
                )}
              </em>
            </>
          ) : (
            <em>{t("لا أحد يطّلع على محفظتك إلا بمنحٍ منك.", "Nobody sees it unless you grant access.")}</em>
          )}
        </div>
        <GrantsBox prefs={prefs} meId={meId} t={t} />
        <EntShareBox t={t} />

        <div className="sec3">{t("قالب الترتيب", "Layout")}</div>
        <div className="lays">
          {(
            [
              ["two", "عمودان مضغوطان", "الأكثر توازناً — بلا فراغات"],
              ["one", "عمود واحد عريض", "أوضح للقراءة والطباعة"],
              ["three", "ثلاثة أعمدة", "للشاشات العريضة"],
              ["main", "رئيسي وجانبي", "بند عريض وآخر جانبه"],
            ] as const
          ).map(([k, n, d]) => (
            <div key={k} className={`lay ${prefs.layout === k ? "on" : ""}`} onClick={() => onChange({ layout: k })}>
              <div className={`wf wf-${k}`}>
                <i />
                <i />
                <i />
              </div>
              <div className="nm2">{n}</div>
              <div className="ds">{d}</div>
            </div>
          ))}
        </div>

        <div className="m-f">
          <button
            className="btn btn-ghost"
            onClick={() =>
              onChange({ color: DEFAULT_PREFS.color, bg: "", bgDim: DEFAULT_PREFS.bgDim, layout: DEFAULT_PREFS.layout })
            }
          >
            {t("إعادة الافتراضي", "Reset")}
          </button>
          <button className="btn" onClick={onClose}>
            {t("تم", "Done")}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   الصفحة
   ============================================================ */
export default function Portfolio({
  me,
  t,
  onOpenNotes,
}: {
  me: Me;
  t: T;
  onOpenNotes: () => void;
}) {
  const pf = usePortfolio();
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [ready, setReady] = useState(false);
  const [custom, setCustom] = useState(false);
  const [ents, setEnts] = useState(false);
  /* صورة الموظف: يرفعها لنفسه، فتظهر هنا وفي «أعلى الاستشاريين
     التزاماً». تُخزَّن في مجلد avatars/ داخل سلّة الوثائق */
  const [photo, setPhoto] = useState("");
  const [photoBusy, setPhotoBusy] = useState(false);
  const photoRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    void apiFetch("/api/people").then((r) => r.json())
      .then((d) => {
        const mine = (Array.isArray(d.people) ? d.people : []).find(
          (u: Rec) => String(u.id) === String(me.id),
        );
        setPhoto(String(mine?.photoUrl || ""));
      })
      .catch(() => setPhoto(""));
  }, [me.id]);

  async function uploadPhoto(f: File) {
    if (!f.type.startsWith("image/")) return;
    setPhotoBusy(true);
    const ext = (f.name.split(".").pop() || "jpg").replace(/[^A-Za-z0-9]/g, "").toLowerCase();
    const key = `avatars/${me.id}-${Date.now()}.${ext || "jpg"}`;
    const up = await sb().storage.from("docs").upload(key, f, { upsert: true });
    if (up.error) {
      setPhotoBusy(false);
      alert(up.error.message);
      return;
    }
    const url = sb().storage.from("docs").getPublicUrl(key).data.publicUrl;
    const r = await apiFetch("/api/people/photo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: me.id, url }),
    }).then((x) => x.json()).catch(() => ({ error: "تعذّر الاتصال" }));
    setPhotoBusy(false);
    if (r?.error) { alert(r.error); return; }
    setPhoto(url);
  }
  const [open, setOpen] = useState<WKey | null>(null);
  const [drag, setDrag] = useState<WKey | null>(null);
  const [imp, setImp] = useState<string | null>(null);
  /* العدّاد يُستعمل في بطاقة المهام نفسها — والمربّع صار للأهداف */
  const [, setTaskCount] = useState<number | null>(null);
  const [goals, setGoals] = useState(false);
  const [addW, setAddW] = useState<string | null>(null);
  const [addSec, setAddSec] = useState(false);
  const [editJoin, setEditJoin] = useState(false);
  const [editLook, setEditLook] = useState<string | null>(null);
  /* محافظ منحني أصحابها الاطّلاع عليها */
  const [shared, setShared] = useState<Grant[]>([]);
  const [viewing, setViewing] = useState<Grant | null>(null);
  /* فريقي: موظفو قطاعي — للمدير وحده، وبحكم الإدارة لا بمنحٍ منهم */
  const [team, setTeam] = useState<TeamRow[]>([]);
  /* ومن يطّلع على محفظتي بحكم الإدارة — يُقال لصاحبها صراحةً */
  const [myLeads, setMyLeads] = useState<string[]>([]);

  useEffect(() => {
    void apiFetch("/api/portfolio/grants")
      .then((r) => r.json())
      .then((d) => setShared(Array.isArray(d.shared) ? d.shared : []))
      .catch(() => setShared([]));
    void apiFetch("/api/portfolio/team")
      .then((r) => r.json())
      .then((d) => setTeam(Array.isArray(d.team) ? d.team : []))
      .catch(() => setTeam([]));
    /* مدير قطاعي: من عُلِّم مديراً ويشاركني قطاعاً — ولستُ أنا */
    void apiFetch("/api/people")
      .then((r) => r.json())
      .then((d) => {
        const all = (d.people || []) as { id: string; name: string; isLead?: boolean; sectorIds?: string[] }[];
        const me2 = all.find((x) => String(x.id) === String(me.id));
        if (!me2 || me2.isLead) { setMyLeads([]); return; }
        const mine = new Set((me2.sectorIds || []).map(String));
        setMyLeads(
          all
            .filter((x) => x.isLead && String(x.id) !== String(me.id) && (x.sectorIds || []).some((k) => mine.has(String(k))))
            .map((x) => x.name),
        );
      })
      .catch(() => setMyLeads([]));
  }, [me.id]);

  useEffect(() => {
    void loadUserData<Partial<Prefs>>("portfolio", {}).then((d) => {
      const p = { ...DEFAULT_PREFS, ...(d || {}) } as Prefs & { v2?: boolean; v3?: boolean };
      /* ترحيل مرة واحدة: كان «مهامي» أول الصف، وصار التقويم
         والملاحظات فوقه — نصلح الترتيب المحفوظ ولا نمسّ بقيته */
      if (!p.v2) {
        const top = ["calendar", "notes", "tasks"];
        p.order = [...top.filter((k) => !p.hidden.includes(k)), ...p.order.filter((k) => !top.includes(k))];
        p.v2 = true;
        void saveUserData("portfolio", p);
      }
      /* ترحيل «الأعمال الرئيسية»: البنود الثلاثة الجديدة تُضاف إلى
         ترتيب من خصّص صفحته سابقاً، والقديمان يُخفيان ولا يُحذفان
         فتبقى بياناتهما ويُعادان من «تخصيص محفظتي» */
      if (!p.v3) {
        const add = ["natstrat", "inststrat", "cx"].filter((k) => !p.order.includes(k));
        p.order = [...p.order, ...add];
        p.hidden = [...new Set([...p.hidden, ...HIDE_V3])];
        p.v3 = true;
        void saveUserData("portfolio", p);
      }
      setPrefs(p);
      setReady(true);
    });
  }, []);

  /* أمر «رتّب صفحتي حسب الأهمية» من المساعد */
  useEffect(() => {
    const h = (e: Event) => {
      const list = (e as CustomEvent).detail as string[];
      if (!Array.isArray(list) || !list.length) return;
      setPrefs((old) => {
        const rest = old.order.filter((k) => !list.includes(k));
        const next = { ...old, order: [...list.filter((k) => old.order.includes(k) || true), ...rest] };
        void saveUserData("portfolio", next);
        return next;
      });
    };
    window.addEventListener("pf-reorder", h);
    return () => window.removeEventListener("pf-reorder", h);
  }, []);

  const patch = useCallback((p: Partial<Prefs>) => {
    setPrefs((old) => {
      const next = { ...old, ...p };
      void saveUserData("portfolio", next);
      return next;
    });
  }, []);

  /** أعمدة قسم: المعدَّلة إن وُجدت، وإلا الافتراضية */
  const colsOf = useCallback(
    (sec: string, base: string): Col[] => {
      const mine = prefs.cols?.[sec];
      return mine && mine.length ? mine : COLS[base] || COLS.custom;
    },
    [prefs.cols],
  );
  /** حفظ أعمدة قسم — null يعيده للافتراضي. لا يمسّ الصفوف */
  const setCols = useCallback(
    (sec: string, next: Col[] | null) => {
      setPrefs((old) => {
        const map = { ...(old.cols || {}) };
        if (next && next.length) map[sec] = next;
        else delete map[sec];
        const out = { ...old, cols: map };
        void saveUserData("portfolio", out);
        return out;
      });
    },
    [],
  );

  /* الترتيب: ما في الإعدادات أولاً ثم أي ويدجت جديدة */
  const allKeys = useMemo(
    () => [...WIDGETS.map((w) => w.key), ...prefs.custom.map((c) => c.key)],
    [prefs.custom],
  );
  const order = useMemo(() => {
    const known = prefs.order.filter((k) => allKeys.includes(k));
    const rest = allKeys.filter((k) => !known.includes(k));
    return [...known, ...rest].filter((k) => !prefs.hidden.includes(k));
  }, [prefs.order, prefs.hidden, allKeys]);

  const WMAP: Record<string, WDef> = useMemo(() => {
    const m: Record<string, WDef> = { ...BASE_MAP };
    for (const c of prefs.custom) m[c.key] = { key: c.key, label: c.label, group: c.group, icon: c.icon, color: c.color, section: c.key };
    for (const [k, v] of Object.entries(prefs.look || {})) {
      if (m[k]) m[k] = { ...m[k], ...(v.label ? { label: v.label } : {}), ...(v.icon ? { icon: v.icon } : {}), ...(v.color ? { color: v.color } : {}) };
    }
    return m;
  }, [prefs.custom, prefs.look]);

  const entities = pf.of("entities");
  /* جهات السجلّ المسندة إليّ — تُعدّ مع جهات المحفظة في كل رقم
     يظهر للمستخدم، فالعدد يوافق ما يراه داخل المربّع لا نصفه */
  const [reg, setReg] = useState<RegRow[]>([]);
  const loadReg = useCallback(() => {
    void apiFetch("/api/entities/mine").then((r) => r.json())
      .then((d) => setReg(Array.isArray(d.mine) ? (d.mine as RegRow[]) : []))
      .catch(() => setReg([]));
  }, []);
  useEffect(() => loadReg(), [loadReg]);
  const regNames = useMemo(() => reg.map((x) => String(x.name || "")), [reg]);
  const mw = useMineWork(reg, me.name || "");
  /* بيانات المحفظة الإضافية للأعمال الرئيسية — المفتاح `القسم:معرّف البند` */
  const mainx = useMemo(() => {
    const m: Record<string, Rec> = {};
    for (const r of pf.rows) if (r.section === "mainx") m[r.id] = r.data;
    return m;
  }, [pf.rows]);
  /* العدّ الموحَّد: جهات السجلّ + جهات المحفظة بلا تكرار الاسم */
  const entCount = useMemo(
    () =>
      new Set([
        ...entities.map((r) => String(r.data.name || "").trim()).filter(Boolean),
        ...regNames.map((x) => x.trim()).filter(Boolean),
      ]).size,
    [entities, regNames],
  );
  const contrib = pf.of("contrib");
  /* ما يخصّني في الخطة التشغيلية — راعياً أو مسؤولاً أو مساهماً */
  const [myContrib, setMyContrib] = useState<MyOp[]>([]);
  useEffect(() => {
    void apiFetch("/api/items?section=opplan")
      .then((r) => r.json())
      .then((d) => {
        const all = (Array.isArray(d.items) ? d.items : []) as { id: string; data: Rec }[];
        setMyContrib(myOpItems(all, me.name || ""));
      })
      .catch(() => setMyContrib([]));
  }, [me.name]);
  const changes = pf.of("changes");
  /* التزامي محسوبٌ من طلبات جهاتي في الجدول المركزي — بنفس حسبة
     «أعلى الاستشاريين التزاماً»، فالرقم واحد في المكانين. والبديل
     لا تُحتسب عليه طلبات الجهة */
  type MyChange = {
    code: string; owner: string; itemName: string; program?: string; category?: string;
    sla: number | null; workDays: number | null; status: string; firstSeen?: string; closedAt?: string;
  };
  const [myCommit, setMyCommit] = useState<CommitRow | null>(null);
  const [myChanges, setMyChanges] = useState<MyChange[]>([]);
  useEffect(() => {
    void (async () => {
      const [ch, en] = await Promise.all([
        apiFetch("/api/changes").then((r) => r.json()).catch(() => ({})),
        apiFetch("/api/entities").then((r) => r.json()).catch(() => ({})),
      ]);
      const list: MyChange[] = Array.isArray(ch.changes) ? ch.changes : [];
      const owners = ownerMap(Array.isArray(en.entities) ? en.entities : []);
      const rows = commitStats(list, owners);
      setMyCommit(rows.find((r) => nrm(r.name) === nrm(me.name)) || null);
      setMyChanges(list.filter((c) => nrm(owners.get(nrm(c.owner))?.name || "") === nrm(me.name)));
    })();
  }, [me.name]);
  /* سنةُ طلبات جهاتي المعروضة — الجارية افتراضاً، و«الكل» متاحة */
  const [crYr, setCrYr] = useState(String(YR_NOW));
  const reverse = pf.of("reverse");
  const workflow = pf.of("workflow");
  const projects = pf.of("projects");
  const devplan = pf.of("devplan");

  const dataOf = (k: WKey): Row[] =>
    k.startsWith("cw-")
      ? pf.of(k)
      : k === "strategies" || k === "quarterly"
      ? entities
      : k === "contrib"
        ? contrib
        : k === "changes"
          ? changes
          : k === "reverse"
            ? reverse
            : k === "workflow"
              ? workflow
              : k === "projects"
                ? projects
                : k === "devplan"
                  ? devplan
                  : [];

  /* عمود «الحالة» قد يتغيّر اسمه ومفتاحه إن اعتمد صاحب المحفظة
     أعمدة جدولٍ لصقه — فنبحث عنه بعنوانه قبل الرجوع للمفتاح الأصلي */
  const statusKeyOf = useCallback(
    (sec: string) => prefs.cols?.[sec]?.find((c) => c.label.includes("حالة"))?.k || "status",
    [prefs.cols],
  );
  const doneOf = (rows: Row[], sec = "") =>
    rows.filter((r) => ["مغلقة", "مكتمل", "مكتملة", "منجز"].includes(txt(r.data[statusKeyOf(sec)]))).length;

  const lateChanges = changes.filter((r) => txt(r.data.status) === "متأخر").length;
  const commit = changes.length ? Math.round(((changes.length - lateChanges) / changes.length) * 100) : 0;

  /* «نسبة التقارير الممتثلة لمعايير جودة الملاحظات» في الخطة
     التشغيلية — آخر ربعٍ رُصد فيه فعليّ */
  const [noteQ, setNoteQ] = useState<{ pct: number; q: string } | null>(null);
  useEffect(() => {
    void apiFetch("/api/items?section=opplan")
      .then((r) => r.json())
      .then((d) => {
        const rows = (Array.isArray(d.items) ? d.items : []) as { data: Rec }[];
        const it = rows.find((x) => /جودة\s*الملاحظات|جودة ملاحظات/.test(txt(x.data.name)));
        if (!it) return setNoteQ(null);
        const QN = ["الربع الأول", "الربع الثاني", "الربع الثالث", "الربع الرابع"];
        for (let i = 4; i >= 1; i--) {
          const v = it.data[`q${i}a`];
          if (v !== undefined && v !== null && String(v).trim() !== "")
            return setNoteQ({ pct: Math.round(num(v)), q: QN[i - 1] });
        }
        setNoteQ(null);
      })
      .catch(() => setNoteQ(null));
  }, []);
  const curQ = Math.floor(new Date().getMonth() / 3) + 1;
  const qLate = entities.filter((r) => {
    const q: number[] = Array.isArray(r.data.q) ? r.data.q : [];
    return !q[curQ - 1];
  }).length;

  /* ============================================================
     أهدافي السنوية — تُقرأ من المنصة نفسها
     ------------------------------------------------------------
     ما حدّثته في صفحة قسمي يصل إلى هدفي من غير إدخالٍ ثانٍ:
     جهةٌ صار قياسها مفعّلاً في «الاستراتيجيات المؤسسية» تُعدّ في
     مؤشرها، وقابلية القياس متوسطُ ما سجّلته لاستراتيجياتي
     المعتمدة. وما لا مصدر له بعد يُدخَل رقمه ويُحفظ في تفضيلاتي.

     والمؤشر الذي لم يُرصد يبقى «—» ولا يُحتسب صفراً: الرقم الذي
     لا سند له يُنقص النسبة بلا ذنب، فالأمانة أن يُقال كم رُصد.
     ============================================================ */
  const goalRows: GoalRow[] = useMemo(() => {
    const man = prefs.goals || {};
    const cap = (got: number, target: number) =>
      target > 0 ? Math.min(100, Math.round((got / target) * 100)) : null;

    const natDone = mw.mine.natstrat.filter((r) => num(r.data.stage, 1) === 4);
    const natMeas = natDone.length
      ? Math.round(natDone.reduce((a, r) => a + num(r.data.meas), 0) / natDone.length)
      : null;
    const instLive = mw.mine.inststrat.filter((r) => txt(r.data.live) === "مفعل").length;
    const cxDone = mw.mine.cx.filter((r) => num(r.data.counted) === 1).length;

    const devDone = devplan.filter((r) => txt(r.data.state) === "مكتملة").length;

    return ANNUAL_GOALS.map((g) => {
      let got: number | null = null;
      let typed = false;
      let src = g.how;
      switch (g.from) {
        case "inststrat":
          got = mw.loaded ? instLive : null;
          src = `${t("من صفحة الاستراتيجيات المؤسسية", "From institutional strategies")} · ${g.how}`;
          break;
        case "cx":
          got = mw.loaded ? cxDone : null;
          src = `${t("من صفحة تجربة المستفيد", "From CX page")} · ${g.how}`;
          break;
        case "natstrat":
          got = natMeas;
          src = `${t("من صفحة الاستراتيجيات الوطنية", "From national strategies")} · ${g.how}`;
          break;
        case "commit":
          got = myCommit ? myCommit.pct : null;
          src = `${t("من جدول طلبات التغيير", "From change requests")} · ${g.how}`;
          break;
        case "opplan":
          got = noteQ ? noteQ.pct : null;
          src = noteQ ? `${t("من الخطة التشغيلية", "From the operational plan")} · ${noteQ.q}` : g.how;
          break;
        /* خطتي التطويرية: ما اكتمل من جدارات الخطة. وقبل أن
           تُدخَل جدارةٌ واحدة لا رقم يُحسب، فتُفتح الخانة ليُكتب
           الرقم من نظام الموارد البشرية — ويُستغنى عنها أول ما
           تُضاف الجدارات */
        case "devplan":
          if (devplan.length) {
            got = Math.round((devDone / devplan.length) * 100);
            src = t(
              `من «خطتي التطويرية» · ${devDone} من ${devplan.length} جدارة مكتملة`,
              `From my development plan · ${devDone}/${devplan.length}`,
            );
          } else {
            got = man[g.id] === undefined ? null : num(man[g.id]);
            typed = true;
            src = t(
              "لم تُضف جدارات بعد — اكتب النسبة، أو أضف جداراتك في «خطتي التطويرية» فتُحسب وحدها",
              "No competencies yet — type the figure or add them to your plan",
            );
          }
          break;
        default:
          got = man[g.id] === undefined ? null : num(man[g.id]);
          typed = true;
          src = g.how;
      }
      return { ...g, got, typed, pct: got === null ? null : cap(got, g.target), src };
    });
  }, [mw.mine, mw.loaded, myCommit, noteQ, prefs.goals, devplan, t]);
  const goalScore = useMemo(() => goalsScore(goalRows), [goalRows]);
  /** رقمٌ يُدخله صاحب المحفظة لمؤشرٍ لا مصدر له */
  const setGoal = useCallback(
    (id: string, v: number | null) => {
      setPrefs((old) => {
        const m = { ...(old.goals || {}) };
        if (v === null) delete m[id];
        else m[id] = v;
        const out = { ...old, goals: m };
        void saveUserData("portfolio", out);
        return out;
      });
    },
    [],
  );

  function stat(k: WKey): { count: number; pct: number; sub: string; warn?: string; chips?: { k: string; v: number }[] } {
    const rows = dataOf(k);
    /* الأعمال الرئيسية تُقرأ من صفحات الأقسام لا من بنود المحفظة */
    if (k === "natstrat" || k === "inststrat" || k === "cx") {
      const mr = mw.mine[k];
      const chips = mainChips(k, mr);
      const done = chips[0]?.v || 0;
      return {
        count: mr.length,
        pct: mr.length ? Math.round((done / mr.length) * 100) : 0,
        sub: k === "natstrat" ? t("استراتيجية", "strategies") : t("جهة", "entities"),
        chips,
      };
    }
    switch (k) {
      case "strategies": {
        const tot = sumOf(entities.flatMap((r) => contribsOf(r.data)));
        return {
          count: entCount,
          pct: entCount ? 100 : 0,
          sub: `${tot.kpis} ${t("مؤشراً", "KPIs")} · ${tot.goals} ${t("هدفاً", "goals")} · ${tot.inits} ${t("مبادرة", "initiatives")}`,
        };
      }
      case "quarterly": {
        const total = entities.length * 4 || 1;
        const done = entities.reduce(
          (a, r) => a + (Array.isArray(r.data.q) ? r.data.q.filter(Boolean).length : 0),
          0,
        );
        return {
          count: entities.length,
          pct: Math.round((done / total) * 100),
          sub: `${t("الربع", "Q")} ${curQ}`,
          warn: qLate ? `${qLate} ${t("متأخرة", "late")}` : undefined,
        };
      }
      case "changes": {
        /* ما لم تُربط جهاتي بعد، يبقى المحسوب من بنود المحفظة */
        if (myCommit)
          return {
            count: myCommit.total,
            pct: myCommit.pct,
            sub: `${t("التزام", "On time")} ${myCommit.pct}%`,
            warn: myCommit.late ? `${myCommit.late} ${t("متأخرة", "late")}` : undefined,
          };
        return {
          count: changes.length,
          pct: commit,
          sub: `${t("التزام", "On time")} ${commit}%`,
          warn: lateChanges ? `${lateChanges} ${t("متأخرة", "late")}` : undefined,
        };
      }
      case "contrib": {
        /* العدّ من الخطة التشغيلية لا من المحفظة: المساهمة بندٌ
           هناك، والبنود المحلية القديمة تُعدّ منفصلةً حتى تُنقل */
        const n = (x: string) => myContrib.filter((d) => txt(d.data.kind) === x).length;
        const role = (x: string) => myContrib.filter((d) => d.roles.includes(x)).length;
        const late = myContrib.filter((d) => opStatus(d.data) === "متأخرة").length;
        return {
          count: myContrib.length,
          pct: 0,
          sub: myContrib.length
            ? `${role("راعي")} راعٍ · ${role("مسؤول")} مسؤول — ${n("kpi")} مؤشرات · ${n("init")} مبادرات · ${n("win")} مكاسب`
            : t("لا يخصّك بندٌ في الخطة بعد", "Nothing yet"),
          warn: late
            ? t(`${late} متأخرة`, `${late} late`)
            : rows.length
              ? t(`${rows.length} غير مربوطة`, `${rows.length} local`)
              : undefined,
        };
      }
      default: {
        const d = doneOf(rows, WMAP[k]?.section || "");
        return {
          count: rows.length,
          pct: rows.length ? Math.round((d / rows.length) * 100) : 0,
          sub: rows.length ? `${d} ${t("مكتملة", "done")}` : t("لا توجد بيانات", "No data"),
        };
      }
    }
  }

  /* جسم كل ويدجت */
  function bodyOf(k: WKey): ReactNode {
    const w = WMAP[k];
    if (!w) return null;
    const rows = dataOf(k);
    const sec = w.section || "";
    void sec;
    const save = (id: string, data: Rec) => void pf.save(sec, id, data, rows.length + 1);
    const del = (id: string) => {
      if (confirm(t("حذف هذا البند؟", "Delete?"))) void pf.remove(sec, id);
    };
    /* الأعمال الرئيسية — تُقرأ من صفحات الأقسام لا من نسخةٍ هنا */
    if (k === "natstrat" || k === "inststrat" || k === "cx")
      return (
        <MainWork
          sec={k}
          rows={mw.mine[k]}
          sess={mw.sess}
          loaded={mw.loaded}
          extras={mainx}
          canEdit={mw.canEdit}
          t={t}
          full={prefs.mode === "table" || open === k}
          onExtra={(key, data) => void pf.save("mainx", key, data, 1)}
          onPatch={mw.patch}
          onReload={mw.reload}
        />
      );
    if (k === "tasks") return <TasksWidget me={me} t={t} onCount={setTaskCount} />;
    if (k === "calendar") return <Cal t={t} meId={me.id} />;
    if (k === "notes") return <NotesWidget t={t} onOpen={onOpenNotes} />;
    if (k === "quarterly")
      return (
        <Quarterly
          rows={entities}
          t={t}
          onToggle={(r, i) => {
            const q: number[] = Array.isArray(r.data.q) ? [...r.data.q] : [0, 0, 0, 0];
            q[i] = q[i] ? 0 : 1;
            void pf.save("entities", r.id, { ...r.data, q }, r.ord);
          }}
        />
      );
    if (k === "strategies")
      return (
        <MyEntities
          rows={entities}
          t={t}
          onSave={(id, data) => void pf.save("entities", id, data, entities.length + 1)}
          onDelete={(id) => {
            if (confirm(t("حذف الجهة وكل مساهماتها؟", "Delete the entity and its contributions?")))
              void pf.remove("entities", id);
          }}
          onAdd={(data) => void pf.save("entities", "ent-" + newId(), data, entities.length + 1)}
        />
      );
    /* المساهمات تُعرض من الخطة دائماً — لا جدولاً محلياً عند فتحها */
    if (k === "contrib") return <Contrib rows={contrib} meName={me.name || ""} t={t} />;
    const base = k.startsWith("cw-") ? "custom" : sec;
    return (
      <>
        {k === "changes" && (
          <CrBox rows={myChanges} yr={crYr} setYr={setCrYr} t={t} />
        )}
        <SectionTable
        section={base}
        sectionKey={sec}
        rows={rows}
        cols={colsOf(sec, base)}
        custom={!!prefs.cols?.[sec]?.length}
        stamp={!prefs.noStamp?.[sec]}
        onStamp={(on) => {
          setPrefs((old) => {
            const map = { ...(old.noStamp || {}) };
            if (on) delete map[sec];
            else map[sec] = true;
            const out = { ...old, noStamp: map };
            void saveUserData("portfolio", out);
            return out;
          });
        }}
        t={t}
        onSave={save}
        onDelete={del}
        onImport={() => setImp(sec)}
        onCols={(next) => setCols(sec, next)}
      />
      </>
    );
  }

  /* بطاقة كاملة */
  function Card({ k, wide }: { k: WKey; wide?: boolean }) {
    const w = WMAP[k];
    const st = stat(k);
    /* بلا سحبٍ ولا وضعِ ترتيب — والتسمية والإخفاء يظهران عند
       المرور على البطاقة، فلا يحتاجان وضعاً خاصاً يُدخَل ويُخرَج */
    return (
      <div className={`card2 ${wide ? "wide" : ""}`}>
        <div className="ch">
          <span className="dot" style={{ background: w.color }}>
            <PIcon id={w.icon} size={13} />
          </span>
          <h3>{w.label}</h3>
          {["tasks", "calendar", "notes"].includes(k) ? null : <span className="n">{st.count}</span>}
          <span className="edit" title={t("تغيير الاسم والأيقونة", "Rename / icon")} onClick={() => setEditLook(k)}>
            ✎
          </span>
          <span className="hide" title={t("إخفاء", "Hide")} onClick={() => patch({ hidden: [...prefs.hidden, k] })}>
            ✕
          </span>
        </div>
        <div className="cb">{bodyOf(k)}</div>
      </div>
    );
  }

  function dropOn(target: WKey) {
    if (!drag || drag === target) return;
    const cur = [...order];
    const from = cur.indexOf(drag);
    const to = cur.indexOf(target);
    if (from < 0 || to < 0) return;
    cur.splice(to, 0, cur.splice(from, 1)[0]);
    patch({ order: [...cur, ...prefs.hidden] });
    setDrag(null);
  }

  const group = (g: string) => order.filter((k) => WMAP[k]?.group === g);
  /* ترتيب الأقسام: ما حفظه صاحب المحفظة، ثم ما استُجدّ منها بعده
     — فقسمٌ يُضاف في نسخةٍ لاحقة لا يختفي عمّن رتّب قبلها */
  const secOrder = useMemo(() => {
    const saved = (prefs.secOrder || []).filter((x) => SEC_ALL.includes(x));
    return [...saved, ...SEC_ALL.filter((x) => !saved.includes(x))];
  }, [prefs.secOrder]);

  function renderGroup(keys: WKey[], addTo?: string) {
    if (!keys.length && !addTo) return null;
    if (prefs.mode === "table" || prefs.layout === "one") {
      return (
        <div className="pf-one">
          {keys.map((k) => (
            <Card key={k} k={k} />
          ))}
          {addTo && (
            <button className="tile add wide" onClick={() => setAddW(addTo)}>
              <span className="pl">+</span>
              {t("إضافة بند", "Add item")}
            </button>
          )}
        </div>
      );
    }
    return (
      <div className={`tiles lay-${prefs.layout}`}>
        {keys.map((k) => {
          const w = WMAP[k];
          const st = stat(k);
          return (
            <Tile
              key={k}
              w={w}
              count={st.count}
              sub={st.sub}
              pct={st.pct}
              warn={st.warn}
              chips={st.chips}
              onOpen={() => setOpen(k)}
              onHide={() => patch({ hidden: [...prefs.hidden, k] })}
              onEdit={() => setEditLook(k)}
              dragProps={{}}
            />
          );
        })}
        {addTo && (
          <button className="tile add" onClick={() => setAddW(addTo)}>
            <span className="pl">+</span>
            {t("إضافة بند", "Add item")}
          </button>
        )}
      </div>
    );
  }

  if (viewing) return <SharedView owner={viewing} t={t} onBack={() => setViewing(null)} />;

  if (!ready || !pf.loaded) return <div className="empty">{t("جارٍ التحميل...", "Loading...")}</div>;

  const openW = open ? WMAP[open] : null;
  const style = { ["--pf" as string]: prefs.color } as React.CSSProperties;

  return (
    <div className={`pf ${prefs.bg ? "hasbg" : ""}`} style={style}>
      {prefs.bg && (
        <div
          className="pf-bg"
          style={{ backgroundImage: `url(${prefs.bg})`, ["--dim" as string]: `${prefs.bgDim / 100}` } as React.CSSProperties}
        />
      )}

      {shared.length > 0 && (
        <div className="pf-shared">
          <b>{t("محافظ شورِكت معي", "Shared with me")}</b>
          {shared.map((g) => (
            <button key={g.userId} onClick={() => setViewing(g)}>
              {g.name}
            </button>
          ))}
        </div>
      )}

      {/* «فريقي» — بحكم الإدارة لا بمنحٍ من أصحابها، فيُفصل عن
          الشريط أعلاه وتُوضع عليه شارته حتى لا يختلط البابان */}
      {team.length > 0 && (
        <div className="pf-team">
          <div className="pf-team-h">
            <b>{t("فريقي", "My team")}</b>
            <span className="pf-team-n">
              {t(`${team.length} من قطاعي`, `${team.length} in my sector`)}
            </span>
            <span className="pf-team-tag">{t("بحكم الإدارة · اطّلاع فقط", "As manager · read only")}</span>
          </div>
          <div className="pf-team-g">
            {team.map((x) => (
              <button
                key={x.userId}
                className={`pf-tm ${x.count === 0 ? "idle" : ""}`}
                onClick={() => setViewing({ userId: x.userId, name: x.name, jobTitle: x.jobTitle, scopes: ["*"] })}
              >
                <span className="av">{(x.name || "?").trim().charAt(0)}</span>
                <span className="tm-w">
                  <b>{x.name}</b>
                  {x.jobTitle && <em>{x.jobTitle}</em>}
                </span>
                <span className="tm-m">
                  {x.count === 0
                    ? t("لا بنود بعد", "Nothing yet")
                    : t(`${x.count} بنداً · آخر تحديث ${whenAr(x.lastAt)}`, `${x.count} items · ${whenAr(x.lastAt)}`)}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="pf-hero">
        <button
          className="av"
          title={t("تغيير صورتي", "Change my photo")}
          onClick={() => photoRef.current?.click()}
          disabled={photoBusy}
        >
          {photo ? <img src={photo} alt="" /> : (me.name || "?").trim().charAt(0)}
          <span className="cam">{photoBusy ? "…" : "✎"}</span>
        </button>
        <input
          ref={photoRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void uploadPhoto(f);
            e.target.value = "";
          }}
        />
        <div className="who">
          <h1>{me.name}</h1>
          <div className="sb">{me.jobTitle || t("عضو فريق إدارة عمليات الأداء", "Team member")}</div>
          {editJoin ? (
            <div className="joinedit">
              <input
                type="date"
                autoFocus
                defaultValue={prefs.joined}
                onChange={(e) => patch({ joined: e.target.value })}
                onBlur={() => setEditJoin(false)}
              />
              <button className="btn2" onClick={() => setEditJoin(false)}>
                {t("تم", "Done")}
              </button>
            </div>
          ) : (
            <button className="joined" onClick={() => setEditJoin(true)}>
              {prefs.joined ? (
                <>
                  {t("أدائي منذ", "At Adaa since")} <b>{prefs.joined}</b>
                  <em>{sinceLabel(prefs.joined)}</em>
                </>
              ) : (
                <>+ {t("أضف تاريخ انضمامك لأداء", "Add your join date")}</>
              )}
            </button>
          )}
        </div>
        {/* زرٌّ واحد في الرأس: العرض والترتيب وإظهار البنود كلها
            صارت داخل «تخصيص» — والرأس لا يحتمل شريط أدوات.
            و«تم الترتيب» يظهر وقت السحب وحده ليُخرَج منه. */}
        <div className="acts">
          <button className="btn2 solid" onClick={() => setCustom(true)}>
            <IconGear size={15} /> {t("تخصيص", "Customize")}
          </button>
        </div>
      </div>

      {/* المربّعات الأربعة: عنوانٌ ورقم بلا شرحٍ تحتهما — بطلب
          صاحبة المنصة. وما كان في الشرح من تفصيلٍ (كم مؤشراً رُصد،
          من أين الرقم) موضعُه النافذة التي يفتحها المربّع. */}
      <div className="kpis">
        {/* أهدافي السنوية بدل «مهامي المفتوحة»: المهام لها بطاقتها
            في الأعلى، وهذا رقمٌ لا يُرى في مكانٍ آخر */}
        <div className="kp clickable" onClick={() => setGoals(true)}>
          <div className="k">{t("نسبة تحقيق الأهداف السنوية", "Annual goals")}</div>
          <div className="v">{goalScore.pct === null ? "—" : `${goalScore.pct}%`}</div>
        </div>
        <div className="kp clickable" onClick={() => setEnts(true)}>
          <div className="k">{t("الجهات المسندة لي", "My entities")}</div>
          <div className="v">{entCount}</div>
        </div>
        <div className="kp">
          <div className="k">{t("نسبة الالتزام بمراجعة طلبات التغيير", "Change requests on-time rate")}</div>
          <div className="v">
            {myCommit ? `${myCommit.pct}%` : changes.length ? `${commit}%` : "—"}
          </div>
        </div>
        {/* جودة ملاحظات الأداء: لا يُرصد فردياً بعد، فالرقم رقم
            الإدارة من مؤشر الخطة التشغيلية */}
        <div className="kp">
          <div className="k">{t("نسبة الالتزام بجودة ملاحظات الأداء", "Notes quality")}</div>
          <div className="v">{noteQ ? `${noteQ.pct}%` : "—"}</div>
        </div>
      </div>

      {/* ترتيب الأقسام من تفضيلات صاحب المحفظة لا من `GROUPS`:
          هذا يبدأ بتقويمه وملاحظاته، وذاك يبدأ بأعماله. والمجموعة
          الفارغة لا يُرسم عنوانها فلا يبقى عنوانٌ تحته فراغ. */}
      {secOrder.map((id) =>
        id === "top" ? (
          group("top").length ? (
            <div
              key="top"
              className={`pf-top ${prefs.mode === "table" || prefs.layout === "one" ? "one" : ""}`}
            >
              {group("top").map((k) => (
                <Card key={k} k={k} wide={k === "tasks"} />
              ))}
            </div>
          ) : null
        ) : group(id).length ? (
          <div key={id}>
            <div className="sect">
              <h2>{t(GMAP[id]?.label[0] || id, GMAP[id]?.label[1] || id)}</h2>
              <span className="ln" />
            </div>
            {renderGroup(group(id), id)}
          </div>
        ) : null,
      )}

      {prefs.sections.map((sc) => (
        <div key={sc.id}>
          <div className="sect">
            <h2>{sc.label}</h2>
            <span className="ln" />
            <button
              className="secx"
              title={t("حذف القسم", "Delete section")}
              onClick={() => {
                if (!confirm(t("حذف هذا القسم؟ بنوده تنتقل للأعمال التشغيلية.", "Delete section?"))) return;
                patch({
                  sections: prefs.sections.filter((x) => x.id !== sc.id),
                  custom: prefs.custom.map((c) => (c.group === sc.id ? { ...c, group: "ops" } : c)),
                });
              }}
            >
              ✕
            </button>
          </div>
          {renderGroup(group(sc.id), sc.id)}
        </div>
      ))}

      <button className="pf-addsec" onClick={() => setAddSec(true)}>
        + {t("إضافة قسم جديد", "Add a section")}
      </button>

      {openW && (
        <div className="modal-overlay" onClick={() => setOpen(null)}>
          {/* الأعمال الرئيسية بطاقاتٌ في عمودين، فتحتاج عرضاً أكبر */}
          <div className={`modal ${openW.group === "main" ? "xwide" : "wide"}`} onClick={(e) => e.stopPropagation()}>
            <div className="m-h">
              <span className="dot" style={{ background: openW.color }}>
                <PIcon id={openW.icon} size={13} />
              </span>
              <h3>{openW.label}</h3>
              <button className="mx" onClick={() => setOpen(null)} aria-label="close">
                ✕
              </button>
            </div>
            <div>{bodyOf(openW.key)}</div>
          </div>
        </div>
      )}

      {ents && (
        <EntitiesModal
          rows={entities}
          reg={reg}
          t={t}
          onReload={loadReg}
          onClose={() => setEnts(false)}
          onSave={(id, data) => void pf.save("entities", id, data, entities.length + 1)}
          onDelete={(id) => {
            if (confirm(t("حذف الجهة وكل ما يتعلق بها في محفظتك؟", "Delete entity?"))) void pf.remove("entities", id);
          }}
        />
      )}

      {goals && (
        <GoalsModal
          rows={goalRows}
          score={goalScore}
          t={t}
          onClose={() => setGoals(false)}
          onSet={setGoal}
        />
      )}

      {custom && (
        <CustomModal
          prefs={prefs}
          t={t}
          meId={me.id}
          leads={myLeads}
          secOrder={secOrder}
          onClose={() => setCustom(false)}
          onChange={patch}
        />
      )}

      {addW && (
        <AddWidget
          t={t}
          onClose={() => setAddW(null)}
          onAdd={(label, icon, color) => {
            const key = "cw-" + newId();
            patch({
              custom: [...prefs.custom, { key, label, icon, color, group: addW }],
              order: [...order, key, ...prefs.hidden],
            });
            setAddW(null);
          }}
        />
      )}

      {editLook && WMAP[editLook] && (
        <EditLook
          t={t}
          w={WMAP[editLook]}
          custom={editLook.startsWith("cw-")}
          onClose={() => setEditLook(null)}
          onSave={(label, icon, color) => {
            if (editLook.startsWith("cw-")) {
              patch({
                custom: prefs.custom.map((c) => (c.key === editLook ? { ...c, label, icon, color } : c)),
              });
            } else {
              patch({ look: { ...prefs.look, [editLook]: { label, icon, color } } });
            }
            setEditLook(null);
          }}
          onReset={() => {
            const nx = { ...prefs.look };
            delete nx[editLook];
            patch({ look: nx });
            setEditLook(null);
          }}
          onDelete={
            editLook.startsWith("cw-")
              ? () => {
                  if (!confirm(t("حذف هذا البند وبياناته؟", "Delete item and its data?"))) return;
                  patch({
                    custom: prefs.custom.filter((c) => c.key !== editLook),
                    order: prefs.order.filter((k) => k !== editLook),
                  });
                  setEditLook(null);
                }
              : undefined
          }
        />
      )}

      {addSec && (
        <AddSection
          t={t}
          onClose={() => setAddSec(false)}
          onAdd={(label) => {
            patch({ sections: [...prefs.sections, { id: "sec-" + newId(), label }] });
            setAddSec(false);
          }}
        />
      )}

      {imp && (
        <ImportModal
          section={imp}
          cols={colsOf(imp, imp.startsWith("cw-") ? "custom" : imp)}
          t={t}
          onClose={() => setImp(null)}
          onRows={async (items, newCols) => {
            /* «اعتمد أعمدة المُلصَق»: الأعمدة أولاً ثم الصفوف بمفاتيحها */
            if (newCols) setCols(imp, newCols);
            /* المرفوع يُختم بتاريخ اليوم كالمُدخَل يدوياً — إلا ما جاء مختوماً */
            const day = todayISO();
            await pf.saveMany(
              items.map((d, i) => ({
                section: imp,
                data: txt(d[ADDED]) ? d : { ...d, [ADDED]: day },
                ord: 100 + i,
              })),
            );
            setImp(null);
          }}
        />
      )}
    </div>
  );
}

/* ---------------- رفع إكسل / لصق ---------------- */
function ImportModal({
  section,
  cols,
  t,
  onClose,
  onRows,
}: {
  section: string;
  /** أعمدة الجدول الحالية — إليها تُطابَق الأعمدة المرفوعة */
  cols: Col[];
  t: T;
  onClose: () => void;
  /** الصفوف، ومعها أعمدةٌ جديدة إن اختار اعتماد أعمدة المُلصَق */
  onRows: (rows: Rec[], cols?: Col[]) => void;
}) {
  void section;
  /* «طابق الأعمدة» يضع الملصق في أعمدة الجدول الحالية،
     و«اعتمد أعمدة المُلصَق» يجعل الجدول بأعمدته هو */
  const [adopt, setAdopt] = useState(false);
  const [aoa, setAoa] = useState<string[][]>([]);
  const [map, setMap] = useState<Record<string, number>>({});
  const [head, setHead] = useState(true);
  const [err, setErr] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const [paste, setPaste] = useState("");

  function useAoa(rows: string[][]) {
    const clean = rows.filter((r) => r.some((c) => txt(c).trim()));
    setAoa(clean);
    const first = clean[0] || [];
    const m: Record<string, number> = {};
    cols.forEach((c) => {
      const i = first.findIndex((h) => txt(h).trim() === c.label);
      m[c.k] = i;
    });
    setMap(m);
  }

  async function onFile(f: File) {
    try {
      const { readXlsx } = await import("@/lib/sheet");
      const rows = await readXlsx(await f.arrayBuffer());
      useAoa(rows.map((r) => r.map((c) => txt(c))));
    } catch {
      setErr(t("تعذّرت قراءة الملف", "Could not read the file"));
    }
  }

  const body = head ? aoa.slice(1) : aoa;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="m-h">
          <h3>{t("رفع بيانات", "Import data")}</h3>
          <button className="mx" onClick={onClose} aria-label="close">
            ✕
          </button>
        </div>

        {!aoa.length ? (
          <>
            <div className="drop" onClick={() => file.current?.click()}>
              <b>{t("اختر ملف إكسل", "Choose an Excel file")}</b>
              {t("xlsx — تُقرأ آخر ورقة", "xlsx")}
            </div>
            <input
              ref={file}
              type="file"
              accept=".xlsx"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onFile(f);
              }}
            />
            <div className="sec3">{t("أو الصق الجدول هنا", "Or paste a table")}</div>
            <textarea
              rows={5}
              className="pf-paste"
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              placeholder={t("انسخ من إكسل والصق هنا…", "Paste from Excel…")}
            />
            <div className="m-f">
              <button className="btn btn-ghost" onClick={onClose}>
                {t("إلغاء", "Cancel")}
              </button>
              <button
                className="btn"
                onClick={() => useAoa(paste.split(/\r?\n/).map((l) => l.split("\t")))}
                disabled={!paste.trim()}
              >
                {t("متابعة", "Continue")}
              </button>
            </div>
          </>
        ) : (
          <>
            <label className="pf-ck">
              <input type="checkbox" checked={head} onChange={(e) => setHead(e.target.checked)} />
              <span>{t("الصف الأول عناوين", "First row is a header")}</span>
            </label>
            <div className="pf-way">
              <label>
                <input type="radio" checked={!adopt} onChange={() => setAdopt(false)} />
                <span>{t("ضَعْه في أعمدة الجدول الحالية", "Map into the current columns")}</span>
              </label>
              <label>
                <input type="radio" checked={adopt} onChange={() => setAdopt(true)} disabled={!head} />
                <span>{t("اجعل الجدول بأعمدة المُلصَق", "Adopt the pasted table's columns")}</span>
              </label>
            </div>
            {adopt ? (
              <>
                <div className="sec3">{t("أعمدة الجدول بعد الحفظ", "Columns after saving")}</div>
                <div className="pf-tw">
                  <table className="pf-t">
                    <thead>
                      <tr>
                        {(aoa[0] || []).map((h, i) => (
                          <th key={i}>{txt(h).trim() || `عمود ${i + 1}`}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {body.slice(0, 3).map((r, i) => (
                        <tr key={i}>
                          {(aoa[0] || []).map((_, j) => (
                            <td key={j}>{txt(r[j]) || "—"}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="pf-hint">
                  {(aoa[0] || []).length} {t("عموداً", "columns")} · {body.length} {t("صفاً", "rows")} —{" "}
                  {t(
                    "الصفوف القديمة تبقى محفوظة، لكن قيمها لا تظهر تحت الأعمدة الجديدة.",
                    "Existing rows are kept, but their values will not show under the new columns.",
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="sec3">{t("طابق الأعمدة", "Map the columns")}</div>
                <div className="pf-map">
                  {cols.map((c) => (
                    <label key={c.k}>
                      <span>{c.label}</span>
                      <select
                        value={map[c.k] ?? -1}
                        onChange={(e) => setMap({ ...map, [c.k]: Number(e.target.value) })}
                      >
                        <option value={-1}>{t("— تجاهل —", "— skip —")}</option>
                        {(aoa[0] || []).map((h, i) => (
                          <option key={i} value={i}>
                            {head ? txt(h) || `عمود ${i + 1}` : `عمود ${i + 1}`}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
                <div className="pf-hint">
                  {body.length} {t("صف سيُضاف", "rows will be added")}
                </div>
              </>
            )}
            {err && <div className="alert alert-error">{err}</div>}
            <div className="m-f">
              <button className="btn btn-ghost" onClick={() => setAoa([])}>
                {t("رجوع", "Back")}
              </button>
              <button
                className="btn"
                onClick={() => {
                  if (adopt) {
                    const nc = colsFromHead(aoa[0] || []);
                    onRows(
                      body.map((r) => {
                        const o: Rec = {};
                        nc.forEach((c, i) => {
                          o[c.k] = txt(r[i]).trim();
                        });
                        return o;
                      }),
                      nc,
                    );
                    return;
                  }
                  onRows(
                    body.map((r) => {
                      const o: Rec = {};
                      cols.forEach((c) => {
                        const i = map[c.k];
                        if (i >= 0) o[c.k] = txt(r[i]).trim();
                      });
                      return o;
                    }),
                  );
                }}
              >
                {adopt ? t("اعتمد الأعمدة وأضف الصفوف", "Adopt columns & add rows") : t("إضافة الصفوف", "Add rows")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ---------------- إضافة بند تشغيلي جديد ---------------- */
function AddWidget({
  t,
  onClose,
  onAdd,
}: {
  t: T;
  onClose: () => void;
  onAdd: (label: string, icon: string, color: string) => void;
}) {
  const [label, setLabel] = useState("");
  const [icon, setIcon] = useState("target");
  const [color, setColor] = useState(CCOLORS[0]);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="m-h">
          <h3>{t("بند جديد", "New item")}</h3>
          <button className="mx" onClick={onClose} aria-label="close">
            ✕
          </button>
        </div>
        <div className="sx-form">
          <label>
            <span>{t("اسم البند", "Name")}</span>
            <input autoFocus value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t("مثال: طلبات الدعم", "e.g. Support requests")} />
          </label>
        </div>
        <div className="sec3">{t("الأيقونة", "Icon")}</div>
        <IconPicker value={icon} onPick={setIcon} t={t} />
        <div className="sec3">{t("اللون", "Color")}</div>
        <div className="sws">
          {CCOLORS.map((c) => (
            <span key={c} className={`sw2 ${color === c ? "on" : ""}`} style={{ background: c }} onClick={() => setColor(c)} />
          ))}
        </div>
        <div className="pf-hint">
          {t("يُنشأ له جدول بأعمدة: البند · الحالة · النسبة · ملاحظة · التاريخ.", "A table is created for it.")}
        </div>
        <div className="m-f">
          <button className="btn btn-ghost" onClick={onClose}>
            {t("إلغاء", "Cancel")}
          </button>
          <button className="btn" disabled={!label.trim()} onClick={() => onAdd(label.trim(), icon, color)}>
            {t("إضافة", "Add")}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- إضافة قسم ---------------- */
function AddSection({ t, onClose, onAdd }: { t: T; onClose: () => void; onAdd: (label: string) => void }) {
  const [label, setLabel] = useState("");
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="m-h">
          <h3>{t("قسم جديد", "New section")}</h3>
          <button className="mx" onClick={onClose} aria-label="close">
            ✕
          </button>
        </div>
        <div className="sx-form">
          <label>
            <span>{t("اسم القسم", "Section name")}</span>
            <input autoFocus value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t("مثال: أعمال المبادرات", "e.g. Initiatives")} />
          </label>
        </div>
        <div className="pf-hint">{t("يظهر تحت الأعمال التشغيلية، وتضيف بنوده من زر «+» داخله.", "Appears below operational work.")}</div>
        <div className="m-f">
          <button className="btn btn-ghost" onClick={onClose}>
            {t("إلغاء", "Cancel")}
          </button>
          <button className="btn" disabled={!label.trim()} onClick={() => onAdd(label.trim())}>
            {t("إضافة", "Add")}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- تغيير اسم البند وأيقونته ولونه ---------------- */
function EditLook({
  t,
  w,
  custom,
  onClose,
  onSave,
  onReset,
  onDelete,
}: {
  t: T;
  w: WDef;
  custom: boolean;
  onClose: () => void;
  onSave: (label: string, icon: string, color: string) => void;
  onReset: () => void;
  onDelete?: () => void;
}) {
  const [label, setLabel] = useState(w.label);
  const [icon, setIcon] = useState(w.icon);
  const [color, setColor] = useState(w.color);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="m-h">
          <h3>{t("تعديل البند", "Edit item")}</h3>
          <button className="mx" onClick={onClose} aria-label="close">
            ✕
          </button>
        </div>
        <div className="sx-form">
          <label>
            <span>{t("الاسم", "Name")}</span>
            <input value={label} onChange={(e) => setLabel(e.target.value)} />
          </label>
        </div>
        <div className="sec3">{t("الأيقونة", "Icon")}</div>
        <IconPicker value={icon} onPick={setIcon} t={t} />
        <div className="sec3">{t("اللون", "Color")}</div>
        <div className="sws">
          {CCOLORS.map((c) => (
            <span key={c} className={`sw2 ${color === c ? "on" : ""}`} style={{ background: c }} onClick={() => setColor(c)} />
          ))}
          <label className="more3">
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
          </label>
        </div>
        <div className="m-f">
          {onDelete && (
            <button className="btn btn-danger" onClick={onDelete}>
              {t("حذف البند", "Delete")}
            </button>
          )}
          {!custom && (
            <button className="btn btn-ghost" onClick={onReset}>
              {t("الافتراضي", "Reset")}
            </button>
          )}
          <button className="btn" onClick={() => onSave(label.trim() || w.label, icon, color)}>
            {t("حفظ", "Save")}
          </button>
        </div>
      </div>
    </div>
  );
}
