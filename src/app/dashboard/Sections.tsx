"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { writeXlsx, readXlsxSheets } from "@/lib/sheet";
import { asset } from "@/lib/base";

/* ============================================================
   الأقسام الخمسة المتفرّعة من المؤشرات التفصيلية:
     جلسات مراجعة الأداء · الاستراتيجيات الوطنية ·
     الاستراتيجيات المؤسسية · المخرجات الوطنية · المشاريع

   كلها تقرأ من جدول واحد (perf_items) والمحتوى في عمود jsonb،
   لأن حقول كل قسم لم تُحسم بعد — فتغييرها لاحقاً لا يحتاج ترحيلاً.
   لكل قسم كتلة مختصرة في «نظرة عامة» وصفحة كاملة في القائمة.
   ============================================================ */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Rec = Record<string, any>;
export type Item = { id: string; ord: number; data: Rec; updatedAt?: string; updatedBy?: string };
type T = (ar: string, en: string) => string;

export type SectionKey = "sessions" | "natstrat" | "inststrat" | "outputs" | "cx" | "projects";

export const SECTION_TITLE: Record<SectionKey, [string, string]> = {
  sessions: ["جلسات مراجعة الأداء", "Performance review sessions"],
  natstrat: ["الاستراتيجيات الوطنية", "National strategies"],
  inststrat: ["الاستراتيجيات المؤسسية", "Institutional strategies"],
  outputs: ["المخرجات الوطنية", "National outputs"],
  cx: ["أعمال قياس تجربة المستفيد من الخدمات الحكومية", "Beneficiary experience measurement"],
  projects: ["المشاريع الاستراتيجية", "Strategic projects"],
};

/* اسم مختصر لعنصر القائمة الجانبية — الاسم الكامل يطول عليه */
export const SECTION_NAV_TITLE: Partial<Record<SectionKey, [string, string]>> = {
  cx: ["قياس تجربة المستفيد", "Beneficiary experience"],
};

/* مراحل المسار — مبدئية حتى تعتمدها الإدارة المعنية */
const SESS_STAGES = ["تحديد الجهة", "جمع البيانات", "إعداد التقرير", "انعقاد الجلسة", "محضر وتوصيات", "الإغلاق"];
/* حالة اعتماد الاستراتيجية الوطنية — أربع محطات */
const NAT_STEPS = ["طور الإعداد/التحديث", "قيد المراجعة", "معتمدة من اللجنة", "معتمدة من مجلس الوزراء"];
const NAT_WHERE = ["لدى الجهة المالكة", "لدى اللجنة الاستراتيجية", "اللجنة الاستراتيجية", "اعتماد نهائي"];
/* مسار المراجعة الأربع — مسار مستقل عن «حالة الاعتماد»:
   لكل مرحلة حالتها (لم يبدأ · قيد التنفيذ · مكتمل) كما في عرض الإدارة */
const NAT_TRACK = ["استلام الوثيقة", "استلام الحصر", "المراجعة الفنية", "معالجة الملاحظات"];
const TRACK_STATE = ["لم يبدأ", "قيد التنفيذ", "مكتمل"];
/** حالات المراحل الأربع — الافتراضي «لم يبدأ» ولا يُستنتج من غيره */
function natTrack(d: Rec): number[] {
  const raw = Array.isArray(d.track) ? d.track : [];
  return NAT_TRACK.map((_, i) => Math.max(0, Math.min(2, numOf(raw[i], 0))));
}
const INST_STAGES = ["وصلت المركز", "قيد المراجعة", "معالجة الملاحظات", "اعتُمدت", "فُعِّل القياس"];

/* أعمدة متابعة الاستراتيجيات المؤسسية — هي أعمدة ملف المتابعة نفسه
   حتى لا يُنقل بين الإكسل واللوحة. كل خلية تُحرَّر في مكانها. */
type ICol = { k: string; label: string; opts?: string[]; w: number };
const INST_SECTORS = ["المالي والاقتصادي", "البنية التحتية", "الخدمات الاجتماعية", "الشؤون الحكومية"];
/* العرض بالبكسل لأن الجدول يمرّر أفقياً — والقيم مقاسة على أطول
   نص فعلي في كل عمود، فلا يُقتطع اسم جهة ولا بريد */
const INST_COLS: ICol[] = [
  { k: "sector", label: "القطاع", opts: ["", ...INST_SECTORS], w: 140 },
  { k: "owner", label: "الجهة", w: 250 },
  { k: "consultant", label: "الاستشاري", w: 150 },
  { k: "phone", label: "رقم الجوال", w: 110 },
  { k: "email", label: "البريد الإلكتروني", w: 210 },
  { k: "rep", label: "تسمية ممثل", opts: ["", "تمت تسمية ممثل", "لم يُرسل بعد"], w: 150 },
  { k: "meet", label: "الاجتماع التعريفي", opts: ["", "تم", "لم يتم بعد"], w: 125 },
  { k: "meetAt", label: "تاريخ الاجتماع", w: 150 },
  { k: "docs", label: "استلام الوثائق", opts: ["", "✓", "✗"], w: 100 },
  { k: "docsState", label: "حالة الوثائق", opts: ["", "مكتمل", "جزئي", "لايمكن قياسه"], w: 130 },
  { k: "target", label: "تفعيل القياس (مستهدف)", opts: ["", "Q1", "Q2", "Q3", "Q4"], w: 120 },
  { k: "live", label: "حالة التفعيل", opts: ["", "مفعل", "غير مفعل"], w: 115 },
  { k: "phase", label: "Phase", opts: ["", "Phase 1", "Phase 2"], w: 110 },
];

/* ============ أعمال قياس تجربة المستفيد (BEX) ============
   النموذج مأخوذ حرفياً من ملف المتابعة «Master Tracker»: كل عمود
   في الملف عمود هنا، فالرفع يستبدل الحقل بالحقل بلا إعادة صياغة.
   وكل أرقام اللوحة محسوبة من الصفوف بنفس معادلات ورقة Dashboard
   في الملف — لا رقم ملخَّص مخزَّن يتقادم. */
const CX_META = "cx-meta";
/** حالة مرحلة في الملف — نفس القيم المستخدمة في قوائمه المنسدلة */
const CX_ST = [
  "",
  "تم الاعتماد",
  "قيد المراجعة",
  "لدى الجهاز لمعالجة الملاحظات",
  "تم الاستلام (استشاري الجهة)",
  "لم يتم الاستلام",
];
const CX_OK = "تم الاعتماد";
const CX_NONE = "لم يتم الاستلام";
/** «قيد العمل»: بدأت ولم تُعتمد — تعريف ورقة Dashboard نفسه */
const cxProg = (v: string) => v !== "" && v !== CX_OK && v !== CX_NONE;

/** الأرباع الخمسة كما في الملف: الأخير من ٢٠٢٥ ثم أرباع ٢٠٢٦ */
const CX_QS = [
  { k: "q0", label: "Q4 — 2025م" },
  { k: "q1", label: "Q1 — 2026م" },
  { k: "q2", label: "Q2 — 2026م" },
  { k: "q3", label: "Q3 — 2026م" },
  { k: "q4", label: "Q4 — 2026م" },
];

type CxCol = { k: string; label: string; w: number; opts?: string[]; core?: boolean };
/** ترتيب الأعمدة هو ترتيب الملف نفسه، فالفهرس هو أداة المطابقة عند الرفع */
const CX_COLS: CxCol[] = [
  { k: "name", label: "اسم الجهاز", w: 240, core: true },
  { k: "sector", label: "القطاع", w: 150, opts: ["", ...INST_SECTORS], core: true },
  { k: "kind", label: "تصنيف الجهة", w: 110, core: true },
  { k: "reply", label: "رد الجهاز وسبب عدم قياس الخدمات", w: 260 },
  { k: "m2023", label: "قياسات 2023", w: 90 },
  { k: "m2024", label: "قياسات 2024", w: 90 },
  { k: "m2025", label: "قياسات 2025", w: 90 },
  { k: "m2026", label: "قياس 2026", w: 90 },
  { k: "counted", label: "احتُسب في المؤشر", w: 100, core: true },
  { k: "countedQ2", label: "احتُسب Q2", w: 90 },
  { k: "consultant", label: "الاستشاري", w: 130, core: true },
  { k: "letters", label: "الخطابات الصادرة 2026م", w: 130 },
  { k: "meet", label: "عقد الاجتماع التعريفي", w: 120, opts: ["", "تم", "لم يبدأ"], core: true },
  { k: "survey", label: "حصر الخدمات من الجهاز", w: 150, opts: CX_ST, core: true },
  { k: "servTot", label: "إجمالي الخدمات", w: 100, core: true },
  { k: "card", label: "بطاقة القياس", w: 150, opts: CX_ST, core: true },
  { k: "scope", label: "الخدمات المستهدفة بالقياس", w: 230 },
  { k: "servPlan", label: "الخدمات المخطط قياسها", w: 110, core: true },
  { k: "freq", label: "دورية القياس", w: 100, opts: ["", "سنوية", "نصف سنوية", "ربعية"], core: true },
  { k: "firstData", label: "موعد توفر البيانات", w: 110 },
  { k: "l1", label: "استبيان لفل 1", w: 150, opts: CX_ST, core: true },
  { k: "rep2025", label: "تقارير 2025م", w: 90 },
  { k: "rep2026", label: "تقارير 2026م", w: 90 },
  ...CX_QS.flatMap((q) => [
    { k: `${q.k}Share`, label: `مشاركة النتائج ${q.label}`, w: 170, opts: CX_ST },
    { k: `${q.k}Issue`, label: `إصدار التقرير ${q.label}`, w: 170, opts: CX_ST },
    { k: `${q.k}Svc`, label: `خدمات بمؤشر رضا ${q.label}`, w: 130 },
    { k: `${q.k}Sat`, label: `مؤشر الرضا ${q.label}`, w: 110 },
  ]),
];
const CX_CORE = CX_COLS.filter((c) => c.core);

/** لون خلية الحالة — أخضر للمعتمد، ذهبي لما هو قيد العمل، أحمر لما لم يُستلم */
function cxTone(c: CxCol, v: string): string {
  if (!v || !c.opts) return "";
  if (c.k === "meet") return v === "تم" ? "ok" : "wt";
  if (v === CX_OK) return "ok";
  if (v === CX_NONE) return "no";
  return "wt";
}

/* مراحل الملف — بنفس معادلات ورقة Dashboard حرفياً.
   وهي **متداخلة لا متتابعة**: جهاز صدر له تقرير في ربع قد يكون
   ما زال «في القياس» في ربع آخر، فيُعدّ في الاثنين — كما في ملفك.
   لذلك لا تُجمع الأرقام على أنها تقسيم للـ١٥٤. */
const CX_STAGES: { k: string; ar: string; en: string; c: string; test: (d: Rec) => boolean }[] = [
  {
    k: "prep", ar: "في التهيئة", en: "Onboarding", c: "#2b7fd4",
    test: (d) => txt(d.meet) === "تم" && txt(d.survey) !== CX_OK,
  },
  {
    k: "planning", ar: "في التخطيط", en: "Planning", c: "#7a5cd6",
    test: (d) => txt(d.survey) === CX_OK && (cxProg(txt(d.card)) || cxProg(txt(d.l1))),
  },
  {
    k: "measuring", ar: "في القياس", en: "Measuring", c: "#e0971a",
    test: (d) =>
      txt(d.survey) === CX_OK && txt(d.card) === CX_OK && txt(d.l1) === CX_OK &&
      CX_QS.some((q) => cxProg(txt(d[`${q.k}Share`]))),
  },
  {
    k: "reports", ar: "صدر لها تقرير", en: "Report issued", c: "#1a9d5c",
    test: (d) => CX_QS.some((q) => txt(d[`${q.k}Issue`]) === CX_OK),
  },
  {
    k: "none", ar: "لم تبدأ", en: "Not started", c: "#9aa8a4",
    test: (d) => txt(d.meet) === "لم يبدأ",
  },
];
/* تلوين الخلايا التي لها معنى حالة */
function instTone(k: string, v: string): string {
  if (!v) return "";
  if (k === "docs") return v === "✓" ? "ok" : "no";
  if (k === "meet") return v === "تم" ? "ok" : "wt";
  if (k === "rep") return v === "تمت تسمية ممثل" ? "ok" : "wt";
  if (k === "live") return v === "مفعل" ? "ok" : "wt";
  if (k === "docsState") return v === "مكتمل" ? "ok" : v === "جزئي" ? "wt" : "no";
  return "";
}

/* الأرقام كلها لاتينية (1 2 3) بطلب المستخدمة. الدالة تحوّل
   الأرقام الهندية إن وردت في نص مُدخَل، فيتوحّد الشكل مهما
   كُتبت البيانات. */
const lat = (v: string) => v.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
const AR = (n: number | string) => lat(String(n));
const numOf = (v: unknown, dflt = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
};
const txt = (v: unknown) => (v === null || v === undefined ? "" : lat(String(v)));
/* لون نطاق القياس: مرتفعة ≥٩٠ · متوسطة ٧٠–٨٩ · منخفضة أقل من ٧٠ */
const measTone = (v: number) => (v >= 90 ? "hi" : v >= 70 ? "mid" : "low");

/* خطوة تراجع واحدة: ما كان عليه البند قبل التغيير (null = لم يكن موجوداً) */
type UndoStep = { kind: "edit" | "add" | "delete"; id: string; label: string; before: Rec | null; ord: number };
const UNDO_MAX = 30;

/* ---------------- تحميل بنود قسم ---------------- */
export function useItems(section: SectionKey, enabled = true) {
  const [items, setItems] = useState<Item[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!enabled) return;
    const r = await apiFetch(`/api/items?section=${section}`);
    const d = await r.json().catch(() => ({}));
    if (!r.ok) setError(d.error || "تعذّر تحميل البيانات");
    setItems(Array.isArray(d.items) ? d.items : []);
    setLoaded(true);
  }, [section, enabled]);

  useEffect(() => {
    void load();
  }, [load]);

  /* التراجع: قبل كل حفظ أو حذف نلتقط الحالة السابقة للبند.
     المكدّس في الذاكرة — يُفرَّغ بإعادة تحميل الصفحة، والسجل
     الدائم هو audit_log في قاعدة البيانات. */
  const undoRef = useRef<UndoStep[]>([]);
  const [undoTop, setUndoTop] = useState<UndoStep | null>(null);
  const itemsRef = useRef<Item[]>([]);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const push = useCallback((st: UndoStep) => {
    undoRef.current.push(st);
    if (undoRef.current.length > UNDO_MAX) undoRef.current.shift();
    setUndoTop(st);
  }, []);

  /* الكتابة الخام — لا تسجّل خطوة تراجع، فيستعملها التراجع نفسه */
  const put = useCallback(
    async (id: string, data: Rec, ord: number) => {
      const r = await apiFetch("/api/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ section, id, data, ord }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return d.error || "تعذّر الحفظ";
      await load();
      return null;
    },
    [section, load],
  );

  const del = useCallback(
    async (id: string) => {
      const r = await apiFetch(`/api/items?section=${section}&id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!r.ok) return "تعذّر الحذف";
      await load();
      return null;
    },
    [section, load],
  );

  const save = useCallback(
    async (id: string, data: Rec, ord: number) => {
      const before = itemsRef.current.find((x: Item) => x.id === id) || null;
      const err = await put(id, data, ord);
      if (err) return err;
      push({
        kind: before ? "edit" : "add",
        id,
        label: txt(data.owner) || txt(data.name) || txt(data.entity) || id,
        before: before ? { ...before.data } : null,
        ord: before ? before.ord : ord,
      });
      return null;
    },
    [put, push],
  );

  const remove = useCallback(
    async (id: string) => {
      const before = itemsRef.current.find((x: Item) => x.id === id) || null;
      const err = await del(id);
      if (err) return err;
      if (before)
        push({
          kind: "delete",
          id,
          label: txt(before.data.owner) || txt(before.data.name) || txt(before.data.entity) || id,
          before: { ...before.data },
          ord: before.ord,
        });
      return null;
    },
    [del, push],
  );

  /* التراجع يمشي عكس الخطوة: المحذوف يُعاد · المعدَّل يرجع لقيمته
     · والمضاف يُحذف. ولا يسجّل خطوة جديدة فلا يدور في حلقة. */
  const undo = useCallback(async () => {
    const st = undoRef.current.pop();
    setUndoTop(undoRef.current[undoRef.current.length - 1] || null);
    if (!st) return null;
    const err = st.before ? await put(st.id, st.before, st.ord) : await del(st.id);
    return err;
  }, [put, del]);

  /* إخفاء الشريط دون إفراغ المكدّس — الخطوة تبقى قابلة للتراجع
     من الشريط التالي إن حدث تغيير آخر */
  const dismissUndo = useCallback(() => setUndoTop(null), []);

  return { items, loaded, error, reload: load, save, remove, undo, undoTop, dismissUndo };
}

/* ------------------------------------------------------------
   طيّ الأقسام — الحالة محفوظة في متصفح كل مستخدم وحده،
   فما يطويه أحد لا يؤثر على غيره ولا يُحفظ في القاعدة.
   ------------------------------------------------------------ */
export function useCollapse(key: string) {
  const [open, setOpen] = useState(true);
  useEffect(() => {
    try {
      setOpen(localStorage.getItem(`ovSec:${key}`) !== "0");
    } catch {
      /* ignore */
    }
  }, [key]);
  const toggle = useCallback(() => {
    setOpen((v) => {
      try {
        localStorage.setItem(`ovSec:${key}`, v ? "0" : "1");
      } catch {
        /* ignore */
      }
      return !v;
    });
  }, [key]);
  return { open, toggle };
}

/** سهم الطيّ — يوضع أول العنوان */
export function CollapseBtn({ open, toggle, t }: { open: boolean; toggle: () => void; t: T }) {
  return (
    <button
      className={`sec-tog ${open ? "" : "closed"}`}
      onClick={toggle}
      aria-expanded={open}
      title={open ? t("طيّ القسم", "Collapse") : t("فتح القسم", "Expand")}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 9l7 7 7-7" />
      </svg>
    </button>
  );
}

/* ---------------- قطع مشتركة ---------------- */

/** حلقة نسبة — القوس يتحرّك بالإكمال وحده */
function Ring({ pct, size = 132, tone = "g" }: { pct: number; size?: number; tone?: "g" | "low" | "mid" | "hi" }) {
  const r = size / 2 - 13;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, pct));
  const color = tone === "low" ? "#d34a4a" : tone === "mid" ? "#e0971a" : tone === "hi" ? "#1a9d5c" : "#00584c";
  return (
    <svg className="sx-ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#dceae6" strokeWidth="13" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="13"
        strokeLinecap="round"
        strokeDasharray={`${(c * v) / 100} ${c}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central" className="sx-ring-t" fill={color}>
        {AR(Math.round(v))}٪
      </text>
    </svg>
  );
}

function Flow({ stages, done, dates, sm }: { stages: string[]; done: number; dates?: string[]; sm?: boolean }) {
  return (
    <div className={`sx-flow ${sm ? "sm" : ""}`}>
      {stages.map((s, i) => (
        <div
          key={s + i}
          className={`sx-st ${i < done ? "ok" : i === done ? "now" : ""}`}
          title={dates?.[i] ? `${s} — ${dates[i]}` : s}
        >
          <div className="d">{i < done ? "✓" : AR(i + 1)}</div>
          <div className="t">{s}</div>
        </div>
      ))}
    </div>
  );
}

/* نقاط صغيرة بدل المسار الكامل — تُستعمل داخل جدول */
function Dots({ n, done }: { n: number; done: number }) {
  return (
    <span className="sx-dots">
      {Array.from({ length: n }).map((_, i) => (
        <i key={i} className={i < done ? "ok" : i === done ? "now" : ""} />
      ))}
    </span>
  );
}

/* شريط التراجع — يظهر بعد أي تعديل أو حذف، ويعمل Ctrl+Z ما دام ظاهراً.
   لا يختفي تلقائياً: قد ينتبه المستخدم للخطأ بعد دقيقة لا بعد ثانيتين. */
function UndoBar({
  step, onUndo, onClose, t,
}: {
  step: UndoStep | null;
  onUndo: () => void;
  onClose: () => void;
  t: T;
}) {
  useEffect(() => {
    if (!step) return;
    const h = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
      if (typing) return; // داخل الحقول يبقى تراجع المتصفح النصي كما هو
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        onUndo();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [step, onUndo]);

  if (!step) return null;
  const what =
    step.kind === "delete"
      ? t("حُذف", "Deleted")
      : step.kind === "add"
        ? t("أُضيف", "Added")
        : t("عُدِّل", "Edited");
  return (
    <div className="undo-bar" role="status">
      <span className="w">
        {what} <b>{step.label}</b>
      </span>
      <button className="u" onClick={onUndo}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20.5 8H9a6 6 0 0 0 0 12h5" />
          <path d="M20.5 8l-5-5M20.5 8l-5 5" />
        </svg>
        {t("تراجع", "Undo")}
      </button>
      <span className="k">Ctrl+Z</span>
      <button className="x" onClick={onClose} aria-label={t("إخفاء", "Dismiss")}>
        ✕
      </button>
    </div>
  );
}

/* ---------------- تحميل البيانات الأولية ----------------
   بديل تشغيل SQL يدوياً: الملف مرفق مع الموقع، والزر يكتبه عبر
   نفس واجهة القسم — فتحكمه صلاحيات الحساب لا امتيازات القاعدة.
   لا يُضاف بند موجود مسبقاً، فالضغط مرتين لا يكرّر شيئاً. */
const SEEDED: SectionKey[] = ["natstrat", "inststrat", "projects"];

function SeedBtn({
  section, have, t, onDone,
}: {
  section: SectionKey; have: Set<string>; t: T; onDone: () => void;
}) {
  const [busy, setBusy] = useState("");

  async function run() {
    setBusy(t("جارٍ التحميل...", "Loading..."));
    try {
      const r = await fetch(asset(`/seed/${section}.json`));
      const all = (await r.json()) as { id: string; ord: number; data: Rec }[];
      const rows = all.filter((x) => !have.has(x.id));
      if (!rows.length) {
        setBusy(t("البيانات محمّلة أصلاً — لا جديد", "Already loaded"));
        return;
      }
      if (!confirm(t(
        `سيُضاف ${rows.length} بنداً إلى هذا القسم. البنود الموجودة لن تُمسّ. متابعة؟`,
        `Add ${rows.length} items? Existing items are untouched.`,
      ))) {
        setBusy("");
        return;
      }
      const res = await apiFetch("/api/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ section, items: rows }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBusy(d.error || t("تعذّر التحميل", "Failed"));
        return;
      }
      setBusy("");
      onDone();
    } catch {
      setBusy(t("تعذّر قراءة ملف البيانات", "Could not read the data file"));
    }
  }

  return (
    <span className="seedb">
      <button className="btn btn-sm" onClick={run} disabled={!!busy && busy.includes("جارٍ")}>
        {t("تحميل البيانات الأولية", "Load starter data")}
      </button>
      {busy && <em>{busy}</em>}
    </span>
  );
}

function Empty({ title, note }: { title: string; note: string }) {
  return (
    <div className="sx-empty">
      <div className="ic">◻</div>
      <h3>{title}</h3>
      <p>{note}</p>
    </div>
  );
}

function Bar({ v }: { v: number }) {
  return (
    <span className={`sx-meas ${measTone(v)}`}>
      <b>{AR(v)}٪</b>
      <span className="bar">
        <i style={{ width: `${Math.max(0, Math.min(100, v))}%` }} />
      </span>
    </span>
  );
}

function Toolbar({
  q,
  setQ,
  filter,
  setFilter,
  options,
  onExport,
  t,
}: {
  q: string;
  setQ: (v: string) => void;
  filter: string;
  setFilter: (v: string) => void;
  options: string[];
  onExport: () => void;
  t: T;
}) {
  return (
    <div className="sx-tb">
      <input
        className="sx-search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t("بحث بالاسم أو الجهة…", "Search…")}
      />
      <select value={filter} onChange={(e) => setFilter(e.target.value)}>
        <option value="">{t("كل الحالات", "All statuses")}</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
      <button className="btn btn-ghost btn-sm" onClick={onExport}>
        ⬇ Excel
      </button>
    </div>
  );
}

function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* ============================================================
   ١) جلسات مراجعة الأداء
   لوحة جانبية فيها حلقة الإنجاز وتفصيل الحالات، وبجانبها
   بطاقة لكل جهة عليها مسار مراحلها والتاريخ في التلميح.
   ============================================================ */
function sessOf(d: Rec) {
  const raw = Array.isArray(d.stages) ? d.stages : [];
  const names = raw.length ? raw.map((x: Rec) => txt(x.n)) : SESS_STAGES;
  const dates = raw.map((x: Rec) => txt(x.d));
  const done = Math.max(0, Math.min(names.length, numOf(d.done)));
  return { names, dates, done, full: names.length };
}

export function Sessions({ limit, t }: { limit?: number; t: T }) {
  const { items, loaded } = useItems("sessions");
  const [all, setAll] = useState(false);
  const shown = limit && !all ? items.slice(0, limit) : items;

  const stat = useMemo(() => {
    let done = 0;
    let live = 0;
    let idle = 0;
    for (const it of items) {
      const s = sessOf(it.data);
      if (s.done >= s.full && s.full > 0) done++;
      else if (s.done > 0) live++;
      else idle++;
    }
    return { done, live, idle };
  }, [items]);

  if (!loaded) return <div className="empty">{t("جارٍ التحميل...", "Loading...")}</div>;
  if (!items.length)
    return (
      <Empty
        title={t("لا توجد جلسات بعد", "No sessions yet")}
        note={t("تُضاف الجهات ومراحل جلساتها من زر «إضافة».", "Add entities and their session stages.")}
      />
    );

  const pct = items.length ? (stat.done / items.length) * 100 : 0;
  const quarter = txt(items[0]?.data?.quarter);

  return (
    <div className="card sx-sess">
      <div className="sx-side">
        <Ring pct={pct} />
        <div className="ttl">{t("إنجاز جلسات المراجعة", "Sessions completed")}</div>
        <div className="sub">
          {`${AR(stat.done)} ${t("من", "of")} ${AR(items.length)} ${t("جهات", "entities")}`}
          {quarter ? ` · ${quarter}` : ""}
        </div>
        <div className="lgd">
          <span className="rw">
            <em className="dot done" />
            {t("مكتملة", "Done")}
            <b>{AR(stat.done)}</b>
          </span>
          <span className="rw">
            <em className="dot live" />
            {t("جارية", "In progress")}
            <b>{AR(stat.live)}</b>
          </span>
          <span className="rw">
            <em className="dot idle" />
            {t("لم تبدأ", "Not started")}
            <b>{AR(stat.idle)}</b>
          </span>
        </div>
      </div>

      <div className="sx-list">
        {shown.map((it) => {
          const s = sessOf(it.data);
          const cur = s.done >= s.full ? t("مكتملة", "Done") : s.names[s.done] || "";
          return (
            <div className="sx-card" key={it.id}>
              <div className="sx-h">
                <b>{txt(it.data.entity) || "—"}</b>
                <span className="sx-own">{txt(it.data.quarter)}</span>
                <span className="sx-pill">{cur}</span>
              </div>
              <Flow stages={s.names} done={s.done} dates={s.dates} />
            </div>
          );
        })}
        {limit && items.length > limit && (
          <button className="sx-more" onClick={() => setAll(!all)}>
            {all
              ? `${t("عرض أقل", "Show less")} ▴`
              : `${t("عرض الكل", "Show all")} (${AR(items.length - limit)} ${t("أخرى", "more")}) ▾`}
          </button>
        )}
      </div>
    </div>
  );
}

function SessionsPage({ t }: { t: T }) {
  return <Sessions t={t} />;
}

/* ============================================================
   ٢) الاستراتيجيات الوطنية
   ============================================================ */
function natStage(d: Rec) {
  return Math.max(1, Math.min(NAT_STEPS.length, numOf(d.stage, 1)));
}

export function NationalStrategies({ limit, t, onMore }: { limit?: number; t: T; onMore?: () => void }) {
  const { items, loaded } = useItems("natstrat");
  const counts = useMemo(() => {
    const c = [0, 0, 0, 0];
    for (const it of items) c[natStage(it.data) - 1]++;
    return c;
  }, [items]);

  if (!loaded) return <div className="empty">{t("جارٍ التحميل...", "Loading...")}</div>;
  if (!items.length)
    return (
      <Empty
        title={t("لا توجد استراتيجيات بعد", "Nothing yet")}
        note={t("تُضاف الاستراتيجيات وحالتها من زر «إضافة».", "Add strategies and their stage.")}
      />
    );

  const latest = [...items].sort((a, b) => txt(b.data.updated).localeCompare(txt(a.data.updated)));
  const shown = limit ? latest.slice(0, limit) : latest;

  return (
    <>
      <div className="sx-nums five">
        <div className="sx-tot">
          <b>{AR(items.length)}</b>
          <span>{t("إجمالي الاستراتيجيات", "Total")}</span>
        </div>
        {NAT_STEPS.map((s, i) => (
          <div className="sx-nc" key={s}>
            <div className="t">{s}</div>
            <b>{AR(counts[i])}</b>
            <div className="s">{NAT_WHERE[i]}</div>
          </div>
        ))}
      </div>

      <div className="sx-rows tight">
        {shown.map((it) => (
          <div className="sx-line" key={it.id}>
            <span className="n">{txt(it.data.name)}</span>
            <span className="sx-pill">{NAT_STEPS[natStage(it.data) - 1]}</span>
            <span className="sx-up">{txt(it.data.updated)}</span>
            <Bar v={numOf(it.data.meas)} />
          </div>
        ))}
      </div>
      {limit && items.length > limit && onMore && (
        <button className="sx-more" onClick={onMore}>
          {`${t("عرض الكل", "Show all")} (${AR(items.length)})`}
        </button>
      )}
    </>
  );
}

/* ما يعمله المركز عند كل حالة — نصوص عرض الإدارة نفسها */
const NAT_DOING: Record<number, string> = {
  4: "يعمل المركز على قياس أداء الاستراتيجيات والرفع بالتقارير",
  3: "يعمل المركز مع الملاك على تقييم ورفع قابلية القياس",
  2: "يعمل المركز مع الملاك على مراجعة الوثائق الاستراتيجية وإبداء الملاحظات",
  1: "يعمل المركز مع الملاك على مراجعة الوثائق الاستراتيجية وإبداء الملاحظات",
};
const NAT_TONE: Record<number, string> = { 4: "#1a9d5c", 3: "#0f8a8a", 2: "#e0971a", 1: "#8a9a95" };
/* عناوين مختصرة للتبويبات — النص الكامل يبقى في العنوان تحتها */
const NAT_TAB: Record<number, string> = {
  4: "معتمدة من المجلس",
  3: "معتمدة من اللجنة",
  2: "قيد المراجعة",
  1: "قيد الإعداد",
};

/* شعارات الجهات المستخرَجة من عرض الإدارة.
   المطابقة بالاسم لا بحقل محفوظ، فتعمل على البنود المحمَّلة سابقاً. */
const logoKey = (s: string) =>
  s.replace(/\s+/g, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي");

function useLogos() {
  const [map, setMap] = useState<Record<string, string>>({});
  useEffect(() => {
    let live = true;
    void fetch(asset("/logos/index.json"))
      .then((r) => r.json())
      .then((d: Record<string, string>) => {
        if (!live) return;
        const m: Record<string, string> = {};
        for (const [k, v] of Object.entries(d)) m[logoKey(k)] = v;
        setMap(m);
      })
      .catch(() => setMap({}));
    return () => {
      live = false;
    };
  }, []);
  return map;
}

/* بطاقة استراتيجية وطنية — حلقة القياس وأربعة أرقام ومسار المراجعة */
function NatCard({
  it, t, canEdit, save, logo,
}: {
  it: Item;
  t: T;
  canEdit?: boolean;
  save?: (id: string, data: Rec, ord: number) => Promise<string | null>;
  logo?: string;
}) {
  const d = it.data;
  const meas = numOf(d.meas);
  const track = natTrack(d);

  async function cycle(i: number) {
    if (!canEdit || !save) return;
    const cur = [...track];
    cur[i] = (cur[i] + 1) % 3;
    await save(it.id, { ...d, track: cur, demo: false }, it.ord);
  }

  return (
    <div className="ncard">
      <div className="hd">
        {logo && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img className="lg" src={asset(`/logos/${logo}`)} alt="" loading="lazy" />
        )}
        <b>{txt(d.name)}</b>
        <span className={`tg ${d.tech ? "ok" : "no"}`}>
          {d.tech ? t("مقبولة فنياً", "Accepted") : t("غير مقبولة فنياً", "Not accepted")}
        </span>
      </div>
      <div className="own">
        {txt(d.owner) || "—"} · {NAT_STEPS[natStage(d) - 1]}
      </div>

      <div className="bd">
        <Ring pct={meas} size={104} tone={measTone(meas)} />
        <div className="nums">
          <div className="n">
            <div className="k">{t("المؤشرات", "KPIs")}</div>
            <div className="v">
              {AR(numOf(d.kpisRep))} <em>{`${t("من", "of")} ${AR(numOf(d.kpisTot))}`}</em>
            </div>
          </div>
          <div className="n">
            <div className="k">{t("المبادرات", "Initiatives")}</div>
            <div className="v">
              {AR(numOf(d.initRep))} <em>{`${t("من", "of")} ${AR(numOf(d.initTot))}`}</em>
            </div>
          </div>
          <div className="n">
            <div className="k">{t("فترة الاستراتيجية", "Period")}</div>
            <div className="v">
              <em>{txt(d.period) || "—"}</em>
            </div>
          </div>
          <div className="n">
            <div className="k">{t("تاريخ الاعتماد", "Approved on")}</div>
            <div className="v">
              <em>{txt(d.approvedAt) || t("لم تُعتمد", "Not approved")}</em>
            </div>
          </div>
        </div>
      </div>

      <div className="trk">
        {NAT_TRACK.map((n, i) => (
          <button
            key={n}
            className={`stg-c s${track[i]} ${canEdit ? "ed" : ""}`}
            onClick={() => void cycle(i)}
            title={`${n} — ${TRACK_STATE[track[i]]}`}
            disabled={!canEdit}
          >
            <i />
            <span>{n}</span>
          </button>
        ))}
      </div>

      <div className="note">{txt(d.note) || t("لا توجد ملاحظات مسجّلة", "No notes")}</div>
    </div>
  );
}

function NationalPage({ t, canEdit }: { t: T; canEdit?: boolean }) {
  const { items, loaded, save, undo, undoTop, dismissUndo } = useItems("natstrat");
  const [q, setQ] = useState("");
  /* التبويب المختار — حالة الاعتماد */
  const [tab, setTab] = useState(4);
  const logos = useLogos();

  const found = useMemo(
    () =>
      items.filter((it) => {
        const d = it.data;
        return !q || `${txt(d.name)} ${txt(d.owner)} ${txt(d.domain)}`.includes(q);
      }),
    [items, q],
  );
  /* البحث يتجاوز التبويب: من يكتب اسم استراتيجية يريدها أينما كانت */
  const rows = q ? found : found.filter((it) => natStage(it.data) === tab);

  function exportXl() {
    const head = ["الاستراتيجية", "الجهة", "حالة الاعتماد", "قابلية القياس ٪", "المؤشرات الممثلة",
      "إجمالي المؤشرات", "المبادرات الممثلة", "إجمالي المبادرات", "المراجعة الفنية",
      "فترة الاستراتيجية", "تاريخ الاعتماد", "أبرز الملاحظات"];
    const body = items.map((it) => {
      const d = it.data;
      return [txt(d.name), txt(d.owner), NAT_STEPS[natStage(d) - 1], numOf(d.meas),
        numOf(d.kpisRep), numOf(d.kpisTot), numOf(d.initRep), numOf(d.initTot),
        d.tech ? "مقبولة فنياً" : "غير مقبولة فنياً", txt(d.period), txt(d.approvedAt), txt(d.note)];
    });
    download("الاستراتيجيات-الوطنية.xlsx", writeXlsx([{ name: "الوطنية", rows: [head, ...body] }]));
  }

  if (!loaded) return <div className="empty">{t("جارٍ التحميل...", "Loading...")}</div>;

  return (
    <>
      <Toolbar q={q} setQ={setQ} filter="" setFilter={() => {}} options={[]} onExport={exportXl} t={t} />

      <div className="stabs">
        {[4, 3, 2, 1].map((st) => {
          const n = items.filter((it) => natStage(it.data) === st).length;
          return (
            <button
              key={st}
              className={`stab ${!q && tab === st ? "on" : ""}`}
              style={{ ["--c" as string]: NAT_TONE[st] }}
              onClick={() => {
                setQ("");
                setTab(st);
              }}
            >
              <span className="l">{NAT_TAB[st]}</span>
              <b>{AR(n)}</b>
            </button>
          );
        })}
      </div>

      <div className="stab-doing">{q ? `${t("نتائج البحث", "Search results")} · ${AR(rows.length)}` : NAT_DOING[tab]}</div>

      {rows.length ? (
        <div className="ncards">
          {rows.map((it) => (
            <NatCard
              key={it.id}
              it={it}
              t={t}
              canEdit={canEdit}
              save={save}
              logo={logos[logoKey(txt(it.data.name))]}
            />
          ))}
        </div>
      ) : (
        <div className="pf-none">{t("لا توجد استراتيجيات في هذه الحالة", "Nothing here")}</div>
      )}

      <UndoBar step={undoTop} onUndo={() => void undo()} onClose={dismissUndo} t={t} />
    </>
  );
}

function NationalDetail({
  it, t, canEdit, save,
}: {
  it: Item;
  t: T;
  canEdit?: boolean;
  save?: (id: string, data: Rec, ord: number) => Promise<string | null>;
}) {
  const d = it.data;
  const meas = numOf(d.meas);
  const track = natTrack(d);

  /* مراحل المراجعة: الضغط يقلّب حالة المرحلة — لم يبدأ ← قيد التنفيذ ← مكتمل */
  async function cycle(i: number) {
    if (!canEdit || !save) return;
    const cur = [...track];
    cur[i] = (cur[i] + 1) % 3;
    await save(it.id, { ...d, track: cur, demo: false }, it.ord);
  }

  return (
    <div className="sx-det">
      <div className="col">
        <div className="box">
          <div className="k">{t("اسم الاستراتيجية", "Strategy")}</div>
          <div className="v">{txt(d.name)}</div>
        </div>
        <div className="box">
          <div className="k">{t("مراحل المراجعة", "Review stages")}</div>
          <div className="nat-track">
            {NAT_TRACK.map((n, i) => (
              <button
                key={n}
                className={`stg-c s${track[i]} ${canEdit ? "ed" : ""}`}
                onClick={() => void cycle(i)}
                title={`${n} — ${TRACK_STATE[track[i]]}`}
                disabled={!canEdit}
              >
                <i />
                <span>{n}</span>
                <em>{TRACK_STATE[track[i]]}</em>
              </button>
            ))}
          </div>
          {canEdit && (
            <div className="hint">{t("اضغط على أي مرحلة لتغيير حالتها", "Click a stage to change it")}</div>
          )}
        </div>
        <div className="two">
          <div className="box">
            <div className="k">{t("فترة الاستراتيجية", "Period")}</div>
            <div className="v">{txt(d.period) || "—"}</div>
          </div>
          <div className="box">
            <div className="k">{t("تاريخ الاعتماد", "Approved on")}</div>
            <div className="v">{txt(d.approvedAt) || t("لم تُعتمد", "Not approved")}</div>
          </div>
        </div>
        <div className="two">
          <div className="box">
            <div className="k">{t("المؤشرات (ممثلة/إجمالي)", "KPIs")}</div>
            <div className="v">{`${AR(numOf(d.kpisRep))} / ${AR(numOf(d.kpisTot))}`}</div>
          </div>
          <div className="box">
            <div className="k">{t("المبادرات (ممثلة/إجمالي)", "Initiatives")}</div>
            <div className="v">{`${AR(numOf(d.initRep))} / ${AR(numOf(d.initTot))}`}</div>
          </div>
        </div>
        <div className="box ringbox">
          <Ring pct={meas} size={150} tone={measTone(meas)} />
          <div className="k">{t("نسبة قابلية القياس", "Measurability")}</div>
          <div className="lg">
            <span>
              <i className="hi" />
              {t("مرتفعة ≥ 90٪", "High")}
            </span>
            <span>
              <i className="mid" />
              {t("متوسطة 70–89٪", "Medium")}
            </span>
            <span>
              <i className="low" />
              {t("منخفضة أقل من 70٪", "Low")}
            </span>
          </div>
        </div>
      </div>
      <div className="col">
        <div className="sx-note big">
          <b>{t("الوضع الحالي", "Current status")}</b>
          {txt(d.current) || "—"}
        </div>
        <div className="sx-note big">
          <b>{t("التحدي", "Challenge")}</b>
          {txt(d.challenge) || "—"}
        </div>
        <div className="sx-note big">
          <b>{t("الخطوات القادمة", "Next steps")}</b>
          {txt(d.next) || "—"}
        </div>
        <div className="sx-note big">
          <b>{t("الدعم المطلوب", "Support needed")}</b>
          {txt(d.support) || "—"}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------
   بطاقتا «نظرة عامة» — معلومات عامة فقط، والأسماء والتفاصيل
   كلها في صفحة كل قسم. الوطنية يميناً والمؤسسية يساراً.
   ------------------------------------------------------------ */
function KV({ label, n, tot, tone }: { label: string; n: number; tot: number; tone?: string }) {
  return (
    <div className="kv">
      <span className="t">{label}</span>
      <span className="mb">
        <i className={tone || ""} style={{ width: `${tot ? (n / tot) * 100 : 0}%` }} />
      </span>
      <b>{AR(n)}</b>
    </div>
  );
}

function GCell({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="gc">
      <div className="k">{k}</div>
      <div className="v">{children}</div>
    </div>
  );
}

export function StrategyBox({
  section,
  t,
  onOpen,
}: {
  section: "natstrat" | "inststrat";
  t: T;
  /** بلا onOpen لا يظهر زرّ «التفاصيل» — لمن لا يملك صلاحية القسم */
  onOpen?: () => void;
}) {
  const { items, loaded } = useItems(section);
  const title = SECTION_TITLE[section];
  const { open, toggle } = useCollapse(section);

  const box = (body: ReactNode) => (
    <div className={`sx-box ${open ? "" : "closed"}`}>
      <div className="hd">
        <CollapseBtn open={open} toggle={toggle} t={t} />
        <h3>{t(title[0], title[1])}</h3>
        {onOpen && (
          <button className="lnk" onClick={onOpen}>
            {t("التفاصيل", "Details")} ‹
          </button>
        )}
      </div>
      {open && <div className="bd">{body}</div>}
    </div>
  );

  if (!loaded) return box(<div className="empty">{t("جارٍ التحميل...", "Loading...")}</div>);
  if (!items.length)
    return box(
      <div className="sx-none">{t("لا توجد بيانات بعد — تُضاف من صفحة القسم.", "No data yet.")}</div>,
    );

  const tot = items.length;
  const last = items.map((x) => txt(x.data.updated)).sort().slice(-1)[0] || "—";

  if (section === "natstrat") {
    const c = [0, 0, 0, 0];
    for (const it of items) c[natStage(it.data) - 1]++;
    /* توزيع النطاقات بدل متوسط واحد: المتوسط يخلط ما لم يصل المركز
       بعد (قابليته صفر) بما قِيس وطلع ضعيفاً، فيعطي رقماً مضلِّلاً */
    const band = { hi: 0, mid: 0, low: 0 };
    for (const it of items) {
      const m = numOf(it.data.meas);
      if (m >= 90) band.hi++;
      else if (m >= 70) band.mid++;
      else band.low++;
    }
    const tech = items.filter((x) => x.data.tech).length;
    const rep = items.reduce((a, x) => a + numOf(x.data.kpisRep), 0);
    const all = items.reduce((a, x) => a + numOf(x.data.kpisTot), 0);
    return box(
      <>
        <div className="head-row">
          <div className="big">
            <b>{AR(tot)}</b>
            <span>{t("استراتيجية وطنية", "national")}</span>
          </div>
          <div className="side">
            {NAT_STEPS.map((s, i) => (
              <KV key={s} label={s} n={c[i]} tot={tot} tone={i >= 2 ? "g" : ""} />
            ))}
          </div>
        </div>
        <div className="gen">
          <GCell k={t("قابلية القياس", "Measurability")}>
            <span className="bands">
              <span className="hi">
                {AR(band.hi)} <em>{t("مرتفعة", "high")}</em>
              </span>
              <span className="mid">
                {AR(band.mid)} <em>{t("متوسطة", "medium")}</em>
              </span>
              <span className="low">
                {AR(band.low)} <em>{t("منخفضة", "low")}</em>
              </span>
            </span>
          </GCell>
          <GCell k={t("مقبولة فنياً", "Technically accepted")}>
            {AR(tech)} <em>{`${t("من", "of")} ${AR(tot)}`}</em>
          </GCell>
          <GCell k={t("المؤشرات الممثَّلة", "Represented KPIs")}>
            {AR(rep)} <em>{`${t("من", "of")} ${AR(all)}`}</em>
          </GCell>
          <GCell k={t("آخر تحديث", "Last update")}>
            <span className="dt">{last}</span>
          </GCell>
        </div>
      </>,
    );
  }

  const cnt = (k: string, v: string) => items.filter((x) => txt(x.data[k]) === v).length;
  const met = cnt("meet", "تم");
  const docs = cnt("docs", "✓");
  const live = cnt("live", "مفعل");
  const pct = Math.round((live / tot) * 100);
  const goals = cnt("phase", "Phase 1");
  const kpis = cnt("phase", "Phase 2");
  return box(
    <>
      <div className="head-row">
        <div className="big">
          <b>{AR(tot)}</b>
          <span>{t("جهة", "entities")}</span>
        </div>
        <div className="side">
          <KV label={t("عُقد الاجتماع التعريفي", "Kickoff held")} n={met} tot={tot} />
          <KV label={t("الوثائق مستلمة", "Docs received")} n={docs} tot={tot} />
          <KV label={t("اكتملت الوثائق", "Docs complete")} n={cnt("docsState", "مكتمل")} tot={tot} />
          <KV label={t("فُعِّل القياس", "Measurement live")} n={live} tot={tot} tone="g" />
        </div>
      </div>
      <div className="gen">
        <GCell k={t("نسبة تفعيل القياس", "Measurement live %")}>
          <span className="meas">
            <span className="n hi">{AR(pct)}٪</span>
            <span className="bar">
              <i className="hi" style={{ width: `${pct}%` }} />
            </span>
          </span>
        </GCell>
        <GCell k={t("لم يُعقد اجتماعها", "Kickoff pending")}>
          {AR(tot - met)} <em>{t("جهة", "entities")}</em>
        </GCell>
        <GCell k="Phase 1 · Phase 2">
          {AR(goals)} <em>· {AR(kpis)}</em>
        </GCell>
        <GCell k={t("آخر تحديث", "Last update")}>
          <span className="dt">{last}</span>
        </GCell>
      </div>
    </>,
  );
}

/* ============================================================
   ٣) الاستراتيجيات المؤسسية — بطاقة لكل جهة
   ============================================================ */
function instStage(d: Rec) {
  return Math.max(0, Math.min(INST_STAGES.length, numOf(d.stage)));
}

export function InstStrategies({ limit, t, onMore }: { limit?: number; t: T; onMore?: () => void }) {
  const { items, loaded } = useItems("inststrat");
  if (!loaded) return <div className="empty">{t("جارٍ التحميل...", "Loading...")}</div>;
  if (!items.length)
    return (
      <Empty
        title={t("لا توجد جهات بعد", "Nothing yet")}
        note={t("تُضاف الجهات من زر «إضافة».", "Add entities.")}
      />
    );

  const g = (k: string, v: string) => items.filter((i) => txt(i.data[k]) === v).length;
  const met = g("meet", "تم");
  const docs = g("docs", "✓");
  const live = g("live", "مفعل");
  const shown = limit ? items.slice(0, limit) : items;

  return (
    <>
      <div className="sx-nums three">
        <div className="sx-tot">
          <b>{AR(items.length)}</b>
          <span>{t("جهة", "entities")}</span>
        </div>
        <div className="sx-nc">
          <div className="t">{t("عُقد الاجتماع التعريفي", "Kickoff held")}</div>
          <b>{AR(met)}</b>
          <div className="s">{`${t("من أصل", "of")} ${AR(items.length)}`}</div>
          <div className="sx-prog">
            <i style={{ width: `${items.length ? (met / items.length) * 100 : 0}%` }} />
          </div>
        </div>
        <div className="sx-nc g">
          <div className="t">{t("فُعِّل القياس", "Measurement live")}</div>
          <b>{AR(live)}</b>
          <div className="s">{`${t("من أصل", "of")} ${AR(items.length)}`}</div>
          <div className="sx-prog">
            <i className="g" style={{ width: `${items.length ? (live / items.length) * 100 : 0}%` }} />
          </div>
        </div>
      </div>

      <div className="sx-mini-row">
        <span>
          {t("الوثائق مستلمة", "Docs received")} <b>{AR(docs)}</b>
        </span>
        <span>
          Phase 1 <b>{AR(g("phase", "Phase 1"))}</b>
        </span>
        <span>
          Phase 2 <b>{AR(g("phase", "Phase 2"))}</b>
        </span>
      </div>

      <div className="sx-cards">
        {shown.map((it) => (
          <InstCard key={it.id} it={it} t={t} />
        ))}
      </div>
      {onMore && limit && items.length > limit && (
        <button className="sx-link mid" onClick={onMore}>
          {`${t("عرض الكل", "Show all")} (${AR(items.length)})`}
        </button>
      )}
    </>
  );
}

function InstCard({ it, t }: { it: Item; t: T }) {
  const d = it.data;
  const step = (k: string, on: boolean, label: string) => (
    <span key={k} className={`ist ${on ? "on" : ""}`}>
      {label}
    </span>
  );
  return (
    <div className="sx-card wide">
      <div className="sx-h">
        <b>{txt(d.owner) || "—"}</b>
        <span className="sx-own">{txt(d.consultant)}</span>
        <span className="sx-mini">{txt(d.sector)}</span>
        <span className="sx-pill">{txt(d.phase) || "—"}</span>
        <span className="sx-up">{txt(d.target) ? `${t("مستهدف", "target")} ${txt(d.target)}` : ""}</span>
      </div>
      <div className="ist-row">
        {step("rep", txt(d.rep) === "تمت تسمية ممثل", t("تسمية ممثل", "Rep named"))}
        {step("meet", txt(d.meet) === "تم", t("الاجتماع التعريفي", "Kickoff"))}
        {step("docs", txt(d.docs) === "✓", t("استلام الوثائق", "Docs"))}
        {step("ds", txt(d.docsState) === "مكتمل", t("اكتمال الوثائق", "Docs complete"))}
        {step("live", txt(d.live) === "مفعل", t("تفعيل القياس", "Measurement live"))}
      </div>
    </div>
  );
}

/* ---------------- بطاقة جهة واحدة ----------------
   أربع محطات، كل محطة باسمها وقيمتها تحتها ونقطة بلون حالتها —
   بدل خلايا جدول عرضها مئة بكسل يُقتطع فيها النص */
function instSteps(d: Rec, t: T) {
  const rep = txt(d.rep);
  const meet = txt(d.meet);
  const docs = txt(d.docs);
  const ds = txt(d.docsState);
  const live = txt(d.live);
  return [
    {
      k: t("تسمية ممثل", "Rep"),
      v: rep === "تمت تسمية ممثل" ? t("تمت", "Named") : rep || "—",
      c: rep === "تمت تسمية ممثل" ? "ok" : rep ? "wt" : "",
    },
    {
      k: t("الاجتماع التعريفي", "Kickoff"),
      v: meet === "تم" ? txt(d.meetAt) || t("تم", "Held") : meet || "—",
      c: meet === "تم" ? "ok" : meet ? "wt" : "",
    },
    {
      k: t("الوثائق", "Documents"),
      v: docs === "✓" ? ds || t("مستلمة", "Received") : docs === "✗" ? t("لم تُستلم", "Not received") : "—",
      c:
        docs === "✓"
          ? ds === "مكتمل" || !ds
            ? "ok"
            : ds === "جزئي"
              ? "wt"
              : "no"
          : docs === "✗"
            ? "no"
            : "",
    },
    { k: t("تفعيل القياس", "Measurement"), v: live || "—", c: live === "مفعل" ? "ok" : live ? "wt" : "" },
  ];
}

function InstEntity({ it, t, onEdit }: { it: Item; t: T; onEdit?: () => void }) {
  const d = it.data;
  const ph = txt(d.phase);
  return (
    <div className="iw">
      <div className="iw-h">
        <b>{txt(d.owner) || "—"}</b>
        <span className={`iw-ph ${ph === "Phase 1" ? "p1" : ""}`}>{ph || "—"}</span>
      </div>
      <div className="iw-who">
        <span>
          {t("الاستشاري", "Consultant")} <b>{txt(d.consultant) || "—"}</b>
        </span>
        {d.phone ? <span>{txt(d.phone)}</span> : null}
        {d.email ? <span>{txt(d.email)}</span> : null}
      </div>
      <div className="iw-steps">
        {instSteps(d, t).map((st) => (
          <div className={`iw-st ${st.c}`} key={st.k}>
            <i />
            <div className="k">{st.k}</div>
            <div className="v">{st.v}</div>
          </div>
        ))}
      </div>
      <div className="iw-f">
        {d.target ? (
          <span className="tg">{`${t("مستهدف التفعيل", "Target")} ${txt(d.target)}`}</span>
        ) : (
          <span>{t("لم يُحدَّد مستهدف التفعيل", "No activation target")}</span>
        )}
        {onEdit && (
          <button className="ed" onClick={onEdit}>
            {t("تعديل", "Edit")}
          </button>
        )}
      </div>
    </div>
  );
}

function InstPage({ t, canEdit }: { t: T; canEdit?: boolean }) {
  const { items, loaded, save, remove, reload, undo, undoTop, dismissUndo } = useItems("inststrat");
  const [q, setQ] = useState("");
  const [f, setF] = useState("");
  const [view, setView] = useState<"cards" | "table">("cards");
  /* القطاع المختار — تبويب أعلى الصفحة */
  const [tab, setTab] = useState(INST_SECTORS[0]);
  const [edit, setEdit] = useState<Item | null>(null);
  const [draft, setDraft] = useState<Record<string, Rec>>({});

  const val = (it: Item, k: string) => txt(draft[it.id]?.[k] ?? it.data[k]);

  async function put(it: Item, k: string, v: string) {
    const data = { ...it.data, ...(draft[it.id] || {}), [k]: v, demo: false };
    setDraft((old) => ({ ...old, [it.id]: { ...(old[it.id] || {}), [k]: v } }));
    await save(it.id, data, it.ord);
  }

  const rows = useMemo(
    () =>
      items.filter((it) => {
        const d = it.data;
        const hay = `${txt(d.owner)} ${txt(d.consultant)} ${txt(d.sector)} ${txt(d.email)}`;
        if (q && !hay.includes(q)) return false;
        if (f && txt(d.sector) !== f) return false;
        return true;
      }),
    [items, q, f],
  );

  function exportXl() {
    const head = INST_COLS.map((c) => c.label);
    const body = rows.map((it) => INST_COLS.map((c) => txt(it.data[c.k])));
    download("متابعة-الاستراتيجيات-المؤسسية.xlsx", writeXlsx([{ name: "المؤسسية", rows: [head, ...body] }]));
  }

  if (!loaded) return <div className="empty">{t("جارٍ التحميل...", "Loading...")}</div>;

  /* قطاعات الملف أولاً بترتيبها، ثم أي قطاع أُضيف لاحقاً */
  const secs = [...INST_SECTORS, ...Array.from(new Set(rows.map((r) => txt(r.data.sector)))).filter(
    (x) => x && !INST_SECTORS.includes(x),
  )];

  return (
    <>
      <Toolbar q={q} setQ={setQ} filter={f} setFilter={setF} options={INST_SECTORS} onExport={exportXl} t={t} />

      <div className="iw-bar">
        <span className="iw-tog">
          <span className={view === "cards" ? "on" : ""} onClick={() => setView("cards")}>
            ◫ {t("بطاقات", "Cards")}
          </span>
          <span className={view === "table" ? "on" : ""} onClick={() => setView("table")}>
            ▤ {t("جدول", "Table")}
          </span>
        </span>
        <span className="sx-count">
          {`${t("عرض", "Showing")} ${AR(rows.length)} ${t("من", "of")} ${AR(items.length)}`}
        </span>
      </div>

      {view === "cards" ? (
        <>
          <div className="stabs">
            {secs.map((sc) => {
              const n = items.filter((r) => txt(r.data.sector) === sc).length;
              return (
                <button
                  key={sc}
                  className={`stab ${!q && !f && tab === sc ? "on" : ""}`}
                  onClick={() => {
                    setQ("");
                    setF("");
                    setTab(sc);
                  }}
                >
                  <span className="l">{sc}</span>
                  <b>{AR(n)}</b>
                </button>
              );
            })}
          </div>

          {(() => {
            /* البحث أو الفلتر يتجاوز التبويب — من يبحث يريد النتيجة أينما كانت */
            const list = q || f ? rows : rows.filter((r) => txt(r.data.sector) === tab);
            if (!list.length) return <div className="pf-none">{t("لا توجد نتائج", "No results")}</div>;
            return (
              <div className="iw-grid">
                {list.map((it) => (
                  <InstEntity key={it.id} it={it} t={t} onEdit={canEdit ? () => setEdit(it) : undefined} />
                ))}
              </div>
            );
          })()}
        </>
      ) : (
        <div className="tbl-wrap">
          <table className="sx-tbl inst">
            <thead>
              <tr>
                <th className="c num">#</th>
                {INST_COLS.map((c) => (
                  <th key={c.k} style={{ minWidth: c.w }}>
                    {c.label}
                  </th>
                ))}
                {canEdit && <th className="c" />}
              </tr>
            </thead>
            <tbody>
              {rows.map((it, n) => (
                <tr key={it.id}>
                  <td className="c num">{AR(n + 1)}</td>
                  {INST_COLS.map((c) => {
                    const v = val(it, c.k);
                    const tone = instTone(c.k, v);
                    if (!canEdit)
                      return (
                        <td key={c.k} className={tone ? `cell ${tone}` : "cell"} style={{ minWidth: c.w }}>
                          {v || "—"}
                        </td>
                      );
                    return (
                      <td key={c.k} className={tone ? `cell ${tone}` : "cell"} style={{ minWidth: c.w }}>
                        {c.opts ? (
                          <select value={v} onChange={(e) => void put(it, c.k, e.target.value)}>
                            {c.opts.map((op) => (
                              <option key={op} value={op}>
                                {op || "—"}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            value={v}
                            onChange={(e) =>
                              setDraft((old) => ({ ...old, [it.id]: { ...(old[it.id] || {}), [c.k]: e.target.value } }))
                            }
                            onBlur={(e) => {
                              if (e.target.value !== txt(it.data[c.k])) void put(it, c.k, e.target.value);
                            }}
                          />
                        )}
                      </td>
                    );
                  })}
                  {canEdit && (
                    <td className="c">
                      <button
                        className="rowx"
                        title={t("حذف الصف", "Delete row")}
                        onClick={() => {
                          if (!confirm(t(`حذف «${txt(it.data.owner)}»؟`, "Delete row?"))) return;
                          void remove(it.id);
                        }}
                      >
                        ✕
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <UndoBar step={undoTop} onUndo={() => void undo()} onClose={dismissUndo} t={t} />

      {edit && (
        <InstForm
          it={edit}
          t={t}
          onClose={() => setEdit(null)}
          onSaved={() => {
            setEdit(null);
            void reload();
          }}
          save={save}
        />
      )}
    </>
  );
}

/* نافذة تعديل جهة — كل حقل بعنوانه الكامل وقائمته */
function InstForm({
  it, t, onClose, onSaved, save,
}: {
  it: Item;
  t: T;
  onClose: () => void;
  onSaved: () => void;
  save: (id: string, data: Rec, ord: number) => Promise<string | null>;
}) {
  const [d, setD] = useState<Rec>({ ...it.data });
  const [busy, setBusy] = useState("");

  async function submit() {
    setBusy(t("جارٍ الحفظ...", "Saving..."));
    const err = await save(it.id, { ...d, demo: false }, it.ord);
    if (err) {
      setBusy(err);
      return;
    }
    onSaved();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="m-h">
          <h3>{txt(it.data.owner) || t("تعديل جهة", "Edit entity")}</h3>
          <button className="mx" onClick={onClose} aria-label="close">
            ✕
          </button>
        </div>
        <div className="iw-form">
          {INST_COLS.map((c) => (
            <label key={c.k}>
              <span>{c.label}</span>
              {c.opts ? (
                <select value={txt(d[c.k])} onChange={(e) => setD({ ...d, [c.k]: e.target.value })}>
                  {c.opts.map((op) => (
                    <option key={op} value={op}>
                      {op || "—"}
                    </option>
                  ))}
                </select>
              ) : (
                <input value={txt(d[c.k])} onChange={(e) => setD({ ...d, [c.k]: e.target.value })} />
              )}
            </label>
          ))}
          <label className="full">
            <span>{t("ملاحظة", "Note")}</span>
            <textarea rows={2} value={txt(d.note)} onChange={(e) => setD({ ...d, note: e.target.value })} />
          </label>
        </div>
        <div className="m-f">
          {busy && <span className="iw-busy">{busy}</span>}
          <button className="btn btn-ghost" onClick={onClose}>
            {t("إلغاء", "Cancel")}
          </button>
          <button className="btn" onClick={submit}>
            {t("حفظ", "Save")}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   أعمال قياس تجربة المستفيد من الخدمات الحكومية
   ============================================================ */

/** يقسم بنود القسم: بند المستهدف المحجوز، وبقيةُ الأجهزة */
function cxSplit(items: Item[]) {
  const meta = items.find((x) => x.id === CX_META) || null;
  const rows = items.filter((x) => x.id !== CX_META);
  return { meta, rows, target: numOf(meta?.data.target) };
}

/** كل أرقام القسم — بمعادلات ورقة Dashboard في ملف المتابعة حرفياً */
function cxStats(items: Item[]) {
  const { rows, target, meta } = cxSplit(items);
  const stage: Record<string, number> = {};
  for (const g of CX_STAGES) stage[g.k] = rows.filter((it) => g.test(it.data)).length;

  /* «تقارير معتمدة» في الملف مجموعُ التقارير لا عدد الأجهزة: جهاز واحد
     قد يصدر له تقرير في أكثر من ربع. فنحسب الاثنين ونسمّي كلاً باسمه. */
  let reportsTot = 0;
  const byQ = CX_QS.map((q) => {
    const share = rows.filter((x) => txt(x.data[`${q.k}Share`]) === CX_OK).length;
    const issued = rows.filter((x) => txt(x.data[`${q.k}Issue`]) === CX_OK).length;
    const review = rows.filter((x) => cxProg(txt(x.data[`${q.k}Issue`]))).length;
    const none = rows.filter((x) => txt(x.data[`${q.k}Issue`]) === CX_NONE).length;
    reportsTot += issued;
    return { ...q, share, issued, review, none };
  });
  /* المستهدف في ملفك «٦٩ جهازاً» — فالمقارنة تكون بعدد الأجهزة التي
     صدر لها تقرير، لا بمجموع التقارير: تقرير مقابل جهاز لا يستقيم. */
  const doneAgencies = rows.filter((x) => CX_QS.some((q) => txt(x.data[`${q.k}Issue`]) === CX_OK)).length;
  const counted = rows.filter((x) => numOf(x.data.counted) === 1).length;
  const servTot = rows.reduce((a, x) => a + numOf(x.data.servTot), 0);
  const servPlan = rows.reduce((a, x) => a + numOf(x.data.servPlan), 0);
  const pct = target > 0 ? Math.round((doneAgencies / target) * 100) : null;

  const secs = [...INST_SECTORS, ...Array.from(new Set(rows.map((r) => txt(r.data.sector)))).filter(
    (x) => x && !INST_SECTORS.includes(x),
  )];
  const bySector = secs
    .map((sc) => {
      const list = rows.filter((r) => txt(r.data.sector) === sc);
      return {
        sector: sc,
        tot: list.length,
        started: list.filter((r) => txt(r.data.meet) === "تم").length,
        notStarted: list.filter((r) => txt(r.data.meet) === "لم يبدأ").length,
        noSurvey: list.filter((r) => txt(r.data.survey) === CX_NONE).length,
      };
    })
    .filter((x) => x.tot);

  return {
    rows, target, meta, stage, byQ, bySector,
    reportsTot, doneAgencies, counted, servTot, servPlan, pct,
    updated: txt(meta?.data.updated),
  };
}

/* البطاقة داخل «نظرة عامة» — بلا إطار خاص بها: يلفّها <Sec> في
   لوحة نظرة عامة كما يلفّ «المخرجات الوطنية» و«المشاريع»، فيتوحّد
   حجم العنوان وزرّ الطيّ مع بقية الأقسام (كان ١٤px بدل ١٨px). */
export function CxBox({ t }: { t: T }) {
  const { items, loaded } = useItems("cx");
  if (!loaded) return <div className="empty">{t("جارٍ التحميل...", "Loading...")}</div>;

  const st = cxStats(items);
  if (!st.rows.length)
    return (
      <div className="sx-none">
        {t("لا توجد بيانات بعد — تُرفع من صفحة القسم بملف المتابعة.", "No data yet.")}
      </div>
    );

  const n = st.rows.length;
  const steps = CX_STAGES.filter((g) => g.k !== "none");
  return (
    <div className="card cxc">
      <div className="cxc-l">
        {st.pct === null ? (
          <>
            <b className="big">{AR(st.doneAgencies)}</b>
            <b>{t("جهازاً صدر لها تقرير", "with a report")}</b>
            <span>{t("المستهدف لم يُحدَّد بعد", "No target set")}</span>
          </>
        ) : (
          <>
            <Ring pct={st.pct} size={140} tone="hi" />
            <b>{`${AR(st.doneAgencies)} ${t("من", "of")} ${AR(st.target)} ${t("جهازاً", "agencies")}`}</b>
            <span>{t("المحقق من المستهدف", "Achieved of target")}</span>
          </>
        )}
      </div>

      <div className="cxc-r">
        <div className="cxc-h">
          {t(`توزيع الأجهزة الـ${AR(n)} على المراحل`, `The ${n} agencies by stage`)}
        </div>
        {steps.map((g) => {
          const v = st.stage[g.k] || 0;
          return (
            <div className="cxc-b" key={g.k}>
              <span className="l">{t(g.ar, g.en)}</span>
              <span className="m">
                <i style={{ width: `${n ? (v / n) * 100 : 0}%`, background: g.c }} />
              </span>
              <b style={{ color: g.c }}>{AR(v)}</b>
            </div>
          );
        })}
        <div className="cxc-f">
          <span>
            {t("مجموع التقارير المعتمدة", "Approved reports")} <b>{AR(st.reportsTot)}</b>
          </span>
          <span>
            {t("احتُسبت في المؤشر", "Counted in KPI")} <b>{AR(st.counted)}</b>
          </span>
          <span>
            {t("الخدمات المخطط قياسها", "Services planned")} <b>{AR(st.servPlan)}</b> {t("من", "of")}{" "}
            <b>{AR(st.servTot)}</b>
          </span>
        </div>
      </div>
    </div>
  );
}

/* ---------- رفع ملف المتابعة ----------
   المطابقة بموضع العمود لا باسمه: عنوانا «مشاركة نتائج القياس Q4»
   يتكرران حرفياً (ربع ٢٠٢٥ وربع ٢٠٢٦)، فالاسم وحده لا يميّزهما.
   ولئلا يمرّ ملف تغيّر ترتيبه، نتحقق من ثلاثة عناوين مرساة أولاً. */
const CX_ANCHORS: [number, string][] = [
  [1, "اسم الجهاز"],
  [2, "القطاع"],
  [13, "عقد الاجتماع"],
];
const cxNorm = (v: string) =>
  v.replace(/[▼\n\r]/g, " ").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/\s+/g, " ").trim();

/** معرّف ثابت من اسم الجهاز، فإعادة الرفع تُحدِّث الصف نفسه ولا تكرّره */
function cxId(name: string): string {
  const k = cxNorm(name).replace(/\s/g, "");
  let h = 5381;
  for (let i = 0; i < k.length; i++) h = ((h * 33) ^ k.charCodeAt(i)) >>> 0;
  return "cx-" + h.toString(36);
}

/** الرقم التسلسلي لإكسل ⇒ YYYY-MM-DD · وما ليس تاريخاً يبقى كما هو */
function cxDate(v: string): string {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 20000 || n > 80000) return v;
  const ms = (n - 25569) * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

function CxImport({ t, onDone }: { t: T; onDone: () => void }) {
  const [msg, setMsg] = useState("");
  const ref = useRef<HTMLInputElement>(null);

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setMsg(t("جارٍ القراءة...", "Reading..."));
    try {
      const sheets = await readXlsxSheets(await f.arrayBuffer());
      const master =
        sheets.find((x) => cxNorm(x.name).includes("Master") || cxNorm(x.name).includes("Tracker")) ||
        sheets[0];
      const rows = master?.rows || [];
      const head = rows[2] || [];
      const bad = CX_ANCHORS.find(([i, lbl]) => !cxNorm(head[i] || "").startsWith(cxNorm(lbl)));
      if (bad) {
        setMsg(
          t(
            `تغيّر ترتيب أعمدة الملف — العمود ${bad[0] + 1} ليس «${bad[1]}». أرسلي الملف كما هو أو أبلغيني بالترتيب الجديد.`,
            "Column layout changed.",
          ),
        );
        return;
      }
      const items = rows
        .slice(3)
        .filter((r) => txt(r[1]).trim())
        .map((r, i) => {
          const data: Rec = {};
          CX_COLS.forEach((c, ci) => {
            const raw = txt(r[ci + 1]).trim();
            data[c.k] = c.k === "firstData" ? cxDate(raw) : raw;
          });
          return { id: cxId(data.name), ord: i + 1, data };
        });
      if (!items.length) {
        setMsg(t("لم يُقرأ أي صف من الملف", "No rows read"));
        return;
      }
      if (
        !confirm(
          t(
            `سيُحدَّث ${items.length} جهازاً من الملف. الموجود يُحدَّث بمعرّفه ولا يتكرّر، ولا يُحذف شيء. متابعة؟`,
            `Update ${items.length} agencies?`,
          ),
        )
      ) {
        setMsg("");
        return;
      }
      /* دفعات صغيرة: ١٥٠ صفاً في طلب واحد قد يتجاوز حدّ الطلب */
      for (let i = 0; i < items.length; i += 60) {
        const res = await apiFetch("/api/items", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ section: "cx", items: items.slice(i, i + 60) }),
        });
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          setMsg(d.error || t("تعذّر الحفظ", "Save failed"));
          return;
        }
      }
      /* المستهدف من ورقة «KPI L1» إن وُجد — «٦٩ جهاز» في خانة المستهدف */
      const kpi = sheets.find((x) => cxNorm(x.name).toUpperCase().includes("KPI"));
      const tgtCell = kpi?.rows?.[1]?.find((c) => /\d/.test(c) && cxNorm(c).includes("جهاز"));
      const tgt = tgtCell ? Number((tgtCell.match(/\d+/) || [])[0]) : 0;
      await apiFetch("/api/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          section: "cx",
          items: [
            {
              id: CX_META,
              ord: 0,
              data: { target: tgt || undefined, updated: new Date().toISOString().slice(0, 10) },
            },
          ],
        }),
      });
      setMsg(
        t(
          `تم تحديث ${items.length} جهازاً${tgt ? ` · المستهدف ${tgt}` : ""}`,
          `Updated ${items.length}`,
        ),
      );
      onDone();
    } catch {
      setMsg(t("تعذّرت قراءة الملف — تأكدي أنه xlsx", "Could not read the file"));
    }
  }

  return (
    <span className="seedb">
      <button className="btn btn-sm" onClick={() => ref.current?.click()}>
        {t("رفع ملف المتابعة", "Upload tracker")}
      </button>
      <input ref={ref} type="file" accept=".xlsx" hidden onChange={pick} />
      {msg && <em>{msg}</em>}
    </span>
  );
}

export function CxPage({ t, canEdit }: { t: T; canEdit: boolean }) {
  const { items, loaded, save, remove, reload, undo, undoTop, dismissUndo } = useItems("cx");
  const [q, setQ] = useState("");
  const [f, setF] = useState("");
  const [wide, setWide] = useState(false);
  const [stg, setStg] = useState("");
  const [draft, setDraft] = useState<Record<string, Rec>>({});
  const [tgtDraft, setTgtDraft] = useState<string | null>(null);

  const st = cxStats(items);
  const val = (it: Item, k: string) => txt(draft[it.id]?.[k] ?? it.data[k]);

  async function put(it: Item, k: string, v: string) {
    const data = { ...it.data, ...(draft[it.id] || {}), [k]: v };
    setDraft((old) => ({ ...old, [it.id]: { ...(old[it.id] || {}), [k]: v } }));
    await save(it.id, data, it.ord);
  }
  async function saveTarget(v: string) {
    const n = numOf(v);
    if (n === st.target) return;
    await save(CX_META, { ...(st.meta?.data || {}), target: n }, 0);
  }

  const cols = wide ? CX_COLS : CX_CORE;
  const shown = useMemo(
    () =>
      st.rows.filter((it) => {
        const d = it.data;
        if (q && !`${txt(d.name)} ${txt(d.consultant)} ${txt(d.sector)}`.includes(q)) return false;
        if (f && txt(d.sector) !== f) return false;
        if (stg && !CX_STAGES.find((g) => g.k === stg)?.test(d)) return false;
        return true;
      }),
    [st.rows, q, f, stg],
  );

  function exportXl() {
    const head = CX_COLS.map((c) => c.label);
    const body = shown.map((it) => CX_COLS.map((c) => txt(it.data[c.k])));
    download("متابعة-تجربة-المستفيد.xlsx", writeXlsx([{ name: "BEX", rows: [head, ...body] }]));
  }

  if (!loaded) return <div className="empty">{t("جارٍ التحميل...", "Loading...")}</div>;

  return (
    <>
      {canEdit && (
        <div className="sx-tools">
          <CxImport t={t} onDone={() => void reload()} />
          {st.updated && (
            <span className="sx-count">{`${t("آخر رفع", "Last upload")}: ${st.updated}`}</span>
          )}
        </div>
      )}

      {!st.rows.length ? (
        <Empty
          title={t("لا توجد بيانات بعد", "No data yet")}
          note={t(
            "ارفعي ملف المتابعة (Master Tracker) من زر «رفع ملف المتابعة» — تُقرأ كل الأعمدة كما هي.",
            "Upload the Master Tracker file.",
          )}
        />
      ) : (
        <>
          <div className="cx-kpis">
            <div className="cx-k">
              <b>{AR(st.rows.length)}</b>
              <span>{t("إجمالي الأجهزة", "Agencies")}</span>
            </div>
            <div className="cx-k ok">
              <b>{AR(st.doneAgencies)}</b>
              <span>{t("صدر لها تقرير", "With a report")}</span>
            </div>
            <div className="cx-k tgt">
              {canEdit ? (
                <input
                  className="cx-tin"
                  inputMode="numeric"
                  value={tgtDraft ?? (st.target || "")}
                  placeholder="—"
                  onChange={(e) => setTgtDraft(e.target.value)}
                  onBlur={(e) => {
                    setTgtDraft(null);
                    void saveTarget(e.target.value);
                  }}
                />
              ) : (
                <b>{st.target > 0 ? AR(st.target) : "—"}</b>
              )}
              <span>{t("المستهدف (جهاز)", "Target")}</span>
            </div>
            <div className="cx-k pct">
              <b>{st.pct === null ? "—" : `${AR(st.pct)}٪`}</b>
              <span>{t("المحقق من المستهدف", "Of target")}</span>
            </div>
          </div>

          {/* المراحل — كل شريحة تفلتر الجدول على مرحلتها */}
          <div className="cx-stages">
            {CX_STAGES.map((g) => (
              <button
                key={g.k}
                className={`cx-st ${stg === g.k ? "on" : ""}`}
                style={{ ["--c" as string]: g.c }}
                onClick={() => setStg(stg === g.k ? "" : g.k)}
              >
                <b>{AR(st.stage[g.k] || 0)}</b>
                <span>{t(g.ar, g.en)}</span>
              </button>
            ))}
          </div>

          <div className="cx-two">
            <div className="card">
              <h3>{t("التقارير حسب الربع", "Reports by quarter")}</h3>
              <table className="sx-tbl mini">
                <thead>
                  <tr>
                    <th>{t("الربع", "Quarter")}</th>
                    <th className="c">{t("مشاركة النتائج", "Results shared")}</th>
                    <th className="c">{t("تقرير معتمد", "Report issued")}</th>
                    <th className="c">{t("قيد المراجعة", "In review")}</th>
                    <th className="c">{t("لم يُستلم", "Not received")}</th>
                  </tr>
                </thead>
                <tbody>
                  {st.byQ.map((r) => (
                    <tr key={r.k}>
                      <td>{r.label}</td>
                      <td className="c">{AR(r.share)}</td>
                      <td className="c b">{AR(r.issued)}</td>
                      <td className="c">{AR(r.review)}</td>
                      <td className="c dim">{AR(r.none)}</td>
                    </tr>
                  ))}
                  <tr className="sum">
                    <td>{t("الإجمالي", "Total")}</td>
                    <td className="c">{AR(st.byQ.reduce((a, x) => a + x.share, 0))}</td>
                    <td className="c b">{AR(st.reportsTot)}</td>
                    <td className="c">{AR(st.byQ.reduce((a, x) => a + x.review, 0))}</td>
                    <td className="c dim">—</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="card">
              <h3>{t("توزيع الأجهزة حسب القطاع", "By sector")}</h3>
              <table className="sx-tbl mini">
                <thead>
                  <tr>
                    <th>{t("القطاع", "Sector")}</th>
                    <th className="c">{t("الأجهزة", "Agencies")}</th>
                    <th className="c">{t("بدأت", "Started")}</th>
                    <th className="c">{t("لم تبدأ", "Not started")}</th>
                    <th className="c">{t("لم يُستلم الحصر", "No survey")}</th>
                  </tr>
                </thead>
                <tbody>
                  {st.bySector.map((r) => (
                    <tr key={r.sector}>
                      <td>{r.sector}</td>
                      <td className="c b">{AR(r.tot)}</td>
                      <td className="c">{AR(r.started)}</td>
                      <td className="c dim">{AR(r.notStarted)}</td>
                      <td className="c dim">{AR(r.noSurvey)}</td>
                    </tr>
                  ))}
                  <tr className="sum">
                    <td>{t("الإجمالي", "Total")}</td>
                    <td className="c b">{AR(st.bySector.reduce((a, x) => a + x.tot, 0))}</td>
                    <td className="c">{AR(st.bySector.reduce((a, x) => a + x.started, 0))}</td>
                    <td className="c dim">{AR(st.bySector.reduce((a, x) => a + x.notStarted, 0))}</td>
                    <td className="c dim">{AR(st.bySector.reduce((a, x) => a + x.noSurvey, 0))}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <Toolbar q={q} setQ={setQ} filter={f} setFilter={setF} options={INST_SECTORS} onExport={exportXl} t={t} />

          <div className="iw-bar">
            <span className="iw-tog">
              <span className={!wide ? "on" : ""} onClick={() => setWide(false)}>
                {t("أعمدة أساسية", "Core columns")}
              </span>
              <span className={wide ? "on" : ""} onClick={() => setWide(true)}>
                {t("كل الأعمدة", "All columns")}
              </span>
            </span>
            <span className="sx-count">
              {`${t("عرض", "Showing")} ${AR(shown.length)} ${t("من", "of")} ${AR(st.rows.length)}`}
            </span>
          </div>

          <div className="tbl-wrap">
            <table className="sx-tbl inst">
              <thead>
                <tr>
                  <th className="c num">#</th>
                  {cols.map((c) => (
                    <th key={c.k} style={{ minWidth: c.w }}>
                      {c.label}
                    </th>
                  ))}
                  {canEdit && <th className="c" />}
                </tr>
              </thead>
              <tbody>
                {shown.map((it, n) => (
                  <tr key={it.id}>
                    <td className="c num">{AR(n + 1)}</td>
                    {cols.map((c) => {
                      const v = val(it, c.k);
                      const tn = cxTone(c, v);
                      const cls = tn ? `cell ${tn}` : "cell";
                      if (!canEdit)
                        return (
                          <td key={c.k} className={cls} style={{ minWidth: c.w }}>
                            {v || "—"}
                          </td>
                        );
                      return (
                        <td key={c.k} className={cls} style={{ minWidth: c.w }}>
                          {c.opts ? (
                            <select value={c.opts.includes(v) ? v : ""} onChange={(e) => void put(it, c.k, e.target.value)}>
                              {[...c.opts, ...(c.opts.includes(v) ? [] : [v])].map((op) => (
                                <option key={op} value={op}>
                                  {op || "—"}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <input
                              value={v}
                              onChange={(e) =>
                                setDraft((old) => ({
                                  ...old,
                                  [it.id]: { ...(old[it.id] || {}), [c.k]: e.target.value },
                                }))
                              }
                              onBlur={(e) => {
                                if (e.target.value !== txt(it.data[c.k])) void put(it, c.k, e.target.value);
                              }}
                            />
                          )}
                        </td>
                      );
                    })}
                    {canEdit && (
                      <td className="c">
                        <button
                          className="rowx"
                          title={t("حذف الصف", "Delete row")}
                          onClick={() => {
                            if (!confirm(t(`حذف «${txt(it.data.name)}»؟`, "Delete row?"))) return;
                            void remove(it.id);
                          }}
                        >
                          ✕
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <UndoBar step={undoTop} onUndo={() => void undo()} onClose={dismissUndo} t={t} />
    </>
  );
}

/* ============================================================
   ٥) المشاريع الاستراتيجية
   ============================================================ */
export function Projects({ t, canEdit }: { t: T; canEdit: boolean }) {
  const { items, loaded, remove, undo, undoTop, dismissUndo, reload } = useItems("projects");
  const [edit, setEdit] = useState<Item | null>(null);
  /* النسب تُدخَل بكسور عشرية (٤١٫٣) فطرحها المباشر يعطي ٦٫٥٩٩٩٩٩٩٩٩٩٩٩٩٩٤ —
     التقريب لخانة واحدة عند العرض وحده، والقيمة المحفوظة تبقى كما أُدخلت. */
  const p1 = (n: number) => Math.round(n * 10) / 10;

  if (!loaded) return <div className="empty">{t("جارٍ التحميل...", "Loading...")}</div>;
  if (!items.length)
    return (
      <Empty
        title={t("لا توجد مشاريع بعد", "No projects yet")}
        note={t("يُضاف المشروع ونسبتا التقدم من زر «إضافة».", "Add a project and its progress.")}
      />
    );
  return (
    <>
      <div className="sx-pjs">
        {items.map((it) => {
          const d = it.data;
          const planned = numOf(d.planned);
          const actual = numOf(d.actual);
          const g = p1(actual - planned);
          // مشروع لم تصل بياناته بعد: لا نعرض «متقدم ٠٪» بل نقول ذلك صراحةً
          const blank = planned === 0 && actual === 0;
          return (
            <div className="sx-pj" key={it.id}>
              <div className="tile">
                <b>{AR(p1(actual))}٪</b>
                <span>{t("الإنجاز الفعلي", "Actual")}</span>
                <em>{`${t("المخطط", "Planned")} ${AR(p1(planned))}٪`}</em>
                {blank ? (
                  <span className="sx-gap wait">{t("بانتظار البيانات", "Awaiting data")}</span>
                ) : (
                  <span className={`sx-gap ${g < 0 ? "neg" : "pos"}`}>
                    {g < 0 ? `متأخر ${AR(Math.abs(g))}٪` : `متقدم ${AR(g)}٪`}
                  </span>
                )}
              </div>
              <div className="bd">
                <h4>{txt(d.name) || "—"}</h4>
                <div className="meta">
                  {d.status ? <span className="sx-pill">{txt(d.status)}</span> : null}
                  {d.owner ? <span className="m">{`${t("الراعي", "Sponsor")}: ${txt(d.owner)}`}</span> : null}
                  {d.period ? <span className="m">{txt(d.period)}</span> : null}
                  {numOf(d.months) > 0 ? (
                    <span className="m">{`· ${t("الشهر", "Month")} ${AR(numOf(d.elapsed))} ${t("من", "of")} ${AR(numOf(d.months))}`}</span>
                  ) : null}
                </div>
                <div className="br pl">
                  <div className="lb">
                    <span>{t("المخطط", "Planned")}</span>
                    <b>{AR(p1(planned))}٪</b>
                  </div>
                  <div className="bar">
                    <i style={{ width: `${Math.max(0, Math.min(100, planned))}%` }} />
                  </div>
                </div>
                <div className="br ac">
                  <div className="lb">
                    <span>{t("الفعلي", "Actual")}</span>
                    <b>{AR(p1(actual))}٪</b>
                  </div>
                  <div className="bar">
                    <i style={{ width: `${Math.max(0, Math.min(100, actual))}%` }} />
                  </div>
                </div>
                {d.note ? <p className="sx-pj-note">{txt(d.note)}</p> : null}
              </div>
              {canEdit && (
                <div className="sx-pj-x">
                  <button className="rowx" title={t("تعديل", "Edit")} onClick={() => setEdit(it)}>
                    ✎
                  </button>
                  <button
                    className="rowx"
                    title={t("حذف المشروع", "Delete project")}
                    onClick={() => {
                      if (!confirm(t(`حذف «${txt(d.name)}»؟`, "Delete project?"))) return;
                      void remove(it.id);
                    }}
                  >
                    ✕
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <UndoBar step={undoTop} onUndo={() => void undo()} onClose={dismissUndo} t={t} />

      {edit && (
        <ItemForm
          section="projects"
          item={edit}
          t={t}
          onClose={(changed) => {
            setEdit(null);
            if (changed) void reload();
          }}
        />
      )}
    </>
  );
}

/* ============================================================
   ٤) المخرجات الوطنية — فاضية حتى يُعتمد محتواها
   ============================================================ */
export function Outputs({ t }: { t: T }) {
  return (
    <Empty
      title={t("الصفحة قيد الإعداد", "Under preparation")}
      note={t(
        "بانتظار تحديد محتوى المخرجات الوطنية من الإدارة المعنية — وسيُضاف الجدول والتفاصيل بعد اعتماد البيانات.",
        "Awaiting the content of national outputs.",
      )}
    />
  );
}

/* ============================================================
   الصفحات الكاملة
   ============================================================ */
export function SectionPage({ section, canEdit, t }: { section: SectionKey; canEdit: boolean; t: T }) {
  const [editing, setEditing] = useState<Item | "new" | null>(null);
  const [nonce, setNonce] = useState(0);
  /* معرّفات ما هو محمَّل فعلاً — ليعرف زر التحميل ما ينقص */
  const { items } = useItems(section, section !== "outputs");
  const have = useMemo(() => new Set(items.map((x) => x.id)), [items]);

  if (section === "outputs") return <Outputs t={t} />;

  return (
    <div key={nonce}>
      {canEdit && (
        <div className="sx-tools">
          <button className="btn btn-sm" onClick={() => setEditing("new")}>
            {t("إضافة", "Add")}
          </button>
          {SEEDED.includes(section) && (
            <SeedBtn
              section={section}
              have={have}
              t={t}
              onDone={() => setNonce((n) => n + 1)}
            />
          )}
        </div>
      )}
      {section === "sessions" && <SessionsPage t={t} />}
      {section === "natstrat" && <NationalPage t={t} canEdit={canEdit} />}
      {section === "inststrat" && <InstPage t={t} canEdit={canEdit} />}
      {section === "cx" && <CxPage t={t} canEdit={canEdit} />}
      {section === "projects" && <Projects t={t} canEdit={canEdit} />}


      {editing && (
        <ItemForm
          section={section}
          item={editing === "new" ? null : editing}
          t={t}
          onClose={(changed) => {
            setEditing(null);
            if (changed) setNonce((n) => n + 1);
          }}
        />
      )}
    </div>
  );
}

/* جدول تحرير مبسّط أسفل الصفحة — لمن يملك «تحرير بيانات هذه الأقسام» */

/* ---------------- نافذة إدخال/تعديل بند ---------------- */
type Field = { k: string; label: string; kind?: "num" | "text" | "date" | "bool" | "area" };

const FIELDS: Record<Exclude<SectionKey, "outputs">, Field[]> = {
  sessions: [
    { k: "entity", label: "الجهة" },
    { k: "quarter", label: "الربع" },
    { k: "done", label: "عدد المراحل المكتملة", kind: "num" },
  ],
  natstrat: [
    { k: "name", label: "الاستراتيجية" },
    { k: "owner", label: "الجهة المالكة" },
    { k: "domain", label: "النطاق (التوطين · الحج · الفضاء…)" },
    { k: "stage", label: "حالة الاعتماد (1 إعداد · 2 مراجعة · 3 اللجنة · 4 مجلس الوزراء)", kind: "num" },
    { k: "tech", label: "مقبولة فنياً؟", kind: "bool" },
    { k: "meas", label: "قابلية القياس ٪", kind: "num" },
    { k: "note", label: "أبرز الملاحظات", kind: "area" },
    { k: "period", label: "فترة الاستراتيجية" },
    { k: "approvedAt", label: "تاريخ الاعتماد", kind: "date" },
    { k: "kpisRep", label: "المؤشرات الممثلة", kind: "num" },
    { k: "kpisTot", label: "إجمالي المؤشرات", kind: "num" },
    { k: "initRep", label: "المبادرات الممثلة", kind: "num" },
    { k: "initTot", label: "إجمالي المبادرات", kind: "num" },
    { k: "current", label: "الوضع الحالي", kind: "area" },
    { k: "challenge", label: "التحدي", kind: "area" },
    { k: "next", label: "الخطوات القادمة", kind: "area" },
    { k: "support", label: "الدعم المطلوب", kind: "area" },
    { k: "updated", label: "آخر تحديث", kind: "date" },
  ],
  inststrat: [
    { k: "sector", label: "القطاع" },
    { k: "owner", label: "الجهة" },
    { k: "consultant", label: "الاستشاري" },
    { k: "phone", label: "رقم الجوال" },
    { k: "email", label: "البريد الإلكتروني" },
    { k: "rep", label: "تسمية ممثل (تمت تسمية ممثل · لم يُرسل بعد)" },
    { k: "meet", label: "الاجتماع التعريفي (تم · لم يتم بعد)" },
    { k: "meetAt", label: "تاريخ الاجتماع" },
    { k: "docs", label: "استلام الوثائق (✓ · ✗)" },
    { k: "docsState", label: "حالة الوثائق (مكتمل · جزئي · لايمكن قياسه)" },
    { k: "target", label: "تفعيل القياس المستهدف (Q1..Q4)" },
    { k: "live", label: "حالة التفعيل (مفعل · غير مفعل)" },
    { k: "phase", label: "Phase 1 · Phase 2" },
    { k: "note", label: "ملاحظة", kind: "area" },
  ],
  cx: [
    { k: "owner", label: "الجهة" },
    { k: "sector", label: "القطاع" },
    { k: "state", label: "الحالة (لم يبدأ · جارٍ القياس · مكتمل)" },
    { k: "services", label: "عدد الخدمات", kind: "num" },
    { k: "measured", label: "الخدمات المقيسة", kind: "num" },
    { k: "updated", label: "آخر تحديث" },
    { k: "note", label: "ملاحظة", kind: "area" },
  ],
  projects: [
    { k: "name", label: "اسم المشروع" },
    { k: "owner", label: "الراعي" },
    { k: "status", label: "الحالة" },
    { k: "planned", label: "نسبة التقدم المخطط ٪", kind: "num" },
    { k: "actual", label: "نسبة التقدم الفعلي ٪", kind: "num" },
    { k: "period", label: "الفترة" },
    { k: "months", label: "مدة المشروع (شهر)", kind: "num" },
    { k: "elapsed", label: "الشهر الحالي", kind: "num" },
    { k: "note", label: "ملاحظة", kind: "area" },
  ],
};

function ItemForm({
  section,
  item,
  t,
  onClose,
}: {
  section: SectionKey;
  item: Item | null;
  t: T;
  onClose: (changed: boolean) => void;
}) {
  const fields = FIELDS[section as Exclude<SectionKey, "outputs">] || [];
  const [form, setForm] = useState<Rec>(() => ({ ...(item?.data || {}) }));
  const [stages, setStages] = useState<{ n: string; d: string }[]>(() => {
    if (section !== "sessions") return [];
    const raw = Array.isArray(item?.data?.stages) ? item!.data.stages : [];
    return raw.length
      ? raw.map((x: Rec) => ({ n: txt(x.n), d: txt(x.d) }))
      : SESS_STAGES.map((n) => ({ n, d: "" }));
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const { save } = useItems(section, false);
  const id = useMemo(() => item?.id || "", [item]);

  async function submit() {
    setBusy(true);
    setErr("");
    const data: Rec = { ...form };
    for (const f of fields) if (f.kind === "num") data[f.k] = numOf(data[f.k]);
    if (section === "sessions") data.stages = stages;
    // علامة صريحة أن الصف صار من إدخال الإدارة، فلا يكتب عليه
    // تحديثُ البيانات المبدئية عند إعادة تشغيل ملف SQL
    data.demo = false;
    const e = await save(id, data, item?.ord ?? 100);
    setBusy(false);
    if (e) {
      setErr(e);
      return;
    }
    onClose(true);
  }

  return (
    <div className="modal-overlay" onClick={() => onClose(false)}>
      <div className="modal sx-modal" onClick={(e) => e.stopPropagation()}>
        <div className="m-h">
          <h3>{item ? t("تعديل بند", "Edit item") : t("بند جديد", "New item")}</h3>
          <button className="mx" onClick={() => onClose(false)} aria-label="close">
            ✕
          </button>
        </div>
        <div className="sx-form">
          {fields.map((f) =>
            f.kind === "bool" ? (
              <label key={f.k} className="ck">
                <input
                  type="checkbox"
                  checked={!!form[f.k]}
                  onChange={(e) => setForm({ ...form, [f.k]: e.target.checked })}
                />
                <span>{f.label}</span>
              </label>
            ) : (
              <label key={f.k}>
                <span>{f.label}</span>
                {f.kind === "area" ? (
                  <textarea
                    rows={2}
                    value={form[f.k] ?? ""}
                    onChange={(e) => setForm({ ...form, [f.k]: e.target.value })}
                  />
                ) : (
                  <input
                    type={f.kind === "num" ? "number" : "text"}
                    value={form[f.k] ?? ""}
                    placeholder={f.kind === "date" ? "YYYY-MM-DD" : ""}
                    onChange={(e) => setForm({ ...form, [f.k]: e.target.value })}
                  />
                )}
              </label>
            ),
          )}
          {section === "sessions" && (
            <div className="sx-stages">
              <div className="hd">{t("المراحل وتواريخها", "Stages & dates")}</div>
              {stages.map((s, i) => (
                <div className="rw" key={i}>
                  <input
                    value={s.n}
                    onChange={(e) => {
                      const next = [...stages];
                      next[i] = { ...next[i], n: e.target.value };
                      setStages(next);
                    }}
                  />
                  <input
                    value={s.d}
                    placeholder="YYYY-MM-DD"
                    onChange={(e) => {
                      const next = [...stages];
                      next[i] = { ...next[i], d: e.target.value };
                      setStages(next);
                    }}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
        {err && <div className="alert alert-error">{err}</div>}
        <div className="m-f">
          <button className="btn btn-ghost" onClick={() => onClose(false)}>
            {t("إلغاء", "Cancel")}
          </button>
          <button className="btn" disabled={busy} onClick={submit}>
            {busy ? t("يُحفظ...", "Saving...") : t("حفظ", "Save")}
          </button>
        </div>
      </div>
    </div>
  );
}
