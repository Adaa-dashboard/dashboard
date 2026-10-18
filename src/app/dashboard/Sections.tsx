"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { CycleBar, CYCLE_CFG } from "./Cycle";
import {
  nqTally, nqCriteria, nqGroup, nqQuarters, nqQOrder, nqObs, nqOfQuarter,
  nqKeyOf, nqNrm, nqCheck, nqBand, nqEntities, NQ_BANDS, NQ_CKEYS, type NQStat,
} from "@/lib/notesq";
import { writeXlsx, readXlsxSheets, readPptxSlides } from "@/lib/sheet";
import { asset } from "@/lib/base";
import { publishUndo } from "@/lib/undoBus";
import { initials, toneOf } from "@/lib/entlogo";
import { IconGear, IconDown, IconUp } from "./icons";
import SectionSettings from "./SectionSettings";
import DonutCard from "./DonutCard";
import { PIcon } from "./pickicons";
import { natDonut, instDonut, sesDonut, cxDonut } from "@/lib/weekReport";
import { loadProjectOutputs, type PdSummary } from "@/lib/pdash";

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

export type SectionKey =
  | "sessions" | "natstrat" | "inststrat" | "outputs" | "cx" | "projects" | "opplan" | "notesq";

export const SECTION_TITLE: Record<SectionKey, [string, string]> = {
  sessions: ["جلسات مراجعة الأداء", "Performance review sessions"],
  natstrat: ["الاستراتيجيات الوطنية", "National strategies"],
  inststrat: ["الاستراتيجيات المؤسسية", "Institutional strategies"],
  outputs: ["المخرجات الوطنية", "National outputs"],
  cx: ["أعمال قياس تجربة المستفيد من الخدمات الحكومية", "Beneficiary experience measurement"],
  projects: ["المشاريع الاستراتيجية", "Strategic projects"],
  opplan: ["الخطة التشغيلية لإدارة عمليات الأداء", "Operational plan"],
  notesq: ["جودة ملاحظات الأداء", "Performance notes quality"],
};

/* اسم مختصر لعنصر القائمة الجانبية — الاسم الكامل يطول عليه */
export const SECTION_NAV_TITLE: Partial<Record<SectionKey, [string, string]>> = {
  cx: ["قياس تجربة المستفيد", "Beneficiary experience"],
  opplan: ["الخطة التشغيلية", "Operational plan"],
};

/* مراحل المسار — مبدئية حتى تعتمدها الإدارة المعنية */
/* المراحل الستّ كما في «آلية عمل جلسة مراجعة الأداء للأجهزة العامة»
   — المركز الوطني لقياس أداء الأجهزة العامة، أكتوبر ٢٠٢٥ */
export const SESS_STAGES = [
  "مراجعة وتحليل الأداء",
  "حصر التحديات والإجراءات التصحيحية",
  "عقد جلسة مراجعة الأداء التحضيرية",
  "عقد جلسة مراجعة الأداء النهائية",
  "مشاركة نتائج جلسة مراجعة الأداء",
  "متابعة تطبيق الإجراءات التصحيحية",
];
/** أسماءٌ قصيرة للعرض في الأشرطة والتبويبات — الكاملة تطول عليها */
export const SESS_SHORT = [
  "مراجعة وتحليل الأداء",
  "حصر التحديات",
  "الجلسة التحضيرية",
  "الجلسة النهائية",
  "مشاركة النتائج",
  "متابعة الإجراءات",
];
/* الأسماء التي كانت قبل اعتماد الآلية — تُستبدل **عرضاً** لا حذفاً:
   البند المحفوظ يبقى كما هو، وترتيب المراحل الست واحد فلا يضيع
   موضع الجهة في المسار */
const SESS_LEGACY = ["تحديد الجهة", "جمع البيانات", "إعداد التقرير", "انعقاد الجلسة", "محضر وتوصيات", "الإغلاق"];

/* مراحل التصعيد الأربع كما في الآلية — تُفعَّل حين يتأخّر استكمال
   الإجراء التصحيحي عن تاريخ تنفيذه. المدّة في الثالثة والرابعة
   تُحتسب من تاريخ الاستحقاق لا من تاريخ الجلسة. */
const ESC_LEVELS: { n: number; name: string; owner: string; note: string; hex: string }[] = [
  {
    n: 1,
    name: "التصعيد إلى إدارة الخدمات الاستشارية",
    owner: "المركز الوطني لقياس أداء الأجهزة العامة",
    note: "يتابع فريق المركز الإجراءات التصحيحية دورياً مع منسوبي الجهة، ويُرفع الأمر إلى مدير الخدمات الاستشارية إن قرب موعد اكتمال الإجراء ولم يتجاوب استشاري الجهة.",
    hex: "#0f8a8a",
  },
  {
    n: 2,
    name: "التصعيد إلى الإدارة التنفيذية",
    owner: "المركز الوطني لقياس أداء الأجهزة العامة",
    note: "يُصعِّد فريق جلسات مراجعة الأداء إلى الإدارة التنفيذية للمركز الإجراءاتِ التصحيحية التي تخطّت تاريخ استحقاقها.",
    hex: "#e0971a",
  },
  {
    n: 3,
    name: "التصعيد إلى مجلس الإدارة",
    owner: "مجلس إدارة المركز",
    note: "تُصعَّد الإجراءات التصحيحية التي تخطّت تاريخ تنفيذها مدةً تزيد على ٣ أشهر إلى مجلس إدارة المركز.",
    hex: "#c0392b",
  },
  {
    n: 4,
    name: "التصعيد إلى مركز الحكومة",
    owner: "مركز الحكومة",
    note: "تُصعَّد الإجراءات التصحيحية التي تخطّت تاريخ تنفيذها مدةً تزيد على ٦ أشهر إلى مركز الحكومة لطلب الدعم.",
    hex: "#7a1f2b",
  },
];
/** مرحلة التصعيد المسجَّلة للبند · 0 = لا تصعيد */
const escOf = (d: Rec) => Math.max(0, Math.min(ESC_LEVELS.length, numOf(d.esc)));
const escAt = (n: number) => ESC_LEVELS.find((x) => x.n === n);

/* نطاقات الأداء العام كما في الآلية: ≥٩٠٪ على المسار الصحيح ·
   ٧٠–٨٩٪ على المسار بشكل جزئي · أقل من ٧٠٪ متعثر */
const PERF_BANDS: { min: number; label: string; tone: "hi" | "mid" | "low"; hex: string }[] = [
  { min: 90, label: "على المسار الصحيح", tone: "hi", hex: "#1a9d5c" },
  { min: 70, label: "على المسار بشكل جزئي", tone: "mid", hex: "#e0971a" },
  { min: 0, label: "متعثر", tone: "low", hex: "#c0392b" },
];
const perfBand = (v: number) => PERF_BANDS.find((b) => v >= b.min) || PERF_BANDS[2];
/* حالة اعتماد الاستراتيجية الوطنية — أربع محطات */
const NAT_STEPS = ["طور الإعداد/التحديث", "قيد المراجعة", "معتمدة من اللجنة", "معتمدة من مجلس الوزراء"];
/* عبارات «حالة الاعتماد» كما تُكتب في ملف المتابعة — تُستعمل في
   التنزيل فيعود الملف إلى المنصة بلا تحويل */
const NAT_STAGE_XL = [
  "إعداد/ تحديث الاستراتيجية (لدى الجهة المالكة للاستراتيجية)",
  "مراجعة الاستراتيجية المحدثة والعرض على اللجنة الاستراتيجية (لدى اللجنة الاستراتيجية)",
  "استراتيجية معتمدة من اللجنة الاستراتيجية",
  "معتمدة من مجلس الوزراء",
];
const NAT_WHERE = ["لدى الجهة المالكة", "لدى اللجنة الاستراتيجية", "اللجنة الاستراتيجية", "اعتماد نهائي"];
/* مسار المراجعة الأربع — مسار مستقل عن «حالة الاعتماد»:
   لكل مرحلة حالتها (لم يبدأ · قيد التنفيذ · مكتمل) كما في عرض الإدارة */
const NAT_TRACK = ["استلام الوثيقة", "استلام نموذج الحصر", "المراجعة الفنية", "اعتماد نموذج الحصر"];
const TRACK_STATE = ["لم يبدأ", "قيد التنفيذ", "مكتمل"];
/** كم محطةً اكتملت من الأربع */
function natDoneSteps(d: Rec): number {
  return natTrack(d).filter((v) => v === 2).length;
}
/** مستوى الاستيفاء: الأربع كلها ⇒ مقبولة فنياً وخضراء · ثلاثٌ ⇒ صفراء
    · ما دونها ⇒ حمراء. وكلّ ما لم يكتمل الأربع غيرُ مقبولٍ فنياً —
    فالقبول يُشتقّ من المحطات لا يُكتب يدوياً */
function natLevel(d: Rec): "ok" | "warn" | "bad" {
  const n = natDoneSteps(d);
  return n >= 4 ? "ok" : n === 3 ? "warn" : "bad";
}
function natTech(d: Rec): boolean {
  return natDoneSteps(d) >= 4;
}

/** حالات المراحل الأربع — الافتراضي «لم يبدأ» ولا يُستنتج من غيره */
function natTrack(d: Rec): number[] {
  const raw = Array.isArray(d.track) ? d.track : [];
  /* `track0..3` بقايا رفعٍ قديم كانت تُحفظ مفاتيحَ مفردة قبل أن
     تُجمَّع في مصفوفة — تُقرأ هنا فلا يحتاج الملف رفعاً ثانياً.
     والأعلى من الاثنين هو المعتمد: البندُ قد يحمل مصفوفةً قديمة
     («قيد التنفيذ» من تدويرٍ يدوي) ومفاتيحَ مفردةً أحدثَ منها جاءت
     من الملف، فلو قُدِّمت المصفوفةُ وحدها بقيت المحطات صفراءَ والملف
     كلُّه «نعم». وتدويرُ المحطة يدوياً يمسح المفاتيح المفردة فيعود
     القرار لمن يعدّل */
  return NAT_TRACK.map((_, i) =>
    Math.max(0, Math.min(2, Math.max(numOf(raw[i], 0), numOf(d[`track${i}`], 0)))),
  );
}
/** يُسقِط مفاتيح `track0..3` القديمة عند الحفظ — `undefined` تختفي من JSON */
function natNoLegacy(d: Rec): Rec {
  return { ...d, track0: undefined, track1: undefined, track2: undefined, track3: undefined };
}
const INST_STAGES = ["وصلت المركز", "قيد المراجعة", "معالجة الملاحظات", "اعتُمدت", "فُعِّل القياس"];

/* أعمدة متابعة الاستراتيجيات المؤسسية — هي أعمدة ملف المتابعة نفسه
   حتى لا يُنقل بين الإكسل واللوحة. كل خلية تُحرَّر في مكانها. */
export type ICol = { k: string; label: string; opts?: string[]; w: number };
export const INST_SECTORS = ["المالي والاقتصادي", "البنية التحتية", "الخدمات الاجتماعية", "الشؤون الحكومية"];
/* العرض بالبكسل لأن الجدول يمرّر أفقياً — والقيم مقاسة على أطول
   نص فعلي في كل عمود، فلا يُقتطع اسم جهة ولا بريد */
export const INST_COLS: ICol[] = [
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
export const CX_QS = [
  { k: "q0", label: "Q4 — 2025م" },
  { k: "q1", label: "Q1 — 2026م" },
  { k: "q2", label: "Q2 — 2026م" },
  { k: "q3", label: "Q3 — 2026م" },
  { k: "q4", label: "Q4 — 2026م" },
];

export type CxCol = { k: string; label: string; w: number; opts?: string[]; core?: boolean };
/** ترتيب الأعمدة هو ترتيب الملف نفسه، فالفهرس هو أداة المطابقة عند الرفع */
export const CX_COLS: CxCol[] = [
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
/** مراحل ملف تجربة المستفيد التي ينطبق عليها البند.
    متداخلة لا متتابعة، فقد ينطبق أكثر من واحدة — تُعرض كلها. */
export function cxStagesOf(d: Rec): { k: string; ar: string; c: string }[] {
  return CX_STAGES.filter((s) => s.test(d)).map((s) => ({ k: s.k, ar: s.ar, c: s.c }));
}

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

  /* **التحديث الحيّ** — ما يُغيَّر في جهازٍ أو صفحةٍ أخرى يظهر هنا
     بلا إعادة تحميل: عند العودة إلى التبويب، وكل ٢٥ ثانية والصفحة
     ظاهرة. ولا طلبَ والصفحة في الخلفية. */
  useEffect(() => {
    if (!enabled) return;
    const tick = () => {
      if (!document.hidden) void load();
    };
    const iv = setInterval(tick, 25000);
    window.addEventListener("focus", tick);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(iv);
      window.removeEventListener("focus", tick);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [load, enabled]);

  /* التراجع: قبل كل حفظ أو حذف نلتقط الحالة السابقة للبند.
     المكدّس في الذاكرة — يُفرَّغ بإعادة تحميل الصفحة، والسجل
     الدائم هو audit_log في قاعدة البيانات. */
  const undoRef = useRef<UndoStep[]>([]);
  const [undoTop, setUndoTop] = useState<UndoStep | null>(null);
  /* رأس المكدّس — مستقل عن شريط التراجع: إخفاء الشريط لا ينزع
     الخطوة، فيبقى سهم التراجع في رأس اللوحة صالحاً */
  const [stackTop, setStackTop] = useState<UndoStep | null>(null);
  const itemsRef = useRef<Item[]>([]);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const push = useCallback((st: UndoStep) => {
    undoRef.current.push(st);
    if (undoRef.current.length > UNDO_MAX) undoRef.current.shift();
    setUndoTop(st);
    setStackTop(st);
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
    setStackTop(undoRef.current[undoRef.current.length - 1] || null);
    if (!st) return null;
    const err = st.before ? await put(st.id, st.before, st.ord) : await del(st.id);
    return err;
  }, [put, del]);

  /* إخفاء الشريط دون إفراغ المكدّس — الخطوة تبقى قابلة للتراجع
     من الشريط التالي إن حدث تغيير آخر */
  const dismissUndo = useCallback(() => setUndoTop(null), []);

  /* نشر رأس المكدّس لسهم التراجع في رأس اللوحة. المُعرّف يحمل القسم
     فلا تمسح صفحةٌ خطوةَ غيرها، والتنظيف عند الخروج من الصفحة. */
  const busId = useRef(`items:${section}:${Math.random().toString(36).slice(2)}`).current;
  useEffect(() => {
    publishUndo(
      busId,
      stackTop
        ? {
            kind: stackTop.kind,
            label: stackTop.label,
            run: () => undo().then((e) => e ?? null),
          }
        : null,
    );
  }, [busId, stackTop, undo]);
  useEffect(() => () => publishUndo(busId, null), [busId]);

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
/* «تحميل البيانات الأولية» أُزيل من الأعمال الرئيسية بطلب صاحبة
   المنصة: بياناتها دخلت مرّة، فبقاء الزرّ بابٌ لإعادة تحميلها فوق
   ما حُرّر. ويبقى في «المشاريع الاستراتيجية» وحدها. */
const SEEDED: SectionKey[] = ["projects"];

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

/* الأعمال الرئيسية صفحاتٌ موحّدة: شريطٌ واحد في صدره «إضافة»،
   وفي آخره صندوقا الإكسل ثم ⚙️ — والصفحة تستقبلهما وتضعهما في
   شريطها، فلا يبقى شريطان فوق بعض */
type SecPageProps = { t: T; canEdit?: boolean; add?: ReactNode; gear?: ReactNode };

function Toolbar({
  q,
  setQ,
  filter,
  setFilter,
  options,
  onExport,
  upload,
  add,
  gear,
  allLabel,
  t,
}: {
  q: string;
  setQ: (v: string) => void;
  filter: string;
  setFilter: (v: string) => void;
  /** نصّاً، أو {v: القيمة, l: النص المعروض} حين يُعرض معه عدد */
  options: (string | { v: string; l: string })[];
  onExport: () => void;
  /** زرّ رفع الملف — يقف بجانب زرّ التنزيل لا في سطرٍ فوقه،
      فالعملان على الملف نفسه وموضعهما واحد.
      والتسمية بطلب صاحبة المنصة: **السهم هو الذي يقول الاتجاه** —
      «تنزيل إكسل ⬇» يأخذ الملف، و«رفع إكسل ⬆» يردّه إلى المنصة. */
  upload?: ReactNode;
  /** زرّ «إضافة» — في صدر الشريط */
  add?: ReactNode;
  /** ⚙️ إعدادات القسم — في آخره مع صندوقَي الإكسل */
  gear?: ReactNode;
  /** نص الخيار الأول — «كل الحالات» ما لم يُمرَّر غيره */
  allLabel?: string;
  t: T;
}) {
  return (
    <div className="sx-tb">
      {add}
      <input
        className="sx-search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t("بحث بالاسم أو الجهة…", "Search…")}
      />
      <select value={filter} onChange={(e) => setFilter(e.target.value)}>
        <option value="">{allLabel || t("كل الحالات", "All statuses")}</option>
        {options.map((o) => {
          const v = typeof o === "string" ? o : o.v;
          const l = typeof o === "string" ? o : o.l;
          return (
            <option key={v} value={v}>
              {l}
            </option>
          );
        })}
      </select>
      {/* الفراغ يدفع الإكسل والإعدادات إلى آخر الشريط — أي إلى
          يساره في صفحةٍ عربية */}
      <span className="gr" />
      {/* صندوق الإكسل واحدٌ في المنصة كلها: أخضر مصمت وسهمٌ يقول
          أهو تنزيلٌ أم رفع — وكان هذا شفّافاً وذاك مصمتاً */}
      <button className="btn btn-sm" onClick={onExport}>
        <IconDown size={15} /> {t("تنزيل إكسل", "Download Excel")}
      </button>
      {upload}
      {gear}
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
  let names = raw.length ? raw.map((x: Rec) => txt(x.n)) : SESS_STAGES;
  /* بندٌ محفوظ بالأسماء القديمة يُعرض بأسماء الآلية المعتمدة */
  if (
    names.length === SESS_LEGACY.length &&
    names.every((n: string, i: number) => n === SESS_LEGACY[i])
  )
    names = SESS_STAGES;
  const dates = raw.map((x: Rec) => txt(x.d));
  const done = Math.max(0, Math.min(names.length, numOf(d.done)));
  /* المرحلة الحالية: ما بعد المكتمل. وبلوغ الأخيرة يعني الاكتمال */
  const at = done >= names.length ? -1 : done;
  return { names, dates, done, full: names.length, at };
}

/** الحالات الثلاث: لم تبدأ · قيد التنفيذ · مكتملة */
function sessStates(rows: Rec[]) {
  let none = 0, live = 0, done = 0;
  for (const d of rows) {
    const s = sessOf(d);
    if (s.full > 0 && s.done >= s.full) done++;
    else if (s.done === 0) none++;
    else live++;
  }
  return { none, live, done };
}

/** صيغة «جهة» بالعربية: جهة · جهتان · ٣ جهات · ١٥ جهة */
function arEnt(n: number) {
  if (n === 1) return "جهة واحدة";
  if (n === 2) return "جهتان";
  if (n <= 10) return `${AR(n)} جهات`;
  return `${AR(n)} جهة`;
}

/** العناصر المتعثرة في بند جلسة — مؤشراتها ومبادراتها */
function sessBad(d: Rec) {
  const kpi = numOf(d.kpiBad);
  const kpiOf = numOf(d.kpiTot);
  const ini = numOf(d.initBad);
  const iniOf = numOf(d.initTot);
  return { kpi, kpiOf, ini, iniOf, all: kpi + ini };
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

/* ---------- بطاقة جهة في جلسات مراجعة الأداء ----------
   على نمط بطاقة الاستراتيجية الوطنية: حلقةُ الأداء العام أولاً،
   ثم العناصر المتعثرة التي استوجبت الجلسة، ثم مسار المراحل الست. */
/* ------------------------------------------------------------
   حذف جهةٍ من بطاقة — صفحتا الجلسات والاستراتيجيات الوطنية
   ------------------------------------------------------------
   الجداول (المؤسسية · البكس · المشاريع) فيها ✕ في آخر عمود منذ
   البداية، والبطاقتان كانتا بلا حذفٍ أصلاً — لا منعاً بصلاحية،
   فسياسة `perf_items_write` في القاعدة `for all` والحذف مشمولٌ
   بها لمن يملك `<القسم>:edit`.

   و**الحذف لا يُفقد شيئاً**: `remove` تدفع الصفّ كاملاً إلى مكدّس
   التراجع قبل أن تحذفه، فشريط ↩️ يعيده بمحتواه. والتأكيد باسم
   الجهة لا بـ«حذف الصف؟» — فما يُحذف يُسمّى.
   ------------------------------------------------------------ */
function DelCard({
  it, name, canEdit, remove, t,
}: {
  it: Item;
  name: string;
  canEdit?: boolean;
  remove?: (id: string) => Promise<string | null>;
  t: T;
}) {
  const [busy, setBusy] = useState(false);
  if (!canEdit || !remove) return null;
  return (
    <button
      className="rowx ncard-x"
      disabled={busy}
      title={t("حذف", "Delete")}
      aria-label={t("حذف", "Delete")}
      onClick={async () => {
        if (!confirm(t(`حذف «${name || "هذا البند"}»؟`, "Delete this row?"))) return;
        setBusy(true);
        await remove(it.id);
        setBusy(false);
      }}
    >
      ✕
    </button>
  );
}

function SessCard({
  it, t, canEdit, save, remove, logo,
}: {
  it: Item;
  t: T;
  canEdit?: boolean;
  save?: (id: string, data: Rec, ord: number) => Promise<string | null>;
  remove?: (id: string) => Promise<string | null>;
  logo?: string;
}) {
  const d = it.data;
  const s = sessOf(d);
  const bad = sessBad(d);
  const perf = numOf(d.perf);
  const band = perfBand(perf);
  const esc = escAt(escOf(d));
  const cur = s.at < 0 ? t("مكتملة", "Done") : s.names[s.at] || "";
  const hasNote = !!txt(d.note).trim();
  /* الكتابة الحرة تُحفظ بعد سكوتٍ قصير، فلا يُرسَل طلبٌ بكل حرف */
  const [draft, setDraft] = useState<string | null>(null);
  /* الخانة لا تُفتح إلا إن كانت فيها ملاحظة أو طلبها الاستشاري —
     البطاقة بلا ملاحظة لا تحمل حقلاً فارغاً */
  const [wantNote, setWantNote] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function put(next: Rec) {
    if (!canEdit || !save) return;
    await save(it.id, { ...d, ...next, demo: false }, it.ord);
  }
  function typeNote(v: string) {
    setDraft(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void put({ note: v });
      setDraft(null);
    }, 900);
  }

  return (
    <div className="ncard">
      <div className="hd">
        <span
          className="en2-lg sess-lg"
          style={{ background: toneOf(txt(d.entity)) + "1f", color: toneOf(txt(d.entity)) }}
        >
          <i>{initials(txt(d.entity))}</i>
          {logo && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={asset(`/logos/${logo}`)} alt="" loading="lazy" />
          )}
        </span>
        <b>{txt(d.entity) || "—"}</b>
        <span className="tg" style={{ background: band.hex, color: "#fff" }}>
          {band.label}
        </span>
        <DelCard it={it} name={txt(d.entity)} canEdit={canEdit} remove={remove} t={t} />
      </div>
      <div className="own">
        {txt(d.quarter) || "—"} · {cur}
      </div>

      {esc && (
        <div className="esc-row" style={{ ["--c" as string]: esc.hex }} title={esc.note}>
          <b>{`المرحلة ${["الأولى", "الثانية", "الثالثة", "الرابعة"][esc.n - 1]}`}</b>
          <span>{esc.name}</span>
          <em>{esc.owner}</em>
        </div>
      )}

      <div className="bd">
        <Ring pct={perf} size={104} tone={band.tone} />
        <div className="nums">
          <div className="n">
            <div className="k">{t("المؤشرات المتعثرة", "Off-track KPIs")}</div>
            <div className="v">
              {AR(bad.kpi)} <em>{`${t("من", "of")} ${AR(bad.kpiOf)}`}</em>
            </div>
          </div>
          <div className="n">
            <div className="k">{t("المبادرات المتعثرة", "Off-track initiatives")}</div>
            <div className="v">
              {AR(bad.ini)} <em>{`${t("من", "of")} ${AR(bad.iniOf)}`}</em>
            </div>
          </div>
        </div>
      </div>

      <Flow stages={s.names} done={s.done} dates={s.dates} />

      {hasNote || (canEdit && wantNote) ? (
        <div className="sn">
          <div className="sn-h">{t("الملاحظات", "Notes")}</div>
          {canEdit ? (
            <textarea
              rows={2}
              className="sn-txt"
              autoFocus={wantNote && !hasNote}
              value={draft ?? txt(d.note)}
              placeholder={t(
                "مثال: الجهة طلبت تأجيل الجلسة أسبوعين لحين اكتمال بيانات الربع، ونُسّق مع مكتب الوكيل.",
                "e.g. the entity asked to postpone the session by two weeks…",
              )}
              onChange={(e) => typeNote(e.target.value)}
            />
          ) : (
            <div className="note">{txt(d.note)}</div>
          )}
        </div>
      ) : canEdit ? (
        <button type="button" className="sn-add" onClick={() => setWantNote(true)}>
          + {t("ملاحظة", "Note")}
        </button>
      ) : (
        <div className="sn-gap" />
      )}
    </div>
  );
}

/* ---------- رفع ملف بيانات جلسات مراجعة الأداء ----------
   نفس منطق رفع الاستراتيجيات الوطنية: إكسل أو بوربوينت، المطابقة
   بعنوان العمود لا بموضعه، والصف باسم الجهة — فيُحدَّث بندها ولا
   يتكرّر، والخانة الفارغة تُبقي القيمة الحالية، ولا يُحذف بند. */
function sessKeyOf(head: string): string {
  const h = natNorm(head);
  if (!h) return "";
  const has = (...w: string[]) => w.every((x) => h.includes(x));
  if (has("مؤشر", "متعثر")) return "kpiBad";
  if (h.includes("مؤشر")) return "kpiTot";
  if (has("مبادر", "متعثر")) return "initBad";
  if (h.includes("مبادر")) return "initTot";
  if (h.includes("اداء") && (h.includes("نسبه") || h.includes("عام"))) return "perf";
  if (h.includes("تصعيد")) return "esc";
  if (h.includes("مرحل") || h.includes("مكتمل")) return "done";
  if (h.includes("ربع")) return "quarter";
  if (h.includes("ملاحظ") || h.includes("تحدي")) return "note";
  if (h.includes("جهه") || h.includes("جهاز") || h.includes("اسم")) return "entity";
  return "";
}

const SESS_NUM_KEYS = new Set(["perf", "kpiBad", "kpiTot", "initBad", "initTot", "done", "esc"]);

function sessVal(k: string, raw: string): unknown {
  const v = String(raw ?? "").trim();
  if (!v) return undefined;
  if (k === "done") {
    /* قد يأتي اسم المرحلة بدل رقمها */
    const n = Number(v);
    if (Number.isFinite(n)) return Math.max(0, Math.min(SESS_STAGES.length, n));
    const h = natNorm(v);
    const i = SESS_STAGES.findIndex((x) => natNorm(x) === h);
    const j = i >= 0 ? i : SESS_SHORT.findIndex((x) => natNorm(x) === h);
    return j >= 0 ? j : undefined;
  }
  if (k === "esc") {
    const n = Number(v);
    if (Number.isFinite(n)) return Math.max(0, Math.min(ESC_LEVELS.length, n));
    const h = natNorm(v);
    const l = ESC_LEVELS.find((x) => natNorm(x.name).includes(h) || natNorm(x.owner).includes(h));
    return l ? l.n : undefined;
  }
  if (SESS_NUM_KEYS.has(k)) {
    const n = Number(v.replace(/[٪%,\s]/g, ""));
    return Number.isFinite(n) ? n : undefined;
  }
  return v;
}

function sessNewId(name: string): string {
  const k = natNorm(name).replace(/\s/g, "");
  let h = 5381;
  for (let i = 0; i < k.length; i++) h = ((h * 33) ^ k.charCodeAt(i)) >>> 0;
  return "sess-" + h.toString(36);
}

function SessImport({ items, t, onDone }: { items: Item[]; t: T; onDone: () => void }) {
  const [msg, setMsg] = useState("");
  const ref = useRef<HTMLInputElement>(null);

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setMsg(t("جارٍ القراءة...", "Reading..."));
    try {
      const buf = await f.arrayBuffer();
      const isPpt = /\.pptx$/i.test(f.name);
      const sheets: { name: string; rows: string[][] }[] = isPpt
        ? (await readPptxSlides(buf)).flatMap((sl) =>
            sl.tables.map((rows, ti) => ({
              name: `${sl.name}${sl.tables.length > 1 ? ` · جدول ${ti + 1}` : ""}`,
              rows,
            })),
          )
        : await readXlsxSheets(buf);

      const found: { rows: string[][]; hi: number; map: Record<number, string> }[] = [];
      for (const sh of sheets) {
        const rs = sh.rows || [];
        for (let i = 0; i < Math.min(rs.length, 8); i++) {
          const m: Record<number, string> = {};
          (rs[i] || []).forEach((c, ci) => {
            const k = sessKeyOf(txt(c));
            if (k && !Object.values(m).includes(k)) m[ci] = k;
          });
          if (Object.values(m).includes("entity") && Object.keys(m).length >= 2) {
            found.push({ rows: rs, hi: i, map: m });
            break;
          }
        }
        if (found.length && !isPpt) break;
      }
      if (!found.length) {
        setMsg(
          t(
            "لم أجد صف العناوين — لا بدّ من عمود «الجهة» ومعه عمود معروف آخر. يمكن تنزيل ملف Excel من الزر المجاور وتعديله ثم رفعه.",
            "Could not find a header row with an entity column.",
          ),
        );
        return;
      }

      const byName = new Map<string, Item>();
      for (const it of items) byName.set(natNorm(txt(it.data.entity)), it);
      const today = new Date().toISOString().slice(0, 10);
      const upd = new Map<string, { id: string; ord: number; data: Rec }>();
      const add = new Map<string, { id: string; ord: number; data: Rec }>();
      const fresh: string[] = [];
      let maxOrd = items.reduce((a, b) => Math.max(a, b.ord || 0), 0);

      for (const src of found) {
        const nameCol = Number(Object.keys(src.map).find((c) => src.map[Number(c)] === "entity"));
        for (const r of src.rows.slice(src.hi + 1)) {
          const nm = txt(r[nameCol]).trim();
          if (!nm) continue;
          const patch: Rec = {};
          for (const [ci, k] of Object.entries(src.map)) {
            if (k === "entity") continue;
            const v = sessVal(k, txt(r[Number(ci)]));
            if (v !== undefined) patch[k] = v;
          }
          const key = natNorm(nm);
          const cur = byName.get(key);
          if (cur) {
            if (!Object.keys(patch).length) continue;
            const prev = upd.get(key);
            upd.set(key, {
              id: cur.id,
              ord: cur.ord,
              data: { ...(prev?.data ?? cur.data), ...patch, updated: today },
            });
          } else {
            const prev = add.get(key);
            if (!prev) fresh.push(nm);
            add.set(key, {
              id: sessNewId(nm),
              ord: prev?.ord ?? ++maxOrd,
              data: { done: 0, ...(prev?.data ?? {}), ...patch, entity: nm, updated: today },
            });
          }
        }
      }

      if (!upd.size && !add.size) {
        setMsg(t("لم يتغيّر شيء — الملف مطابق لما في المنصة", "Nothing changed"));
        return;
      }
      const extra = fresh.length
        ? `\n\nوستُضاف ${fresh.length} جهة ليست في المنصة:\n• ${fresh
            .slice(0, 6)
            .join("\n• ")}${fresh.length > 6 ? "\n• …" : ""}`
        : "";
      if (
        !confirm(
          t(
            `سيُحدَّث ${upd.size} جهة من الملف.\nلا يُحذف شيء، والخانة الفارغة تُبقي القيمة الحالية كما هي.${extra}\n\nمتابعة؟`,
            `Update ${upd.size} entities?`,
          ),
        )
      ) {
        setMsg("");
        return;
      }

      const all = [...upd.values(), ...add.values()];
      for (let i = 0; i < all.length; i += 40) {
        const res = await apiFetch("/api/items", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ section: "sessions", items: all.slice(i, i + 40) }),
        });
        if (!res.ok) {
          const dd = await res.json().catch(() => ({}));
          setMsg(dd.error || t("تعذّر الحفظ", "Save failed"));
          return;
        }
      }
      setMsg(
        t(
          `تم تحديث ${upd.size} جهة${add.size ? ` · وأُضيفت ${add.size}` : ""}`,
          `Updated ${upd.size}`,
        ),
      );
      onDone();
    } catch {
      setMsg(t("تعذّرت قراءة الملف — يُقبل xlsx أو pptx", "Could not read the file"));
    }
  }

  return (
    <span className="seedb">
      <button className="btn btn-sm" onClick={() => ref.current?.click()}>
        <IconUp size={15} /> {t("رفع إكسل", "Upload Excel")}
      </button>
      <input ref={ref} type="file" accept=".xlsx,.pptx" hidden onChange={pick} />
      {msg && <em>{msg}</em>}
    </span>
  );
}

function SessionsPage({ t, canEdit, add, gear }: SecPageProps) {
  const { items, loaded, save, remove, reload, undo, undoTop, dismissUndo } = useItems("sessions");
  const [q, setQ] = useState("");
  /* فلتر واحد يجمع الحالة والمرحلة والتصعيد — بدل المربعات فوق */
  const [f, setF] = useState("");
  const logos = useLogos();

  const OPTS = useMemo(() => {
    const stage = new Array(SESS_STAGES.length).fill(0);
    const esc = new Array(ESC_LEVELS.length + 1).fill(0);
    let done = 0;
    for (const it of items) {
      const at = sessOf(it.data).at;
      if (at < 0) done++;
      else stage[Math.min(at, SESS_STAGES.length - 1)]++;
      esc[escOf(it.data)]++;
    }
    const escN = esc.slice(1).reduce((a: number, b: number) => a + b, 0);
    const out: { v: string; l: string }[] = [];
    SESS_SHORT.forEach((n, i) => {
      if (stage[i]) out.push({ v: `المرحلة: ${n}`, l: `${n} (${AR(stage[i])})` });
    });
    if (done) out.push({ v: "مكتملة", l: `مكتملة (${AR(done)})` });
    if (escN) {
      out.push({ v: "تحتاج تصعيداً", l: `تحتاج تصعيداً (${AR(escN)})` });
      for (const l of ESC_LEVELS)
        if (esc[l.n]) out.push({ v: `تصعيد: ${l.name}`, l: `— ${l.name} (${AR(esc[l.n])})` });
    }
    return out;
  }, [items]);

  useEffect(() => {
    if (f && !OPTS.some((o) => o.v === f)) setF("");
  }, [OPTS, f]);

  const rows = useMemo(() => {
    const byQ = items.filter((it) => {
      const d = it.data;
      return !q || `${txt(d.entity)} ${txt(d.quarter)}`.includes(q);
    });
    if (!f) return byQ;
    return byQ.filter((it) => {
      const at = sessOf(it.data).at;
      const e = escOf(it.data);
      if (f === "مكتملة") return at < 0;
      if (f === "تحتاج تصعيداً") return e > 0;
      if (f.startsWith("المرحلة: ")) return at >= 0 && SESS_SHORT[at] === f.slice(9);
      if (f.startsWith("تصعيد: ")) return escAt(e)?.name === f.slice(7);
      return true;
    });
  }, [items, q, f]);

  function exportXl() {
    const head = ["الجهة", "الربع", "المرحلة الحالية", "المراحل المكتملة", "نسبة الأداء العام ٪",
      "المؤشرات المتعثرة", "إجمالي المؤشرات", "المبادرات المتعثرة", "إجمالي المبادرات",
      "مرحلة التصعيد", "جهة التصعيد", "أبرز التحديات"];
    const body = items.map((it) => {
      const d = it.data;
      const sx = sessOf(d);
      const bd = sessBad(d);
      const e = escAt(escOf(d));
      return [txt(d.entity), txt(d.quarter), sx.at < 0 ? "مكتملة" : sx.names[sx.at] || "", sx.done,
        numOf(d.perf), bd.kpi, bd.kpiOf, bd.ini, bd.iniOf,
        e ? e.name : "لا تصعيد", e ? e.owner : "", txt(d.note)];
    });
    download("جلسات-مراجعة-الأداء.xlsx", writeXlsx([{ name: "الجلسات", rows: [head, ...body] }]));
  }

  if (!loaded) return <div className="empty">{t("جارٍ التحميل...", "Loading...")}</div>;
  if (!items.length)
    return (
      <>
        {/* الشريط يبقى في الصفحة الفارغة: منه تُضاف أول جهة ويُرفع
            أول ملف، فلو أُخفي تعذّر البدء */}
        <div className="sx-tb">
          {add}
          <span className="gr" />
          {canEdit && <SessImport items={items} t={t} onDone={() => void reload()} />}
          {gear}
        </div>
        <Empty
          title={t("لا توجد جلسات بعد", "No sessions yet")}
          note={t("رفعُ ملف البيانات، أو إضافة الجهات من زر «إضافة».", "Upload the data file or add entities.")}
        />
      </>
    );

  return (
    <>
      <Toolbar
        q={q}
        setQ={setQ}
        filter={f}
        setFilter={setF}
        options={OPTS}
        allLabel={t("الكل", "All")}
        onExport={exportXl}
        upload={canEdit ? <SessImport items={items} t={t} onDone={() => void reload()} /> : null}
        add={add}
        gear={gear}
        t={t}
      />

      <div className="stab-doing">
        {`${t("عرض", "Showing")} ${AR(rows.length)} ${t("من", "of")} ${AR(items.length)} ${t("جهة", "entities")}`}
      </div>

      {rows.length ? (
        <div className="ncards eq">
          {rows.map((it) => (
            <SessCard
              key={it.id}
              it={it}
              t={t}
              canEdit={canEdit}
              save={save}
              remove={remove}
              logo={logos[logoKey(txt(it.data.entity))]}
            />
          ))}
        </div>
      ) : (
        <div className="pf-none">{t("لا توجد جهات مطابقة", "Nothing here")}</div>
      )}

      {/* ↩️ كان ينقص هذه الصفحة وحدها — ومع الحذف لا بدّ منه */}
      <UndoBar step={undoTop} onUndo={() => void undo()} onClose={dismissUndo} t={t} />
    </>
  );
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
export const logoKey = (s: string) =>
  s.replace(/\s+/g, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي");

export function useLogos() {
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
  it, t, canEdit, save, remove, logo,
}: {
  it: Item;
  t: T;
  canEdit?: boolean;
  save?: (id: string, data: Rec, ord: number) => Promise<string | null>;
  remove?: (id: string) => Promise<string | null>;
  logo?: string;
}) {
  const d = it.data;
  const meas = numOf(d.meas);
  const track = natTrack(d);
  /* سببُ تعذّر الحفظ يُقال: كان يُبتلع صامتاً، فتبدو المحطة كأنها
     لا تتغيّر بلا بيانِ سبب */
  const [trkErr, setTrkErr] = useState("");

  async function cycle(i: number) {
    if (!canEdit || !save) return;
    const cur = [...track];
    cur[i] = (cur[i] + 1) % 3;
    setTrkErr("");
    const e = await save(it.id, { ...natNoLegacy(d), track: cur, demo: false }, it.ord);
    if (e) setTrkErr(e);
  }

  /** خليةٌ تُكتب في مكانها لمن يملك التعديل، ونصٌّ لغيره */
  const cell = (k: "period" | "approvedAt", ph: string) =>
    canEdit && save ? (
      <input
        className="n-in"
        defaultValue={txt(d[k])}
        placeholder={ph}
        onBlur={(e) => {
          const v = e.target.value.trim();
          if (v !== txt(d[k])) void save(it.id, { ...d, [k]: v }, it.ord);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
      />
    ) : (
      <em>{txt(d[k]) || "—"}</em>
    );

  return (
    <div className="ncard">
      <div className="hd">
        {logo && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img className="lg" src={asset(`/logos/${logo}`)} alt="" loading="lazy" />
        )}
        <b>{txt(d.name)}</b>
        <span className={`tg ${natTech(d) ? "ok" : "no"}`}>
          {natTech(d) ? t("مقبولة فنياً", "Accepted") : t("غير مقبولة فنياً", "Not accepted")}
        </span>
        <DelCard it={it} name={txt(d.name)} canEdit={canEdit} remove={remove} t={t} />
      </div>
      <div className="own">
        {/* القطاع إلى جوار الجهة المالكة — وكان يقع بعد المرحلة
            فيظهر في بعض البطاقات ويغيب في غيرها */}
        {txt(d.owner) || "—"}
        {txt(d.sector) ? ` · ${txt(d.sector)}` : ""} · {NAT_STEPS[natStage(d) - 1]}
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
          {/* الفترة وتاريخ الاعتماد ليسا في ملف المتابعة، فيُكتبان
              هنا مباشرة — و«—» حين لا يوجد */}
          <div className="n">
            <div className="k">{t("فترة الاستراتيجية", "Period")}</div>
            <div className="v">{cell("period", "2025م حتى 2030م")}</div>
          </div>
          <div className="n">
            <div className="k">{t("تاريخ الاعتماد", "Approved on")}</div>
            <div className="v">{cell("approvedAt", "1447/06/04هـ - 2025/11/25م")}</div>
          </div>
        </div>
      </div>

      <div className={`trk lvl-${natLevel(d)}`}>
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
      {trkErr && <div className="ncard-err">{trkErr}</div>}

      <div className="note" title={txt(d.note)}>
        {txt(d.note) || t("لا توجد ملاحظات مسجّلة", "No notes")}
      </div>
    </div>
  );
}

/* ---------- رفع ملف الاستراتيجيات الوطنية ----------
   المطابقة بعنوان العمود لا بموضعه: ترتيب الأعمدة يختلف بين ملف
   وآخر، والعنوان يبقى. والصف يُطابَق باسم الاستراتيجية فيُحدَّث
   بندها ولا يتكرّر. الخانة الفارغة تُبقي القيمة الحالية — لا تمسحها
   — ولا يُحذف بند أبداً مهما نقص من الملف. */
const natNorm = (v: string) =>
  String(v || "")
    .replace(/[\n\r▼]/g, " ")
    /* التشكيل والتطويل يكسران المطابقة: «الممثّلة» لا تحوي «ممثل» */
    .replace(/[\u064B-\u0652\u0670\u0640]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[٪%]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** عنوان العمود ⇒ مفتاح الحقل — الأكثر تخصيصاً أولاً */
function natKeyOf(head: string): string {
  const h = natNorm(head);
  if (!h) return "";
  const has = (...w: string[]) => w.every((x) => h.includes(x));
  /* أعمدة «هل تم …؟» الأربع = مسار المراجعة. تُقرأ **قبل** القواعد
     العامة: «هل تم الانتهاء من المراجعة الفنية» يحوي «فني»،
     و«هل تم معالجة الملاحظات» يحوي «ملاحظ»، فلولا الأسبقية لوقعا
     في «مقبولة فنياً» و«ملاحظة» */
  if (h.includes("هل تم") || h.includes("هل تمت")) {
    if (h.includes("وثيقه")) return "track0";
    /* «اعتماد نموذج الحصر» قبل «استلام نموذج الحصر»: كلاهما يحوي
       «حصر»، ولو سبق الاستلامُ لابتلع العمودين وضاع الاعتماد */
    if (h.includes("حصر") && (h.includes("اعتماد") || h.includes("معتمد"))) return "track3";
    if (h.includes("حصر")) return "track1";
    if (h.includes("فني") || h.includes("مراجع")) return "track2";
    if (h.includes("ملاحظ")) return "track3";
  }
  /* المنجز من المؤشرات والمبادرات يُسمّى في الملفات: «الممثلة» أو
     «المعتمدة» أو «المقبولة»، وما عداه إجمالي. وكان «عدد المبادرات
     المعتمدة» يقع في «إجمالي المبادرات» فيُهمَل (العمود الأول يفوز)
     فيبقى المنجز صفراً */
  const isRep =
    h.includes("ممثل") || h.includes("ممتثل") || h.includes("معتمد") ||
    h.includes("مقبول") || h.includes("منجز");
  if (h.includes("مؤشر")) return isRep ? "kpisRep" : "kpisTot";
  if (h.includes("مبادر")) return isRep ? "initRep" : "initTot";
  if (h.includes("قابلي")) return "meas";
  if (h.includes("فتر")) return "period";
  if (has("تاريخ", "اعتماد")) return "approvedAt";
  if (h.includes("اعتماد") || h.includes("مرحل")) return "stage";
  if (h.includes("فني")) return "tech";
  if (h.includes("ملاحظ")) return "note";
  if (h.includes("الوضع الحالي") || h.includes("المنجز")) return "current";
  if (h.includes("تحدي") || h.includes("معوق")) return "challenge";
  if (h.includes("القادم") || h.includes("التالي")) return "next";
  if (h.includes("دعم")) return "support";
  if (h.includes("قطاع")) return "sector";
  if (h.includes("جهه") || h.includes("مالك")) return "owner";
  if (h.includes("استراتيجي") || h.includes("اسم")) return "name";
  return "";
}

const NAT_NUM_KEYS = new Set(["meas", "kpisRep", "kpisTot", "initRep", "initTot"]);

/** القيمة كما يفهمها الحقل · undefined = اتركها كما هي */
function natVal(k: string, raw: string): unknown {
  const v = String(raw ?? "").trim();
  if (!v) return undefined;
  if (NAT_NUM_KEYS.has(k)) {
    const n = Number(v.replace(/[٪%,\s]/g, ""));
    if (!Number.isFinite(n)) return undefined;
    /* **خلية النسبة في إكسل كسرٌ لا عدد**: «100%» تُقرأ 1 و«25%»
       تُقرأ 0.25 حين تكون الخلية منسّقةً نسبةً. فكان القياس 100%
       يُحفظ 1 ويُعرض «١٪». فما كان ≤ 1 بلا علامة ٪ يُضرب في مئة،
       وما جاء مكتوباً «100%» يبقى كما هو */
    if (k === "meas" && !/[٪%]/.test(v) && n > 0 && n <= 1) {
      return Math.round(n * 1000) / 10;
    }
    return n;
  }
  if (/^track[0-3]$/.test(k)) {
    const h = natNorm(v);
    if (/^(نعم|تم|تمت|مكتمل|منجز|yes|y|true|✓|✔|1)$/i.test(h)) return 2;
    if (/^(جار|جاري|جاريه|قيد|جزئي|جزئيا|partial)/i.test(h)) return 1;
    return 0;
  }
  if (k === "tech") return !/^(غير|لا|no|false|0)/i.test(natNorm(v));
  if (k === "stage") {
    const n = Number(v);
    if (n >= 1 && n <= NAT_STEPS.length) return n;
    const h = natNorm(v);
    /* عبارات الملف طويلة ولا تطابق أسماء المراحل حرفياً:
       «إعداد/ تحديث الاستراتيجية (لدى الجهة المالكة…)» و«مراجعة
       الاستراتيجية المحدثة والعرض على اللجنة…» — فالمطابقة بكلماتها */
    if (h.includes("مجلس الوزرا")) return 4;
    if (h.includes("معتمد") && h.includes("لجنه")) return 3;
    if (h.includes("مراجع") || h.includes("العرض علي اللجنه")) return 2;
    if (h.includes("اعداد") || h.includes("تحديث") || h.includes("الجهه المالكه")) return 1;
    const exact = NAT_STEPS.findIndex((x) => natNorm(x) === h);
    if (exact >= 0) return exact + 1;
    const near = NAT_STEPS.findIndex((x) => natNorm(x).includes(h) || h.includes(natNorm(x)));
    return near >= 0 ? near + 1 : undefined;
  }
  return v;
}

/** معرّف ثابت من الاسم، فإعادة رفع الملف لا تكرّر الاستراتيجية */
function natNewId(name: string): string {
  const k = natNorm(name).replace(/\s/g, "");
  let h = 5381;
  for (let i = 0; i < k.length; i++) h = ((h * 33) ^ k.charCodeAt(i)) >>> 0;
  return "nat-x" + h.toString(36);
}

function NatImport({ items, t, onDone }: { items: Item[]; t: T; onDone: () => void }) {
  const [msg, setMsg] = useState("");
  const ref = useRef<HTMLInputElement>(null);

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setMsg(t("جارٍ القراءة...", "Reading..."));
    try {
      const buf = await f.arrayBuffer();
      /* بوربوينت أو إكسل: كلاهما أرشيف zip، وجدول الشريحة يُقرأ
         صفوفاً وخلايا كورقة إكسل تماماً — فبقية المنطق واحدة */
      const isPpt = /\.pptx$/i.test(f.name);
      const sheets: { name: string; rows: string[][] }[] = isPpt
        ? (await readPptxSlides(buf)).flatMap((sl) =>
            sl.tables.map((rows, ti) => ({
              name: `${sl.name}${sl.tables.length > 1 ? ` · جدول ${ti + 1}` : ""}`,
              rows,
            })),
          )
        : await readXlsxSheets(buf);

      /* صف العناوين قد لا يكون الأول — نبحث عنه في أوائل صفوف كل ورقة.
         في العرض تُؤخذ **كل** الجداول المطابقة، لأن الجدول الواحد
         يُقسَّم على شرائح. وفي الجدول تُؤخذ أول ورقة مطابقة وحدها،
         فالمصنّف قد يحمل نسخة قديمة في ورقة أخرى. */
      const found: { rows: string[][]; hi: number; map: Record<number, string> }[] = [];
      for (const sh of sheets) {
        const rs = sh.rows || [];
        for (let i = 0; i < Math.min(rs.length, 8); i++) {
          const m: Record<number, string> = {};
          (rs[i] || []).forEach((c, ci) => {
            const k = natKeyOf(txt(c));
            if (k && !Object.values(m).includes(k)) m[ci] = k;
          });
          if (Object.values(m).includes("name") && Object.keys(m).length >= 3) {
            found.push({ rows: rs, hi: i, map: m });
            break;
          }
        }
        if (found.length && !isPpt) break;
      }
      if (!found.length) {
        setMsg(
          isPpt
            ? t(
                "لم أجد في العرض جدولاً عنوانه «الاستراتيجية» ومعه عمودان معروفان على الأقل. إن كانت كل شريحة استراتيجيةً في مربعات نصّ لا جدولاً، فالملف يحتاج قراءةً على شكله.",
                "No table with a strategy column was found in the deck.",
              )
            : t(
                "لم أجد صف العناوين في الملف — لا بدّ من عمود «الاستراتيجية». يمكن تنزيل ملف Excel من الزر المجاور وتعديله ثم رفعه.",
                "Could not find a header row with a strategy column.",
              ),
        );
        return;
      }

      const byName = new Map<string, Item>();
      for (const it of items) byName.set(natNorm(txt(it.data.name)), it);

      const today = new Date().toISOString().slice(0, 10);
      const upd = new Map<string, { id: string; ord: number; data: Rec }>();
      const add = new Map<string, { id: string; ord: number; data: Rec }>();
      const fresh: string[] = [];
      let maxOrd = items.reduce((a, b) => Math.max(a, b.ord || 0), 0);

      for (const src of found) {
        const nameCol = Number(Object.keys(src.map).find((c) => src.map[Number(c)] === "name"));
        for (const r of src.rows.slice(src.hi + 1)) {
          const nm = txt(r[nameCol]).trim();
          if (!nm) continue;
          const patch: Rec = {};
          for (const [ci, k] of Object.entries(src.map)) {
            if (k === "name") continue;
            const v = natVal(k, txt(r[Number(ci)]));
            if (v !== undefined) patch[k] = v;
          }
          const key = natNorm(nm);
          const cur = byName.get(key);
          /* أعمدة «هل تم …؟» الأربع تصير مصفوفة `track` واحدة، وما
             لم يأتِ عمودُه في الملف يبقى على حاله فلا يُصفَّر */
          const tk = [0, 1, 2, 3].map((i) => patch[`track${i}`]);
          if (tk.some((v) => v !== undefined)) {
            const base = natTrack((cur?.data ?? {}) as Rec);
            patch.track = base.map((b, i) => (tk[i] === undefined ? b : numOf(tk[i])));
          }
          /* `undefined` لا `delete`: الحقل يُكتب فوق القديم في البيانات
             المدموجة ثم يسقط من JSON، فلا تبقى بقايا المفاتيح المفردة */
          for (let i = 0; i < 4; i++) patch[`track${i}`] = undefined;
          if (cur) {
            if (!Object.keys(patch).length) continue;
            /* الاسم قد يتكرّر على أكثر من شريحة بأعمدة مختلفة، فتُجمَّع */
            const prev = upd.get(key);
            upd.set(key, {
              id: cur.id,
              ord: cur.ord,
              data: { ...(prev?.data ?? cur.data), ...patch, updated: today },
            });
          } else {
            const prev = add.get(key);
            if (!prev) fresh.push(nm);
            add.set(key, {
              id: natNewId(nm),
              ord: prev?.ord ?? ++maxOrd,
              data: { stage: 1, ...(prev?.data ?? {}), ...patch, name: nm, updated: today },
            });
          }
        }
      }

      /* ما في المنصة وليس في الملف — يُحذف باختيارٍ صريح وحده، فالملف
         قد يكون جزئياً ولا يصحّ أن يمحو ما لم يذكره */
      const seenKeys = new Set([...upd.keys(), ...add.keys()]);
      const gone = items.filter((it) => !seenKeys.has(natNorm(txt(it.data.name))));

      if (!upd.size && !add.size && !gone.length) {
        setMsg(t("لم يتغيّر شيء — الملف مطابق لما في المنصة", "Nothing changed"));
        return;
      }
      const extra = fresh.length
        ? `\n\nوستُضاف ${fresh.length} استراتيجية ليست في المنصة:\n• ${fresh
            .slice(0, 6)
            .join("\n• ")}${fresh.length > 6 ? "\n• …" : ""}`
        : "";
      if (
        !confirm(
          t(
            `سيُحدَّث ${upd.size} استراتيجية من الملف.\nالخانة الفارغة تُبقي القيمة الحالية كما هي.${extra}\n\nمتابعة؟`,
            `Update ${upd.size} strategies?`,
          ),
        )
      ) {
        setMsg("");
        return;
      }
      let del: Item[] = [];
      if (gone.length) {
        del = confirm(
          t(
            `في المنصة ${gone.length} استراتيجية ليست في الملف:\n• ${gone
              .slice(0, 8)
              .map((x) => txt(x.data.name))
              .join("\n• ")}${gone.length > 8 ? "\n• …" : ""}\n\nهل تُحذف لتطابق المنصةُ الملف؟\n(إلغاء = تبقى كما هي)`,
            `Delete ${gone.length} strategies missing from the file?`,
          ),
        )
          ? gone
          : [];
      }

      const all = [...upd.values(), ...add.values()];
      for (let i = 0; i < all.length; i += 40) {
        const res = await apiFetch("/api/items", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ section: "natstrat", items: all.slice(i, i + 40) }),
        });
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          setMsg(d.error || t("تعذّر الحفظ", "Save failed"));
          return;
        }
      }
      for (const it of del) {
        const r = await apiFetch(
          `/api/items?section=natstrat&id=${encodeURIComponent(it.id)}`,
          { method: "DELETE" },
        );
        if (!r.ok) {
          setMsg(t("تعذّر حذف بعض الاستراتيجيات", "Some deletions failed"));
          break;
        }
      }
      setMsg(
        t(
          `تم تحديث ${upd.size} استراتيجية${add.size ? ` · وأُضيفت ${add.size}` : ""}` +
            (del.length ? ` · وحُذفت ${del.length}` : ""),
          `Updated ${upd.size}`,
        ),
      );
      onDone();
    } catch {
      setMsg(t("تعذّرت قراءة الملف — يُقبل xlsx أو pptx", "Could not read the file"));
    }
  }

  return (
    <span className="seedb">
      <button className="btn btn-sm" onClick={() => ref.current?.click()}>
        <IconUp size={15} /> {t("رفع إكسل", "Upload Excel")}
      </button>
      <input ref={ref} type="file" accept=".xlsx,.pptx" hidden onChange={pick} />
      {msg && <em>{msg}</em>}
    </span>
  );
}

function NationalPage({ t, canEdit, add, gear }: SecPageProps) {
  const { items, loaded, save, remove, reload, undo, undoTop, dismissUndo } = useItems("natstrat");
  const [q, setQ] = useState("");
  /* **ترحيلٌ لمرّة واحدة**: مفاتيح `track0..3` المفردة — بقايا رفعٍ
     قديم — تُدمج في مصفوفة `track` ثم تُمحى. وجودها كان يجعل حالة
     المحطة أعلى القيمتين، فتغييرُ المحطة إلى حالةٍ أدنى لا يظهر
     ويبقى القبول الفنّي على ما كان. الكتابة مباشرةً بلا خطوة تراجع */
  const fixedTrk = useRef(false);
  useEffect(() => {
    if (!canEdit || !loaded || fixedTrk.current) return;
    const old = items.filter((it) =>
      [0, 1, 2, 3].some((i) => (it.data as Rec)[`track${i}`] !== undefined),
    );
    if (!old.length) return;
    fixedTrk.current = true;
    void (async () => {
      for (const it of old) {
        await apiFetch("/api/items", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            section: "natstrat",
            id: it.id,
            ord: it.ord,
            data: { ...natNoLegacy(it.data), track: natTrack(it.data) },
          }),
        });
      }
      await reload();
    })();
  }, [items, loaded, canEdit, reload]);
  /* القطاع المختار من الفلتر — فارغٌ = كل القطاعات */
  const [sec, setSec] = useState("");
  /* التبويب المختار — حالة الاعتماد */
  const [tab, setTab] = useState(4);
  const logos = useLogos();

  const found = useMemo(
    () =>
      items.filter((it) => {
        const d = it.data;
        if (sec && txt(d.sector) !== sec) return false;
        return !q || `${txt(d.name)} ${txt(d.owner)} ${txt(d.domain)}`.includes(q);
      }),
    [items, q, sec],
  );
  /* البحث يتجاوز التبويب: من يكتب اسم استراتيجية يريدها أينما كانت */
  const rows = q ? found : found.filter((it) => natStage(it.data) === tab);

  /* **فلتر القطاعات** — كانت القائمة «كل الحالات» فارغةً بلا خيار
     واحد، فلا تفعل شيئاً. القطاعات الأربعة المعتمدة أولاً، ثم أيُّ
     قطاعٍ ورد في البيانات وليس منها، ومع كلٍّ عددُه. والقطاع يأتي
     من عمود «القطاع» في ملف الرفع أو من نموذج التعديل. */
  const secOpts = useMemo(() => {
    const n = new Map<string, number>();
    for (const it of items) {
      const v = txt(it.data.sector).trim();
      if (v) n.set(v, (n.get(v) || 0) + 1);
    }
    const all = [...INST_SECTORS, ...[...n.keys()].filter((x) => !INST_SECTORS.includes(x))];
    return all.filter((x) => n.has(x)).map((x) => ({ v: x, l: `${x} (${AR(n.get(x) || 0)})` }));
  }, [items]);

  /* **التنزيل بشكل ملف المتابعة نفسه** — أعمدته وعباراته كما هي،
     فما يُنزَّل يُرفع كما هو بلا تحويل. والفترة وتاريخ الاعتماد
     والملاحظات ليست من أعمدته: تبقى في المنصة وتُكتب في البطاقة،
     ورفعُ الملف لا يمسّها لأن ما لا عمود له لا يُغيَّر. */
  function exportXl() {
    const head = ["v", "أسم الاستراتيجية", "نسبة قابلية قياس الاستراتيجية", "حالة الاعتماد", "القطاع",
      "هل تم استلام الوثيقة الاستراتيجية؟", "هل تم استلام نموذج الحصر",
      "هل تم الانتهاء من المراجعة الفنية", "هل تم اعتماد نموذج الحصر",
      "اجمالي مؤشرات", "عدد المؤشرات الممتثلة", "اجمالي المبادرات", "عدد المبادرات المعتمدة"];
    const yn = (n: number) => (n >= 2 ? "نعم" : n === 1 ? "جارٍ" : "لا");
    const body = items.map((it, i) => {
      const d = it.data;
      const tr = natTrack(d);
      /* النسبة تُكتب كسراً كما في الملف الأصلي (100% = 1)، فيعود
         الملف إلى المنصة بالقيمة نفسها بلا التباس */
      return [i + 1, txt(d.name), Math.round(numOf(d.meas) * 100) / 10000,
        NAT_STAGE_XL[natStage(d) - 1], txt(d.sector),
        yn(tr[0]), yn(tr[1]), yn(tr[2]), yn(tr[3]),
        numOf(d.kpisTot), numOf(d.kpisRep), numOf(d.initTot), numOf(d.initRep)];
    });
    download("قائمة-الاستراتيجيات-الوطنية.xlsx",
      writeXlsx([{ name: "تفاصيل الاستراتيجيات", rows: [head, ...body] }]));
  }

  if (!loaded) return <div className="empty">{t("جارٍ التحميل...", "Loading...")}</div>;

  return (
    <>
      <Toolbar
        q={q} setQ={setQ}
        filter={sec} setFilter={setSec} options={secOpts}
        allLabel={t("كل القطاعات", "All sectors")}
        onExport={exportXl}
        upload={canEdit ? <NatImport items={items} t={t} onDone={() => void reload()} /> : null}
        add={add}
        gear={gear}
        t={t}
      />

      <div className="stabs">
        {[4, 3, 2, 1].map((st) => {
          /* العدّ من `found` لا من `items`: التبويب يعدّ ما يراه
             المستخدم بعد الفلتر، وإلا ناقضَ الرقمُ ما تحته */
          const n = found.filter((it) => natStage(it.data) === st).length;
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
        /* alleq: كل البطاقات بقياسٍ واحد ومستوىً واحد — بطاقتا جهتين
           مختلفتين لا تتفاوتان في الطول */
        <div className="ncards eq alleq">
          {rows.map((it) => (
            <NatCard
              key={it.id}
              it={it}
              t={t}
              canEdit={canEdit}
              save={save}
              remove={remove}
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
    await save(it.id, { ...natNoLegacy(d), track: cur, demo: false }, it.ord);
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
          <div className={`nat-track lvl-${natLevel(d)}`}>
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
            <div className="v">{txt(d.approvedAt) || "—"}</div>
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
   بطاقات «نظرة عامة» — حلقةُ الحالة نفسها التي في التقرير
   الأسبوعي، بحسبةٍ واحدة من `lib/weekReport.ts`. والأسماء
   والتفاصيل كلها في صفحة كل قسم.
   ------------------------------------------------------------ */
/* ============================================================
   بطاقة «أشرطة الحالة» — الحالات الثلاث أشرطةً بنسبتها وعددها.
   تقرأ من `weekSummary` نفسها التي يقرأ منها التقرير الأسبوعي،
   فلا يختلف رقمٌ بين الصفحة والتقرير.
   ============================================================ */
const BAR_TONE = ["#1a7a48", "#e0971a", "#9aa8a4", "#2f7fd1", "#6b53c9", "#0f8a8a", "#a24160"];
/* عبارةٌ داخل الشريط تشرح الحالة — لا تكرّر عنوانها */
const BAR_INNER: Record<string, string> = {
  مكتملة: "اكتملت مراحلها",
  "قيد التنفيذ": "قيد الإعداد",
  "لم تبدأ": "لم تُجدول بعد",
  /* مراحل جلسة مراجعة الأداء — شرحٌ لا تكرارٌ للعنوان */
  "مراجعة وتحليل الأداء": "تحليل تاريخي ورصد المتعثر",
  "حصر التحديات": "التحديات والإجراءات التصحيحية",
  "الجلسة التحضيرية": "مع فريق العمل",
  "الجلسة النهائية": "مع رئيس الجهاز",
  "مشاركة النتائج": "محضر الجلسة وتوصياتها",
  "متابعة الإجراءات": "حتى إغلاق الإجراء",
};

/** أيقونة كل قسم في «نظرة عامة» — هي أيقونته في التقرير الأسبوعي */
const SEC_ICON: Partial<Record<SectionKey, string>> = {
  sessions: "bars",
  natstrat: "bank",
  inststrat: "building",
  cx: "users",
  outputs: "layers",
  projects: "gantt",
  notesq: "checklist",
};

/** قُطر حلقات «نظرة عامة» — واحدٌ للبطاقات الأربع، وأكبر من قياس
    التقرير الأسبوعي لأن البطاقة هنا أوسع فيبقى حولها بياضٌ كثير */
const DONUT = 152;

export function StatusBars({
  section,
  t,
  onOpen,
}: {
  section: SectionKey;
  t: T;
  onOpen?: () => void;
}) {
  const { items, loaded } = useItems(section);
  const title = SECTION_TITLE[section];
  const { open, toggle } = useCollapse(section);
  const sum = useMemo(() => weekSummary(section, items), [section, items]);

  const box = (body: ReactNode) => (
    <div className={`sx-box ${open ? "" : "closed"}`}>
      <div className="hd">
        <CollapseBtn open={open} toggle={toggle} t={t} />
        <span className="wk-ci">
          <PIcon id={SEC_ICON[section] || "layers"} size={17} />
        </span>
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

  const tot = sum.total || 1;
  const quarter = txt(items[0]?.data?.quarter);
  return box(
    <div className="pbars">
      <div className="pb-sub">
        {`${AR(sum.total)} ${sum.totalLabel}`}
        {quarter ? ` · ${quarter}` : ""}
      </div>
      {sum.breakdown.map((b, i) => {
        const pct = Math.round((b.n / tot) * 100);
        const inner = BAR_INNER[b.k] || b.k;
        return (
          <div className="pb-row" key={b.k}>
            <div className="pb-h">
              <b>{b.k}</b>
              <span>{pct}%</span>
              <i>{AR(b.n)}</i>
            </div>
            <div className="pb-t">
              <span
                className="pb-f"
                style={{ width: `${Math.max(pct, 3)}%`, background: BAR_TONE[i % BAR_TONE.length] }}
              >
                {pct >= 26 && <em>{inner}</em>}
                <u className="knob" />
              </span>
            </div>
          </div>
        );
      })}
    </div>,
  );
}

/* ============================================================
   جلسات مراجعة الأداء في «نظرة عامة» — مختصرة
   ------------------------------------------------------------
   كانت سبعة أشرطة طويلة تملأ الصندوق ولا تُقرأ بنظرة. صارت:
   رقمٌ واحد كبير (كم جهة تحتاج جلسة هذا الربع) · شبكةُ المراحل
   الست بعددها · وسطرُ التصعيد. و«مكتملة» أُزيلت بطلب المستخدمة.
   ============================================================ */
export function SessionsBox({ t, onOpen }: { t: T; onOpen?: () => void }) {
  const { items, loaded } = useItems("sessions");
  const title = SECTION_TITLE.sessions;
  const { open, toggle } = useCollapse("sessions");

  const sum = useMemo(() => {
    const c = sessStates(items.map((it) => it.data));
    let esc = 0;
    for (const it of items) if (escOf(it.data) > 0) esc++;
    return { ...c, esc };
  }, [items]);

  const box = (body: ReactNode) => (
    <div className={`sx-box ${open ? "" : "closed"}`}>
      <div className="hd">
        <CollapseBtn open={open} toggle={toggle} t={t} />
        <span className="wk-ci">
          <PIcon id={SEC_ICON.sessions || "bars"} size={17} />
        </span>
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

  const quarter = txt(items[0]?.data?.quarter);
  const d = sesDonut(items);

  return box(
    <>
      {/* الحلقة أولاً في البطاقات الأربع — فتستوي حلقاتها في مستوى
          واحد، والسطر الوصفي تحتها لا فوقها */}
      <DonutCard slices={d.slices} total={d.total} unit={d.unit} size={DONUT} />
      <div className="sx-dsub">
        {arEnt(items.length)}
        {quarter ? ` · ${quarter}` : ""}
      </div>
      {/* التصعيد لا يُذكر إلا إن وُجد — «٠ جهة» ليست معلومة */}
      {sum.esc > 0 && (
        <div className="ss-esc on">
          <b>{AR(sum.esc)}</b>
          <span>{t("جهة تحتاج تصعيداً", "entities need escalation")}</span>
        </div>
      )}
    </>,
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
        <span className="wk-ci">
          <PIcon id={SEC_ICON[section] || "bank"} size={17} />
        </span>
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

  /* الحلقة نفسها التي في التقرير الأسبوعي، بالحسبة نفسها
     (`lib/weekReport.ts`) — فلا يفترق رقم الصفحة عن رقم التقرير */
  if (section === "natstrat") {
    const d = natDonut(items);
    /* نسبة القياس على **المعتمدة من مجلس الوزراء وحدها**: ما لم
       يُعتمد بعدُ فقائمة مؤشراته غير نهائية، فإدخاله في النسبة
       يخفضها بما لم يحن دوره */
    const appr = items.filter((x) => natStage(x.data) === NAT_STEPS.length);
    /* النسبة من الملف (`meas`) لا من عدد المؤشرات — والمعتمدة من
       مجلس الوزراء وحدها هي المؤشر المسقط على الإدارة */
    const all = appr.length;
    const pct = all ? Math.round((appr.reduce((a, x) => a + numOf(x.data.meas), 0) / all) * 10) / 10 : 0;
    return box(
      <>
        <DonutCard slices={d.slices} total={d.total} unit={d.unit} size={DONUT} />
        <div className="sx-dline">
          <span className="l">{t("نسبة قابلية قياس الاستراتيجيات المعتمدة من مجلس الوزراء", "Measurability — CoM approved")}</span>
          {all ? (
            /* النسبة وعدد الجهات التي حُسبت منها — بلا تفصيل المؤشرات
               وبلا شريط، كما في بطاقة المؤسسية */
            <>
              <b>{AR(pct)}٪</b>
              <em>{`${AR(appr.length)} ${t("استراتيجية", "strategies")}`}</em>
            </>
          ) : (
            <em>{t("لا توجد استراتيجية معتمدة من مجلس الوزراء بعد", "None approved yet")}</em>
          )}
        </div>
      </>,
    );
  }

  const d = instDonut(items);
  const live = items.filter((x) => txt(x.data.live) === "مفعل").length;
  const pct = items.length ? Math.round((live / items.length) * 100) : 0;
  return box(
    <>
      <DonutCard slices={d.slices} total={d.total} unit={d.unit} size={DONUT} />
      <div className="sx-dline">
        <span className="l">
          {t("نسبة تفعيل قياس الاستراتيجيات المؤسسية", "Institutional measurement live %")}
        </span>
        <b>{AR(pct)}٪</b>
        <em>{`${AR(live)} ${t("من", "of")} ${AR(items.length)} ${t("جهة", "entities")}`}</em>
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
/* ------------------------------------------------------------
   مرحلة الجهة في المؤسسية — **المرحلة التي بلغتها**
   ------------------------------------------------------------
   الخطوات الأربع متتابعة لا متنافية، فلو عُدَّ «من أنجز كلَّ خطوة»
   لوقعت الجهة الواحدة في أربع خانات ولم تُجمَع الأعداد على شيء.
   وبهذا التعريف تصير الخانات متنافيةً كما في الوطنية تماماً:
   مجموعها عدد الجهات، والضغط على خانةٍ يُظهر ما بلغها.

   والخانتان الأخيرتان **بالتفعيل لا بـ«اكتملت»** — بطلب صاحبة
   المنصة: من أنهى الوثائق ولمّا يُفعَّل قياسُه فهو «مخطط تفعيلها»
   (وله في الجدول رُبعٌ مستهدف)، ومن فُعِّل فهو «تم تفعيلها».
   فلا تختفي جهةٌ من الشريط، ويُقرأ الفرق بين المخطَّط والواقع.
   ------------------------------------------------------------ */
const INST_TABS = ["تسمية ممثل", "الاجتماع التعريفي", "الوثائق", "مخطط تفعيلها", "تم تفعيلها"];
const INST_TAB_TONE = ["#8a9a95", "#e0971a", "#0f8a8a", "#2f7fd1", "#1a9d5c"];

/** 0..4 — المرحلة التي بلغتها الجهة */
function instStep(d: Rec): number {
  if (txt(d.rep) !== "تمت تسمية ممثل") return 0;
  if (txt(d.meet) !== "تم") return 1;
  if (txt(d.docs) !== "✓") return 2;
  return txt(d.live) === "مفعل" ? 4 : 3;
}

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

function InstEntity({
  it, t, onEdit, canEdit, remove,
}: {
  it: Item;
  t: T;
  onEdit?: () => void;
  canEdit?: boolean;
  remove?: (id: string) => Promise<string | null>;
}) {
  const d = it.data;
  const ph = txt(d.phase);
  return (
    <div className="iw">
      <div className="iw-h">
        <b>{txt(d.owner) || "—"}</b>
        <span className={`iw-ph ${ph === "Phase 1" ? "p1" : ""}`}>{ph || "—"}</span>
        {/* نفس موضع ✕ في بقية البطاقات — فالحذف لا يتنقّل من صفحةٍ
            لأخرى. والجدول في هذه الصفحة له ✕ في آخر عمود كما كان */}
        <DelCard it={it} name={txt(d.owner)} canEdit={canEdit} remove={remove} t={t} />
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

function InstPage({ t, canEdit, add, gear }: SecPageProps) {
  const { items, loaded, save, remove, reload, undo, undoTop, dismissUndo } = useItems("inststrat");
  const [q, setQ] = useState("");
  const [f, setF] = useState("");
  const [view, setView] = useState<"cards" | "table">("cards");
  /* المرحلة المختارة — شريط أعلى الصفحة، كشريط الوطنية.
     كان الشريط للقطاعات والقائمة «كل الحالات» فارغة، فصار
     الشريط للحالات والقائمة للقطاعات — بطلب صاحبة المنصة */
  const [stage, setStage] = useState(0);
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

  /* البحث يتجاوز الشريط: من يكتب اسم جهة يريدها في أيّ مرحلةٍ كانت */
  const list = useMemo(
    () => (q ? rows : rows.filter((it) => instStep(it.data) === stage)),
    [rows, q, stage],
  );

  /* القطاعات بأعدادها — القائمة كانت تعرض الأربعة بلا عدد */
  const secOpts = useMemo(() => {
    const n = new Map<string, number>();
    for (const it of items) {
      const v = txt(it.data.sector).trim();
      if (v) n.set(v, (n.get(v) || 0) + 1);
    }
    const all = [...INST_SECTORS, ...[...n.keys()].filter((x) => !INST_SECTORS.includes(x))];
    return all.filter((x) => n.has(x)).map((x) => ({ v: x, l: `${x} (${AR(n.get(x) || 0)})` }));
  }, [items]);

  function exportXl() {
    const head = INST_COLS.map((c) => c.label);
    const body = rows.map((it) => INST_COLS.map((c) => txt(it.data[c.k])));
    download("متابعة-الاستراتيجيات-المؤسسية.xlsx", writeXlsx([{ name: "المؤسسية", rows: [head, ...body] }]));
  }

  if (!loaded) return <div className="empty">{t("جارٍ التحميل...", "Loading...")}</div>;

  return (
    <>
      <Toolbar q={q} setQ={setQ} filter={f} setFilter={setF} options={secOpts}
               allLabel={t("كل القطاعات", "All sectors")}
               onExport={exportXl} add={add} gear={gear} t={t} />

      {/* شريط الحالات الأربع — فوق العرضين معاً، فالجدول يتبع
          المرحلة المختارة كما تتبعها البطاقات */}
      <div className="stabs">
        {INST_TABS.map((nm, i) => (
          <button
            key={nm}
            className={`stab ${!q && stage === i ? "on" : ""}`}
            style={{ ["--c" as string]: INST_TAB_TONE[i] }}
            onClick={() => {
              setQ("");
              setStage(i);
            }}
          >
            <span className="l">{nm}</span>
            <b>{AR(rows.filter((it) => instStep(it.data) === i).length)}</b>
          </button>
        ))}
      </div>

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
        !list.length ? (
          <div className="pf-none">{t("لا توجد نتائج", "No results")}</div>
        ) : (
          <div className="iw-grid">
            {list.map((it) => (
              <InstEntity
                key={it.id}
                it={it}
                t={t}
                onEdit={canEdit ? () => setEdit(it) : undefined}
                canEdit={canEdit}
                remove={remove}
              />
            ))}
          </div>
        )
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
              {list.map((it, n) => (
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
export function CxBox({ t, onOpen }: { t: T; onOpen?: () => void }) {
  const { items, loaded } = useItems("cx");
  /* عنوانٌ مختصر في «نظرة عامة» — الكامل («…من الخدمات الحكومية»)
     يلتفّ سطرين في رأس البطاقة */
  const title: [string, string] = ["أعمال قياس تجربة المستفيد", "Beneficiary experience"];
  const { open, toggle } = useCollapse("cx");

  const box = (body: ReactNode) => (
    <div className={`sx-box ${open ? "" : "closed"}`}>
      <div className="hd">
        <CollapseBtn open={open} toggle={toggle} t={t} />
        <span className="wk-ci">
          <PIcon id={SEC_ICON.cx || "users"} size={17} />
        </span>
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

  const st = cxStats(items);
  if (!st.rows.length)
    return box(
      <div className="sx-none">
        {t("لا توجد بيانات بعد — تُرفع من صفحة القسم بملف المتابعة.", "No data yet.")}
      </div>,
    );

  /* الحلقة على المستهدف لا على قائمة الملف كلها: السؤال هو كم بقي
     من المستهدف، لا كم جهازاً في الملف */
  const d = cxDonut(items);
  return box(
    <>
      <DonutCard slices={d.slices} total={d.total} unit={d.unit} size={DONUT} />
      <div className="sx-dfoot">
        <span>
          {t("مجموع التقارير المعتمدة", "Approved reports")} <b>{AR(st.reportsTot)}</b>
        </span>
        <span>
          {t("احتُسبت في المؤشر", "Counted in KPI")} <b>{AR(st.counted)}</b>
        </span>
      </div>
    </>,
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
            `تغيّر ترتيب أعمدة الملف — العمود ${bad[0] + 1} ليس «${bad[1]}». يُرفع الملف كما هو، أو يُبلَّغ بالترتيب الجديد.`,
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
        <IconUp size={15} /> {t("رفع إكسل", "Upload Excel")}
      </button>
      <input ref={ref} type="file" accept=".xlsx" hidden onChange={pick} />
      {msg && <em>{msg}</em>}
    </span>
  );
}

export function CxPage({ t, canEdit, add, gear }: SecPageProps) {
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
      {/* الشريط في صدر الصفحة كبقية صفحات الأعمال الرئيسية —
          كان تحت البطاقات والجدولين فلا يُرى إلا بعد تمريرٍ طويل */}
      {st.rows.length ? (
        <Toolbar
          q={q} setQ={setQ} filter={f} setFilter={setF} options={INST_SECTORS} onExport={exportXl}
          upload={
            canEdit ? (
              <>
                <CxImport t={t} onDone={() => void reload()} />
                {st.updated && (
                  <span className="sx-count">{`${t("آخر رفع", "Last upload")}: ${st.updated}`}</span>
                )}
              </>
            ) : null
          }
          add={add}
          gear={gear}
          t={t}
        />
      ) : (
        canEdit && (
          /* بلا بيانات لا بحث ولا فلتر، فيبقى الرفع و«إضافة» و⚙️ وحدها */
          <div className="sx-tb">
            {add}
            <span className="gr" />
            <CxImport t={t} onDone={() => void reload()} />
            {gear}
          </div>
        )
      )}

      {!st.rows.length ? (
        <Empty
          title={t("لا توجد بيانات بعد", "No data yet")}
          note={t(
            "رفع ملف المتابعة (Master Tracker) من الزر أعلاه — تُقرأ الأعمدة كما هي.",
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
/* مراحل المشروع الأربع — الافتراضي حين لا تُكتب مراحلُ المشروع
   صراحةً في بيانه. ويُكتب بدلها ما شاءت الإدارة: سطرٌ لكل مرحلة
   أو مخرج، ونسبته بعد نقطتين («المخرج الثاني:100») */
const PJ_STAGES = ["التهيئة", "التخطيط", "التنفيذ", "الإغلاق"];
const PJ_COLORS = ["#0b6b50", "#1b9c74", "#5bb594", "#9ecdbb"];

type PjStage = { name: string; pct: number; done?: number; total?: number; unit?: string };

function pjStages(d: Rec, actual: number): PjStage[] {
  const raw = txt(d.stages).trim();
  if (raw) {
    return raw
      .split(/[\n·,،]+/)
      .map((x) => x.trim())
      .filter(Boolean)
      .map((x) => {
        const i = x.lastIndexOf(":");
        const val = i > 0 ? x.slice(i + 1).trim() : "";
        const name = (i > 0 ? x.slice(0, i) : x).trim();
        /* «محقق/مستهدف وحدة» — مخرجٌ له كمية، فالنسبة تُشتقّ منها
           ويظهر العددان كما في لوحة متابعة المشروع */
        const q = val.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*(.*)$/);
        if (q) {
          const done = numOf(q[1]);
          const total = numOf(q[2]);
          return {
            name,
            done,
            total,
            unit: q[3].trim(),
            pct: total > 0 ? Math.max(0, Math.min(100, (done / total) * 100)) : 0,
          };
        }
        const hasPct = /^\d+(\.\d+)?\s*%?$/.test(val);
        return {
          name: hasPct ? name : x.trim(),
          pct: hasPct ? Math.max(0, Math.min(100, numOf(val))) : 0,
        };
      });
  }
  /* بلا بيانٍ صريح: المراحل الأربع تُملأ من الإنجاز الفعلي —
     كل مرحلةٍ ربعُ المشروع */
  return PJ_STAGES.map((name, i) => ({
    name,
    pct: Math.max(0, Math.min(100, Math.round((actual - i * 25) * 4))),
  }));
}

/** حلقة نسبةٍ واحدة — الإنجاز الفعلي في وسط بطاقة المشروع */
function PjRing({ pct, late }: { pct: number; late: boolean }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, pct));
  return (
    <span className="pjx-rg">
      <svg width="92" height="92" viewBox="0 0 92 92">
        <circle cx="46" cy="46" r={r} fill="none" stroke="var(--line2)" strokeWidth="11" />
        <circle
          cx="46" cy="46" r={r} fill="none" strokeWidth="11" strokeLinecap="round"
          stroke={late ? "var(--gold)" : "#0b6b50"}
          strokeDasharray={`${(c * v) / 100} 999`}
        />
      </svg>
      <b className={late ? "warn" : ""}>{AR(Math.round(v * 10) / 10)}٪</b>
    </span>
  );
}

/** مشروعٌ مربوطٌ بلوحة متابعة المشروع — أرقامه تُقرأ منها لا تُكتب */
const isPdash = (d: Rec) => /^(نعم|yes|y|1|true)$/i.test(txt(d.pdash).trim());

/** الاسم المختصر للمخرج — ما قبل الشَّرطة: «المخرج الأول» */
const shortOut = (n: string) => (n.split(/[—–]/)[0] || n).trim() || n;

export function Projects({
  t,
  canEdit,
  /* **في «نظرة عامة» موجزٌ لا تفصيل**: شريط المراحل بأسماء المخرجات
     ونسبها وحدها — بلا كميات ولا أعداد، فليست لكل من يفتح الصفحة */
  compact = false,
}: {
  t: T;
  canEdit: boolean;
  compact?: boolean;
}) {
  const { items, loaded, remove, undo, undoTop, dismissUndo, reload } = useItems("projects");
  const [edit, setEdit] = useState<Item | null>(null);
  /* أرقام لوحة متابعة المشروع — تُقرأ مرةً عند فتح الصفحة، وتُعاد
     القراءة كلما تغيّرت البنود. وتعذُّرُها لا يكسر شيئاً: تبقى
     المراحل المكتوبة يدوياً */
  const [pdash, setPdash] = useState<PdSummary | null>(null);
  const linked = items.some((x) => isPdash(x.data));
  useEffect(() => {
    if (!linked) return;
    let on = true;
    void loadProjectOutputs().then((x) => {
      if (on) setPdash(x);
    });
    return () => {
      on = false;
    };
  }, [linked]);
  /* النسب تُدخَل بكسور عشرية (٤١٫٣) فطرحها المباشر يعطي ٦٫٥٩٩٩٩٩٩٩٩٩٩٩٩٩٤ —
     التقريب لخانة واحدة عند العرض وحده، والقيمة المحفوظة تبقى كما أُدخلت. */
  const p1 = (n: number) => Math.round(n * 10) / 10;

  /* شريط الحالة فوق البطاقات: كم مشروعاً، وأين هي من خطتها */
  const sum = useMemo(() => {
    let on = 0, near = 0, late = 0;
    for (const it of items) {
      const g = numOf(it.data.actual) - numOf(it.data.planned);
      if (g <= -10) late++;
      else if (g < 0) near++;
      else on++;
    }
    return { on, near, late };
  }, [items]);

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
      <div className="pjx-kpi">
        {[
          { k: "all", n: items.length, l: t("مشاريع استراتيجية", "Projects"), ic: "rocket" },
          { k: "on", n: sum.on, l: t("على المسار", "On track"), ic: "check" },
          { k: "near", n: sum.near, l: t("قريب من التأخر", "At risk"), ic: "clock" },
          { k: "late", n: sum.late, l: t("متأخر", "Late"), ic: "alert" },
        ].map((x) => (
          <div className={`pjx-kp ${x.k}`} key={x.k}>
            <span className="ic">
              <PIcon id={x.ic} size={20} />
            </span>
            {/* الرقم وعنوانه معاً إلى جوار الأيقونة — كانا يُدفعان
                إلى الطرف الآخر فيبتعد الكلام عن أيقونته */}
            <span className="tx">
              <b>{AR(x.n)}</b>
              <span className="l">{x.l}</span>
            </span>
          </div>
        ))}
      </div>

      <div className={`pjx-g ${compact ? "lite" : ""}`}>
        {items.map((it) => {
          const d = it.data;
          const live = isPdash(d) ? pdash : null;
          const planned = numOf(d.planned);
          /* الإنجاز الفعلي من اللوحة إن كان المشروع مربوطاً بها */
          const actual = live ? live.pct : numOf(d.actual);
          const g = p1(actual - planned);
          // مشروع لم تصل بياناته بعد: لا نعرض «متقدم ٠٪» بل نقول ذلك صراحةً
          const blank = planned === 0 && actual === 0;
          const left = Math.max(0, numOf(d.months) - numOf(d.elapsed));
          const st = g <= -10 ? "late" : g < 0 ? "near" : "on";
          const stages: PjStage[] = live
            ? live.outs.map((o) => ({ name: o.name, pct: o.pct, done: o.done, total: o.total, unit: o.unit }))
            : pjStages(d, actual);
          const notes = txt(d.note)
            .split(/\n+/)
            .map((x) => x.trim())
            .filter(Boolean);
          return (
            <div className="pjx" key={it.id}>
              <div className="pjx-h">
                <span className="wk-ci">
                  <PIcon id="gantt" size={19} />
                </span>
                <h4>{txt(d.name) || "—"}</h4>
                <span className={`pjx-st ${st}`}>
                  <i />
                  {txt(d.status) ||
                    (st === "late" ? t("متأخر", "Late") : st === "near" ? t("قريب من التأخر", "At risk") : t("على المسار", "On track"))}
                </span>
              </div>

              {(d.period || numOf(d.months) > 0) && (
                <div className="pjx-dt">
                  <PIcon id="calendar" size={14} />
                  {txt(d.period) ||
                    `${t("الشهر", "Month")} ${AR(numOf(d.elapsed))} ${t("من", "of")} ${AR(numOf(d.months))}`}
                </div>
              )}

              <div className="pjx-k">
                <div className="pjx-ring">
                  <PjRing pct={actual} late={st !== "on"} />
                  <span>{t("الإنجاز الفعلي", "Actual")}</span>
                </div>
                <div className="pjx-t">
                  <span className="ic">
                    <PIcon id="calendar" size={18} />
                  </span>
                  <b>{AR(left)}</b>
                  <span className="l">{t("المدة المتبقية (شهر)", "Months left")}</span>
                </div>
                <div className="pjx-t">
                  <span className="ic">
                    <PIcon id="bars" size={18} />
                  </span>
                  <b>{AR(p1(planned))}٪</b>
                  <span className="l">{t("المخطط", "Planned")}</span>
                </div>
                <div className="pjx-t">
                  <span className="ic">
                    <PIcon id="target" size={18} />
                  </span>
                  {blank ? (
                    <>
                      <b className="mute">—</b>
                      <span className="l">{t("بانتظار البيانات", "Awaiting data")}</span>
                    </>
                  ) : (
                    <>
                      <b className={g < 0 ? "warn" : "ok"}>{`${g < 0 ? "−" : "+"}${AR(Math.abs(g))}٪`}</b>
                      <span className="l">{g < 0 ? t("متأخر عن الخطة", "Behind plan") : t("متقدم على الخطة", "Ahead of plan")}</span>
                    </>
                  )}
                </div>
              </div>

              {/* مخرجاتٌ لها كميات ⇒ صفٌّ لكل مخرج فيه شريطُه وعدداه،
                  كما في لوحة متابعة المشروع. وإلا فشريط المراحل كما كان */}
              {stages.some((x) => x.total) && !compact ? (
                <div className="pjx-out">
                  <div className="hd">
                    {t("مخرجات المشروع", "Project outputs")}
                    {live && (
                      <em>
                        {t("من لوحة متابعة المشروع", "From the project dashboard")}
                        {live.updatedAt ? ` · ${live.updatedAt}` : ""}
                      </em>
                    )}
                  </div>
                  {stages.map((x, i) => (
                    <div className="o" key={x.name + i}>
                      <div className="t">
                        <b>{x.name}</b>
                        <u>{AR(Math.round(x.pct * 10) / 10)}٪</u>
                      </div>
                      <span className="b">
                        <i
                          style={{
                            width: `${x.pct}%`,
                            background: PJ_COLORS[i % PJ_COLORS.length],
                          }}
                        />
                      </span>
                      <div className="n">
                        <span className="d">{AR(x.done ?? 0)}</span>
                        {` ${t("من", "of")} `}
                        {AR(x.total ?? 0)}
                        {x.unit ? ` ${x.unit}` : ""}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
              <div className="pjx-sg">
                <div className="hd">
                  {live
                    ? t("مخرجات المشروع", "Project outputs")
                    : t("توزيع مراحل المشروع", "Project stages")}
                </div>
                <div className="bar">
                  {stages.map((x, i) => (
                    <span className="seg" key={x.name + i}>
                      <i
                        style={{
                          width: `${x.pct}%`,
                          background: PJ_COLORS[i % PJ_COLORS.length],
                        }}
                      />
                    </span>
                  ))}
                </div>
                <div className="lg">
                  {stages.map((x, i) => (
                    <span key={x.name + i}>
                      <i style={{ background: PJ_COLORS[i % PJ_COLORS.length] }} />
                      {compact ? shortOut(x.name) : x.name}
                      <u>{AR(Math.round(x.pct))}٪</u>
                    </span>
                  ))}
                </div>
              </div>
              )}

              {/* «أبرز المستجدات» تفصيلٌ لا موجز: لا تظهر في نظرة عامة */}
              {!compact && notes.length > 0 && (
                <div className="pjx-up">
                  <div className="hd">
                    <PIcon id="note" size={15} />
                    {t("أبرز المستجدات", "Highlights")}
                  </div>
                  <ul>
                    {notes.map((x, i) => (
                      <li key={i}>
                        <i />
                        {x}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

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
   جودة ملاحظات الأداء
   ------------------------------------------------------------
   دورةٌ ربعية: تُقيَّم ملاحظاتُ كل عنصرٍ متعثر (مؤشر أو مبادرة)
   على أربعة معايير، ومنها تُشتقّ نسبةُ الجهة والقطاع والإدارة.

   **لا رقم يُكتب يدوياً**: نسبة الإدارة والقطاع والجهة والمعايير
   والفرق عن الربع السابق — كلُّها محسوبةٌ من الصفوف نفسها. فما
   يُرفع مرةً يَظهر في الصفحة وفي نظرة عامة وفي محفظة الموظف بلا
   إدخالٍ ثانٍ.

   والحساب في `lib/notesq` ليُختبر بلا React ولا شبكة. وأهمّ ما
   فيه: العنصر لا يُحتسب ملتزماً إلا باستيفاء المعايير الأربعة
   كلّها، والترجيح بعدد العناصر لا بعدد الجهات.
   ============================================================ */

/** لونُ النطاق — من متغيّرات الهوية لا بأرقامٍ مكتوبة */
const NQ_TONE: Record<string, string> = {
  ok: "var(--success)",
  wt: "var(--warn)",
  no: "var(--danger)",
};

/** اسم الربع الذي قبله — ليُسمّى العمود الفارغ باسمه لا بـ«السابق» */
const NQ_QN = ["الربع الأول", "الربع الثاني", "الربع الثالث", "الربع الرابع"];
function prevName(q: string): string {
  const o = nqQOrder(q);
  const n = o % 10;
  const y = Math.floor(o / 10);
  if (n >= 2) return `${NQ_QN[n - 2]}${y ? ` ${AR(y)}` : ""}`;
  if (n === 1 && y) return `${NQ_QN[3]} ${AR(y - 1)}`;
  return "";
}

/** خانة نسبة ملوَّنة بنطاقها */
function NqPct({ pct }: { pct: number }) {
  const b = nqBand(pct);
  return <span className={`nq-pc ${b.tone}`}>{AR(pct)}%</span>;
}

/** فرق الربع عن سابقه — ▲ أو ▼ أو لا شيء */
function NqDelta({ d }: { d: number | null }) {
  if (d === null || d === 0) return null;
  return (
    <span className={`nq-dl ${d < 0 ? "dn" : "up"}`}>
      {d < 0 ? "▼" : "▲"} {AR(Math.abs(d))}%
    </span>
  );
}

/* ---------------- صندوق «نظرة عامة»: خطّ الأرباع ---------------- */
export function NotesQBox({ t }: { t: T }) {
  const { items, loaded } = useItems("notesq");
  const qs = useMemo(() => nqQuarters(items), [items]);
  if (!loaded) return <div className="empty">{t("جارٍ التحميل...", "Loading...")}</div>;
  if (!qs.length)
    return <div className="sx-none">{t("لا توجد بيانات بعد — تُرفع من صفحة القسم.", "No data yet.")}</div>;

  /* أرباع السنة الأحدث: الصندوق لوحةُ متابعة لا أرشيفاً */
  const year = Math.floor(nqQOrder(qs[qs.length - 1].q) / 10);
  const QN = ["الربع الأول", "الربع الثاني", "الربع الثالث", "الربع الرابع"];
  const shown = QN.map((nm) => {
    const hit = qs.find((x) => nqQOrder(x.q) === year * 10 + QN.indexOf(nm) + 1);
    return { nm, hit };
  });

  return (
    <div className="nq-line">
      {shown.map(({ nm, hit }) => {
        const tone = hit ? nqBand(hit.stat.pct).tone : "";
        return (
          <div className={`nq-q ${hit ? "on " + tone : ""}`} key={nm}>
            <b style={hit ? { color: NQ_TONE[tone] } : undefined}>
              {hit ? `${AR(hit.stat.pct)}%` : "—"}
              {hit && <NqDelta d={hit.delta} />}
            </b>
            <i style={hit ? { borderColor: NQ_TONE[tone] } : undefined} />
            <span>{nm}</span>
            <em>
              {hit
                ? t(`${AR(hit.stat.n)} عنصر`, `${hit.stat.n} items`)
                : t("لم يُرفع بعد", "Not uploaded")}
            </em>
          </div>
        );
      })}
    </div>
  );
}

/* ---------------- الصفحة ---------------- */
const NQ_COLS: ICol[] = [
  { k: "entity", label: "الجهة", w: 220 },
  { k: "sector", label: "القطاع", opts: ["", ...INST_SECTORS], w: 150 },
  { k: "name", label: "العنصر", w: 200 },
  { k: "kind", label: "النوع", opts: ["", "مؤشر", "مبادرة"], w: 100 },
  { k: "c1", label: "وصف التحدي", w: 100 },
  { k: "c2", label: "تصنيف التحدي", w: 100 },
  { k: "c3", label: "الإجراء التصحيحي", w: 110 },
  { k: "c4", label: "تاريخ الإجراء", w: 100 },
  { k: "total", label: "عدد العناصر", w: 100 },
  { k: "pct", label: "نسبة الالتزام ٪", w: 110 },
];

function NotesQPage({ t, canEdit, add, gear }: SecPageProps) {
  const { items, loaded, reload, undo, undoTop, dismissUndo } = useItems("notesq");
  const [pick, setPick] = useState("");
  const [tab, setTab] = useState<"sector" | "entity">("sector");
  const [q, setQ] = useState("");
  const [f, setF] = useState("");

  const qs = useMemo(() => nqQuarters(items), [items]);
  /* الافتراضي آخر ربعٍ مرفوع — هو ما يُسأل عنه */
  const cur = pick || qs[qs.length - 1]?.q || "";
  const qRows = useMemo(() => (cur ? nqOfQuarter(items, cur) : []), [items, cur]);

  const all = useMemo(() => nqTally(qRows), [qRows]);
  const crit = useMemo(() => nqCriteria(qRows), [qRows]);
  const obs = useMemo(() => nqObs(qRows), [qRows]);
  const bySec = useMemo(() => nqGroup(qRows, "sector"), [qRows]);
  const byEnt = useMemo(() => nqEntities(qRows), [qRows]);
  const curIdx = qs.findIndex((x) => nqNrm(x.q) === nqNrm(cur));
  const delta = qs[curIdx]?.delta ?? null;

  /* **القطاعات عمودان لكل قطاع**: الربع المعروض وما قبله — بطلب
     صاحبة المنصة. والربع الذي لم يُرفع عمودٌ مخطَّط بـ«—» فلا تبقى
     فجوةٌ تُربك القراءة. */
  const prevQ = curIdx > 0 ? qs[curIdx - 1].q : prevName(cur);
  const bySecPrev = useMemo(
    () => (curIdx > 0 ? nqGroup(nqOfQuarter(items, qs[curIdx - 1].q), "sector") : []),
    [items, qs, curIdx],
  );
  /* القطاعات بترتيب نسبة الربع المعروض، ومعها ما ظهر في السابق وحده */
  const secCols = useMemo(() => {
    type Col = { name: string; now: NQStat | null; was: NQStat | null };
    const prev = new Map(bySecPrev.map((x) => [nqNrm(x.name), x.stat]));
    const out: Col[] = bySec.map((x) => ({ name: x.name, now: x.stat, was: prev.get(nqNrm(x.name)) || null }));
    /* قطاعٌ كان في الربع السابق ولم يَرِد في المعروض يبقى ظاهراً،
       وإلا بدا كأنه لم يكن */
    for (const x of bySecPrev)
      if (!out.some((y) => nqNrm(y.name) === nqNrm(x.name)))
        out.push({ name: x.name, now: null, was: x.stat });
    /* البحث وفلتر القطاع يعملان على ما يُعرض: الأعمدة في تبويب
       القطاعات، والأسماء في تبويب الجهات */
    return out.filter((x) => (!f || x.name === f) && (!q || x.name.includes(q)));
  }, [bySec, bySecPrev, f, q]);

  const entRows = useMemo(
    () => byEnt.filter((x) => !q || x.name.includes(q)),
    [byEnt, q],
  );

  function exportXl() {
    const head = ["الربع", ...NQ_COLS.map((c) => c.label)];
    const body = (qRows as Item[]).map((it) => [cur, ...NQ_COLS.map((c) => txt(it.data[c.k]))]);
    const sec = [["القطاع", "نسبة الالتزام ٪", "عدد العناصر"],
      ...bySec.map((x) => [x.name, String(x.stat.pct), String(x.stat.n)])];
    const ent = [["الجهة", "نسبة الالتزام ٪", "عدد العناصر"],
      ...byEnt.map((x) => [x.name, String(x.stat.pct), String(x.stat.n)])];
    download(
      `جودة-ملاحظات-الأداء-${cur || ""}.xlsx`,
      writeXlsx([
        { name: "البيانات", rows: [head, ...body] },
        { name: "القطاعات", rows: sec },
        { name: "الجهات", rows: ent },
      ]),
    );
  }

  if (!loaded) return <div className="empty">{t("جارٍ التحميل...", "Loading...")}</div>;

  return (
    <>
      <Toolbar
        q={q} setQ={setQ}
        filter={f} setFilter={setF}
        options={bySec.map((x) => ({ v: x.name, l: `${x.name} (${AR(x.stat.n)})` }))}
        allLabel={t("كل القطاعات", "All sectors")}
        onExport={exportXl}
        upload={canEdit ? <NotesQImport items={items} t={t} onDone={() => void reload()} /> : null}
        add={add}
        gear={gear}
        t={t}
      />

      {!items.length ? (
        <Empty
          title={t("لا توجد بيانات بعد", "Nothing yet")}
          note={t("تُرفع من «رفع إكسل» أو تُضاف من زر «إضافة».", "Upload the file or add rows.")}
        />
      ) : (
        <>
          {/* الربع المعروض — آخر ما رُفع افتراضاً */}
          <div className="chips" style={{ marginBottom: 12 }}>
            {qs.map((x) => (
              <button
                key={x.q}
                className={`chip sm ${nqNrm(x.q) === nqNrm(cur) ? "on" : ""}`}
                onClick={() => setPick(x.q)}
              >
                {x.q}
              </button>
            ))}
          </div>

          <div className="nq-top">
            <div className="nq-ring-box">
              <div
                className="nq-ring"
                style={{
                  background: `conic-gradient(${NQ_TONE[nqBand(all.pct).tone]} 0 ${all.pct}%, var(--line2) ${all.pct}% 100%)`,
                }}
              >
                <i>{AR(all.pct)}%</i>
              </div>
              <div className="nq-k">
                {t("نسبة العناصر المتعثرة الملتزمة بمعايير ملاحظات الأداء",
                   "Elements complying with the notes criteria")}
              </div>
              <NqDelta d={delta} />
              <div className="nq-n">
                <b>{AR(all.n)}</b> {t("عنصر متعثر", "elements")}
              </div>
            </div>

            <div className="nq-bars-box">
              <h4>{t("حالة الالتزام بكتابة ملاحظات الأداء للعناصر المتعثرة وفقاً للمعايير",
                     "Compliance by criterion")}</h4>
              {/* أشرطة أفقية: اسم المعيار يميناً والنسبة يساراً — بطلب
                  صاحبة المنصة. والأعمدة الرأسية كانت تُجبر الاسم على
                  سطرٍ ضيّق تحتها. ولونُ الشريط من نطاقه، فالدليل أسفله
                  يشرح الألوان بدل أن يكون زينة */}
              <div className="nq-rows">
                {crit.map((c) => (
                  <div className="r" key={c.name}>
                    <span className="n">{c.name}</span>
                    <span className="t">
                      <i
                        style={{
                          width: `${c.stat ? Math.max(c.stat.pct, 1) : 0}%`,
                          background: c.stat ? NQ_TONE[nqBand(c.stat.pct).tone] : "transparent",
                        }}
                      />
                    </span>
                    <b>{c.stat ? `${AR(c.stat.pct)}%` : "—"}</b>
                  </div>
                ))}
              </div>
              <div className="nq-lg">
                {NQ_BANDS.map((b) => (
                  <span key={b.label}>
                    <i style={{ background: NQ_TONE[b.tone] }} />
                    {b.label} {AR(b.min)}–{b.min === 90 ? "100" : b.min === 70 ? "89" : "69"}%
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* تبويب «البيانات» أُزيل بطلب صاحبة المنصة — والتصحيح
              يصير برفع ملف إكسل */}
          <div className="chips" style={{ margin: "14px 0 10px" }}>
            {([["sector", "القطاعات"], ["entity", "الجهات"]] as const).map(([k, lb]) => (
              <button key={k} className={`chip sm ${tab === k ? "on" : ""}`} onClick={() => setTab(k)}>
                {lb}
              </button>
            ))}
          </div>

          {tab === "sector" ? (
            /* عمودان لكل قطاع: الربع المعروض وما قبله — بنفس تجسيم
               أعمدة المؤشرات في «نظرة عامة» وأنحف منها */
            <div className="nq-sec">
              <div className="nqk">
                {secCols.map((x) => (
                  <div className="g" key={x.name}>
                    <div className="gb">
                      {[{ q: prevQ, st: x.was }, { q: cur, st: x.now }].map((b, i) => (
                        <div className={`c ${b.st ? "" : "na"}`} key={i} title={`${x.name} — ${b.q}`}>
                          <div className="bw" style={b.st ? { height: `${Math.max(2, b.st.pct)}%` } : undefined}>
                            <span className="v">{b.st ? `${AR(b.st.pct)}%` : "—"}</span>
                            <span
                              className="bar"
                              style={b.st ? { background: NQ_TONE[nqBand(b.st.pct).tone] } : undefined}
                            />
                          </div>
                          <span className="q">{b.q || "—"}</span>
                        </div>
                      ))}
                    </div>
                    <div className="lb">
                      {x.name}
                      <em>{t(`${AR((x.now || x.was)!.n)} عنصراً`, `${(x.now || x.was)!.n}`)}</em>
                    </div>
                  </div>
                ))}
              </div>
              {/* شريط «الإجمالي» أُزيل بطلب صاحبة المنصة — الرقم نفسه
                  في الدائرة أعلى الصفحة */}
            </div>
          ) : (
            <div className="tbl-wrap">
              <table className="sx-tbl nq-tbl">
                <thead>
                  <tr>
                    <th>{t("اسم الجهة", "Entity")}</th>
                    <th className="c">{t("نسبة الالتزام", "Compliance")}</th>
                    <th className="c">{t("عدد العناصر المتعثرة", "Elements")}</th>
                  </tr>
                </thead>
                <tbody>
                  {entRows.map((x) => (
                    <tr key={x.name}>
                      <td>{x.name}</td>
                      <td className="c"><NqPct pct={x.stat.pct} /></td>
                      <td className="c">{AR(x.stat.n)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {obs.some((o) => o.list.length) && (
            <>
              <h4 className="nq-h">{t("أبرز المشاهدات وملاحظات المقيمين", "Evaluator observations")}</h4>
              <div className="nq-obs">
                {obs.map((o) => (
                  <div className="nq-ob" key={o.name}>
                    <div className="oh">
                      <b>{o.name}</b>
                      <em>{t("نسبة تكرارها", "Frequency")}</em>
                    </div>
                    <ul>
                      {o.list.length ? (
                        o.list.map((x, i) => (
                          /* النصّ أولاً ثم النسبة — فتقع النسبة تحت
                             عنوانها «نسبة تكرارها» لا تحت اسم المعيار */
                          <li key={i}>
                            <span>{x.text}</span>
                            <b>{AR(x.pct)}%</b>
                          </li>
                        ))
                      ) : (
                        <li className="none">{t("لا ملاحظات", "None")}</li>
                      )}
                    </ul>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}

      <UndoBar step={undoTop} onUndo={() => void undo()} onClose={dismissUndo} t={t} />
    </>
  );
}

/* رفع ملف الربع — يقبل صيغتَي الملف: صفّاً لكل عنصرٍ متعثر، أو
   صفّاً لكل جهةٍ بعددها ونسبتها. والمطابقة بالجهة والعنصر والربع،
   فإعادة رفع الملف نفسه تحدّث ولا تكرّر. */
function NotesQImport({ items, t, onDone }: { items: Item[]; t: T; onDone: () => void }) {
  const [msg, setMsg] = useState("");
  const ref = useRef<HTMLInputElement>(null);

  const keyOf = (d: Rec) =>
    `${nqNrm(d.quarter)}|${nqNrm(d.entity)}|${nqNrm(d.name)}`;

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setMsg(t("جارٍ القراءة...", "Reading..."));
    try {
      const sheets = await readXlsxSheets(await file.arrayBuffer());
      let hit: { rows: string[][]; hi: number; map: Record<number, string> } | null = null;
      for (const sh of sheets) {
        const rs = sh.rows || [];
        for (let i = 0; i < Math.min(rs.length, 8); i++) {
          const m: Record<number, string> = {};
          (rs[i] || []).forEach((c, ci) => {
            const k = nqKeyOf(txt(c));
            if (k && !Object.values(m).includes(k)) m[ci] = k;
          });
          const v = Object.values(m);
          /* يكفي عمودُ الجهة ومعه معيارٌ واحد أو عددُ العناصر */
          if (v.includes("entity") && (v.some((x) => NQ_CKEYS.includes(x)) || v.includes("total"))) {
            hit = { rows: rs, hi: i, map: m };
            break;
          }
        }
        if (hit) break;
      }
      if (!hit) {
        setMsg(t(
          "لم أجد صف العناوين — لا بدّ من عمود «الجهة» ومعه المعايير الأربعة أو «عدد العناصر».",
          "Header row not found.",
        ));
        return;
      }

      /* الربع: من عمودٍ في الملف، وإلا يُسأل عنه مرّةً واحدة */
      const hasQ = Object.values(hit.map).includes("quarter");
      let qAll = "";
      if (!hasQ) {
        qAll = (prompt(t("ما الربع الذي يخصّه هذا الملف؟", "Which quarter?"), "الربع الثالث 2025") || "").trim();
        if (!qAll) { setMsg(""); return; }
      }

      const byKey = new Map(items.map((it) => [keyOf(it.data), it]));
      let maxOrd = items.reduce((a, b) => Math.max(a, b.ord || 0), 0);
      const put: { id: string; ord: number; data: Rec }[] = [];
      let upd = 0;
      for (const r of hit.rows.slice(hit.hi + 1)) {
        const d: Rec = {};
        for (const [ci, k] of Object.entries(hit.map)) {
          const v = txt(r[Number(ci)]).trim();
          if (!v) continue;
          /* المعايير تُوحَّد على علامةٍ واحدة، فلا تتفرّق «نعم» و«1» و«✓» */
          d[k] = NQ_CKEYS.includes(k) ? (nqCheck(v) === 1 ? "✅" : nqCheck(v) === 0 ? "" : v) : v;
        }
        if (!txt(d.entity).trim()) continue;
        if (qAll) d.quarter = qAll;
        const cur = byKey.get(keyOf(d));
        if (cur) {
          upd++;
          put.push({ id: cur.id, ord: cur.ord, data: { ...cur.data, ...d } });
        } else {
          put.push({ id: "nq-" + Math.random().toString(36).slice(2, 10), ord: ++maxOrd, data: d });
        }
      }
      if (!put.length) {
        setMsg(t("لا صفوف في الملف", "No rows in the file"));
        return;
      }
      if (!confirm(t(
        `سيُحدَّث ${upd} صفاً ويُضاف ${put.length - upd}. متابعة؟`,
        `${upd} updated, ${put.length - upd} added. Continue?`,
      ))) {
        setMsg("");
        return;
      }
      for (let i = 0; i < put.length; i += 40) {
        const r = await apiFetch("/api/items", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ section: "notesq", items: put.slice(i, i + 40) }),
        });
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          setMsg(txt(j.error) || t("تعذّر الحفظ", "Save failed"));
          return;
        }
      }
      setMsg(t(`تم · ${put.length} صفاً`, `Done · ${put.length}`));
      onDone();
    } catch {
      setMsg(t("تعذّرت قراءة الملف", "Could not read the file"));
    }
  }

  return (
    <>
      <button className="btn btn-sm" onClick={() => ref.current?.click()}>
        <IconUp size={15} /> {t("رفع إكسل", "Upload Excel")}
      </button>
      <input ref={ref} type="file" accept=".xlsx,.xls" hidden onChange={pick} />
      {msg && <span className="sx-msg">{msg}</span>}
    </>
  );
}

/* ============================================================
   الصفحات الكاملة
   ============================================================ */
export function SectionPage({
  section,
  canEdit,
  meId,
  t,
}: {
  section: SectionKey;
  canEdit: boolean;
  /** لاستثناء صاحب الصفحة من قائمة من يُفوَّض */
  meId?: string;
  t: T;
}) {
  const [editing, setEditing] = useState<Item | "new" | null>(null);
  /* ⚙️ التفويض أثناء الإجازة — يظهر لمن يحرّر القسم، والقاعدة
     تمنع مَن فُوِّض من التفويض بدوره */
  const [gear, setGear] = useState(false);
  const [nonce, setNonce] = useState(0);
  /* معرّفات ما هو محمَّل فعلاً — ليعرف زر التحميل ما ينقص */
  /* البنود تُحمَّل للأقسام كلها: شريط «التحديث الدوري» يقرأ منها
     من حدّث ومن لم يحدّث */
  const { items } = useItems(section);
  const have = useMemo(() => new Set(items.map((x) => x.id)), [items]);

  const gearBtn = canEdit ? (
    <button
      className="sx-gear"
      onClick={() => setGear(true)}
      title={t("إعدادات القسم — تفويض أثناء الإجازة", "Section settings")}
      aria-label={t("إعدادات القسم", "Section settings")}
    >
      <IconGear />
    </button>
  ) : null;

  const gearModal = gear ? (
    <SectionSettings
      section={section}
      title={t(SECTION_TITLE[section][0], SECTION_TITLE[section][1])}
      meId={meId || ""}
      rows={items}
      onClose={() => setGear(false)}
      t={t}
    />
  ) : null;

  /* شريط الدورة فوق الصفحة — يراه الجميع، ويحرّكه صاحب الصلاحية */
  const cycleBar = CYCLE_CFG[section] ? (
    <CycleBar section={section} rows={items} canEdit={canEdit} t={t} />
  ) : null;

  /* الزرّان يُمرَّران إلى شريط الصفحة نفسه، فلا يبقى شريطان فوق
     بعض: «إضافة» في صدره و⚙️ في آخره مع صندوقَي الإكسل */
  const addBtn = canEdit ? (
    <button className="btn btn-sm" onClick={() => setEditing("new")}>
      ＋ {t("إضافة", "Add")}
    </button>
  ) : null;

  if (section === "outputs")
    return (
      <div>
        {(addBtn || gearBtn) && (
          <div className="sx-tb">
            {addBtn}
            <span className="gr" />
            {gearBtn}
          </div>
        )}
        {cycleBar}
        <Outputs t={t} />
        {gearModal}
      </div>
    );

  return (
    <div key={nonce}>
      {section === "projects" && canEdit && (
        <div className="sx-tools">
          <button className="btn btn-sm" onClick={() => setEditing("new")}>
            {t("إضافة", "Add")}
          </button>
          {SEEDED.includes(section) && (
            <SeedBtn section={section} have={have} t={t} onDone={() => setNonce((n) => n + 1)} />
          )}
          {gearBtn}
        </div>
      )}
      {cycleBar}
      {section === "sessions" && <SessionsPage t={t} canEdit={canEdit} add={addBtn} gear={gearBtn} />}
      {section === "natstrat" && <NationalPage t={t} canEdit={canEdit} add={addBtn} gear={gearBtn} />}
      {section === "inststrat" && <InstPage t={t} canEdit={canEdit} add={addBtn} gear={gearBtn} />}
      {section === "cx" && <CxPage t={t} canEdit={canEdit} add={addBtn} gear={gearBtn} />}
      {section === "notesq" && <NotesQPage t={t} canEdit={canEdit} add={addBtn} gear={gearBtn} />}
      {section === "projects" && <Projects t={t} canEdit={canEdit} />}


      {gearModal}

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
type Field = { k: string; label: string; kind?: "num" | "text" | "date" | "bool" | "area" | "trk" };

const FIELDS: Record<Exclude<SectionKey, "outputs" | "opplan">, Field[]> = {
  /* صفٌّ واحد يصلح للصورتين: عنصرٌ متعثر بمعاييره الأربعة، أو جهةٌ
     بعدد عناصرها ونسبتها. يُملأ ما يناسب ويُترك الباقي. */
  notesq: [
    { k: "quarter", label: "الربع (مثال: الربع الثالث 2025)" },
    { k: "entity", label: "الجهة" },
    { k: "sector", label: "القطاع (المالي والاقتصادي · البنية التحتية · الخدمات الاجتماعية · الشؤون الحكومية)" },
    { k: "name", label: "العنصر المتعثر (مؤشر أو مبادرة)" },
    { k: "kind", label: "النوع (مؤشر · مبادرة)" },
    { k: "c1", label: "وصف التحدي — ✅ إن استوفى المعيار" },
    { k: "c2", label: "تصنيف التحدي — ✅ إن استوفى المعيار" },
    { k: "c3", label: "الإجراء التصحيحي — ✅ إن استوفى المعيار" },
    { k: "c4", label: "تاريخ الإجراء التصحيحي — ✅ إن استوفى المعيار" },
    { k: "total", label: "أو: عدد العناصر المتعثرة في الجهة", kind: "num" },
    { k: "pct", label: "أو: نسبة الالتزام ٪", kind: "num" },
  ],
  sessions: [
    { k: "entity", label: "الجهة" },
    { k: "quarter", label: "الربع" },
    { k: "done", label: "عدد المراحل المكتملة (0–6)", kind: "num" },
    { k: "perf", label: "نسبة الأداء العام ٪", kind: "num" },
    { k: "kpiBad", label: "المؤشرات المتعثرة", kind: "num" },
    { k: "kpiTot", label: "إجمالي المؤشرات", kind: "num" },
    { k: "initBad", label: "المبادرات المتعثرة", kind: "num" },
    { k: "initTot", label: "إجمالي المبادرات", kind: "num" },
    { k: "esc", label: "مرحلة التصعيد (0 بلا تصعيد · 1 الخدمات الاستشارية · 2 الإدارة التنفيذية · 3 مجلس الإدارة · 4 مركز الحكومة)", kind: "num" },
    { k: "note", label: "أبرز التحديات", kind: "area" },
  ],
  natstrat: [
    { k: "name", label: "الاستراتيجية" },
    { k: "owner", label: "الجهة المالكة" },
    { k: "sector", label: "القطاع (المالي والاقتصادي · البنية التحتية · الخدمات الاجتماعية · الشؤون الحكومية)" },
    { k: "domain", label: "النطاق (التوطين · الحج · الفضاء…)" },
    { k: "stage", label: "حالة الاعتماد (1 إعداد · 2 مراجعة · 3 اللجنة · 4 مجلس الوزراء)", kind: "num" },
    /* «مقبولة فنياً» لا تُكتب: تُشتقّ من اكتمال المحطات الأربع —
       ولهذا تُحرَّر المحطات من النموذج أيضاً لا من نقاط البطاقة
       وحدها، فمن يفتح «تعديل» لا يجد فيه ما يغيّر القبول الفنّي */
    { k: "track", label: "محطات المراجعة", kind: "trk" },
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
    {
      k: "pdash",
      label: "ربط بلوحة متابعة المشروع (نعم) — تُقرأ المخرجات ونسبة الإنجاز منها",
    },
    {
      k: "stages",
      label:
        "مراحل المشروع أو مخرجاته — سطر لكل واحد. بعد النقطتين: نسبة " +
        "(المخرج الثاني:100) أو محقق/مستهدف ووحدته (المخرج الأول:31/60 تقرير) " +
        "فتُحسب النسبة ويظهر العددان",
      kind: "area",
    },
    { k: "note", label: "أبرز المستجدات (سطر لكل مستجد)", kind: "area" },
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
  const fields = FIELDS[section as Exclude<SectionKey, "outputs" | "opplan">] || [];
  const [form, setForm] = useState<Rec>(() => ({ ...(item?.data || {}) }));
  const [stages, setStages] = useState<{ n: string; d: string }[]>(() => {
    if (section !== "sessions") return [];
    const raw = Array.isArray(item?.data?.stages) ? item!.data.stages : [];
    return raw.length
      ? raw.map((x: Rec) => ({ n: txt(x.n), d: txt(x.d) }))
      : SESS_STAGES.map((n) => ({ n, d: "" }));
  });
  /* محطات الاستراتيجية الوطنية — تُحرَّر من النموذج كما تُحرَّر
     بالضغط على نقاط البطاقة، والقبول الفنّي يُشتقّ منها */
  const [trk, setTrk] = useState<number[]>(() => natTrack(item?.data || {}));
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
    if (fields.some((f) => f.kind === "trk")) {
      /* المصفوفة وحدها، وتُمحى المفاتيح المفردة القديمة */
      Object.assign(data, natNoLegacy(data), { track: trk });
    }
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
            f.kind === "trk" ? (
              <div key={f.k} className="trk-form">
                <span className="trk-h">{f.label}</span>
                <div className="trk-row">
                  {NAT_TRACK.map((n, i) => (
                    <label key={n}>
                      <span>{n}</span>
                      <select
                        value={trk[i]}
                        onChange={(e) =>
                          setTrk(trk.map((v, j) => (j === i ? Number(e.target.value) : v)))
                        }
                      >
                        {TRACK_STATE.map((lab, v) => (
                          <option key={lab} value={v}>
                            {lab}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
              </div>
            ) : f.kind === "bool" ? (
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

/* ============================================================
   مؤشرات «نظرة عامة» تُقرأ من صفحات الأقسام
   ------------------------------------------------------------
   كان كل مؤشر يُدخَل يدوياً في «القياسات» وإن كانت صفحته تحسبه
   أصلاً — فيختلف الرقمان. الآن المؤشر الذي له صفحة يأخذ رقمها،
   وصيغةُ كلٍّ من نصّ المؤشر نفسه لا من قاعدة عامة:

     · قياس خدمات الأجهزة   ⇐ الأجهزة التي صدر لها تقرير ÷ المستهدف
     · الأداء المنخفض        ⇐ الجهات التي عُقدت لها الجلسة النهائية ÷ الكل
     · الاستراتيجيات الوطنية ⇐ المؤشرات الممثَّلة ÷ إجماليها، للمعتمدة
                               من مجلس الوزراء وحدها
     · الاستراتيجيات المؤسسية ⇐ عدد الجهات التي فُعِّل قياسها (عدد لا
                               نسبة، فيُقسَم على مستهدفه في نظرة عامة)

   وما لا صفحة له — أو صفحته بلا حقول معتمدة كالمخرجات الوطنية —
   يبقى على الإدخال اليدوي كما كان.
   ============================================================ */
export type SecKpi = { pct: number | null; count: number | null; note: string };

export function sectionKpi(section: SectionKey, items: Item[]): SecKpi {
  const none: SecKpi = { pct: null, count: null, note: "" };
  if (!items.length) return none;

  if (section === "cx") {
    const st = cxStats(items);
    return {
      pct: st.pct,
      count: st.doneAgencies,
      note: `${AR(st.doneAgencies)} جهازاً صدر له تقرير${st.target > 0 ? ` من ${AR(st.target)}` : ""}`,
    };
  }

  if (section === "sessions") {
    /* «عُقدت لها جلسة» = أتمّت مرحلة «عقد جلسة مراجعة الأداء النهائية» */
    const HELD = 4;
    const held = items.filter((it) => sessOf(it.data).done >= HELD).length;
    return {
      pct: Math.round((held / items.length) * 100),
      count: held,
      note: `${AR(held)} جهة عُقدت لها الجلسة النهائية من ${AR(items.length)}`,
    };
  }

  if (section === "natstrat") {
    /* **المعتمدة من مجلس الوزراء وحدها**، والنسبة هي المكتوبة في
       ملف المتابعة (`meas`) لا المحسوبة من عدد المؤشرات — فالملف
       هو المرجع */
    const appr = items.filter((it) => natStage(it.data) === NAT_STEPS.length);
    if (!appr.length) return none;
    const avg = appr.reduce((a, x) => a + numOf(x.data.meas), 0) / appr.length;
    return {
      pct: Math.round(avg * 10) / 10,
      count: null,
      note: `متوسط قابلية القياس في ${AR(appr.length)} استراتيجية معتمدة من مجلس الوزراء`,
    };
  }

  if (section === "inststrat") {
    const live = items.filter((it) => txt(it.data.live) === "مفعل").length;
    return { pct: null, count: live, note: `${AR(live)} جهة فُعِّل قياس استراتيجيتها` };
  }

  return none;
}

/* ============================================================
   توزيع منجز القسم على القطاعات — لنافذة المؤشر في «نظرة عامة»
   ------------------------------------------------------------
   بطاقةُ المؤشر تقرأ رقمها من صفحة القسم، لكن النافذة التفصيلية
   بقيت تقرأ جدول «القياسات» المُدخَل يدوياً. فتناقض الرقمان:
   مؤشر الاستراتيجيات المؤسسية على البطاقة جهةٌ واحدة فُعِّل قياسها،
   وفي النافذة عشر موزّعةً على القطاعات من إدخالٍ قديم.
   فصارت النافذة تُشتقّ من القسم نفسه بنفس قاعدة البطاقة.

   وما لا يحمل بنودُه قطاعاً (الجلسات) يُعرض صفّاً واحداً، وما ليس
   عدّاً أصلاً (الاستراتيجيات الوطنية نسبةُ تمثيلٍ لا عدد جهات)
   يبقى على الإدخال اليدوي — فلا يُقحَم رقمٌ لا معنى له.
   ============================================================ */
export type SecSplit = {
  /** اسم القطاع كما يُكتب في القسم ⇐ المنجز فيه · null حيث لا قطاع */
  bySector: Record<string, number> | null;
  total: number;
  /** أسماء الجهات المنجَزة — تُذكر في النافذة فيُعرف الرقم من أين جاء */
  names: string[];
  /** آخر تحديثٍ لبندٍ منجَز */
  updated: string;
  unitLabel: [string, string];
};

/** يطابق «قطاع المالي والاقتصادي» مع «المالي والاقتصادي» */
export const secKey = (v: unknown) =>
  txt(v).replace(/^\s*قطاع\s+/, "").replace(/\s+/g, " ").trim();

export function sectionSplit(section: SectionKey, items: Item[]): SecSplit | null {
  if (!items.length) return null;
  const lastUpd = (list: Item[]) =>
    list.map((x) => x.updatedAt || "").filter(Boolean).sort().slice(-1)[0] || "";
  const group = (list: Item[]) => {
    const by: Record<string, number> = {};
    for (const it of list) by[secKey(it.data.sector)] = (by[secKey(it.data.sector)] || 0) + 1;
    return by;
  };

  if (section === "inststrat") {
    const done = items.filter((it) => txt(it.data.live) === "مفعل");
    return {
      bySector: group(done),
      total: done.length,
      names: done.map((it) => txt(it.data.owner)).filter(Boolean),
      updated: lastUpd(done),
      unitLabel: ["جهة فُعِّل قياس استراتيجيتها", "measurement live"],
    };
  }

  if (section === "cx") {
    const { rows } = cxSplit(items);
    const done = rows.filter((x) => CX_QS.some((q) => txt(x.data[`${q.k}Issue`]) === CX_OK));
    return {
      bySector: group(done),
      total: done.length,
      names: done.map((it) => txt(it.data.name)).filter(Boolean),
      updated: lastUpd(done),
      unitLabel: ["جهازاً صدر له تقرير", "with a report"],
    };
  }

  if (section === "sessions") {
    /* بنود الجلسات بلا قطاع، فصفٌّ واحد أصدق من توزيعٍ مُختلَق */
    const held = items.filter((it) => sessOf(it.data).done >= 4);
    return {
      bySector: null,
      total: held.length,
      names: held.map((it) => txt(it.data.entity)).filter(Boolean),
      updated: lastUpd(held),
      unitLabel: ["جهة عُقدت لها الجلسة النهائية", "final session held"],
    };
  }

  return null;
}

/** الأقسام التي تُغذّي مؤشرات «نظرة عامة» */
export const KPI_SECTIONS: SectionKey[] = ["cx", "sessions", "natstrat", "inststrat"];

/** يقرأ الأقسام الأربعة مرّةً ويُرجع رقم كلٍّ — لصفحة «نظرة عامة» */
export function useSectionKpis() {
  const [map, setMap] = useState<Partial<Record<SectionKey, SecKpi>>>({});
  useEffect(() => {
    let live = true;
    void Promise.all(
      KPI_SECTIONS.map(async (k) => {
        const r = await apiFetch(`/api/items?section=${k}`);
        const d = await r.json().catch(() => ({}));
        return [k, sectionKpi(k, Array.isArray(d.items) ? d.items : [])] as const;
      }),
    )
      .then((pairs) => {
        if (!live) return;
        const m: Partial<Record<SectionKey, SecKpi>> = {};
        for (const [k, v] of pairs) m[k] = v;
        setMap(m);
      })
      .catch(() => setMap({}));
    return () => {
      live = false;
    };
  }, []);
  return map;
}

/* ============================================================
   ملخّص أسبوعي لقسم واحد — يستعمله «التقرير الأسبوعي».
   يُبنى من نفس الدوال والثوابت التي ترسم القسم في نظرة عامة،
   فلا يختلف رقمٌ بين الصفحة والتقرير.
   ============================================================ */
export type WeekSum = {
  total: number;
  totalLabel: string;
  breakdown: { k: string; n: number }[];
  /** تقدّم القسم نحو غايته — منه يُحسب «الأداء العام» في التقرير
      الأسبوعي. null حيث لا غاية معتمدة، فلا يدخل المتوسط أصلاً. */
  prog: { done: number; of: number } | null;
};

export function weekSummary(section: SectionKey, items: Item[]): WeekSum {
  const d = (x: Item) => x.data;

  if (section === "sessions") {
    /* كم جهة في كل مرحلة من مراحل الآلية الست — بطلب المستخدمة.
       الجهة تقع في المرحلة التي تليها ما أنجزته، ومن أتمّ الست
       يُعدّ «مكتملة» ولا يُحسب في أي مرحلة. */
    const c = sessStates(items.map(d));
    return {
      total: items.length,
      totalLabel: "جهة",
      breakdown: [
        { k: "لم تبدأ", n: c.none },
        { k: "قيد التنفيذ", n: c.live },
        { k: "مكتملة", n: c.done },
      ],
      prog: items.length ? { done: c.done, of: items.length } : null,
    };
  }

  if (section === "natstrat") {
    const c = [0, 0, 0, 0];
    for (const it of items) c[natStage(d(it)) - 1]++;
    return {
      total: items.length,
      totalLabel: "استراتيجية",
      breakdown: NAT_STEPS.map((s, i) => ({ k: s, n: c[i] })),
      /* «معتمدة» = من اللجنة أو من مجلس الوزراء */
      prog: items.length ? { done: c[2] + c[3], of: items.length } : null,
    };
  }

  if (section === "inststrat") {
    const g = (k: string, v: string) => items.filter((i) => txt(i.data[k]) === v).length;
    return {
      total: items.length,
      totalLabel: "جهة",
      breakdown: [
        { k: "عُقد الاجتماع التعريفي", n: g("meet", "تم") },
        { k: "الوثائق مستلمة", n: g("docs", "✓") },
        { k: "فُعِّل القياس", n: g("live", "مفعل") },
      ],
      prog: items.length ? { done: g("live", "مفعل"), of: items.length } : null,
    };
  }

  if (section === "cx") {
    const st = cxStats(items);
    return {
      total: st.rows.length,
      totalLabel: "جهاز",
      breakdown: [
        { k: "صدر لها تقرير", n: st.stage.reports || 0 },
        { k: "في القياس", n: st.stage.measuring || 0 },
        { k: "في التهيئة", n: st.stage.prep || 0 },
        { k: "لم تبدأ", n: st.stage.none || 0 },
      ],
      /* المستهدف في ملف المتابعة نفسه — لا رقم مفترض */
      prog: st.target > 0 ? { done: st.doneAgencies, of: st.target } : null,
    };
  }

  if (section === "projects") {
    const behind = items.filter((x) => numOf(d(x).actual) < numOf(d(x).planned)).length;
    const done = items.filter((x) => numOf(d(x).actual) >= 100).length;
    return {
      total: items.length,
      totalLabel: "مشروع",
      breakdown: [
        { k: "مكتملة", n: done },
        { k: "متأخرة عن الخطة", n: behind },
        { k: "وفق الخطة", n: items.length - behind - done },
      ],
      /* متوسط الإنجاز الفعلي للمشاريع — مئوية أصلاً */
      prog: items.length
        ? { done: Math.round(items.reduce((a, x) => a + numOf(d(x).actual), 0) / items.length), of: 100 }
        : null,
    };
  }

  /* المخرجات الوطنية — الحقول لم تُعتمد بعد، فالحالة نصٌّ حر */
  const byStatus = new Map<string, number>();
  for (const it of items) {
    const s = txt(d(it).status) || "بلا حالة";
    byStatus.set(s, (byStatus.get(s) || 0) + 1);
  }
  return {
    total: items.length,
    totalLabel: "مخرج",
    breakdown: [...byStatus.entries()].map(([k, n]) => ({ k, n })).slice(0, 4),
    prog: null,
  };
}
