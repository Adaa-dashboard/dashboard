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
import { useLogos, logoKey, SESS_SHORT, INST_COLS, CX_COLS, CX_QS, cxStagesOf } from "./Sections";
import { OP_OWNERS } from "./OpPlan";
import { initials, toneOf } from "@/lib/entlogo";
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
];
const BASE_MAP: Record<string, WDef> = Object.fromEntries(WIDGETS.map((w) => [w.key, w]));

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
  /** علامة ترحيل الترتيب الافتراضي الجديد */
  v2?: boolean;
  /** علامة ترحيل هيكل «الأعمال الرئيسية» */
  v3?: boolean;
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
function NotesWidget({ t, onOpen }: { t: T; onOpen: () => void }) {
  const [data, setData] = useState<NotesData>(EMPTY_NOTES);
  const [all, setAll] = useState(false);
  useEffect(() => {
    void loadUserData<NotesData>("notes", EMPTY_NOTES).then((d) => setData(d || EMPTY_NOTES));
  }, []);
  const sorted = [...(data.notes || [])].sort((a, b) => txt(b.updatedAt).localeCompare(txt(a.updatedAt)));
  const list = all ? sorted : sorted.slice(0, 5);
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
          <div className="nt2" key={n.id}>
            <div className="t">{firstLine(n)}</div>
            <div className="x">{preview(n)}</div>
            <div className="m">{whenAr(n.updatedAt)}</div>
          </div>
        ))}
        {!list.length && <div className="pf-none">{t("لا توجد ملاحظات بعد.", "No notes yet.")}</div>}
      </div>
      {sorted.length > 5 && (
        <button className="moreln" onClick={() => setAll(!all)}>
          {all ? t("عرض أقل", "Show less") : `${t("عرض ملاحظات أخرى", "More notes")} (${sorted.length - 5})`}
        </button>
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
const MAIN_ENT: Record<MainSec, string> = { natstrat: "owner", inststrat: "name", cx: "name" };
/** عنوان الصف: الاستراتيجية في الوطنية، والجهة في البقية */
const MAIN_TITLE: Record<MainSec, string> = { natstrat: "name", inststrat: "name", cx: "name" };

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
  if (!rows.length)
    return (
      <div className="pf-none">
        {t(
          "لا توجد بنود مسندة إليك — تُسنَد بأن تكون نقطة التواصل الأساسية لجهتها في «الجهات ونقاط التواصل».",
          "Nothing assigned to you yet.",
        )}
      </div>
    );

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
        </div>
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
const CONTRIB_ST = ["جديدة", "مستمرة", "مكتملة", "لم تبدأ"];

function Contrib({ rows, meName, t }: { rows: Row[]; meName: string; t: T }) {
  const [mine, setMine] = useState<{ id: string; data: Rec }[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [msg, setMsg] = useState("");
  const [add, setAdd] = useState<Rec | null>(null);

  const load = useCallback(() => {
    void apiFetch("/api/items?section=opplan")
      .then((r) => r.json())
      .then((d) => {
        const all = (Array.isArray(d.items) ? d.items : []) as { id: string; data: Rec }[];
        setMine(all.filter((x) => nrm(txt(x.data.contributor)) === nrm(meName)));
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

  return (
    <div className="cb">
      <div className="cb-h">
        <span>
          {t(
            "ما تضيفه هنا يظهر في صفحة «الخطة التشغيلية» تحت محفظة المدير الذي تختاره.",
            "Added here, shown under the chosen manager's portfolio.",
          )}
        </span>
        <button onClick={() => setAdd({ kind: "win", owner: OP_OWNERS[0], status: "جديدة" })}>
          + {t("مساهمة جديدة", "New")}
        </button>
      </div>
      {msg && <div className="cb-msg">{msg}</div>}

      <div className="c3">
        {CONTRIB_KINDS.map(({ k, label }) => {
          const list = mine.filter((r) => txt(r.data.kind) === k);
          return (
            <div className="col2" key={k}>
              <div className="h">
                {label}
                <b>{list.length}</b>
              </div>
              {list.map((r) => (
                <div className="li cb-li" key={r.id}>
                  <span className="n">{txt(r.data.name)}</span>
                  <span className="o">{txt(r.data.owner)}</span>
                  <select
                    value={txt(r.data.status) || "جديدة"}
                    onChange={(e) => void put(r.id, { status: e.target.value })}
                  >
                    {CONTRIB_ST.map((x) => (
                      <option key={x} value={x}>{x}</option>
                    ))}
                  </select>
                  <button className="x" title={t("حذف", "Delete")} onClick={() => void del(r.id)}>✕</button>
                </div>
              ))}
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
                    status: txt(r.data.status) || "جديدة",
                  });
                }}
              >
                {t("نقل إلى الخطة", "Move")}
              </button>
            </div>
          ))}
        </div>
      )}

      {add && (
        <div className="modal-overlay" onClick={() => setAdd(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="m-h">
              <h3>{t("مساهمة في الخطة التشغيلية", "New contribution")}</h3>
              <button className="mx" onClick={() => setAdd(null)} aria-label="close">✕</button>
            </div>
            <div className="op-f">
              <label className="wide">
                <span>{t("البند", "Item")}</span>
                <textarea rows={2} value={txt(add.name)}
                          onChange={(e) => setAdd({ ...add, name: e.target.value })} />
              </label>
              <label>
                <span>{t("النوع", "Kind")}</span>
                <select value={txt(add.kind)} onChange={(e) => setAdd({ ...add, kind: e.target.value })}>
                  {CONTRIB_KINDS.map(({ k, label }) => (
                    <option key={k} value={k}>{label}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>{t("محفظة المدير", "Portfolio")}</span>
                <select value={txt(add.owner)} onChange={(e) => setAdd({ ...add, owner: e.target.value })}>
                  {OP_OWNERS.map((o) => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>{t("الحالة", "Status")}</span>
                <select value={txt(add.status)} onChange={(e) => setAdd({ ...add, status: e.target.value })}>
                  {CONTRIB_ST.map((x) => (
                    <option key={x} value={x}>{x}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="m-f">
              <button className="btn btn-ghost" onClick={() => setAdd(null)}>{t("إلغاء", "Cancel")}</button>
              <button
                className="btn"
                onClick={async () => {
                  if (!txt(add.name).trim()) return;
                  if (await put(null, add)) setAdd(null);
                }}
              >
                {t("إضافة", "Add")}
              </button>
            </div>
          </div>
        </div>
      )}
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
  const [name, setName] = useState("");
  const [type, setType] = useState("مؤسسية");
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
          <div className="addent">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("اسم الجهة أو الاستراتيجية", "Entity or strategy")}
            />
            <select value={type} onChange={(e) => setType(e.target.value)}>
              {["مؤسسية", "وطنية", "مناطقية", "برنامج"].map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
            <button
              className="go2"
              onClick={() => {
                if (!name.trim()) return;
                onSave("", { name: name.trim(), type, q: [0, 0, 0, 0] });
                setName("");
              }}
            >
              + {t("إضافة", "Add")}
            </button>
          </div>
          <div className="pf-hint">
            {t(
              "ما يُضاف هنا يظهر في «جهاتي ومساهماتها» و«التقارير الربعية».",
              "Added entities appear in your strategies and quarterly widgets.",
            )}
          </div>
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

  return (
    <>
      <div className="sec3">{t("من يرى محفظتي", "Who can see my portfolio")}</div>
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

function CustomModal({
  prefs,
  t,
  meId,
  onClose,
  onChange,
}: {
  prefs: Prefs;
  t: T;
  meId: string;
  onClose: () => void;
  onChange: (p: Partial<Prefs>) => void;
}) {
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
  const [arrange, setArrange] = useState(false);
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
  const [taskCount, setTaskCount] = useState<number | null>(null);
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
  /* مساهماتي في الخطة التشغيلية — تُقرأ للعدّاد في البطاقة */
  const [myContrib, setMyContrib] = useState<Rec[]>([]);
  useEffect(() => {
    void apiFetch("/api/items?section=opplan")
      .then((r) => r.json())
      .then((d) => {
        const all = (Array.isArray(d.items) ? d.items : []) as { data: Rec }[];
        setMyContrib(all.map((x) => x.data).filter((x) => nrm(txt(x.contributor)) === nrm(me.name || "")));
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
  const curQ = Math.floor(new Date().getMonth() / 3) + 1;
  const qLate = entities.filter((r) => {
    const q: number[] = Array.isArray(r.data.q) ? r.data.q : [];
    return !q[curQ - 1];
  }).length;

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
        const n = (x: string) => myContrib.filter((d) => txt(d.kind) === x).length;
        return {
          count: myContrib.length,
          pct: 0,
          sub: myContrib.length
            ? `${n("kpi")} مؤشرات · ${n("init")} مبادرات · ${n("win")} مكاسب`
            : t("لا توجد مساهمات بعد", "Nothing yet"),
          warn: rows.length ? t(`${rows.length} غير مربوطة`, `${rows.length} local`) : undefined,
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
    return (
      <div
        className={`card2 ${wide ? "wide" : ""}`}
        draggable={arrange}
        onDragStart={() => setDrag(k)}
        onDragOver={(e) => arrange && e.preventDefault()}
        onDrop={() => dropOn(k)}
      >
        <div className="ch">
          {arrange && <span className="grip">⋮⋮</span>}
          <span className="dot" style={{ background: w.color }}>
            <PIcon id={w.icon} size={13} />
          </span>
          <h3>{w.label}</h3>
          {["tasks", "calendar", "notes"].includes(k) ? null : <span className="n">{st.count}</span>}
          {arrange && (
            <>
              <span className="edit" title={t("تغيير الاسم والأيقونة", "Rename / icon")} onClick={() => setEditLook(k)}>
                ✎
              </span>
              <span className="hide" onClick={() => patch({ hidden: [...prefs.hidden, k] })}>
                ✕
              </span>
            </>
          )}
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
              dragProps={{
                draggable: arrange,
                onDragStart: () => setDrag(k),
                onDragOver: (e: React.DragEvent) => arrange && e.preventDefault(),
                onDrop: () => dropOn(k),
              }}
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

      {/* الموظف يعرف من يطّلع عليه — قبل أن يكتشفه */}
      {myLeads.length > 0 && (
        <div className="pf-note-lead">
          <span>👁️</span>
          <div>
            <b>{t("مدير قطاعك يطّلع على أعمال محفظتك", "Your manager can view your portfolio")}</b>
            <em>
              {t(
                `${myLeads.join(" · ")} — اطّلاع فقط، ولا يستطيع التعديل. وملاحظاتك وتقويمك لا يراهما أحد.`,
                `${myLeads.join(" · ")} — read only. Your notes and calendar stay private.`,
              )}
            </em>
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
        <div className="acts">
          <span className="viewtog">
            <span className={prefs.mode === "tiles" ? "on" : ""} onClick={() => patch({ mode: "tiles" })}>
              ◫ {t("بطاقات", "Tiles")}
            </span>
            <span className={prefs.mode === "table" ? "on" : ""} onClick={() => patch({ mode: "table" })}>
              ▤ {t("جداول", "Tables")}
            </span>
          </span>
          <button className="btn2 solid" onClick={() => setCustom(true)}>
            <IconGear size={15} /> {t("تخصيص", "Customize")}
          </button>
          <button className={`btn2 ${arrange ? "solid" : ""}`} onClick={() => setArrange(!arrange)}>
            {arrange ? `✓ ${t("تم الترتيب", "Done")}` : `⋮⋮ ${t("ترتيب", "Arrange")}`}
          </button>
        </div>
      </div>

      <div className="kpis">
        <div className="kp">
          <div className="k">{t("مهامي المفتوحة", "Open tasks")}</div>
          <div className="v">{taskCount === null ? "—" : taskCount}</div>
          <div className="s">{t("المسندة لي والذاتية", "Assigned & self")}</div>
        </div>
        <div className="kp clickable" onClick={() => setEnts(true)}>
          <div className="k">{t("جهاتي", "My entities")}</div>
          <div className="v">{entCount}</div>
          <div className="s">{t("اضغط لإدارة القائمة", "Manage list")}</div>
        </div>
        <div className="kp">
          <div className="k">{t("نسبة التزامي", "On-time rate")}</div>
          <div className="v">
            {myCommit ? `${myCommit.pct}%` : changes.length ? `${commit}%` : "—"}
          </div>
          <div className="s">
            {myCommit
              ? t(`${myCommit.ok} من ${myCommit.total} ضمن مدّتها`, `${myCommit.ok}/${myCommit.total} on time`)
              : t("طلبات التغيير", "Change requests")}
          </div>
        </div>
      </div>

      {arrange && (
        <div className="pf-arr">
          <b>{t("الويدجت", "Widgets")}</b>
          {WIDGETS.map((w) => {
            const on = !prefs.hidden.includes(w.key);
            return (
              <span
                key={w.key}
                className={`b ${on ? "on" : ""}`}
                onClick={() =>
                  patch({
                    hidden: on ? [...prefs.hidden, w.key] : prefs.hidden.filter((x) => x !== w.key),
                  })
                }
              >
                {w.label} {on ? "✓" : "+"}
              </span>
            );
          })}
          <span className="b" onClick={() => patch({ order: DEFAULT_PREFS.order, hidden: [] })}>
            ↺ {t("الترتيب الافتراضي", "Reset order")}
          </span>
        </div>
      )}

      <div className={`pf-top ${prefs.mode === "table" || prefs.layout === "one" ? "one" : ""}`}>
        {group("top").map((k) => (
          <Card key={k} k={k} wide={k === "tasks"} />
        ))}
      </div>

      {/* العناوين وترتيبها من `GROUPS` — والمجموعة الفارغة لا يُرسم
          عنوانها، فلا يبقى عنوانٌ تحته فراغ */}
      {GROUPS.map((g) =>
        group(g.id).length ? (
          <div key={g.id}>
            <div className="sect">
              <h2>{t(g.label[0], g.label[1])}</h2>
              <span className="ln" />
            </div>
            {renderGroup(group(g.id), g.id)}
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

      {custom && (
        <CustomModal prefs={prefs} t={t} meId={me.id} onClose={() => setCustom(false)} onChange={patch} />
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
