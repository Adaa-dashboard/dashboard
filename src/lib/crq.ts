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
  /** مصدر الرقم: مُدخَلٌ في المنصة أم محسوبٌ من الملف اليومي */
  src: "stored" | "live";
};

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

  const list = [...out.values()].sort((a, b) => order(a.label) - order(b.label));
  return list.map((x, i) => ({
    ...x,
    delta: i === 0 ? null : x.stat.pct - list[i - 1].stat.pct,
  }));
}

export const crQuarters = (stored: CrRow[], live: CrLite[]) => periods(stored, live, "q");
export const crMonths = (stored: CrRow[], live: CrLite[]) => periods(stored, live, "m");

/** آخر `n` فتراتٍ — خطُّ «نظرة عامة» متابعةٌ لا أرشيف */
export const crLast = <T,>(list: T[], n: number) => (list.length > n ? list.slice(-n) : list);

export type CrSector = {
  name: string;
  stat: CrStat;
  /** نسبة الربع السابق — `null` إن لم يُدخَل */
  was: CrStat | null;
  /** التفصيل حين يُدخَل: رؤية 2030 · الاستراتيجيات الوطنية */
  v30: number | null;
  nat: number | null;
};

/**
 * قطاعات ربعٍ بعينه ومعها الربع الذي قبله — مصدرها الصفوف
 * المُدخَلة وحدها: القطاع يأتي من سجلّ الجهات لا من ملف الطلبات،
 * فلا يُحسب حيّاً هنا.
 */
export function crSectors(stored: CrRow[], quarter: string, prev?: string): CrSector[] {
  const rows = stored.filter(crIsSec);
  const of = (q: string) =>
    rows.filter((r) => crNrm(r.data.quarter) === crNrm(q));
  const now = of(quarter);
  const before = new Map(
    (prev ? of(prev) : []).map((r) => [crNrm(r.data.sector), statOf(r)]),
  );
  const out: CrSector[] = now.map((r) => ({
    name: txt(r.data.sector).trim(),
    stat: statOf(r),
    was: before.get(crNrm(r.data.sector)) || null,
    v30: txt(r.data.v30) === "" ? null : Math.round(crNum(r.data.v30)),
    nat: txt(r.data.nat) === "" ? null : Math.round(crNum(r.data.nat)),
  }));
  /* قطاعٌ كان في السابق ولم يَرِد في المعروض يبقى ظاهراً بـ«—»،
     وإلا بدا كأنه لم يكن */
  for (const [k, st] of before)
    if (!out.some((x) => crNrm(x.name) === k)) {
      const r = (prev ? of(prev) : []).find((y) => crNrm(y.data.sector) === k);
      out.push({ name: txt(r?.data.sector).trim(), stat: { n: 0, ok: 0, pct: 0 }, was: st, v30: null, nat: null });
    }
  return out.sort((a, b) => b.stat.pct - a.stat.pct || b.stat.n - a.stat.n);
}

/** الربع الذي قبل ربعٍ مكتوبٍ نصّاً */
export function crPrevQ(q: string): string {
  const o = crQOrder(q);
  if (!o) return "";
  const y = Math.floor(o / 10);
  const n = o % 10;
  return n > 1 ? `الربع ${Q_WORDS[n - 2]} ${y}` : `الربع ${Q_WORDS[3]} ${y - 1}`;
}
