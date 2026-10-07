"use client";

/* ============================================================
   الخطة التشغيلية لإدارة عمليات الأداء
   ------------------------------------------------------------
   خمس محافظ، لكل مديرٍ محفظة، وداخل كل محفظة ثلاثة أنواع من
   المساهمات: مؤشرات · مبادرات · مكاسب سريعة.

   **الراعي غير صاحب المحفظة**: البند قد يرعاه من ليس مديراً،
   فيُحفَظ اسمه كما هو ويبقى البند في محفظة المدير المسؤول عنه.
   ولذلك `owner` حقلٌ مستقلّ عن `sponsor` لا يُشتقّ منه.
   ============================================================ */

import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { useItems, type Item } from "./Sections";
import { nrm } from "@/lib/commit";
import { DEFAULT_BANDS } from "@/lib/calc";
import { apiFetch } from "@/lib/api";
import { IconDown, IconUp, IconKpi, IconBulb, IconBolt, IconTarget, IconLayers } from "./icons";
import { writeXlsx, readXlsxSheets } from "@/lib/sheet";
import {
  OP_STATUSES, KPI_STATUSES, ALL_STATUSES, statusesOf, toneOf, TONE_LABEL, OP_TONES, NO_MEASURE,
  quarters, onTrack, opStatus, opShares, opNames,
  xlBook, xlParseBook, type XlRow, type XlPlan,
} from "@/lib/opxl";

/* المنطق في `lib/opxl` ليُختبر بلا React ولا شبكة، والصفحة تعرضه.
   ويُعاد تصديره هنا ليبقى مستوردوه على ما ألفوه */
export { OP_STATUSES, ALL_STATUSES, statusesOf, opStatus };

/** الكتاب يُغلَّف ملفاً — بناؤه في `lib/opxl` */
const xlExport = (rows: XlRow[], owners: string[]) => writeXlsx(xlBook(rows, owners));

type T = (ar: string, en: string) => string;
type Rec = Record<string, unknown>;

const txt = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const num = (v: unknown, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
/** قيمة مُدخَلة فعلاً — الصفر قيمة، والفراغ ليس صفراً */
const has = (v: unknown) => v !== undefined && v !== null && String(v).trim() !== "";

/** أصحاب المحافظ الخمس بترتيب العرض */
export const OP_OWNERS = [
  "عبدالله الحزامي",
  "دعاء الفهمي",
  "معاذ الهقاص",
  "بدر الغنام",
  "عمر العتيق",
];
const OWNER_COLOR: Record<string, string> = {
  "عبدالله الحزامي": "#00584c",
  "دعاء الفهمي": "#016b5f",
  "معاذ الهقاص": "#008b84",
  "بدر الغنام": "#0f8a8a",
  "عمر العتيق": "#1a9d5c",
};
const KIND_COLOR: Record<string, string> = { kpi: "#00584c", init: "#7a5cd1", win: "#c9a020" };
const KIND_LABEL: Record<string, [string, string]> = {
  kpi: ["المؤشرات", "KPIs"],
  init: ["المبادرات", "Initiatives"],
  win: ["المكاسب السريعة", "Quick wins"],
};
/** مختصرٌ لشرائح البطاقة — «المكاسب السريعة» لا تسع في صفٍّ واحد */
const KIND_SHORT: Record<string, string> = { kpi: "مؤشرات", init: "مبادرات", win: "مكاسب" };
const KINDS = ["kpi", "init", "win"] as const;
/** نصّ شريط الإضافة في ذيل كل عمود */
const ADD_LABEL: Record<string, string> = {
  kpi: "إضافة مؤشر",
  init: "إضافة مبادرة",
  win: "إضافة مكسب سريع",
};
const LEVELS = ["", "مستوى أول", "مستوى ثانٍ", "مستوى ثالث"];
const INIT_TYPES = ["استراتيجية", "تشغيلية"];
/** الحالات الأربع المعتمدة — لا «جديدة» ولا «مستمرة» بعد اليوم */
const ST_TONE: Record<string, string> = {
  /* سلّم المؤشرات */
  "وفق المسار": "ok",
  "متعثر جزئيًا": "go",
  متعثر: "no",
  "لا يقاس": "nt",
  /* سلّم المبادرات والمكاسب */
  مكتملة: "ok",
  "على المسار": "nw",
  متأخرة: "no",
  "لم تبدأ": "nt",
};

/** أحرف الاسم الأولى — وجهٌ صغير للمحفظة */
const short = (n: string) => {
  const w = n.trim().split(/\s+/);
  return ((w[0]?.[0] || "") + (w[1]?.[0] || "")).trim() || "؟";
};
/** آخر كلمة من الاسم — تكفي للتمييز في الشرائح الضيّقة */
const last = (n: string) => n.trim().split(/\s+/).slice(-1)[0] || n;

/* ---------- أسماء قديمة بقيت في المخزون ---------- */
/* بندٌ محفوظ باسمٍ قديم يصنع **محفظةً ثانية** للشخص نفسه: واحدة
   فارغة بالاسم الصحيح من قائمة أصحاب المحافظ، وأخرى فيها بنوده
   بالاسم الخطأ لأنها ليست في القائمة فتُعرض كمحفظةٍ زائدة.
   فتُصحَّح الأسماء عند العرض، ويُصحَّح المخزون نفسه بملف
   perf-opplan-rename.sql — والاثنان معاً: الواجهة تصلح فوراً
   والقاعدة تصلح دائماً. */
const NAME_ALIAS: Record<string, string> = {
  "معاذ البقاص": "معاذ الهقاص",
  /* حسابه في المنصة «عبدالعزيز بن عون»، وفي الخطة «عبدالعزيز العون»
     — فظهر سطرين في جدول المساهمات. والصحيح «بن عون» */
  "عبدالعزيز العون": "عبدالعزيز بن عون",
};
export const opName = (v: unknown) => {
  const x = txt(v).trim();
  return NAME_ALIAS[x] ?? x;
};
/** خانةٌ قد تحمل عدة أسماء — يُصحَّح كلٌّ منها على حدة.
    والتقسيم بـ`opNames` نفسها التي يحسب بها جدول المساهمات، فلا
    يفترق ما تراه عمّا يُحسب */
const fixList = (v: unknown) => {
  const x = txt(v).trim();
  if (!x) return x;
  const parts = opNames(x);
  return parts.length > 1 ? parts.map(opName).join(" · ") : opName(x);
};
/** نسخةٌ من بيانات البند بأسماءٍ مصحَّحة — تُستعمل في العرض والمطابقة */
export function opFix(d: Rec): Rec {
  return {
    ...d,
    owner: opName(d.owner),
    sponsor: fixList(d.sponsor),
    assignee: fixList(d.assignee),
    contributor: opName(d.contributor),
  };
}

/* ---------- «مَن يخصّه البند» ---------- */
/** خانةٌ قد تحمل أكثر من اسم: «أ · ب» أو «أ، ب» */
const namesOf = opNames;

/** أدوار الشخص في البند — فارغة إن لم يكن له فيه شيء */
export function opRoles(d: Rec, me: string): string[] {
  const n = nrm(me);
  if (!n) return [];
  const r: string[] = [];
  if (namesOf(d.sponsor).some((x) => nrm(x) === n)) r.push("راعي");
  if (namesOf(d.assignee).some((x) => nrm(x) === n)) r.push("مسؤول");
  if (namesOf(d.owner).some((x) => nrm(x) === n) && !r.length) r.push("صاحب المحفظة");
  if (nrm(txt(d.contributor)) === n && !r.length) r.push("مساهمة");
  return r;
}

/* ---------- آخر تحديثٍ لحالة المساهمة ---------- */
/* «حالة المساهمة» تتحدّث أسبوعياً، فمتى تحدّثت آخر مرة جزءٌ من
   المعلومة: سطرٌ عمره أسبوعان يُقرأ على أنه الحاضر وهو ليس كذلك. */
export function agoOf(iso?: string): { txt: string; stale: boolean } | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  const w =
    days <= 0 ? "اليوم"
    : days === 1 ? "أمس"
    : days === 2 ? "قبل يومين"
    : days < 11 ? `قبل ${days} أيام`
    : days < 30 ? `قبل ${days} يوماً`
    : d.toLocaleDateString("ar-SA-u-nu-latn", { year: "numeric", month: "short", day: "numeric" });
  return { txt: w, stale: days > 10 };
}

export const opTone = (s: string) => ST_TONE[s] || "nt";

/* ---------------- حلقةٌ مجزّأة ---------------- */
/* الداش بورد دوائرُ لا أشرطة — بطلب صاحبة المنصة. والحلقة ترسم
   نفسها بـ`stroke-dasharray` على دائرةٍ واحدة: كل جزءٍ قوسٌ طوله
   حصّته، و`stroke-dashoffset` يدفعه إلى مكانه. لا مكتبة رسوم. */
function Donut({
  parts, size = 150, w = 17, mid, sub,
}: {
  parts: { v: number; c: string }[];
  size?: number;
  w?: number;
  mid?: string;
  sub?: string;
}) {
  const r = (size - w) / 2;
  const cx = size / 2;
  const C = 2 * Math.PI * r;
  const sum = parts.reduce((a, x) => a + x.v, 0) || 1;
  let off = 0;
  const arcs = parts.map((x, i) => {
    if (x.v <= 0) return null;
    const ln = (C * x.v) / sum;
    const at = off;
    off += ln;
    /* فجوةٌ صغيرة بين الأقواس تفصلها للعين — وتُقتطع من القوس نفسه
       لا تُزاد عليه، وإلا زاد مجموع الأقواس عن محيط الدائرة */
    return (
      <circle
        key={i} cx={cx} cy={cx} r={r} fill="none" stroke={x.c} strokeWidth={w} strokeLinecap="round"
        strokeDasharray={`${Math.max(ln - 2.2, 0.1)} ${C - Math.max(ln - 2.2, 0.1)}`}
        strokeDashoffset={-at}
      />
    );
  });
  return (
    <svg className="dn" viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden>
      <g transform={`rotate(-90 ${cx} ${cx})`}>
        <circle cx={cx} cy={cx} r={r} fill="none" stroke="var(--soft)" strokeWidth={w} />
        {arcs}
      </g>
      {mid && <text x={cx} y={cx - 2} textAnchor="middle" className="dn-n">{mid}</text>}
      {sub && <text x={cx} y={cx + 16} textAnchor="middle" className="dn-s">{sub}</text>}
    </svg>
  );
}

/** رمز كل نوع في بطاقته */
const KIND_ICON: Record<string, (p: { size?: number }) => ReactElement> = {
  kpi: IconKpi,
  init: IconBulb,
  win: IconBolt,
};
/* **ألوان الحالات من لوحة «حالة المؤشرات» نفسها** (`DEFAULT_BANDS`)
   فلا تتكلّم الصفحتان لغتين: الأخضر وفق المسار والأحمر متعثّر.
   و«مكتملة» أخضرُ أغمق من «على المسار» — فالحالتان كلتاهما خير،
   ويفرّقهما الدرجة لا اللون. و«لم تبدأ» رماديٌّ كـ«لا قياس»: لا
   يُسقَط من الحلقة وإلا لم يجمع مجموعُها الكلّ */
const BAND: Record<string, string> = Object.fromEntries(
  DEFAULT_BANDS.map((b) => [b.label, b.color]),
);
const GREY = "#a8b3b0";
const ST_COLOR: Record<string, string> = {
  /* سلّم المؤشرات — ألوانه من `DEFAULT_BANDS` حرفياً */
  "وفق المسار": BAND["وفق المسار"] ?? "#22c55e",
  "متعثر جزئيًا": BAND["متعثر جزئيًا"] ?? "#f59e0b",
  متعثر: BAND["متعثر"] ?? "#ef4444",
  "لا يقاس": GREY,
  /* سلّم المبادرات والمكاسب — «مكتملة» أخضرُ أغمق تمييزاً لها عمّا
     هو على المسار، فالحالتان كلتاهما خير ويفرّقهما الدرجة لا اللون */
  مكتملة: "#15803d",
  "على المسار": BAND["وفق المسار"] ?? "#22c55e",
  متأخرة: BAND["متعثر"] ?? "#ef4444",
  "لم تبدأ": GREY,
};
/** لون كل درجة في الشريط الإجمالي — و«مكتملة» كحليٌّ بطلب صاحبة
    المنصة، فلا يلتبس المنجَز بما هو سائرٌ بعد */
const TONE_COLOR: Record<string, string> = {
  done: "#1e3a6b",
  ok: BAND["وفق المسار"] ?? "#22c55e",
  warn: BAND["متعثر جزئيًا"] ?? "#f59e0b",
  bad: BAND["متعثر"] ?? "#ef4444",
  none: GREY,
};
/** بندٌ بلا حالةٍ مُدخَلة لم يبدأ — فلا يسقط من الحلقة */
/* بندٌ بلا حالةٍ مُدخَلة لم يبدأ — فلا يسقط من الحلقة */
const stOf = (d: Rec) => opStatus(d) || (txt(d.kind) === "kpi" ? NO_MEASURE : "لم تبدأ");

/* ---------------- تبويب ١: الداش بورد ---------------- */
/* بطاقةُ نوعٍ واحد: عدده الكليّ، ثم حالاته الأربع عدداً وحلقةً.
   والبطاقة كلها زرّ — يفتح تبويب المحافظ على هذا النوع وحده،
   وهو ما يعنيه السهم في زاويتها. */
function OpKind({
  k, rows, t, onOpen,
}: {
  k: (typeof KINDS)[number];
  rows: { data: Rec }[];
  t: T;
  onOpen: () => void;
}) {
  const Ic = KIND_ICON[k];
  const n = rows.length;
  /* المؤشر لا «يكتمل»، فسلّمه غير سلّم المبادرات والمكاسب */
  const sts = statusesOf(k);
  const sc = (x: string) => rows.filter((r) => stOf(r.data) === x).length;
  return (
    <button className="opk" style={{ ["--c" as string]: KIND_COLOR[k] }} onClick={onOpen}
            title={t(`عرض ${KIND_LABEL[k][0]} وحدها`, `Show only ${KIND_LABEL[k][1]}`)}>
      <span className="h">
        <span className="go" aria-hidden>‹</span>
        <span className="t">{t(KIND_LABEL[k][0], KIND_LABEL[k][1])}</span>
        <span className="ic"><Ic size={20} /></span>
      </span>
      <span className="n">{n}</span>
      <span className="nl">{t(`إجمالي ${KIND_LABEL[k][0]}`, `Total ${KIND_LABEL[k][1]}`)}</span>
      <span className="bd">
        <span className="lg">
          {sts.map((x) => (
            <span key={x}>
              <em>{x}</em>
              <i style={{ background: ST_COLOR[x] }} />
              <b>{sc(x)}</b>
            </span>
          ))}
        </span>
        <span className="dw">
          <Donut size={96} w={12} parts={sts.map((x) => ({ v: sc(x), c: ST_COLOR[x] }))} />
          {/* الرمز في قلب الحلقة — خارج الـsvg فلا يدور مع دورانها */}
          <span className="mid" aria-hidden><Ic size={22} /></span>
        </span>
      </span>
    </button>
  );
}

function OpDash({
  rows, t, onKind,
}: {
  rows: { id: string; ord: number; data: Rec }[];
  t: T;
  /** الضغط على بطاقة نوعٍ ينقل إلى تبويب المحافظ على ذلك النوع */
  onKind: (k: (typeof KINDS)[number]) => void;
}) {
  const tot = rows.length;
  const pct = (n: number) => (tot ? Math.round((1000 * n) / tot) / 10 : 0);
  /* السلّمان يلتقيان في أربع درجات — وإلا لزم الشريطَ ثماني شرائح */
  const sc = (x: string) => rows.filter((r) => toneOf(stOf(r.data)) === x).length;
  const ofKind = (k: string) => rows.filter((r) => txt(r.data.kind) === k);

  if (!tot) return <div className="op-none">{t("لا توجد بنود في الخطة بعد", "The plan is empty")}</div>;

  return (
    <>
      {/* المؤشرات أولاً ثم المبادرات ثم المكاسب — ترتيب `KINDS` نفسه */}
      <div className="opk-3">
        {KINDS.map((k) => (
          <OpKind key={k} k={k} rows={ofKind(k)} t={t} onOpen={() => onKind(k)} />
        ))}
      </div>

      <div className="opo opd-mb">
        <div className="h">
          <span className="ic"><IconTarget size={19} /></span>
          <h4>{t("الحالة الإجمالية للخطة التشغيلية", "Overall status")}</h4>
        </div>
        <div className="bd">
          <div>
            <div className="bar">
              {OP_TONES.map((x) =>
                sc(x) ? (
                  <span key={x} style={{ flex: sc(x), background: TONE_COLOR[x] }}>
                    {/* النسبة تُكتب داخل الشريحة ما دامت تسعها */}
                    {pct(sc(x)) >= 5 ? `${pct(sc(x))}%` : ""}
                  </span>
                ) : null,
              )}
            </div>
            <div className="lg3">
              {OP_TONES.map((x) => (
                <span key={x}>
                  <em><i style={{ background: TONE_COLOR[x] }} />{TONE_LABEL[x]}</em>
                  <b>{sc(x)}</b>
                  <u>{pct(sc(x))}%</u>
                </span>
              ))}
            </div>
          </div>
          <div className="tot">
            <span className="l">{t("إجمالي عناصر الخطة التشغيلية", "Total plan items")}</span>
            <span className="r">
              <b>{tot}</b>
              <IconLayers size={22} />
            </span>
          </div>
        </div>
      </div>

    </>
  );
}


/* ---------------- تبويب ٣: نسبة المساهمات ---------------- */
/* **مساهمةٌ بالعدد لا بالإنجاز**: كم بنداً للموظف فيه دورٌ مُسمّى.
   والبند يُحسب مرةً واحدة له مهما تعدّدت أدواره فيه، ويُحسب لكل من
   ذُكر فيه — فمجموع النسب يتجاوز 100% بطبيعته، إذ للبند راعٍ
   ومسؤولون. */
function OpPeople({
  rows, people, owners, t, onPick,
}: {
  rows: { id: string; data: Rec }[];
  /** كل موظفي المنصة — فالجدول على كل موظف لا على من ذُكر في الخطة وحده */
  people: { name: string; isLead: boolean }[];
  owners: string[];
  t: T;
  /** الضغط على محفظة ينقل إلى تبويب المحافظ مفلترًا عليها */
  onPick: (o: string) => void;
}) {
  /* مدراء المحافظ رعاةٌ بلا مسؤوليةٍ مباشرة، فجمعُ الدورين يضعهم في
     الصدارة — والمربع يفصل المسؤولية وحدها لمن أراد المنفّذ */
  const [both, setBoth] = useState(true);
  /* الجدول على كل موظف، ومن لا بند له يُطوى خلف زرٍّ حتى لا يطول
     الجدول بأصفارٍ تحجب من يعمل */
  const [zeros, setZeros] = useState(false);

  const tot = rows.length;
  /* «مدراء القطاعات» يُحلّ إلى من عُلِّم `is_lead`. وإن لم يُعلَّم أحد
     سقط البند فلم يصل أحداً — فالبديل أصحابُ المحافظ الأربعة، وهم
     مدراء القطاعات بالتعريف (والأول مدير الإدارة فيُستثنى) */
  const ppl = useMemo(() => {
    if (people.some((x) => x.isLead)) return people;
    const leads = new Set(OP_OWNERS.slice(1).map((o) => nrm(o)));
    return people.map((x) => ({ ...x, isLead: leads.has(nrm(x.name)) }));
  }, [people]);
  const list = useMemo(() => opShares(rows, ppl, both, opName), [rows, ppl, both]);

  const pct = (n: number) => (tot ? Math.round((100 * n) / tot) : 0);
  const none = list.filter((e) => !e.items).length;
  const shown = zeros ? list : list.filter((e) => e.items > 0);

  if (!tot) return <div className="op-none">{t("لا توجد بنود في الخطة بعد", "The plan is empty")}</div>;

  return (
    <>
      {/* المحافظ هنا لا في الداش بورد: حجمُ المحفظة مساهمةُ صاحبها،
          فموضعها مع بقية المساهمات */}
      <div className="opd-box opd-mb">
        <h4>{t("المحافظ — حجم كل محفظة وتركيبتها", "Portfolios")}</h4>
        <div className="opd-pf5">
          {owners.map((o) => {
            const rs = rows.filter((r) => txt(r.data.owner) === o);
            return (
              <button className="p" key={o} onClick={() => onPick(o)}
                      title={t(`عرض محفظة ${o}`, `Open ${o}`)}>
                <Donut size={108} w={13} mid={String(rs.length)} sub={t("بنداً", "items")}
                       parts={KINDS.map((k) => ({
                         v: rs.filter((r) => txt(r.data.kind) === k).length,
                         c: KIND_COLOR[k],
                       }))} />
                <span className="nm">{o}</span>
                <span className="sb">{pct(rs.length)}% {t("من الخطة", "of the plan")}</span>
              </button>
            );
          })}
        </div>
        <div className="opd-lg inl">
          {KINDS.map((k) => (
            <span key={k}><i style={{ background: KIND_COLOR[k] }} />{t(KIND_LABEL[k][0], KIND_LABEL[k][1])}</span>
          ))}
        </div>
      </div>

      <div className="opd-box opd-mb">
        <h4>{t("أكثر خمسة إسهاماً", "Top five")}</h4>
        <div className="opd-pf5">
          {list.slice(0, 5).map((e) => (
            <div className="p" key={e.name}>
              <Donut
                size={108} w={13} mid={`${pct(e.items)}%`} sub={t(`${e.items} بنداً`, `${e.items} items`)}
                parts={[...KINDS.map((k) => ({ v: e.k[k] || 0, c: KIND_COLOR[k] })), { v: tot - e.items, c: "#eef3f2" }]}
              />
              <span className="nm">{e.name}</span>
              <span className="sb">
                {[e.sponsor ? t(`راعٍ ${e.sponsor}`, `sponsor ${e.sponsor}`) : "",
                  e.assignee ? t(`مسؤول ${e.assignee}`, `owner ${e.assignee}`) : ""].filter(Boolean).join(" · ")}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="opd-box">
        <div className="opd-hd">
          <h4>{t("نسبة مساهمة كل موظف في الخطة التشغيلية", "Contribution per person")}</h4>
          <div className="chips">
            <button className={`chip sm ${both ? "on" : ""}`} onClick={() => setBoth(true)}>
              {t("راعٍ + مسؤول", "Sponsor + owner")}
            </button>
            <button className={`chip sm ${!both ? "on" : ""}`} onClick={() => setBoth(false)}>
              {t("المسؤولية فقط", "Owner only")}
            </button>
          </div>
        </div>
        <p className="opc-note">
          {t(
            `النسبة = عدد بنود الخطة التي للموظف فيها دورٌ مُسمّى ÷ ${tot} بنداً. البند يُحسب مرةً واحدة لكل شخص مهما تعدّدت أدواره فيه، ويُحسب لكل من ذُكر فيه — فمجموع النسب يتجاوز 100% بطبيعته. وهي مساهمةٌ بالعدد لا بالإنجاز. والاسم الجماعي («مدراء القطاعات» · «الفريق المركزي») لا يظهر صفّاً، بل يُحسب بنده لكل واحدٍ من أصحابه.`,
            `Share of the ${tot} plan items where the person holds a named role. Totals exceed 100% by design.`,
          )}
        </p>
        <table className="opc-tb">
          <thead>
            <tr>
              <th>{t("الموظف", "Person")}</th>
              <th>{t("البنود", "Items")}</th>
              <th>{t("عدد", "N")}</th>
              <th>{t("نسبة", "%")}</th>
              <th>{t("الأدوار", "Roles")}</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((e) => {
              const mx = list[0]?.items || 1;
              return (
                <tr key={e.name}>
                  <td className="nm">{e.name}</td>
                  <td>
                    <span className="opc-b">
                      {KINDS.map((k) =>
                        e.k[k] ? <span key={k} style={{ flex: e.k[k], background: KIND_COLOR[k] }} /> : null,
                      )}
                      {mx > e.items && <span style={{ flex: mx - e.items }} />}
                    </span>
                  </td>
                  <td className="p">{e.items}</td>
                  <td className="p">{pct(e.items)}%</td>
                  <td>
                    {e.sponsor > 0 && <span className="opc-k sp">{t(`راعٍ ${e.sponsor}`, `sponsor ${e.sponsor}`)}</span>}
                    {e.assignee > 0 && <span className="opc-k as">{t(`مسؤول ${e.assignee}`, `owner ${e.assignee}`)}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {none > 0 && (
          <button className="op-more" onClick={() => setZeros((x) => !x)}>
            {zeros
              ? t("إخفاء من لا بند له", "Hide people with no items")
              : t(`عرض من لا بند له في الخطة (${none})`, `Show ${none} with no items`)}
          </button>
        )}
      </div>
    </>
  );
}

export default function OpPlan({ t, canEdit }: { t: T; canEdit: boolean }) {
  const { items, loaded, save, remove, reload } = useItems("opplan");
  const [own, setOwn] = useState("");
  /* نوعٌ واحد معروض، أو الثلاثة. يُختار من شريحة البطاقة أو من
     عنوان العمود — فمن أراد مؤشرات محفظةٍ وحدها رآها وحدها */
  const [kind, setKind] = useState<"" | (typeof KINDS)[number]>("");
  /* صورة صاحب المحفظة إن رفعها في محفظته — تُطابَق بالاسم بعد
     التطبيع، فاختلاف الهمزة لا يُسقطها. وبلا صورةٍ يبقى الحرفان */
  const [photo, setPhoto] = useState<Map<string, string>>(new Map());
  /* وتُستعمل القائمة نفسها في «نسبة المساهمات»: الجدول على كل موظف
     لا على من ذُكر في الخطة وحده، و`isLead` يحلّ «مدراء القطاعات» */
  const [people, setPeople] = useState<{ name: string; isLead: boolean }[]>([]);
  useEffect(() => {
    void apiFetch("/api/people")
      .then((r) => r.json())
      .then((d) => {
        const m = new Map<string, string>();
        const ppl: { name: string; isLead: boolean }[] = [];
        for (const u of (Array.isArray(d.people) ? d.people : []) as Rec[]) {
          const url = txt(u.photoUrl);
          const name = opName(txt(u.name));
          if (!name) continue;
          if (url) m.set(nrm(name), url);
          ppl.push({ name, isLead: u.isLead === true });
        }
        setPhoto(m);
        setPeople(ppl);
      })
      .catch(() => {});
  }, []);
  const [edit, setEdit] = useState<Item | null>(null);
  /* بندٌ جديد لم يُحفَظ بعد — نفس نافذة التعديل، والفرق أن الحذف
     يُخفى والعنوان يقول «إضافة» */
  const [add, setAdd] = useState<Item | null>(null);
  /* الصفحة ثلاثة تبويبات، وتُفتح على الداش بورد — بطلب صاحبة المنصة */
  const [view, setView] = useState<"dash" | "pf" | "ppl">("dash");
  /* سُحبت الصلاحية والتبويب مفتوح ⇒ يعود إلى الداش بورد، فلا تبقى
     صفحةٌ معروضةً بلا مربّعٍ يدلّ عليها */
  useEffect(() => {
    if (!canEdit && view === "ppl") setView("dash");
  }, [canEdit, view]);

  const rows = useMemo(() => items.map((x) => ({ ...x, data: opFix(x.data as Rec) })), [items]);
  const byOwner = useMemo(() => {
    const m: Record<string, typeof rows> = {};
    for (const o of OP_OWNERS) m[o] = [];
    for (const r of rows) {
      const o = txt(r.data.owner);
      (m[o] = m[o] || []).push(r);
    }
    return m;
  }, [rows]);
  /* محافظ لم يُذكر أصحابها في الخمسة — تُعرض ولا تُخفى */
  const extra = useMemo(
    () => Object.keys(byOwner).filter((o) => o && !OP_OWNERS.includes(o)),
    [byOwner],
  );
  const owners = [...OP_OWNERS, ...extra];

  /* بندٌ فارغ بنوع عموده ومحفظة المعروضة — معرّفه من الوقت والعشوائي
     كبقية المنصة، وترتيبه بعد آخر بند فلا يزاحم محفوظاً */
  const newItem = (k: string): Item => ({
    id: "op-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    ord: rows.reduce((a, r) => Math.max(a, r.ord), 0) + 1,
    data: {
      kind: k,
      owner: own || owners[0] || "",
      name: "",
      sponsor: "",
      assignee: "",
      ...(k === "kpi" ? { level: 1, unit: "%" } : {}),
      ...(k === "init" ? { itype: INIT_TYPES[0] } : {}),
    },
  });

  const shown = own ? rows.filter((r) => txt(r.data.owner) === own) : rows;
  const of = (k: string) => shown.filter((r) => txt(r.data.kind) === k);
  const cnt = (o: string, k: string) => (byOwner[o] || []).filter((r) => txt(r.data.kind) === k).length;

  if (!loaded) return <div className="empty">{t("جارٍ التحميل...", "Loading...")}</div>;

  return (
    <div className="op">
      {/* عنوان الصفحة في شريط المنصة الأعلى (TITLES.opplan)، ومكانَه
          هنا المربعات الثلاثة — بطلب صاحبة المنصة */}
      <div className="op-bar">
        <div className="chips">
          <button className={`chip ${view === "dash" ? "on" : ""}`} onClick={() => setView("dash")}>
            {t("الخطة التشغيلية", "Operational plan")}
          </button>
          <button className={`chip ${view === "pf" ? "on" : ""}`} onClick={() => setView("pf")}>
            {t("المحافظ", "Portfolios")}
          </button>
          {/* **لا يراه ولا عنوانَه إلا من يحرّر الخطة** — وهم الأربعة
              أصحاب `opplan:edit`. والواجهة تجميلية كما في بقية
              المنصة: البنود نفسها يقرؤها كل من يملك `opplan`، وإنما
              هذا إخفاءُ عرضٍ لا حاجزُ بيانات */}
          {canEdit && (
            <button className={`chip ${view === "ppl" ? "on" : ""}`} onClick={() => setView("ppl")}>
              {t("نسبة المساهمات", "Contribution")}
            </button>
          )}
        </div>
        <div className="gr" />
        {/* الملف يحمل الخطة كما هي على الشاشة — المعروض بعد الفلتر
            لا كل شيء، فما تراه هو ما تُنزّله. و**التنزيل لمن يقرأ**:
            أخذُ نسخةٍ لا يغيّر شيئاً، وإنما الرفع هو الذي يحتاج
            صلاحية التحرير */}
        {view === "pf" && <OpXlsx rows={shown} owners={owners} t={t} canEdit={canEdit} onDone={reload} />}
      </div>

      {view === "dash" && (
        <OpDash
          rows={rows}
          t={t}
          onKind={(k) => {
            setOwn("");
            setKind(k);
            setView("pf");
          }}
        />
      )}
      {/* المساهمات لمن يحرّر الخطة وحده — والشرط هنا كما هو على
          المربّع، فلا يُفتح التبويب بتغيير الحالة في المتصفح */}
      {view === "ppl" && canEdit && (
        <OpPeople
          rows={rows}
          people={people}
          owners={owners}
          t={t}
          onPick={(o) => {
            setOwn(o);
            setKind("");
            setView("pf");
          }}
        />
      )}

      {view === "pf" && (
       <>
      <div className="op-sub">
        {t(
          `${owners.length} محافظ · ${of("kpi").length} مؤشراً · ${of("init").length} مبادرة · ${of("win").length} مكاسب سريعة`,
          `${owners.length} portfolios`,
        )}
      </div>

      {/* المحافظ — الضغط يفلتر الأعمدة الثلاثة على صاحبها */}
      <div className="op-pf">
        {/* البطاقة `div` لا `button`: فيها أزرارٌ أربعة — الاسم
            يختار المحفظة، وكلُّ شريحةٍ تختارها ونوعَها معاً.
            والزرّ داخل الزرّ لا يصحّ في HTML */}
        {owners.map((o) => (
          <div key={o} className={`c ${own === o ? "on" : ""}`}>
            <button className="hd" onClick={() => setOwn(own === o ? "" : o)}>
              <span className="av">
                {photo.get(nrm(o)) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={photo.get(nrm(o))} alt="" />
                ) : (
                  short(o)
                )}
              </span>
              <span className="nm">{o}</span>
              <span className="rl">
                {o === OP_OWNERS[0] ? t("مدير الإدارة", "Director") : t("مدير قطاع", "Sector manager")}
              </span>
            </button>
            <span className="n3">
              {KINDS.map((k) => (
                <button
                  key={k}
                  className={own === o && kind === k ? "on" : ""}
                  title={t(`${KIND_LABEL[k][0]} — ${o}`, KIND_LABEL[k][1])}
                  onClick={() => {
                    const same = own === o && kind === k;
                    setOwn(same ? "" : o);
                    setKind(same ? "" : k);
                  }}
                >
                  {KIND_SHORT[k]} <b>{cnt(o, k)}</b>
                </button>
              ))}
            </span>
          </div>
        ))}
      </div>
      {(own || kind) && (
        <div className="op-filt">
          {own ? t(`معروضة محفظة: ${own}`, `Portfolio: ${own}`) : t("كل المحافظ", "All portfolios")}
          {kind && <b>{t(KIND_LABEL[kind][0], KIND_LABEL[kind][1])}</b>}
          <button
            onClick={() => {
              setOwn("");
              setKind("");
            }}
          >
            {t("عرض الجميع", "Show all")}
          </button>
        </div>
      )}

      {/* نوعٌ مختار ⇒ عمودٌ واحد يملأ العرض */}
      <div className={`op-3 ${kind ? "one" : ""}`}>
        {KINDS.filter((k) => !kind || k === kind).map((k) => (
          <div className="op-col" key={k} style={{ ["--c" as string]: KIND_COLOR[k] }}>
            <h3
              className="pick"
              title={kind ? t("عرض الأنواع الثلاثة", "Show all three") : t("عرض هذا النوع وحده", "Show only this")}
              onClick={() => setKind(kind === k ? "" : k)}
            >
              <i />
              {t(KIND_LABEL[k][0], KIND_LABEL[k][1])}
              <b>{of(k).length}</b>
            </h3>
            {of(k).map((r) => (
              <OpCard key={r.id} r={r} canEdit={canEdit} t={t} onEdit={() => setEdit(r)} />
            ))}
            {!of(k).length && <div className="op-none">{t("لا توجد بنود", "Nothing here")}</div>}
            {/* الإضافة من ذيل العمود لا من رأس الصفحة: النوع يصير
                معلوماً من العمود نفسه، فلا تُسأل عنه النافذة */}
            {canEdit && (
              <button className="op-add" onClick={() => setAdd(newItem(k))}>
                ＋ {t(ADD_LABEL[k], KIND_LABEL[k][1])}
              </button>
            )}
          </div>
        ))}
      </div>
       </>
      )}

      {add && (
        <OpEdit
          it={add}
          isNew
          t={t}
          owners={owners}
          onClose={() => setAdd(null)}
          onSave={async (d) => {
            const err = await save(add.id, d, add.ord);
            if (!err) setAdd(null);
            return err;
          }}
          onDelete={async () => null}
        />
      )}

      {edit && (
        <OpEdit
          it={edit}
          t={t}
          owners={owners}
          onClose={() => setEdit(null)}
          onSave={async (d) => {
            const err = await save(edit.id, d, edit.ord);
            if (!err) setEdit(null);
            return err;
          }}
          onDelete={async () => {
            const err = await remove(edit.id);
            if (!err) setEdit(null);
            return err;
          }}
        />
      )}
    </div>
  );
}

function OpXlsx({
  rows, owners, t, canEdit, onDone,
}: {
  rows: XlRow[];
  /** ترتيب المحافظ — ورقةٌ لكل واحدة بالترتيب نفسه */
  owners: string[];
  t: T;
  /** الرفع لمن يحرّر الخطة وحده — والتنزيل للجميع */
  canEdit: boolean;
  onDone: () => void;
}) {
  const file = useRef<HTMLInputElement | null>(null);
  const [plan, setPlan] = useState<XlPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  function down() {
    const url = URL.createObjectURL(xlExport(rows, owners));
    const a = document.createElement("a");
    a.href = url;
    a.download = `الخطة-التشغيلية-${new Date().toISOString().slice(0, 10)}.xlsx`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  async function pick(f: File | null | undefined) {
    if (!f) return;
    setMsg("");
    try {
      const sheets = await readXlsxSheets(await f.arrayBuffer());
      if (!sheets.length) throw new Error("فارغ");
      const p = xlParseBook(sheets, rows);
      if (!p.put.length) {
        setMsg(t(`لا جديد في الملف — ${p.same} بنداً كما هي.`, "Nothing changed."));
        return;
      }
      setPlan(p);
    } catch {
      setMsg(t("تعذّرت قراءة الملف — يُحفظ من إكسل بصيغة xlsx.", "Could not read the file."));
    }
  }

  async function run() {
    if (!plan) return;
    setBusy(true);
    /* دفعةٌ واحدة لا طلبٌ لكل بند: ثلاثون طلباً متتابعاً تُبطئ
       وتترك الخطة نصفَ محدَّثة إن انقطع الاتصال في وسطها */
    const r = await apiFetch("/api/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        section: "opplan",
        items: plan.put.map((x) => ({ id: x.id, ord: x.ord, data: x.data })),
      }),
    }).catch(() => null);
    const okAll = !!r && r.ok;
    setBusy(false);
    setPlan(null);
    setMsg(
      okAll
        ? t(`حُدِّث ${plan.put.length} بنداً.`, `Updated ${plan.put.length}.`)
        : t("تعذّر الحفظ — تحقّق من صلاحيتك على الخطة.", "Save failed."),
    );
    if (okAll) onDone();
  }

  return (
    <div className="op-xl">
      <button className="btn btn-sm" onClick={down}>
        <IconDown size={15} /> {t("تنزيل إكسل", "Download Excel")}
      </button>
      {canEdit && (
        <>
          <button className="btn btn-sm" onClick={() => file.current?.click()}>
            <IconUp size={15} /> {t("رفع إكسل", "Upload Excel")}
          </button>
          <input
            ref={file}
            type="file"
            accept=".xlsx"
            style={{ display: "none" }}
            onChange={(e) => {
              void pick(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </>
      )}
      {msg && <span className="op-xmsg">{msg}</span>}

      {plan && (
        <div className="modal-overlay" onClick={() => setPlan(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="m-h">
              <h3>{t("تحديث الخطة من الملف", "Update from file")}</h3>
              <button className="mx" onClick={() => setPlan(null)} aria-label="close">✕</button>
            </div>
            <div className="op-xsum">
              <b>{plan.put.filter((x) => !x.add).length}</b> {t("بنداً سيُحدَّث", "updated")} ·{" "}
              <b>{plan.put.filter((x) => x.add).length}</b> {t("بنداً جديداً", "new")} ·{" "}
              <b>{plan.same}</b> {t("بلا تغيير", "unchanged")}
            </div>
            <div className="op-xlist">
              {plan.put.slice(0, 40).map((x) => (
                <div className="r" key={x.id}>
                  <i className={x.add ? "add" : ""} />
                  <span>{x.name}</span>
                  <em>{x.add ? t("جديد", "new") : t("تحديث", "update")}</em>
                </div>
              ))}
              {plan.put.length > 40 && (
                <div className="r more">{t(`و${plan.put.length - 40} غيرها…`, "…")}</div>
              )}
            </div>
            {plan.skipped.length > 0 && (
              <div className="op-err">{plan.skipped.slice(0, 5).join(" · ")}</div>
            )}
            <p className="muted" style={{ fontSize: 11, lineHeight: 1.8 }}>
              {t(
                "الرفع لا يحذف شيئاً: بندٌ غائبٌ عن الملف يبقى كما هو في المنصة. والمطابقة بعمود «المعرّف»، فإن حُذف فبـ«المحفظة + البند».",
                "Upload never deletes; rows are matched by id, else by portfolio + item.",
              )}
            </p>
            <div className="m-f">
              <button className="btn btn-ghost" onClick={() => setPlan(null)}>{t("إلغاء", "Cancel")}</button>
              <button className="btn" disabled={busy} onClick={() => void run()}>
                {busy ? t("يُحدَّث…", "Updating…") : t("تحديث الخطة", "Update")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------- بطاقة بند ---------------- */
function OpCard({
  r, canEdit, t, onEdit,
}: {
  r: { id: string; ord: number; data: Rec; updatedAt?: string };
  canEdit: boolean;
  t: T;
  onEdit: () => void;
}) {
  const d = r.data;
  const kind = txt(d.kind);
  const qs = quarters(d);
  const ok = onTrack(d);
  const st = opStatus(d);
  const unit = txt(d.unit) === "عدد" ? "" : "٪";

  return (
    <div className={`op-it ${ok === false ? "off" : ""}`}>
      <span className="t">{txt(d.name)}</span>
      <div className="mt">
        <em>
          {t("الراعي", "Sponsor")} <b>{txt(d.sponsor) || "—"}</b>
        </em>
        {has(d.assignee) && (
          <em>
            {t("المسؤول", "Owner")} <b>{txt(d.assignee)}</b>
          </em>
        )}
        {kind === "kpi" && num(d.level) > 0 && <span className="chip nw">{LEVELS[num(d.level)]}</span>}
        {kind === "init" && has(d.itype) && <span className="chip go">{txt(d.itype)}</span>}
        {st && <span className={`chip ${opTone(st)}`}>{st}</span>}
        {has(d.contributor) && (
          <span className="chip ct" title={t("مساهمة من محفظة موظف", "From a portfolio")}>
            {t(`مساهمة · ${txt(d.contributor)}`, txt(d.contributor))}
          </span>
        )}
        {canEdit && (
          <button className="op-pen" title={t("تعديل", "Edit")} onClick={onEdit}>
            ✎
          </button>
        )}
      </div>

      {kind === "kpi" && (
        <>
          <div className="q4">
            {qs.map((q, i) => {
              const cls = q.a === null ? "" : q.t === null ? "ok" : q.a >= q.t ? "ok" : "bad";
              return (
                <span className={cls} key={i}>
                  Q{i + 1} {q.a === null ? "—" : `${q.a}${unit}`}
                </span>
              );
            })}
          </div>
          {has(d.yearTarget) && (
            <div className="yt">
              {t("المستهدف العام", "Year target")} <b>{num(d.yearTarget)}{unit}</b>
            </div>
          )}
        </>
      )}
      {(has(d.start) || has(d.end)) && (
        <div className="op-dt">
          <span>{t("البداية", "Start")} <b>{txt(d.start) || "—"}</b></span>
          <i />
          <span>{t("النهاية", "End")} <b>{txt(d.end) || "—"}</b></span>
        </div>
      )}
      {has(d.note) && (
        <div className="op-nt">
          {txt(d.note)}
          {(() => {
            const a = agoOf(r.updatedAt);
            return a ? (
              <em className={a.stale ? "old" : ""}>
                {t(`آخر تحديث ${a.txt}`, `Updated ${a.txt}`)}
              </em>
            ) : null;
          })()}
        </div>
      )}
    </div>
  );
}

/* ---------------- نافذة التعديل ---------------- */
function OpEdit({
  it, t, owners, onClose, onSave, onDelete, isNew,
}: {
  it: Item;
  t: T;
  owners: string[];
  onClose: () => void;
  onSave: (d: Rec) => Promise<string | null>;
  /** حذف بندٍ سقط من الخطة — التراجع يعيده من شريط ↩ */
  onDelete: () => Promise<string | null>;
  /** بندٌ لم يُحفَظ بعد: لا حذف، والعنوان يقول «إضافة» */
  isNew?: boolean;
}) {
  const [f, setF] = useState<Rec>({ ...(it.data as Rec) });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const kind = txt(f.kind);
  const set = (k: string, v: unknown) => setF((o) => ({ ...o, [k]: v }));
  const numOrDel = (k: string, v: string) =>
    setF((o) => {
      const n = { ...o };
      if (v.trim() === "") delete n[k];
      else n[k] = Number(v);
      return n;
    });

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="m-h">
          <h3>
            {isNew
              ? t(`${ADD_LABEL[kind] ?? "إضافة بند"} إلى الخطة`, "Add to the plan")
              : t("تعديل بند الخطة", "Edit item")}
          </h3>
          <button className="mx" onClick={onClose} aria-label="close">✕</button>
        </div>

        <div className="op-f">
          <label className="wide">
            <span>{t("البند", "Item")}</span>
            <textarea rows={2} value={txt(f.name)} onChange={(e) => set("name", e.target.value)} />
          </label>
          <label>
            <span>{t("المحفظة", "Portfolio")}</span>
            <select value={txt(f.owner)} onChange={(e) => set("owner", e.target.value)}>
              {owners.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          </label>
          <label>
            <span>{t("الراعي", "Sponsor")}</span>
            <input value={txt(f.sponsor)} onChange={(e) => set("sponsor", e.target.value)} />
          </label>
          <label className="wide">
            <span>{t("المسؤول", "Responsible")}</span>
            <input value={txt(f.assignee)} onChange={(e) => set("assignee", e.target.value)} />
          </label>

          {kind === "kpi" && (
            <>
              <label>
                <span>{t("المستوى", "Level")}</span>
                <select value={num(f.level, 1)} onChange={(e) => set("level", Number(e.target.value))}>
                  {[1, 2, 3].map((n) => (
                    <option key={n} value={n}>{LEVELS[n]}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>{t("الوحدة", "Unit")}</span>
                <select value={txt(f.unit) || "%"} onChange={(e) => set("unit", e.target.value)}>
                  <option value="%">٪</option>
                  <option value="عدد">{t("عدد", "count")}</option>
                </select>
              </label>
              <label>
                <span>{t("المستهدف العام", "Year target")}</span>
                <input type="number" value={has(f.yearTarget) ? num(f.yearTarget) : ""}
                       onChange={(e) => numOrDel("yearTarget", e.target.value)} />
              </label>
            </>
          )}
          {kind === "init" && (
            <label>
              <span>{t("نوع المبادرة", "Type")}</span>
              <select value={txt(f.itype)} onChange={(e) => set("itype", e.target.value)}>
                {INIT_TYPES.map((x) => (
                  <option key={x} value={x}>{x}</option>
                ))}
              </select>
            </label>
          )}
          <label>
            <span>{t("الحالة", "Status")}</span>
            <select value={txt(f.status)} onChange={(e) => set("status", e.target.value)}>
              <option value="">
                {kind === "kpi" ? t("تلقائي من الأرباع", "Auto") : t("— اختر —", "— pick —")}
              </option>
              {statusesOf(kind).map((x) => (
                <option key={x} value={x}>{x}</option>
              ))}
            </select>
          </label>
        </div>

        {kind === "kpi" && (
          <>
            <div className="op-qh">{t("مستهدف وفعلي كل ربع — الفراغ يعني لم يُدخَل بعد", "Quarterly")}</div>
            <div className="op-q">
              {[1, 2, 3, 4].map((i) => (
                <div className="r" key={i}>
                  <b>Q{i}</b>
                  <label>
                    <span>{t("المستهدف", "Target")}</span>
                    <input type="number" value={has(f[`q${i}t`]) ? num(f[`q${i}t`]) : ""}
                           onChange={(e) => numOrDel(`q${i}t`, e.target.value)} />
                  </label>
                  <label>
                    <span>{t("الفعلي", "Actual")}</span>
                    <input type="number" value={has(f[`q${i}a`]) ? num(f[`q${i}a`]) : ""}
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
            <input
              value={txt(f.start)}
              placeholder={t("مثال: 1 يناير 2026م", "e.g. Jan 2026")}
              onChange={(e) => set("start", e.target.value)}
            />
          </label>
          <label>
            <span>{t("تاريخ النهاية", "End")}</span>
            <input
              value={txt(f.end)}
              placeholder={t("مثال: 31 ديسمبر 2026م", "e.g. Dec 2026")}
              onChange={(e) => set("end", e.target.value)}
            />
          </label>
        </div>

        <label className="op-note">
          <span>{t("حالة المساهمة", "Progress")}</span>
          <textarea rows={3} value={txt(f.note)} onChange={(e) => set("note", e.target.value)} />
        </label>

        {err && <div className="op-err">{err}</div>}
        <div className="m-f">
          <button
            className="btn btn-del"
            hidden={isNew}
            disabled={busy}
            onClick={async () => {
              if (!confirm(t(`حذف «${txt(it.data.name)}» من الخطة؟`, "Delete this item?"))) return;
              setBusy(true);
              const e = await onDelete();
              setBusy(false);
              if (e) setErr(e);
            }}
          >
            🗑 {t("حذف البند", "Delete")}
          </button>
          <button className="btn btn-ghost" onClick={onClose}>{t("إلغاء", "Cancel")}</button>
          <button
            className="btn"
            disabled={busy}
            onClick={async () => {
              if (!txt(f.name).trim()) {
                setErr(t("اكتب اسم البند أولاً", "Name is required"));
                return;
              }
              setBusy(true);
              const e = await onSave(f);
              setBusy(false);
              if (e) setErr(e);
            }}
          >
            {isNew ? t("إضافة البند", "Add") : t("حفظ", "Save")}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- بطاقة «نظرة عامة» ---------------- */
export function OpPlanCard({ t, onOpen }: { t: T; onOpen: () => void }) {
  const { items, loaded } = useItems("opplan");
  const rows = useMemo(() => items.map((x) => opFix(x.data as Rec)), [items]);
  if (!loaded || !rows.length) return null;

  const of = (k: string) => rows.filter((d) => txt(d.kind) === k);
  const kpis = of("kpi");
  const good = kpis.filter((d) => onTrack(d) === true).length;
  const bad = kpis.filter((d) => onTrack(d) === false).length;
  const stOf = (k: string, s: string) => of(k).filter((d) => opStatus(d) === s).length;
  const perOwner = OP_OWNERS.map((o) => ({ o, n: rows.filter((d) => txt(d.owner) === o).length }));

  return (
    <div className="op-card" onClick={onOpen} role="button" tabIndex={0}
         onKeyDown={(e) => e.key === "Enter" && onOpen()}>
      <div className="h">
        <h3>{t("الخطة التشغيلية 2026م", "Operational plan 2026")}</h3>
        <span>{t("↩ اضغط للتفاصيل", "Open")}</span>
      </div>
      <div className="n3">
        <div className="k" style={{ ["--c" as string]: KIND_COLOR.kpi }}>
          <b>{kpis.length}</b>
          <span>{t("مؤشراً", "KPIs")}</span>
          <em>{t(`${good} على المسار · ${bad} دون المستهدف`, `${good} on track`)}</em>
        </div>
        <div className="k" style={{ ["--c" as string]: KIND_COLOR.init }}>
          <b>{of("init").length}</b>
          <span>{t("مبادرة", "Initiatives")}</span>
          <em>
            {t(
              `${stOf("init", "مكتملة")} مكتملة · ${stOf("init", "على المسار")} على المسار · ${stOf("init", "متأخرة")} متأخرة`,
              `${stOf("init", "مكتملة")} done`,
            )}
          </em>
        </div>
        <div className="k" style={{ ["--c" as string]: KIND_COLOR.win }}>
          <b>{of("win").length}</b>
          <span>{t("مكاسب سريعة", "Quick wins")}</span>
          <em>
            {t(
              `${stOf("win", "مكتملة")} مكتملة · ${stOf("win", "على المسار")} على المسار · ${stOf("win", "متأخرة")} متأخرة`,
              `${stOf("win", "مكتملة")} done`,
            )}
          </em>
        </div>
      </div>
      <div className="pp">
        {perOwner.map(({ o, n }) => (
          <span className="p" key={o}>
            <i style={{ background: (OWNER_COLOR[o] || "#4e615c") + "1f", color: OWNER_COLOR[o] || "#4e615c" }}>
              {short(o)}
            </i>
            <span>{last(o)}</span>
            <em>{n}</em>
          </span>
        ))}
      </div>
    </div>
  );
}
