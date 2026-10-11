/* ------------------------------------------------------------
   التزام طلبات التغيير باتفاقيات مستوى الخدمة — الحسبة وحدها.

   مصدران لا واحد، وهذا جوهر الملف:

   ١) **صفوفٌ مُدخَلة** في `perf_items` تحت `section = 'changes'`
      — أرباعٌ وأشهرٌ وقطاعاتٌ مضت قبل أن تدخل المنصة، أُخذت من
      عرض «لوحة بيانات مؤشر اتفاقيات مستوى الخدمة».
   ٢) **حسبةٌ حيّة** من ملف منصة الرؤية اليومي: كل طلبٍ أُغلق
      يقع في شهرٍ وربعٍ بتاريخ إغلاقه، ويُعدّ ملتزماً إن كانت
      أيام عمله دون مدّته.

   والمُدخَل يسبق المحسوب عند التعارض: الربع الذي أُدخلت نسبته
   رقمٌ معتمدٌ عُرض في اجتماع، فلا تزيحه حسبةٌ تقريبية.

   النسبة **مرجَّحة بعدد الطلبات** لا متوسطَ نِسَب — كما في
   العرض تماماً: مجموع الملتزم ÷ مجموع الطلبات.
   ------------------------------------------------------------ */

export type Rec = Record<string, unknown>;
export type CrRow = { data: Rec };

/** ما يلزم من الطلب للحسبة — لا أكثر، فتعمل الدالة في الاختبار */
export type CrLite = {
  sla: number | null;
  workDays: number | null;
  status: "open" | "closed";
  closedAt?: string;
  lastSeen?: string;
  owner?: string;
};

export type CrStat = { n: number; ok: number; pct: number };
export type CrBand = { min: number; label: string; tone: "ok" | "wt" | "no" };

/* المستهدف 100%، فالنطاقات أضيق من نطاقات جودة الملاحظات */
export const CR_BANDS: CrBand[] = [
  { min: 90, label: "عالٍ", tone: "ok" },
  { min: 70, label: "متوسط", tone: "wt" },
  { min: 0, label: "منخفض", tone: "no" },
];
export const crBand = (pct: number): CrBand =>
  CR_BANDS.find((b) => pct >= b.min) || CR_BANDS[CR_BANDS.length - 1];

export const CR_TONE: Record<string, string> = {
  ok: "#1a9d5c",
  wt: "#e0971a",
  no: "#d34a4a",
};

export const AR_MONTHS = [
  "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
  "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
];
const Q_WORDS = ["الأول", "الثاني", "الثالث", "الرابع"];

const txt = (v: unknown) => (v === null || v === undefined ? "" : String(v));
export const crNrm = (v: unknown) =>
  txt(v)
    .replace(/[ً-ْـ]/g, "")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[\s/\\_-]+/g, " ")
    .trim()
    .toLowerCase();

export function crNum(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const s = txt(v)
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[^\d.-]/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

/* ---------------- الفترات: اسمها وترتيبها ---------------- */

/** تاريخٌ ⇒ [سنة, شهر 1..12] — يقبل ISO وما يبدأ به */
function ymOf(iso: unknown): [number, number] | null {
  const m = txt(iso).match(/(\d{4})-(\d{1,2})/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (!y || mo < 1 || mo > 12) return null;
  return [y, mo];
}

/** «الربع الثاني 2026» من تاريخ */
export function crQOf(iso: unknown): string {
  const ym = ymOf(iso);
  if (!ym) return "";
  return `الربع ${Q_WORDS[Math.floor((ym[1] - 1) / 3)]} ${ym[0]}`;
}

/** «يونيو 2026» من تاريخ */
export function crMOf(iso: unknown): string {
  const ym = ymOf(iso);
  if (!ym) return "";
  return `${AR_MONTHS[ym[1] - 1]} ${ym[0]}`;
}

/** ترتيب ربعٍ مكتوبٍ نصّاً — للفرز والمقارنة */
export function crQOrder(q: string): number {
  const s = crNrm(q);
  const y = Number((s.match(/\d{4}/) || [])[0] || 0);
  let n = Q_WORDS.findIndex((w) => s.includes(crNrm(w))) + 1;
  if (!n) n = Number((s.match(/\bq\s*([1-4])\b/i) || [])[1] || 0);
  return y * 10 + n;
}

/** ترتيب شهرٍ مكتوبٍ نصّاً («يونيو 2026») */
export function crMOrder(m: string): number {
  const s = crNrm(m);
  const y = Number((s.match(/\d{4}/) || [])[0] || 0);
  const n = AR_MONTHS.findIndex((w) => s.includes(crNrm(w))) + 1;
  return y * 100 + n;
}

/* ---------------- الحسبة الحيّة ---------------- */

/**
 * هل أُغلق الطلب ملتزماً؟
 * `1` ملتزم · `0` متأخر · `-1` لا يُحتسب (بلا مدّة أو بلا أيام عمل).
 *
 * **الحكم بآخر «أيام العمل» رأيناها في الملف** — فالطلب يختفي من
 * ملف اليوم فنعدّه مراجَعاً، ولا يصلنا رقمٌ بعده. فانتظام الرفع
 * اليومي شرطُ دقّة هذا الرقم، وانقطاعُه يوماً قد يَعُدّ طلباً
 * أُغلق فيه متأخراً.
 */
export function crClosedOk(c: CrLite): 1 | 0 | -1 {
  if (c.sla == null || c.workDays == null) return -1;
  return c.workDays < c.sla ? 1 : 0;
}

/** تاريخ احتساب الطلب: إغلاقه، وإلا آخر ظهورٍ له */
export const crWhen = (c: CrLite) => txt(c.closedAt) || txt(c.lastSeen);

function tally(list: CrLite[]): CrStat {
  let n = 0, ok = 0;
  for (const c of list) {
    const v = crClosedOk(c);
    if (v < 0) continue;
    n++;
    if (v === 1) ok++;
  }
  return { n, ok, pct: n ? Math.round((ok / n) * 100) : 0 };
}

/* ---------------- الصفوف المُدخَلة ---------------- */

export const crIsQ = (r: CrRow) => txt(r.data.row) === "q";
export const crIsM = (r: CrRow) => txt(r.data.row) === "m";
export const crIsSec = (r: CrRow) => txt(r.data.row) === "sec";

/** نسبةٌ وعددٌ من صفٍّ مُدخَل — النسبة تُحفظ عدداً صحيحاً */
function statOf(r: CrRow): CrStat {
  const n = crNum(r.data.total);
  const pct = Math.max(0, Math.min(100, Math.round(crNum(r.data.pct))));
  return { n, ok: Math.round((pct / 100) * n), pct };
}

export type CrPeriod = {
  /** الاسم كما يُعرض */
  label: string;
  stat: CrStat;
  /** الفرق عن الفترة السابقة — `null` لأوّلها */
  delta: number | null;
  /**
   * مصدر الرقم: مُدخَلٌ في المنصة · محسوبٌ من الملف اليومي ·
   * أو `gap` فترةٌ بينهما لم يُغلق فيها طلبٌ واحد.
   */
  src: "stored" | "live" | "gap";
};

/** رقمُ الفترة المتسلسل — به تُعرف الفجوات بين فترتين */
const seq = (label: string, kind: "q" | "m") =>
  kind === "q"
    ? Math.floor(crQOrder(label) / 10) * 4 + (crQOrder(label) % 10) - 1
    : Math.floor(crMOrder(label) / 100) * 12 + (crMOrder(label) % 100) - 1;

/** اسم الفترة من رقمها المتسلسل */
const nameOfSeq = (n: number, kind: "q" | "m") =>
  kind === "q"
    ? `الربع ${Q_WORDS[n % 4]} ${Math.floor(n / 4)}`
    : `${AR_MONTHS[n % 12]} ${Math.floor(n / 12)}`;

/**
 * الفترات مرتّبةً زمنياً: المُدخَل أولاً ثم ما حسبناه من الطلبات
 * المُغلقة، والمُدخَل يسبق المحسوب في الفترة الواحدة.
 */
function periods(
  stored: CrRow[],
  live: CrLite[],
  kind: "q" | "m",
): CrPeriod[] {
  const nameOf = kind === "q" ? crQOf : crMOf;
  const order = kind === "q" ? crQOrder : crMOrder;
  const field = kind === "q" ? "quarter" : "month";
  const isRow = kind === "q" ? crIsQ : crIsM;

  const out = new Map<string, CrPeriod>();
  for (const r of stored) {
    if (!isRow(r)) continue;
    const label = txt(r.data[field]).trim();
    if (!label) continue;
    out.set(crNrm(label), { label, stat: statOf(r), delta: null, src: "stored" });
  }

  const byLive = new Map<string, { label: string; rows: CrLite[] }>();
  for (const c of live) {
    if (c.status !== "closed") continue;
    const label = nameOf(crWhen(c));
    if (!label) continue;
    const k = crNrm(label);
    const g = byLive.get(k) || { label, rows: [] };
    g.rows.push(c);
    byLive.set(k, g);
  }
  for (const [k, g] of byLive) {
    if (out.has(k)) continue;
    const stat = tally(g.rows);
    if (!stat.n) continue;
    out.set(k, { label: g.label, stat, delta: null, src: "live" });
  }

  const found = [...out.values()].sort((a, b) => order(a.label) - order(b.label));

  /* **الفترة الخالية تظهر بصفر ولا تختفي** — بطلب صاحبة المنصة:
     شهرٌ لم يُغلق فيه طلبٌ كان يُحذف من الخطّ، فيقفز يونيو إلى
     سبتمبر ويبدو أنّهما متجاوران. */
  const list: CrPeriod[] = [];
  for (const x of found) {
    const last = list[list.length - 1];
    if (last) {
      for (let n = seq(last.label, kind) + 1; n < seq(x.label, kind); n++)
        list.push({
          label: nameOfSeq(n, kind),
          stat: { n: 0, ok: 0, pct: 0 },
          delta: null,
          src: "gap",
        });
    }
    list.push(x);
  }

  /* الفرق يقارن بآخر فترةٍ **فيها طلبات** — فالفجوة ليست هبوطاً
     إلى الصفر، ولو حُسبت كذلك لأظهرت تراجعاً لم يقع */
  let prev: number | null = null;
  return list.map((x) => {
    const delta = x.src === "gap" || prev === null ? null : x.stat.pct - prev;
    if (x.src !== "gap") prev = x.stat.pct;
    return { ...x, delta };
  });
}

export const crQuarters = (stored: CrRow[], live: CrLite[]) => periods(stored, live, "q");
export const crMonths = (stored: CrRow[], live: CrLite[]) => periods(stored, live, "m");

/** آخر `n` فتراتٍ — خطُّ «نظرة عامة» متابعةٌ لا أرشيف */
export const crLast = <T,>(list: T[], n: number) => (list.length > n ? list.slice(-n) : list);

/** قيمة قطاعٍ في ربع: الإجمالي ومعه تفصيل النوعين */
export type CrSecVal = {
  pct: number;
  n: number;
  /** رؤية 2030 — `null` إن لم يُدخَل تفصيلها */
  v30: number | null;
  n30: number | null;
  /** الاستراتيجيات الوطنية */
  nat: number | null;
  nnat: number | null;
};

export type CrSector = {
  name: string;
  /** الربع المعروض — `null` إن لم يرد فيه */
  now: CrSecVal | null;
  /** الربع الذي قبله */
  was: CrSecVal | null;
};

/** أي نوعٍ من الطلبات يُعرض: الكل · رؤية 2030 · الاستراتيجيات الوطنية */
export type CrKind = "" | "v30" | "nat";

/**
 * قراءة قيمةٍ بحسب النوع المختار — `null` حين لا تفصيل لذلك
 * النوع في تلك الفترة، فيُعرض العمود مخطَّطاً بـ«—» لا بصفرٍ
 * يُقرأ تراجعاً.
 */
export function crPick(v: CrSecVal | null, kind: CrKind): { pct: number; n: number } | null {
  if (!v) return null;
  if (kind === "") return { pct: v.pct, n: v.n };
  const pct = kind === "v30" ? v.v30 : v.nat;
  if (pct == null) return null;
  const n = (kind === "v30" ? v.n30 : v.nnat) ?? 0;
  return { pct, n };
}

function valOf(r: CrRow): CrSecVal {
  const has = (k: string) => txt(r.data[k]) !== "";
  return {
    n: crNum(r.data.total),
    pct: Math.max(0, Math.min(100, Math.round(crNum(r.data.pct)))),
    v30: has("v30") ? Math.round(crNum(r.data.v30)) : null,
    n30: has("n30") ? crNum(r.data.n30) : null,
    nat: has("nat") ? Math.round(crNum(r.data.nat)) : null,
    nnat: has("nnat") ? crNum(r.data.nnat) : null,
  };
}

/**
 * قطاعات ربعٍ بعينه ومعها الربع الذي قبله — مصدرها الصفوف
 * المُدخَلة وحدها: القطاع يأتي من سجلّ الجهات لا من ملف الطلبات،
 * فلا يُحسب حيّاً هنا.
 */
export function crSectors(stored: CrRow[], quarter: string, prev?: string): CrSector[] {
  const rows = stored.filter(crIsSec);
  const of = (q: string) => rows.filter((r) => crNrm(r.data.quarter) === crNrm(q));
  const before = new Map(
    (prev ? of(prev) : []).map((r) => [crNrm(r.data.sector), { nm: txt(r.data.sector).trim(), v: valOf(r) }]),
  );
  const out: CrSector[] = of(quarter).map((r) => ({
    name: txt(r.data.sector).trim(),
    now: valOf(r),
    was: before.get(crNrm(r.data.sector))?.v || null,
  }));
  /* قطاعٌ كان في السابق ولم يَرِد في المعروض يبقى ظاهراً،
     وإلا بدا كأنه لم يكن */
  for (const [k, x] of before)
    if (!out.some((y) => crNrm(y.name) === k)) out.push({ name: x.nm, now: null, was: x.v });
  return out.sort(
    (a, b) => (b.now?.pct ?? -1) - (a.now?.pct ?? -1) || (b.now?.n ?? 0) - (a.now?.n ?? 0),
  );
}

/**
 * نسبة نوعٍ على مستوى الربع كلّه — مرجَّحةً بعدد طلباته، كما
 * تُحسب نسبة الربع من قطاعاته.
 */
export function crKindTotal(secs: CrSector[], kind: CrKind): CrStat | null {
  let n = 0, ok = 0;
  for (const s of secs) {
    const v = crPick(s.now, kind);
    if (!v || !v.n) continue;
    n += v.n;
    ok += (v.pct / 100) * v.n;
  }
  if (!n) return null;
  return { n, ok: Math.round(ok), pct: Math.round((ok / n) * 100) };
}

/** الربع الذي قبل ربعٍ مكتوبٍ نصّاً */
export function crPrevQ(q: string): string {
  const o = crQOrder(q);
  if (!o) return "";
  const y = Math.floor(o / 10);
  const n = o % 10;
  return n > 1 ? `الربع ${Q_WORDS[n - 2]} ${y}` : `الربع ${Q_WORDS[3]} ${y - 1}`;
}
