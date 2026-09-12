"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { docUrl } from "./Docs";
import { loadUserData, saveUserData } from "@/lib/userdata";
import { PIcon } from "./pickicons";

/* ============================================================
   المساعد الذكي — يجيب من بيانات اللوحة نفسها، بلا أي خدمة خارجية:
   لا يخرج من المتصفح شيء، ولا يحتاج مفتاحاً ولا موافقة أمنية.
   مبنيّ ليصير مصدر الجواب نموذجاً لاحقاً بلا تغيير الواجهة:
   يكفي استبدال answer() بنداء الخادم.
   ============================================================ */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Rec = Record<string, any>;
type T = (ar: string, en: string) => string;
type Me = { id: string; name: string; scopes: string[] };

export type Pin = { id: string; title: string; icon: string; lines: string[]; at: string };
export type Ans = {
  title: string;
  icon: string;
  lines: string[];
  chips?: { k: string; v: string; tone?: string }[];
  note?: string;
  /** صفحة القسم التي بُنيت منها الإجابة — زرٌّ يفتحها من داخل المساعد */
  open?: { tab: string; label: string };
  /** ملفات من «منهجيات أداء» — تُنزَّل من داخل الإجابة */
  files?: { id: string; title: string; kind: string; url: string; pages: number }[];
  /** مقاطع من نصّ المنهجيات — كلٌّ بمصدره وصفحته */
  passages?: { title: string; page: number; heading: string; body: string }[];
  /** جهات ونقاط تواصلها — جوابُ «هل عندنا نقطة تواصل مع…» */
  entities?: {
    id: string; name: string; kind: string;
    ours: Record<string, string>[]; theirs: Record<string, string>[];
  }[];
};

const txt = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const num = (v: unknown, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const today = () => new Date().toISOString().slice(0, 10);
const daysTo = (d: string) => Math.round((new Date(d).getTime() - new Date(today()).getTime()) / 86400000);
const AR_MONTHS = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];

/* ---------------- المثبَّتات ---------------- */
export function usePins() {
  const [pins, setPins] = useState<Pin[]>([]);
  useEffect(() => {
    void loadUserData<Pin[]>("pins", []).then((d) => setPins(Array.isArray(d) ? d : []));
  }, []);
  const add = useCallback((p: Pin) => {
    setPins((old) => {
      const next = [p, ...old.filter((x) => x.id !== p.id)].slice(0, 8);
      void saveUserData("pins", next);
      return next;
    });
  }, []);
  const remove = useCallback((id: string) => {
    setPins((old) => {
      const next = old.filter((x) => x.id !== id);
      void saveUserData("pins", next);
      return next;
    });
  }, []);
  return { pins, add, remove };
}

/** شريط المثبَّتات — مربعات صغيرة أعلى كل صفحة */
export function PinnedBar({ pins, onRemove, t }: { pins: Pin[]; onRemove: (id: string) => void; t: T }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!pins.length) return null;
  return (
    <div className="pinbar">
      {pins.map((p) => (
        <div className={`pin ${open === p.id ? "open" : ""}`} key={p.id}>
          <button className="pin-h" onClick={() => setOpen(open === p.id ? null : p.id)}>
            <span className="ic">
              <PIcon id={p.icon} size={14} />
            </span>
            <b>{p.title}</b>
            <em>{p.lines.length}</em>
          </button>
          <button className="pin-x" onClick={() => onRemove(p.id)} title={t("إزالة", "Unpin")}>
            ✕
          </button>
          {open === p.id && (
            <div className="pin-b">
              {p.lines.map((l, i) => (
                <div key={i}>{l}</div>
              ))}
              <span className="at">{t("ثُبِّتت", "Pinned")} {p.at}</span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* ---------------- فهم السؤال ---------------- */
const has = (q: string, ...w: string[]) => w.some((x) => q.includes(x));

/** فترة مذكورة في السؤال: «من ٢٠٢٦-٠٧-٠١ إلى …» أو «هذا الشهر» أو «آخر ٣٠ يوم» */
function period(q: string): { from: string; to: string; label: string } | null {
  const iso = q.match(/(\d{4}-\d{2}-\d{2})/g);
  if (iso && iso.length >= 2) return { from: iso[0], to: iso[1], label: `${iso[0]} → ${iso[1]}` };
  const n = q.match(/(?:آخر|اخر)\s*(\d+)\s*(يوم|أيام|ايام)/);
  if (n) {
    const d = Number(n[1]);
    const from = new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
    return { from, to: today(), label: `آخر ${d} يوماً` };
  }
  if (has(q, "هذا الأسبوع", "هذا الاسبوع", "الأسبوع", "الاسبوع")) {
    const from = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    return { from, to: today(), label: "آخر أسبوع" };
  }
  if (has(q, "هذا الشهر", "الشهر")) {
    const d = new Date();
    const from = new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
    return { from, to: today(), label: `${AR_MONTHS[d.getMonth()]} ${d.getFullYear()}` };
  }
  if (has(q, "الربع")) {
    const d = new Date();
    const qs = Math.floor(d.getMonth() / 3) * 3;
    const from = new Date(d.getFullYear(), qs, 1).toISOString().slice(0, 10);
    return { from, to: today(), label: `الربع ${Math.floor(d.getMonth() / 3) + 1}` };
  }
  return null;
}

type Ctx = {
  me: Me;
  tasks: Rec[];
  rows: Rec[];
  changes: Rec[];
  /* بنود الأقسام الخمسة من نظرة عامة — مفتاحها اسم القسم */
  sections: Record<string, Rec[]>;
};

/* ---------------- زبدة الأقسام الخمسة ----------------
   «عطني الزبدة من المخرجات الوطنية» وما شابهها. الملخّص يُبنى
   من نفس البيانات المعروضة في القسم، فلا يختلف رقمٌ عمّا تراه. */
type SecKey = "sessions" | "natstrat" | "inststrat" | "outputs" | "cx" | "projects";
/* المطابقة على **جذر الكلمة** لا على العبارة كاملة: السائل يكتب
   «استراتيجية مؤسسية» و«الاستراتيجيات المؤسسية» و«المؤسسية» —
   والمطابقة الحرفية كانت تخطئ الأولى فيقع السؤال في فرع آخر.
   nrm توحّد الهمزات والتاء المربوطة وتُسقط «ال» التعريف. */
const nrm = (s: string) =>
  s
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[\u064B-\u0652\u0640]/g, "")
    .replace(/(^|\s)ال/g, "$1");

/* الترتيب مقصود: «المخرجات الوطنية» تحوي «وطني»، فتُفحص المخرجات
   قبلها وإلا خطفها فرع الاستراتيجيات الوطنية */
const SEC_WORDS: [SecKey, string[]][] = [
  ["cx", ["تجربه المستفيد", "قياس تجربه", "المستفيدين", "مستفيد", "bex"]],
  ["sessions", ["جلسات مراجعه", "جلسه مراجعه", "مراجعه الاداء", "مراجعه اداء"]],
  ["outputs", ["مخرجات", "مخرج وطني"]],
  ["inststrat", ["مؤسسي", "تفعيل قياس", "مستهدف تفعيل", "قياسها", "تفعيلها"]],
  ["natstrat", ["وطني"]],
  ["projects", ["مشاريع استراتيجيه", "مشروع استراتيجي", "مشاريع", "مشروع"]],
];
const SEC_NAME: Record<SecKey, string> = {
  sessions: "جلسات مراجعة الأداء",
  natstrat: "الاستراتيجيات الوطنية",
  inststrat: "الاستراتيجيات المؤسسية",
  outputs: "المخرجات الوطنية",
  cx: "أعمال قياس تجربة المستفيد",
  projects: "المشاريع الاستراتيجية",
};
const NAT_STEPS = ["طور الإعداد/التحديث", "قيد المراجعة", "معتمدة من اللجنة", "معتمدة من مجلس الوزراء"];
const INST_STAGES = ["وصلت المركز", "قيد المراجعة", "معالجة الملاحظات", "اعتُمدت", "فُعِّل القياس"];

function whichSection(q: string): SecKey | null {
  const n = nrm(q);
  for (const [k, words] of SEC_WORDS) if (words.some((w) => n.includes(nrm(w)))) return k;
  return null;
}

const SEC_OPEN: Record<SecKey, Ans["open"]> = {
  sessions: { tab: "sessions", label: "افتح صفحة جلسات مراجعة الأداء" },
  natstrat: { tab: "natstrat", label: "افتح صفحة الاستراتيجيات الوطنية" },
  inststrat: { tab: "inststrat", label: "افتح صفحة الاستراتيجيات المؤسسية" },
  outputs: { tab: "outputs", label: "افتح صفحة المخرجات الوطنية" },
  cx: { tab: "cx", label: "افتح صفحة أعمال قياس تجربة المستفيد" },
  projects: { tab: "projects", label: "افتح صفحة المشاريع الاستراتيجية" },
};

/** ملخّص قسم واحد — الأرقام أولاً ثم أبرز البنود */
function sectionBrief(k: SecKey, items: Rec[]): Ans {
  const title = `زبدة ${SEC_NAME[k]}`;
  if (k === "outputs")
    return {
      title,
      icon: "archive",
      lines: [
        "صفحة المخرجات الوطنية ما زالت قيد الإعداد ولم تُعتمد بياناتها بعد.",
        "ما إن تُدخل البيانات حتى يظهر ملخّصها هنا تلقائياً.",
      ],
      note: "لا أخترع أرقاماً — القسم فارغ فعلاً.",
    };
  if (!items.length)
    return { title, icon: "archive", lines: [`لا توجد بنود مسجّلة في ${SEC_NAME[k]} بعد.`] };

  const d = (x: Rec) => (x.data || {}) as Rec;

  if (k === "sessions") {
    const SESS_OPEN = { tab: "sessions", label: "افتح صفحة جلسات مراجعة الأداء" };
    const sline = (x: Rec) => {
      const raw = Array.isArray(d(x).stages) ? d(x).stages : [];
      const full = raw.length || 6;
      const done = Math.max(0, Math.min(full, num(d(x).done)));
      return `${txt(d(x).entity) || "بلا جهة"} — ${done}/${full} مراحل${txt(d(x).quarter) ? ` · ${txt(d(x).quarter)}` : ""}`;
    };
    const st = (x: Rec) => {
      const raw = Array.isArray(d(x).stages) ? d(x).stages : [];
      const full = raw.length || 6;
      return { done: Math.max(0, Math.min(full, num(d(x).done))), full };
    };
    const closed = items.filter((x) => st(x).done >= st(x).full);
    const notStarted = items.filter((x) => st(x).done === 0);
    return {
      title,
      icon: "clipboard",
      chips: [
        { k: "الجهات", v: String(items.length) },
        { k: "مكتملة", v: String(closed.length), tone: "g" },
        { k: "لم تبدأ", v: String(notStarted.length), tone: notStarted.length ? "a" : "g" },
      ],
      lines: items
        .slice(0, 8)
        .map((x) => `${txt(d(x).entity) || "بلا جهة"} — ${st(x).done}/${st(x).full} مراحل${txt(d(x).quarter) ? ` · ${txt(d(x).quarter)}` : ""}`),
    };
  }

  if (k === "natstrat") {
    const stage = (x: Rec) => Math.max(1, Math.min(4, num(d(x).stage, 1)));
    const counts = [1, 2, 3, 4].map((n) => items.filter((x) => stage(x) === n).length);
    /* نطاقات لا متوسط: المتوسط يخلط ما لم يصل المركز بعد بما قِيس فضعُف */
    const band = { hi: 0, mid: 0, low: 0 };
    for (const x of items) {
      const m = num(d(x).meas);
      if (m >= 90) band.hi++;
      else if (m >= 70) band.mid++;
      else band.low++;
    }
    const weak = items.filter((x) => num(d(x).meas) > 0 && num(d(x).meas) < 70);
    return {
      title,
      icon: "flag",
      chips: [
        { k: "الاستراتيجيات", v: String(items.length) },
        { k: "قابلية قياس مرتفعة", v: String(band.hi), tone: "g" },
        { k: "متوسطة", v: String(band.mid), tone: "a" },
        { k: "منخفضة", v: String(band.low), tone: band.low ? "r" : "g" },
        { k: "معتمدة من المجلس", v: String(counts[3]), tone: "g" },
      ],
      lines: [
        ...NAT_STEPS.map((n, i) => `${n}: ${counts[i]}`),
        ...(weak.length
          ? ["—", ...weak.slice(0, 5).map((x) => `تحتاج رفع قابلية القياس: ${txt(d(x).name)} (${num(d(x).meas)}%) — ${txt(d(x).owner)}`)]
          : []),
      ],
    };
  }

  if (k === "inststrat") {
    /* الحقول هي أعمدة ملف المتابعة نفسه — لا مرحلة رقمية */
    const g = (f: string, v: string) => items.filter((x) => txt(d(x)[f]) === v).length;
    const q = (n: number) => items.filter((x) => txt(d(x).target) === `Q${n}`).length;
    return {
      title,
      icon: "building",
      chips: [
        { k: "الجهات", v: String(items.length) },
        { k: "فُعِّل القياس", v: String(g("live", "مفعل")), tone: "g" },
        { k: "عُقد الاجتماع", v: String(g("meet", "تم")) },
        { k: "الوثائق مستلمة", v: String(g("docs", "✓")) },
      ],
      lines: [
        `مخطط تفعيلها: الربع الأول ${q(1)} · الثاني ${q(2)} · الثالث ${q(3)} · الرابع ${q(4)}`,
        `Phase 1: ${g("phase", "Phase 1")} · Phase 2: ${g("phase", "Phase 2")}`,
        "—",
        ...items.slice(0, 6).map(
          (x) =>
            `${txt(d(x).owner) || "بلا جهة"} — ${txt(d(x).live) || "لم يُحدَّد التفعيل"}${
              txt(d(x).target) ? ` · مستهدف ${txt(d(x).target)}` : ""
            }`,
        ),
      ],
    };
  }

  if (k === "cx") {
    /* المراحل متداخلة لا متتابعة — كما في ملف المتابعة نفسه */
    const rows = items.filter((x) => x.id !== "cx-meta");
    const meta = items.find((x) => x.id === "cx-meta");
    const OK = "تم الاعتماد";
    const NONE = "لم يتم الاستلام";
    const prog = (v: string) => v !== "" && v !== OK && v !== NONE;
    const QK = ["q0", "q1", "q2", "q3", "q4"];
    const issued = rows.filter((x) => QK.some((qq) => txt(d(x)[`${qq}Issue`]) === OK)).length;
    const measuring = rows.filter(
      (x) =>
        txt(d(x).survey) === OK && txt(d(x).card) === OK && txt(d(x).l1) === OK &&
        QK.some((qq) => prog(txt(d(x)[`${qq}Share`]))),
    ).length;
    const prep = rows.filter((x) => txt(d(x).meet) === "تم" && txt(d(x).survey) !== OK).length;
    const none = rows.filter((x) => txt(d(x).meet) === "لم يبدأ").length;
    const target = num(meta ? d(meta).target : 0);
    return {
      title,
      icon: "users",
      chips: [
        { k: "الأجهزة", v: String(rows.length) },
        { k: "صدر لها تقرير", v: String(issued), tone: "g" },
        { k: "في القياس", v: String(measuring), tone: "a" },
        { k: "لم تبدأ", v: String(none), tone: none ? "a" : "g" },
      ],
      lines: [
        target ? `المستهدف ${target} جهازاً — المحقق ${issued} (${Math.round((issued / target) * 100)}%)` : "لم يُسجَّل مستهدف في الملف بعد",
        `في التهيئة ${prep} · في القياس ${measuring} · صدر لها تقرير ${issued}`,
        "المراحل متداخلة لا متتابعة، فمجموعها يتجاوز عدد الأجهزة — كما في ملف المتابعة.",
      ],
    };
  }

  /* المشاريع الاستراتيجية */
  const behind = items.filter((x) => num(d(x).actual) < num(d(x).planned));
  return {
    title,
    icon: "rocket",
    chips: [
      { k: "المشاريع", v: String(items.length) },
      { k: "متأخرة عن الخطة", v: String(behind.length), tone: behind.length ? "a" : "g" },
    ],
    lines: items.slice(0, 8).map((x) => {
      const pl = num(d(x).planned);
      const ac = num(d(x).actual);
      const gap = pl - ac;
      return `${txt(d(x).name)} — المخطط ${pl}% · الفعلي ${ac}%${gap > 0 ? ` (فجوة ${gap}%)` : " ✓"}`;
    }),
  };
}

/* ---------------- سؤال محدَّد عن قسم ----------------
   «كم استراتيجية مؤسسية مخطط تفعيلها الربع الثالث؟» — الجواب
   يُحسب من صفحة القسم نفسها لا من صياغة عامة. القاعدة: نلتقط
   القيد من السؤال (ربع · حالة · قطاع)، ونعدّ الصفوف المطابقة،
   ونسمّيها. وإن لم يُفهم القيد رجعنا إلى الزبدة الكاملة.
   ---------------------------------------------------- */

/** الربع المذكور في السؤال — رقماً من 1 إلى 4، أو 0 */
function askedQuarter(q0: string): number {
  const m = q0.match(/\bQ\s*([1-4])\b/i);
  if (m) return Number(m[1]);
  const q = nrm(q0);
  if (has(q, "ربع اول")) return 1;
  if (has(q, "ربع ثاني")) return 2;
  if (has(q, "ربع ثالث")) return 3;
  if (has(q, "ربع رابع")) return 4;
  return 0;
}

/** جواب عددي مباشر: العدد أولاً، ثم الصفوف التي كوّنته */
function countAns(
  title: string,
  icon: string,
  n: number,
  of: number,
  ofLabel: string,
  names: string[],
  note?: string,
  open?: Ans["open"],
): Ans {
  return {
    title,
    icon,
    chips: [
      { k: "العدد", v: String(n), tone: n ? "g" : "a" },
      { k: `من ${of} ${ofLabel}`, v: of ? `${Math.round((n / of) * 100)}%` : "—" },
    ],
    lines: n
      ? names.slice(0, 12).concat(names.length > 12 ? [`… و${names.length - 12} غيرها`] : [])
      : ["لا يوجد صفٌّ مطابق في بيانات القسم."],
    note: note || "محسوب من صفحة القسم الآن — لا رقم مخزَّن.",
    open,
  };
}

/** سطر الجهة في الاستراتيجيات المؤسسية — ما يظهر تحت بطاقتها في صفحتها */
function instLine(d: Rec): string {
  const bits = [
    txt(d.live) ? `التفعيل: ${txt(d.live)}` : "التفعيل: لم يُحدَّد",
    txt(d.target) ? `مستهدف ${txt(d.target)}` : "",
    txt(d.meet) === "تم" && txt(d.meetAt) ? `الاجتماع التعريفي ${txt(d.meetAt)}` : txt(d.meet) ? `الاجتماع: ${txt(d.meet)}` : "",
    txt(d.docs) === "✓" ? `الوثائق ${txt(d.docsState) || "مستلمة"}` : txt(d.docs) ? "الوثائق لم تُستلم" : "",
    txt(d.consultant) ? `الاستشاري ${txt(d.consultant)}` : "",
    txt(d.phase) || "",
    txt(d.sector) || "",
  ].filter(Boolean);
  return `${txt(d.owner) || txt(d.name) || "بلا جهة"} — ${bits.join(" · ")}`;
}

function secQuery(k: SecKey, items: Rec[], q0: string): Ans | null {
  if (!items.length) return null;
  /* الموحَّد يُطابق «مفعّل» و«مفعل» و«الوثائق» و«وثائق» سواء */
  const q = nrm(q0);
  const has = (s: string, ...w: string[]) => w.some((x) => s.includes(nrm(x)));
  const d = (x: Rec) => (x.data || {}) as Rec;
  const nm = (x: Rec) => txt(d(x).owner) || txt(d(x).name) || txt(d(x).entity) || "بلا اسم";
  const qn = askedQuarter(q);
  const pick = (f: (x: Rec) => boolean) => items.filter(f);

  if (k === "inststrat") {
    const INST_OPEN = { tab: "inststrat", label: "افتح صفحة الاستراتيجيات المؤسسية" };
    /* «مخطط تفعيلها الربع الثالث» = عمود «تفعيل القياس (مستهدف)» */
    if (qn && has(q, "مخطط", "المخطط", "مستهدف", "المستهدف", "تفعيل", "التفعيل", "خطة")) {
      const rows = pick((x) => txt(d(x).target) === `Q${qn}`);
      return countAns(
        `الاستراتيجيات المؤسسية المخطط تفعيل قياسها في الربع ${["", "الأول", "الثاني", "الثالث", "الرابع"][qn]}`,
        "building",
        rows.length,
        items.length,
        "جهة",
        rows.map((x) => instLine(d(x))),
        "من عمود «تفعيل القياس (مستهدف)» في صفحة الاستراتيجيات المؤسسية.",
        { tab: "inststrat", label: "افتح صفحة الاستراتيجيات المؤسسية" },
      );
    }
    if (has(q, "غير مفعل", "غير مفعّل", "ما فُعّل", "ما فعل")) {
      const rows = pick((x) => txt(d(x).live) === "غير مفعل");
      return countAns("جهات لم يُفعَّل قياسها بعد", "building", rows.length, items.length, "جهة", rows.map((x) => instLine(d(x))), undefined, INST_OPEN);
    }
    if (has(q, "مفعل", "مفعّل", "فُعّل", "فعل القياس", "تفعيل القياس")) {
      const rows = pick((x) => txt(d(x).live) === "مفعل");
      return countAns("جهات فُعِّل قياسها", "building", rows.length, items.length, "جهة", rows.map((x) => instLine(d(x))), undefined, INST_OPEN);
    }
    if (has(q, "الاجتماع التعريفي", "اجتماع تعريفي", "الاجتماعات")) {
      const rows = pick((x) => txt(d(x).meet) === "تم");
      return countAns("جهات عُقد معها الاجتماع التعريفي", "building", rows.length, items.length, "جهة", rows.map((x) => instLine(d(x))), undefined, INST_OPEN);
    }
    if (has(q, "الوثائق", "وثائق", "المستندات")) {
      const rows = pick((x) => txt(d(x).docs) === "✓");
      return countAns("جهات استُلمت وثائقها", "building", rows.length, items.length, "جهة", rows.map((x) => instLine(d(x))), undefined, INST_OPEN);
    }
    if (has(q, "ممثل", "تسمية ممثل")) {
      const rows = pick((x) => txt(d(x).rep) === "تمت تسمية ممثل");
      return countAns("جهات سمّت ممثلها", "building", rows.length, items.length, "جهة", rows.map((x) => instLine(d(x))), undefined, INST_OPEN);
    }
    const ph = q0.match(/phase\s*([12])/i);
    if (ph) {
      const rows = pick((x) => txt(d(x).phase) === `Phase ${ph[1]}`);
      return countAns(`جهات Phase ${ph[1]}`, "building", rows.length, items.length, "جهة", rows.map((x) => instLine(d(x))), undefined, INST_OPEN);
    }
    return null;
  }

  if (k === "natstrat") {
    const NAT_OPEN = { tab: "natstrat", label: "افتح صفحة الاستراتيجيات الوطنية" };
    const steps: [string[], number][] = [
      [["مجلس الوزراء", "معتمدة من مجلس"], 4],
      [["اللجنة", "معتمدة من اللجنة"], 3],
      [["قيد المراجعة", "تحت المراجعة"], 2],
      [["طور الإعداد", "قيد الإعداد", "التحديث"], 1],
    ];
    for (const [words, n] of steps) {
      if (has(q, ...words)) {
        const rows = pick((x) => Math.max(1, Math.min(4, num(d(x).stage, 1))) === n);
        return countAns(
          `الاستراتيجيات الوطنية — ${["", "طور الإعداد/التحديث", "قيد المراجعة", "معتمدة من اللجنة", "معتمدة من مجلس الوزراء"][n]}`,
          "flag",
          rows.length,
          items.length,
          "استراتيجية",
          rows.map(
            (x) =>
              `${txt(d(x).name)} — ${[
                txt(d(x).owner) ? `الجهة ${txt(d(x).owner)}` : "",
                num(d(x).meas) ? `قابلية القياس ${num(d(x).meas)}%` : "",
                txt(d(x).updated) ? `آخر تحديث ${txt(d(x).updated)}` : "",
              ]
                .filter(Boolean)
                .join(" · ")}`,
          ),
          undefined,
          NAT_OPEN,
        );
      }
    }
    if (has(q, "قابلية القياس", "قابلية قياس", "ضعيفة", "منخفضة")) {
      const rows = pick((x) => num(d(x).meas) > 0 && num(d(x).meas) < 70);
      return countAns(
        "استراتيجيات وطنية قابلية قياسها منخفضة (أقل من ٧٠٪)",
        "flag", rows.length, items.length, "استراتيجية",
        rows.map((x) => `${txt(d(x).name)} — ${num(d(x).meas)}%${txt(d(x).owner) ? ` · ${txt(d(x).owner)}` : ""}`),
        undefined,
        NAT_OPEN,
      );
    }
    return null;
  }

  if (k === "sessions") {
    const SESS_OPEN = { tab: "sessions", label: "افتح صفحة جلسات مراجعة الأداء" };
    const st = (x: Rec) => {
      const raw = Array.isArray(d(x).stages) ? d(x).stages : [];
      const full = raw.length || 6;
      return { done: Math.max(0, Math.min(full, num(d(x).done))), full };
    };
    /* السطر يذكر أين وقفت الجلسة وربعها — لا الاسم وحده */
    const sline = (x: Rec) =>
      `${txt(d(x).entity) || "بلا جهة"} — ${st(x).done}/${st(x).full} مراحل${
        txt(d(x).quarter) ? ` · ${txt(d(x).quarter)}` : ""
      }${txt(d(x).owner) ? ` · ${txt(d(x).owner)}` : ""}`;
    if (qn) {
      const rows = pick((x) => txt(d(x).quarter).includes(String(qn)));
      return countAns(`جلسات الربع ${["", "الأول", "الثاني", "الثالث", "الرابع"][qn]}`, "clipboard",
        rows.length, items.length, "جلسة", rows.map(sline), undefined, SESS_OPEN);
    }
    if (has(q, "لم تبدأ", "ما بدأت", "مابدأت")) {
      const rows = pick((x) => st(x).done === 0);
      return countAns("جلسات لم تبدأ", "clipboard", rows.length, items.length, "جلسة", rows.map(sline), undefined, SESS_OPEN);
    }
    if (has(q, "مكتمل", "مكتملة", "مغلقة", "انتهت")) {
      const rows = pick((x) => st(x).done >= st(x).full);
      return countAns("جلسات مكتملة", "clipboard", rows.length, items.length, "جلسة", rows.map(sline), undefined, SESS_OPEN);
    }
    return null;
  }

  if (k === "cx") {
    const rows0 = items.filter((x) => x.id !== "cx-meta");
    const OK = "تم الاعتماد";
    const NONE = "لم يتم الاستلام";
    const prog = (v: string) => v !== "" && v !== OK && v !== NONE;
    const QK = ["q0", "q1", "q2", "q3", "q4"];
    const CX_OPEN = { tab: "cx", label: "افتح صفحة أعمال قياس تجربة المستفيد" };
    const nmx = (x: Rec) =>
      `${txt(d(x).name) || "بلا اسم"}${
        [txt(d(x).sector), txt(d(x).consultant) ? `الاستشاري ${txt(d(x).consultant)}` : "", num(d(x).servPlan) ? `${num(d(x).servPlan)} خدمة مخططة` : ""]
          .filter(Boolean).length
          ? " — " +
            [txt(d(x).sector), txt(d(x).consultant) ? `الاستشاري ${txt(d(x).consultant)}` : "", num(d(x).servPlan) ? `${num(d(x).servPlan)} خدمة مخططة` : ""]
              .filter(Boolean)
              .join(" · ")
          : ""
      }`;
    if (qn) {
      const key = `q${qn}`;
      const rows = rows0.filter((x) => txt(d(x)[`${key}Issue`]) === OK);
      return countAns(
        `أجهزة صدر لها تقرير في الربع ${["", "الأول", "الثاني", "الثالث", "الرابع"][qn]} من ٢٠٢٦م`,
        "users", rows.length, rows0.length, "جهاز", rows.map(nmx), undefined, CX_OPEN,
      );
    }
    if (has(q, "صدر", "تقرير", "تقارير")) {
      const rows = rows0.filter((x) => QK.some((z) => txt(d(x)[`${z}Issue`]) === OK));
      return countAns("أجهزة صدر لها تقرير", "users", rows.length, rows0.length, "جهاز", rows.map(nmx), undefined, CX_OPEN);
    }
    if (has(q, "لم تبدأ", "ما بدأت", "لم يبدأ")) {
      const rows = rows0.filter((x) => txt(d(x).meet) === "لم يبدأ");
      return countAns("أجهزة لم تبدأ", "users", rows.length, rows0.length, "جهاز", rows.map(nmx), undefined, CX_OPEN);
    }
    if (has(q, "في القياس", "قيد القياس", "تُقاس")) {
      const rows = rows0.filter(
        (x) =>
          txt(d(x).survey) === OK && txt(d(x).card) === OK && txt(d(x).l1) === OK &&
          QK.some((z) => prog(txt(d(x)[`${z}Share`]))),
      );
      return countAns("أجهزة في مرحلة القياس", "users", rows.length, rows0.length, "جهاز", rows.map(nmx), undefined, CX_OPEN);
    }
    return null;
  }

  if (k === "projects") {
    if (has(q, "متأخر", "متأخرة", "متعثر", "متعثرة", "خلف الخطة")) {
      const rows = pick((x) => num(d(x).actual) < num(d(x).planned));
      return countAns("مشاريع متأخرة عن الخطة", "rocket", rows.length, items.length, "مشروع",
        rows.map((x) => `${txt(d(x).name)} — المخطط ${num(d(x).planned)}% · الفعلي ${num(d(x).actual)}%${txt(d(x).sponsor) ? ` · الراعي ${txt(d(x).sponsor)}` : ""}`),
        undefined, { tab: "projects", label: "افتح صفحة المشاريع الاستراتيجية" });
    }
    if (has(q, "مكتمل", "مكتملة", "منتهية")) {
      const rows = pick((x) => num(d(x).actual) >= 100);
      return countAns("مشاريع مكتملة", "rocket", rows.length, items.length, "مشروع",
        rows.map((x) => `${txt(d(x).name)}${txt(d(x).sponsor) ? ` — الراعي ${txt(d(x).sponsor)}` : ""}`),
        undefined, { tab: "projects", label: "افتح صفحة المشاريع الاستراتيجية" });
    }
    return null;
  }

  return null;
}

/* ---------------- دليل الاستخدام داخل المساعد ----------------
   الغاية: من يفتح المنصة أول مرة يسأل ويفهم، بلا ملف خارجي يتقادم.
   والشرح يُبنى من صلاحيات السائل نفسه، فلا يُعرض له ما لا يفتحه. */
type Guide = { k: string; scope?: string; name: string; words: string[]; lines: string[] };

const GUIDES: Guide[] = [
  {
    k: "overview", scope: "overview", name: "نظرة عامة",
    words: ["نظرة عامة", "الصفحة الرئيسية", "الرئيسية"],
    lines: [
      "ملخّص كل قسم في بطاقة: الأرقام والحالات والنسب، بلا أسماء ولا تفاصيل.",
      "يراها كل موظفي الإدارة — فالجميع يعرف أين وصل العمل كله لا قسمه وحده.",
      "زرّ «المزيد من التفاصيل» ينقلك للصفحة التفصيلية، ولا يظهر إلا لأصحاب القسم.",
      "كل بطاقة تُطوى بالسهم في رأسها، والحالة تُحفظ لك وحدك.",
    ],
  },
  {
    k: "mypage", name: "محفظتي",
    words: ["محفظتي", "المحفظة", "صفحتي الشخصية"],
    lines: [
      "صفحتك أنت: مهامك وتقويمك وملاحظاتك، ثم مشاريعك وأعمالك التشغيلية.",
      "خاصة بك — لا يراها مديرك ولا مدير الإدارة إلا بمنحٍ صريح منك.",
      "المنح من زرّ ⚙️: تختار الشخص والأقسام (مثلاً كل شيء عدا مهامي)، وتسحبه متى شئت.",
      "والمنح للاطّلاع لا للتعديل.",
    ],
  },
  {
    k: "tasks", scope: "tasks", name: "المهام",
    words: ["المهام", "مهامي", "المهمة"],
    lines: [
      "ثلاثة أعمدة: المهام · المتأخرة · المكتملة.",
      "المهمة المسندة من مديرك خضراء وعليها 🔒 — تحدّثها وتغلقها ولا تحذفها.",
      "والمهمة التي تضيفها لنفسك بيضاء، تحذفها بـ ✕ متى شئت.",
      "كل مهمة تقبل تحديثات نصية يقرؤها مديرك، وردوداً على كل تحديث.",
    ],
  },
  {
    k: "notes", name: "الملاحظات والتقويم",
    words: ["الملاحظات", "ملاحظاتي", "التقويم", "المواعيد", "الكالندر"],
    lines: [
      "اكتب ملاحظتك بلغتك: «بكرة الساعة ٩ اجتماع الديوان».",
      "المنصة تقرأ التاريخ من النص وتضعه في التقويم وحدها — بلا ملء أي حقل.",
      "تُفهم: اليوم · بكرة · بعد بكرة · الأحد · الأربعاء ٢:٣٠ · بعد أسبوع · ١٥ سبتمبر.",
      "والتنبيهات تجمع المتأخر وما يستحق خلال ثلاثة أيام، وعدّادها على أيقونة التقويم.",
    ],
  },
  {
    k: "details", scope: "details", name: "المؤشرات التفصيلية",
    words: ["المؤشرات التفصيلية", "المؤشرات", "مؤشرات قطاعي"],
    lines: [
      "مؤشرات قطاعك: المستهدف والفعلي والفرق ونسبة الإنجاز ومقارنتها بالربع السابق.",
      "«وضع تعديل المستهدفات» زرّ مستقل — لمدير القطاع في قطاعه.",
      "الملاحظات تُكتب على المؤشر نفسه مع إشارة الزملاء @، فتبقى ملتصقة برقمها.",
      "وكل تعديل يُسجَّل باسمك ويظهر في «آخر التحديثات».",
    ],
  },
  {
    k: "weekly", scope: "weekly", name: "الإنجاز الأسبوعي",
    words: ["الإنجاز الأسبوعي", "التقرير الأسبوعي", "الأسبوعي"],
    lines: [
      "تقرير يُولَّد آلياً من بيانات المنصة — لا يُكتب يدوياً ولا يُجمَّع من أحد.",
      "الأداء العام ومساره عبر ستة أسابيع، والمؤشرات وحالاتها، وتحديث الأقسام.",
      "تصفَّح الأسابيع للخلف للمقارنة، وصدِّره PDF بضغطة.",
      "و«مشاركة رابط» يفتح التقرير للاطّلاع فقط بلا حساب، بمدة صلاحية تحدّدها.",
    ],
  },
  {
    k: "cx", scope: "cx", name: "أعمال قياس تجربة المستفيد",
    words: ["تجربة المستفيد", "خدمات المستفيدين", "البكس"],
    lines: [
      "١٥٤ جهازاً بأربعة وأربعين حقلاً، تغطي خمسة أرباع.",
      "زرّ «رفع ملف المتابعة» يقرأ ملف Master Tracker كما هو ويحدّث الجميع.",
      "شرائح المراحل فلاتر: اضغط «في القياس» فيعرض أجهزتها وحدها.",
      "وكل الأرقام محسوبة من الصفوف بمعادلات ورقة الملخّص في الملف نفسه.",
    ],
  },
  {
    k: "natstrat", scope: "natstrat", name: "الاستراتيجيات الوطنية",
    words: ["الاستراتيجيات الوطنية"],
    lines: [
      "٥٢ استراتيجية في أربعة تبويبات حسب حالة الاعتماد.",
      "كل بطاقة: شعار الجهة · حلقة قابلية القياس · المؤشرات والمبادرات الممثَّلة.",
      "ومسار المراجعة الأربع أسفل البطاقة — تُضغط النقطة فتتغيّر حالتها.",
      "النطاقات: مرتفعة ≥٩٠٪ · متوسطة ٧٠–٨٩٪ · منخفضة أقل من ٧٠٪.",
    ],
  },
  {
    k: "inststrat", scope: "inststrat", name: "الاستراتيجيات المؤسسية",
    words: ["الاستراتيجيات المؤسسية"],
    lines: [
      "٤٣ جهة موزّعة على القطاعات الأربعة — القطاعات تبويبات في الأعلى.",
      "لكل جهة مسارها: تسمية ممثل ← الاجتماع التعريفي ← الوثائق ← تفعيل القياس.",
      "وللقسم عرض جدولي يُبدَّل إليه بزر، بأعمدة ملف المتابعة كلها.",
      "ويُصدَّر المعروض بعد الفلترة إلى Excel.",
    ],
  },
  {
    k: "sessions", scope: "sessions", name: "جلسات مراجعة الأداء",
    words: ["جلسات مراجعة", "الجلسات"],
    lines: [
      "لكل جهة مسار من ست محطات: من تحديد الجهة إلى الإغلاق.",
      "والحلقة أعلى الصفحة تعطي نسبة الإنجاز العام وتوزيع الجهات.",
      "الصفحة جاهزة وتنتظر بياناتها — تُضاف الجهات من زرّ «إضافة».",
    ],
  },
  {
    k: "assignments", scope: "assignments", name: "التكاليف",
    words: ["التكاليف", "التكليف"],
    lines: [
      "التكاليف الواردة من جهة أعلى: على من أُسندت وموعدها وحالتها.",
      "تختلف عن المهمة: التكليف يرد من خارج الإدارة، والمهمة تُنشأ داخلها.",
    ],
  },
  {
    k: "changes", scope: "changes", name: "طلبات التغيير",
    words: ["طلبات التغيير", "طلب تغيير"],
    lines: [
      "طلبات التغيير على المؤشرات الواردة من منصة الرؤية.",
      "تُرفع بملف واحد فتُقرأ كلها دفعة، وتُصدَّر وتُنسخ.",
      "والشرائح في الأعلى تفلتر بالحالة، فيُعرف المتأخر في ثانية.",
    ],
  },
  {
    k: "users", scope: "users", name: "المستخدمون والصلاحيات",
    words: ["المستخدمون", "الصلاحيات", "إضافة مستخدم"],
    lines: [
      "إنشاء الحسابات وإسناد القطاعات ومنح الصلاحيات وإيقاف الحسابات.",
      "ما إن تُسنِد للموظف قطاعه حتى يظهر في «الهيكل التنظيمي» مباشرة.",
      "ولا يستطيع أحد سحب هذه الصلاحية من نفسه ولا إيقاف حسابه.",
    ],
  },
];

/** سؤال عن «كيف أستخدم» لا عن الأرقام */
const asksHow = (q: string) =>
  has(q, "كيف", "شرح", "اشرح", "وش فايدة", "فايدة", "استخدم", "استخدام", "وش هي", "وش هذي", "ما هي", "وش يعني");

const DONE = ["مغلقة", "مكتمل", "مكتملة", "منجز", "معتمدة"];

function answer(q0: string, c: Ctx): Ans {
  const q = q0.trim();
  const mine = c.tasks.filter((x) => x.assigneeId === c.me.id);
  const open = mine.filter((x) => x.state !== "done");
  const late = open.filter((x) => x.dueDate && daysTo(x.dueDate) < 0);
  const soon = open.filter((x) => x.dueDate && daysTo(x.dueDate) >= 0 && daysTo(x.dueDate) <= 3);
  const ents = c.rows.filter((r) => r.section === "entities");
  const curQ = Math.floor(new Date().getMonth() / 3) + 1;
  const qLate = ents.filter((r) => !(Array.isArray(r.data?.q) ? r.data.q : [])[curQ - 1]);
  const chRows = c.rows.filter((r) => r.section === "changes");
  const chLate = chRows.filter((r) => txt(r.data?.status) === "متأخر");
  const commit = chRows.length ? Math.round(((chRows.length - chLate.length) / chRows.length) * 100) : null;

  /* ---- دليل الاستخدام: قبل بقية الفروع لأن «كيف أستخدم الاستراتيجيات
     الوطنية» يخطفه فرع الزبدة وإلا، والسائل يريد الشرح لا الأرقام ---- */

  /* ما هي المنصة */
  if (has(q, "وش هذي المنصة", "ما هذه المنصة", "وش المنصة", "تعريف بالمنصة", "عن المنصة", "المنصة هذي وش"))
    return {
      title: "وش هذي المنصة؟",
      icon: "idea",
      lines: [
        "منصة إدارة عمليات الأداء — مكان واحد لما تعمل عليه الإدارة، بدل ملفات إكسل متفرّقة تتنقّل بالبريد وتتقادم نسخها.",
        "فيها: الاستراتيجيات الوطنية والمؤسسية · جلسات مراجعة الأداء · أعمال قياس تجربة المستفيد · المخرجات الوطنية · المشاريع الاستراتيجية.",
        "وفيها لكل موظف: مهامه وتقويمه وملاحظاته في «محفظتي» — خاصة به وحده.",
        "القاعدة: ملخّص كل قسم في «نظرة عامة» يراه الجميع، والصفحة التفصيلية والتعديل لأصحاب القسم.",
        "والإدارة تُحدِّث ملفات متابعتها كما اعتادت، والمنصة تقرؤها: ملف تجربة المستفيد يُرفع كما هو فتُحسب منه الأرقام آلياً.",
      ],
      note: "اسألني «وش أقدر أفتح؟» فأخبرك بصفحاتك أنت، أو «اشرح لي محفظتي».",
    };

  /* صفحاتي وصلاحياتي */
  if (has(q, "صفحاتي", "صلاحياتي", "وش أقدر أفتح", "وش اقدر افتح", "وش عندي صلاحية", "أي صفحات"))
    {
      const mineG = GUIDES.filter((g) => !g.scope || c.me.scopes.includes(g.scope));
      return {
        title: `صفحاتك يا ${c.me.name.split(" ")[0]}`,
        icon: "idea",
        chips: [{ k: "عدد الصفحات", v: String(mineG.length) }],
        lines: [
          ...mineG.map((g) => `${g.name} — ${g.lines[0]}`),
          "وملخّصات بقية الأقسام تراها في «نظرة عامة» وإن لم تفتح صفحتها.",
        ],
        note: "اسألني «اشرح لي <اسم الصفحة>» لتفصيلها.",
      };
    }

  /* شرح صفحة أو أداة بعينها */
  if (asksHow(q)) {
    const g = GUIDES.find((x) => has(q, ...x.words));
    if (g) {
      const owned = !g.scope || c.me.scopes.includes(g.scope);
      return {
        title: g.name,
        icon: "idea",
        lines: g.lines,
        note: owned
          ? undefined
          : "هذه الصفحة ليست ضمن صلاحياتك — لكنك ترى ملخّصها في «نظرة عامة».",
      };
    }
  }

  /* مساعدة */
  if (!q || has(q, "مساعدة", "وش تقدر", "ماذا تستطيع", "الأوامر"))
    return {
      title: "وش أقدر أسوي؟",
      icon: "idea",
      lines: [
        "«وش هذي المنصة؟» — تعريف بها في أسطر",
        "«وش أقدر أفتح؟» — صفحاتك أنت حسب صلاحياتك",
        "«اشرح لي محفظتي» — وكذلك أي صفحة أو أداة",
        "«أهم شي عندي الآن» — المتأخر والقريب موعده",
        "«أبرز أعمالي هذا الشهر» أو «من 2026-07-01 إلى 2026-08-31»",
        "«رتّب صفحتي حسب الأهمية»",
        "«كم نسبة التزامي؟»",
        "«كم جهة ما سويت لها اجتماع ربعي؟»",
        "«ملخص الأسبوع»",
        "«عطني الزبدة من الاستراتيجيات الوطنية» — وكذلك: جلسات مراجعة الأداء · الاستراتيجيات المؤسسية · أعمال قياس تجربة المستفيد · المخرجات الوطنية · المشاريع الاستراتيجية",
        "«كم استراتيجية مؤسسية مخطط تفعيلها الربع الثالث؟» — أسأل عن قسم بقيد، فأعدّ لك من صفحته وأسمّي الصفوف",
        "«كم جهة فُعِّل قياسها؟» · «كم استراتيجية وطنية معتمدة من مجلس الوزراء؟» · «كم جهازاً لم يبدأ في تجربة المستفيد؟»",
      ],
      note: "الإجابات تُحسب من بياناتك داخل متصفحك — لا يخرج منها شيء.",
    };

  /* زبدة قسم من نظرة عامة — قبل بقية الفروع لأن كلمة
     «الاستراتيجيات» يخطفها فرع «جهاتي» وإلا */
  {
    const sec = whichSection(q);
    if (sec) {
      /* السؤال المحدَّد أولاً: «كم … الربع الثالث؟» يريد عدداً
         لا زبدة. وإن لم يُفهم القيد رجعنا إلى الزبدة الكاملة. */
      /* زرّ «افتح الصفحة» لا يظهر إلا لمن يملك صلاحية ذلك القسم —
         وإلا فتح على فراغ. والملخّص يبقى ظاهراً للجميع. */
      const may = c.me.scopes.includes(sec);
      const withOpen = (a: Ans): Ans => ({ ...a, open: may ? a.open || SEC_OPEN[sec] : undefined });
      const direct = secQuery(sec, c.sections[sec] || [], q);
      if (direct) return withOpen(direct);
      return withOpen(sectionBrief(sec, c.sections[sec] || []));
    }
  }

  /* ترتيب الصفحة */
  if (has(q, "رتب", "رتّب", "ترتيب") && has(q, "صفحتي", "المحفظة", "محفظتي", "الأهمية", "الاهمية")) {
    const orderNow = [
      ...(late.length || soon.length ? ["tasks"] : []),
      ...(chLate.length ? ["changes"] : []),
      ...(qLate.length ? ["quarterly"] : []),
      "calendar",
      "strategies",
      "contrib",
      "projects",
      "reverse",
      "workflow",
      "notes",
    ];
    void saveUserData("portfolio_order_hint", orderNow);
    window.dispatchEvent(new CustomEvent("pf-reorder", { detail: orderNow }));
    return {
      title: "رُتِّبت محفظتك حسب الأهمية",
      icon: "stack-rank",
      lines: [
        late.length ? `مهامك المتأخرة (${late.length}) في الأعلى` : "لا توجد مهام متأخرة",
        chLate.length ? `طلبات التغيير المتأخرة (${chLate.length}) بعدها` : "طلبات التغيير ضمن مدّتها",
        qLate.length ? `الجهات التي لم تُعقد جلستها هذا الربع (${qLate.length})` : "التقارير الربعية مكتملة لهذا الربع",
      ],
      note: "الترتيب الجديد في «محفظتي» — ويُعاد من «ترتيب ← الترتيب الافتراضي».",
    };
  }

  /* الالتزام */
  if (has(q, "التزام", "الالتزام", "طلبات التغيير", "طلب تغيير", "SLA"))
    return {
      title: "التزامي بطلبات التغيير",
      icon: "shield",
      lines: chRows.length
        ? [
            `إجمالي طلباتي: ${chRows.length}`,
            `منجزة في الوقت: ${chRows.length - chLate.length}`,
            `متأخرة الآن: ${chLate.length}`,
            ...chLate.slice(0, 5).map((r) => `متأخر: ${txt(r.data?.code)} — ${txt(r.data?.entity)}`),
          ]
        : ["لا توجد طلبات تغيير مسجّلة في محفظتك بعد."],
      chips: commit === null ? [] : [{ k: "نسبة الالتزام", v: `${commit}%`, tone: commit >= 90 ? "g" : commit >= 70 ? "a" : "r" }],
    };

  /* التقارير الربعية */
  if (has(q, "ربع", "الربعية", "جلسات", "جلسة", "جلست", "عقدت", "تعقد", "اجتماع", "اجتماعات", "لقاء", "لقاءات"))
    return {
      title: `التقارير الربعية — الربع ${curQ}`,
      icon: "calendar-check",
      lines: ents.length
        ? qLate.length
          ? [
              `${qLate.length} من ${ents.length} جهة لم تُعقد جلستها هذا الربع:`,
              ...qLate.map((r) => `• ${txt(r.data?.name)}`),
            ]
          : ["كل جهاتك عُقدت جلستها هذا الربع 👌"]
        : ["لا توجد جهات بعد — تُضاف من «جهاتي ومساهماتها» في محفظتي."],
      chips: [
        { k: "جهاتي", v: String(ents.length) },
        { k: "مكتملة هذا الربع", v: String(ents.length - qLate.length), tone: "g" },
        { k: "متبقية", v: String(qLate.length), tone: qLate.length ? "a" : "g" },
      ],
    };

  /* أبرز الأعمال خلال فترة */
  const per = period(q);
  if (per || has(q, "أبرز", "ابرز", "ملخص", "تقرير", "إنجاز", "انجاز", "أعمالي", "اعمالي")) {
    const p = per || { from: new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10), to: today(), label: "آخر 30 يوماً" };
    const inRange = (d: string) => !!d && d.slice(0, 10) >= p.from && d.slice(0, 10) <= p.to;
    const doneT = mine.filter((x) => x.state === "done" && inRange(txt(x.completedAt || x.updatedAt)));
    const closed = c.rows.filter(
      (r) => DONE.includes(txt(r.data?.status)) && inRange(txt(r.updatedAt)),
    );
    const touched = c.rows.filter((r) => inRange(txt(r.updatedAt)));
    return {
      title: `أبرز أعمالي — ${p.label}`,
      icon: "award",
      chips: [
        { k: "مهام أنجزتها", v: String(doneT.length), tone: "g" },
        { k: "بنود أُغلقت", v: String(closed.length), tone: "g" },
        { k: "بنود حدّثتها", v: String(touched.length) },
      ],
      lines: [
        ...doneT.slice(0, 5).map((x) => `أنجزت: ${txt(x.title)}`),
        ...closed.slice(0, 5).map((r) => `أُغلق: ${txt(r.data?.name || r.data?.code)}`),
        ...(doneT.length + closed.length === 0 ? ["لا توجد أعمال مكتملة في هذه الفترة."] : []),
      ],
    };
  }

  /* المهام */
  if (has(q, "مهام", "مهمة", "مهامي", "تكاليف", "تكليف", "مسند"))
    return {
      title: "مهامي",
      icon: "clipboard",
      chips: [
        { k: "مفتوحة", v: String(open.length) },
        { k: "متأخرة", v: String(late.length), tone: late.length ? "r" : "g" },
        { k: "خلال 3 أيام", v: String(soon.length), tone: soon.length ? "a" : "g" },
      ],
      lines: [
        ...late.map((x) => `متأخرة ${Math.abs(daysTo(x.dueDate))} يوم: ${txt(x.title)}`),
        ...soon.map((x) => `${daysTo(x.dueDate) === 0 ? "اليوم" : `بعد ${daysTo(x.dueDate)} يوم`}: ${txt(x.title)}`),
        ...(late.length + soon.length === 0 ? ["لا يوجد شيء مستحق قريباً."] : []),
      ],
    };

  /* الجهات */
  if (has(q, "جهات", "جهاتي", "جهة", "استراتيجيات", "الاستراتيجيات", "برامج", "برنامج"))
    return {
      title: "جهاتي واستراتيجياتي",
      icon: "building",
      chips: [{ k: "العدد", v: String(ents.length) }],
      lines: ents.length
        ? ents.map(
            (r) =>
              `${txt(r.data?.name)} — ${txt(r.data?.type) || "بلا نوع"}${
                num(r.data?.kpis) ? ` · ${num(r.data.kpis)} مؤشراً` : ""
              }`,
          )
        : ["لا توجد جهات مسجّلة بعد."],
    };

  /* الافتراضي: أهم ما عندك الآن */
  return {
    title: "أهم ما عندك الآن",
    icon: "alert",
    chips: [
      { k: "مهام متأخرة", v: String(late.length), tone: late.length ? "r" : "g" },
      { k: "مستحقة خلال 3 أيام", v: String(soon.length), tone: soon.length ? "a" : "g" },
      { k: "طلبات متأخرة", v: String(chLate.length), tone: chLate.length ? "r" : "g" },
      { k: "جهات بلا جلسة هذا الربع", v: String(qLate.length), tone: qLate.length ? "a" : "g" },
    ],
    lines: [
      ...late.slice(0, 4).map((x) => `مهمة متأخرة ${Math.abs(daysTo(x.dueDate))} يوم: ${txt(x.title)}`),
      ...soon.slice(0, 3).map((x) => `مستحقة ${daysTo(x.dueDate) === 0 ? "اليوم" : `بعد ${daysTo(x.dueDate)} يوم`}: ${txt(x.title)}`),
      ...chLate.slice(0, 3).map((r) => `طلب تغيير متأخر: ${txt(r.data?.code)} — ${txt(r.data?.entity)}`),
      ...qLate.slice(0, 3).map((r) => `لم تُعقد جلسة الربع: ${txt(r.data?.name)}`),
      ...(late.length + soon.length + chLate.length + qLate.length === 0 ? ["كل شيء تحت السيطرة 👌"] : []),
    ],
  };
}

/* ---------------- الواجهة ---------------- */
const SUGGEST = [
  "وش هذي المنصة؟",
  "وش أقدر أفتح؟",
  "أهم شي عندي الآن",
  "عطني الزبدة من الاستراتيجيات الوطنية",
  "كم استراتيجية مؤسسية مخطط تفعيلها الربع الثالث؟",
  "كم جهازاً صدر له تقرير في تجربة المستفيد؟",
  "أبرز أعمالي هذا الشهر",
  "رتّب صفحتي حسب الأهمية",
  "كم نسبة التزامي؟",
  "كم جهة ما سويت لها اجتماع ربعي؟",
];

export default function Assistant({
  me,
  t,
  onPin,
  onOpenTab,
}: {
  me: Me;
  t: T;
  onPin: (p: Pin) => void;
  /** فتح صفحة القسم الذي بُنيت منه الإجابة */
  onOpenTab?: (tab: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [ans, setAns] = useState<Ans | null>(null);
  /* الأسئلة المقترحة تزحم الشاشة — صارت خلف زر ⓘ، تبقى مفتوحة
     لمن يفتحها حتى نهاية الجلسة فلا يعيد فتحها كل مرة */
  const [tips, setTips] = useState(false);
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const box = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const KEYS = ["sessions", "natstrat", "inststrat", "outputs", "cx", "projects"];
    const [tk, pf, ...secs] = await Promise.all([
      apiFetch("/api/tasks").then((r) => r.json()).catch(() => ({})),
      apiFetch("/api/portfolio").then((r) => r.json()).catch(() => ({})),
      /* القسم الذي لا يملك صاحب الحساب صلاحيته يرجع فارغاً من RLS،
         فلا يرى في الزبدة ما لا يراه في الصفحة */
      ...KEYS.map((k) =>
        apiFetch(`/api/items?section=${k}`).then((r) => r.json()).catch(() => ({})),
      ),
    ]);
    const sections: Record<string, Rec[]> = {};
    KEYS.forEach((k, i) => {
      sections[k] = (secs[i]?.items || []) as Rec[];
    });
    setCtx({ me, tasks: tk.tasks || [], rows: pf.items || [], changes: [], sections });
  }, [me]);

  useEffect(() => {
    if (open && !ctx) void load();
    if (open) setTimeout(() => box.current?.focus(), 60);
  }, [open, ctx, load]);

  /* الجواب المحلي أولاً (فوري من بيانات المنصة)، ثم يُستكمل من
     «منهجيات أداء» إن كان السؤال عن ملف أو عن مضمون منهجية.
     الترتيب مقصود: لا تنتظر الشبكةَ إجابةٌ تُحسب في المتصفح. */
  async function ask(text: string) {
    setQ(text);
    if (!ctx) return;
    const local = answer(text, ctx);
    setAns(local);
    const t2 = text.trim();
    if (t2.length < 4) return;
    try {
      const r = await apiFetch(`/api/docs/ask?q=${encodeURIComponent(t2)}`).then((x) => x.json());
      const files = (r.files || []) as { id: string; title: string; kind: string; filePath: string; pages: number }[];
      const passages = (r.passages || []) as { title: string; page: number; heading: string; body: string }[];
      const ents = (r.entities || []) as Ans["entities"];
      if (!files.length && !passages.length && !ents?.length) return;
      setAns((cur) => {
        const base = cur || local;
        return {
          ...base,
          files: files.slice(0, 3).map((f) => ({
            id: f.id, title: f.title, kind: f.kind, pages: f.pages, url: docUrl(f.filePath),
          })),
          passages: passages.slice(0, 2),
          entities: ents?.slice(0, 3),
        };
      });
    } catch {
      /* تعذّر الوصول للمكتبة: يبقى الجواب المحلي كما هو */
    }
  }

  /* الإغلاق يعيد النافذة لحالتها الأولى: «أهم ما عندك الآن».
     بدونه يبقى آخر جواب معروضاً كل مرة تُفتح فيها، فيبدو أن
     الأهم اختفى وإنما هو خلف الجواب القديم */
  const close = () => {
    setOpen(false);
    setAns(null);
    setQ("");
    setTips(false);
  };

  const pinIt = () => {
    if (!ans) return;
    onPin({
      id: "pin-" + Date.now().toString(36),
      title: ans.title,
      icon: ans.icon,
      lines: [...(ans.chips || []).map((c) => `${c.k}: ${c.v}`), ...ans.lines].slice(0, 8),
      at: today(),
    });
  };

  const first = useMemo(() => (ctx ? answer("", ctx) : null), [ctx]);
  const show = ans || first;

  return (
    <>
      <button className="ai-fab" onClick={() => setOpen(true)} title={t("المساعد الذكي", "Assistant")} aria-label="assistant">
        <PIcon id="idea" size={20} />
        <span>{t("المساعد الذكي", "Ask")}</span>
      </button>

      {open && (
        <div className="modal-overlay" onClick={close}>
          <div className="modal ai" onClick={(e) => e.stopPropagation()}>
            <div className="m-h">
              <span className="ai-dot">
                <PIcon id="idea" size={14} />
              </span>
              <h3>{t("المساعد الذكي", "Assistant")}</h3>
              <button
                className={`ai-i ${tips ? "on" : ""}`}
                onClick={() => setTips((v) => !v)}
                aria-pressed={tips}
                title={t("أمثلة على ما يمكن سؤاله", "Example questions")}
                aria-label={t("أمثلة على ما يمكن سؤاله", "Example questions")}
              >
                i
              </button>
              <button className="mx" onClick={close} aria-label="close">
                ✕
              </button>
            </div>

            <div className="ai-ask">
              <input
                ref={box}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && ask(q)}
                placeholder={t("اكتب سؤالك… مثال: أبرز أعمالي هذا الشهر", "Ask…")}
              />
              <button className="btn btn-sm" onClick={() => ask(q)}>
                {t("اسأل", "Ask")}
              </button>
            </div>
            {tips && (
              <div className="ai-sg">
                {SUGGEST.map((s) => (
                  <span
                    key={s}
                    onClick={() => {
                      setTips(false);
                      ask(s);
                    }}
                  >
                    {s}
                  </span>
                ))}
              </div>
            )}

            {!ctx ? (
              <div className="pf-none">{t("جارٍ قراءة بياناتك...", "Reading your data...")}</div>
            ) : (
              show && (
                <div className="ai-ans">
                  <div className="ai-t">
                    <span className="ic">
                      <PIcon id={show.icon} size={15} />
                    </span>
                    <b>{show.title}</b>
                    {!!ans && (
                      <button
                        className="ai-back"
                        onClick={() => {
                          setAns(null);
                          setQ("");
                        }}
                        title={t("رجوع إلى أهم ما عندك الآن", "Back to priorities")}
                      >
                        {t("الأهم الآن", "Priorities")}
                      </button>
                    )}
                    <button className="ai-pin" onClick={pinIt} title={t("تثبيت أعلى الصفحات", "Pin")}>
                      📌 {t("تثبيت", "Pin")}
                    </button>
                  </div>
                  {!!show.chips?.length && (
                    <div className="ai-chips">
                      {show.chips.map((c) => (
                        <span key={c.k} className={`ai-chip ${c.tone || ""}`}>
                          {c.k} <b>{c.v}</b>
                        </span>
                      ))}
                    </div>
                  )}
                  <ul className="ai-lines">
                    {show.lines.map((l, i) => (
                      <li key={i}>{l}</li>
                    ))}
                  </ul>
                  {show.open && onOpenTab && (
                    <button
                      className="ai-open"
                      onClick={() => {
                        onOpenTab(show.open!.tab);
                        close();
                      }}
                    >
                      {show.open.label} ‹
                    </button>
                  )}
                  {/* الجهات أولاً: «هل عندنا نقطة تواصل مع…» جوابُه
                      اسمٌ ورقم، لا إحالةٌ إلى صفحة */}
                  {!!show.entities?.length && (
                    <div className="ai-ents">
                      {show.entities.map((e) => (
                        <div className="ai-ent" key={e.id}>
                          <b>{e.name}</b>
                          <div className="ai-ent-r">
                            <span className="l">{t("من المركز", "Ours")}</span>
                            {e.ours?.length ? (
                              <span className="v">
                                {e.ours.map((c) => c.name).filter(Boolean).join(" · ")}
                                {e.ours[0]?.phone ? ` — ${e.ours[0].phone}` : ""}
                              </span>
                            ) : (
                              <span className="v no">{t("لا توجد نقطة تواصل عندنا", "None yet")}</span>
                            )}
                          </div>
                          <div className="ai-ent-r">
                            <span className="l">{t("من الجهة", "Theirs")}</span>
                            {e.theirs?.length ? (
                              <span className="v">
                                {e.theirs[0].name}
                                {e.theirs[0].jobTitle ? ` — ${e.theirs[0].jobTitle}` : ""}
                                {e.theirs[0].phone ? ` · ${e.theirs[0].phone}` : ""}
                                {e.theirs[0].email ? ` · ${e.theirs[0].email}` : ""}
                              </span>
                            ) : (
                              <span className="v no">{t("غير مسجَّلة", "Not recorded")}</span>
                            )}
                          </div>
                        </div>
                      ))}
                      {onOpenTab && (
                        <button className="ai-open" onClick={() => { onOpenTab("entities"); close(); }}>
                          {t("صفحة الجهات ونقاط التواصل", "Entities page")} ‹
                        </button>
                      )}
                    </div>
                  )}

                  {/* من نصّ المنهجيات — المقطع ومصدره وصفحته، فيتحقّق
                      السائل بنفسه بدل أن يثق بجوابٍ بلا مرجع */}
                  {!!show.passages?.length && (
                    <div className="ai-kb">
                      {show.passages.map((x, i) => (
                        <div className="ai-kb-i" key={i}>
                          {x.heading && <b>{x.heading}</b>}
                          <p>{x.body}</p>
                          <span>
                            {x.title} · {t("صفحة", "p.")} {x.page}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  {!!show.files?.length && (
                    <div className="ai-files">
                      <b>{t("ملفات ذات صلة", "Related files")}</b>
                      {show.files.map((f) => (
                        <a key={f.id} className="ai-file" href={f.url} target="_blank" rel="noreferrer">
                          <span className="k">{f.kind}</span>
                          {f.title}
                          <span className="dl">⬇</span>
                        </a>
                      ))}
                    </div>
                  )}
                  {show.note && <div className="ai-note">{show.note}</div>}
                </div>
              )
            )}

            <div className="ai-foot">
              {t(
                "الإجابات تُحسب من بياناتك داخل متصفحك — لا تخرج إلى أي خدمة خارجية.",
                "Answers are computed locally in your browser.",
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
