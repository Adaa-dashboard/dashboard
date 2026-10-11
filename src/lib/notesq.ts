/* ============================================================
   جودة ملاحظات الأداء — المنطق الخالص
   ------------------------------------------------------------
   «مراجعة ملاحظات الأداء» دورةٌ ربعية: تُقيَّم ملاحظاتُ كل عنصرٍ
   متعثر (مؤشر أو مبادرة) على أربعة معايير، ومنها تُشتقّ نسبةُ
   الجهة والقطاع والإدارة.

   **النسبة الكلية ليست متوسط المعايير** — وهذا أهمّ ما في الملف:
   معايير الربع الثاني كانت 90 · 96 · 98 · 91 ومتوسطها 94%، بينما
   النسبة المعلنة 79%. لأن العنصر لا يُحتسب ملتزماً إلا إن استوفى
   **المعايير الأربعة كلَّها**، فحاصل ضربها لا جمعُها
   (0.90×0.96×0.98×0.91 ≈ 0.77) هو ما يقارب 79%.

   و**الترجيح بعدد العناصر لا بعدد الجهات**: تحقّقٌ من أرقام العرض
   نفسه — (69×93 + 114×90 + 69×83 + 306×70) ÷ 558 = 78.5 ≈ 79%.
   فجهةٌ لها عنصرٌ واحد لا توازن جهةً لها مئة.

   ------------------------------------------------------------
   والصفّ يأتي على صورتين، فالملف قد يكون هذا أو ذاك:

     · **صفُّ عنصر** — فيه `c1..c4` علاماتُ المعايير الأربعة.
       وزنُه واحد، ويُحتسب ملتزماً إن استوفى الأربعة.
     · **صفُّ جهة** — فيه `total` عددُ عناصرها و`ok` (أو `pct`)
       ما التزم منها. وزنُه عدد عناصره.

   فأيّهما وصل عمل، ويصحّ خلطهما في الربع الواحد.
   ============================================================ */

export type Rec = Record<string, unknown>;
export type NQRow = { data: Rec };

/** المعايير الأربعة بترتيبها المعتمد */
export const NQ_CRITERIA = [
  "وصف التحدي",
  "تصنيف التحدي",
  "الإجراء التصحيحي",
  "تاريخ الإجراء التصحيحي",
];
export const NQ_CKEYS = ["c1", "c2", "c3", "c4"];
/** نسبة كل معيار في صفّ الجهة — حين لا تكون العلامات مفصَّلة */
export const NQ_PKEYS = ["p1", "p2", "p3", "p4"];

/** النطاقات الثلاثة كما في العرض المعتمد */
export type NQBand = { min: number; label: string; tone: "ok" | "wt" | "no" };
export const NQ_BANDS: NQBand[] = [
  { min: 90, label: "عالٍ", tone: "ok" },
  { min: 70, label: "متوسط", tone: "wt" },
  { min: 0, label: "منخفض", tone: "no" },
];
export const nqBand = (pct: number): NQBand =>
  NQ_BANDS.find((b) => pct >= b.min) || NQ_BANDS[NQ_BANDS.length - 1];

const txt = (v: unknown) => (v === null || v === undefined ? "" : String(v));
export const nqNrm = (v: unknown) =>
  txt(v)
    .replace(/[ً-ْـ]/g, "")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[\s/\\_-]+/g, " ")
    .trim();

/** رقمٌ من خلية — الأرقام الهندية وعلامة ٪ والفواصل تُقبل */
export function nqNum(v: unknown): number {
  const s = txt(v)
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[٪%,\s]/g, "");
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/* علامة المعيار: ما يُقبل «نعم» وما يُقبل «لا» — ويُترك ما سواهما
   مجهولاً فلا يُحسب التزاماً بالخطأ */
const YES = new Set(["نعم", "1", "✅", "✔", "✓", "☑", "صح", "y", "yes", "true", "مطابق", "ملتزم"]);
const NO = new Set(["", "لا", "0", "—", "-", "–", "n", "no", "false", "غير مطابق", "غير ملتزم"]);
/** `1` مستوفٍ · `0` غير مستوفٍ · `-1` قيمةٌ لا تُفهم */
export function nqCheck(v: unknown): 1 | 0 | -1 {
  const s = nqNrm(v).toLowerCase();
  if (YES.has(s)) return 1;
  if (NO.has(s)) return 0;
  return -1;
}

/* ---------------- نوع الصفّ ---------------- */
/** صفُّ ملاحظةٍ من المقيِّمين — لا يدخل أي حساب */
export const nqIsObs = (r: NQRow) => txt(r.data.row) === "obs";
/** صفُّ عنصر: فيه علامةُ معيارٍ واحدٍ على الأقل */
export const nqIsItem = (r: NQRow) =>
  !nqIsObs(r) && NQ_CKEYS.some((k) => nqCheck(r.data[k]) >= 0 && txt(r.data[k]) !== "");

/** وزن الصفّ = عدد العناصر التي يمثّلها */
export function nqWeight(r: NQRow): number {
  if (nqIsObs(r)) return 0;
  if (nqIsItem(r)) return 1;
  return nqNum(r.data.total);
}

/** ما التزم من عناصر الصفّ */
export function nqOk(r: NQRow): number {
  if (nqIsObs(r)) return 0;
  if (nqIsItem(r)) {
    /* **الأربعة كلُّها**: معيارٌ واحد غير مستوفٍ يُسقط العنصر.
       والمجهول (`-1`) يُعدّ غير مستوفٍ فلا تُرفع النسبة بلا سند. */
    return NQ_CKEYS.every((k) => nqCheck(r.data[k]) === 1) ? 1 : 0;
  }
  const tot = nqNum(r.data.total);
  if (txt(r.data.ok) !== "") return Math.min(nqNum(r.data.ok), tot);
  /* **لا يُقرَّب هنا**: صفٌّ يقول «93% من 69» يعني 64.17 عنصراً،
     وتقريبُه في كل صفٍّ يُراكم الخطأ حتى يقلب النسبة الكلية
     (أرقام الربع الثاني تعطي 78% بدل 79%). التقريب عند العرض وحده. */
  if (txt(r.data.pct) !== "") return Math.min((nqNum(r.data.pct) / 100) * tot, tot);
  return 0;
}

/** ما استوفى المعيار رقم `i` (0..3) من عناصر الصفّ */
export function nqOkOf(r: NQRow, i: number): number {
  if (nqIsObs(r)) return 0;
  if (nqIsItem(r)) return nqCheck(r.data[NQ_CKEYS[i]]) === 1 ? 1 : 0;
  const tot = nqNum(r.data.total);
  const p = r.data[NQ_PKEYS[i]];
  if (txt(p) !== "") return Math.min((nqNum(p) / 100) * tot, tot);
  /* صفُّ جهةٍ بلا تفصيلٍ للمعايير: لا يُنسب إليه معيارٌ بعينه */
  return -1;
}

export type NQStat = { n: number; ok: number; pct: number };
const stat = (n: number, ok: number): NQStat => ({
  n,
  ok,
  pct: n > 0 ? Math.round((ok / n) * 100) : 0,
});

/** مجاميع صفوف — `pct` صفرٌ بلا بيانات */
export function nqTally(rows: NQRow[]): NQStat {
  let n = 0;
  let ok = 0;
  for (const r of rows) {
    n += nqWeight(r);
    ok += nqOk(r);
  }
  return stat(n, ok);
}

/** نسبة كل معيارٍ من المعايير الأربعة — تتجاهل ما لا تفصيل فيه */
export function nqCriteria(rows: NQRow[]): { name: string; stat: NQStat | null }[] {
  return NQ_CRITERIA.map((name, i) => {
    let n = 0;
    let ok = 0;
    for (const r of rows) {
      const got = nqOkOf(r, i);
      if (got < 0) continue;
      n += nqWeight(r);
      ok += got;
    }
    return { name, stat: n > 0 ? stat(n, ok) : null };
  });
}

/** تجميعٌ على عمود — القطاع أو الجهة */
export function nqGroup(rows: NQRow[], key: string): { name: string; stat: NQStat }[] {
  const m = new Map<string, { name: string; rows: NQRow[] }>();
  for (const r of rows) {
    if (nqIsObs(r)) continue;
    const nm = txt(r.data[key]).trim();
    if (!nm) continue;
    const k = nqNrm(nm);
    const e = m.get(k) || { name: nm, rows: [] };
    e.rows.push(r);
    m.set(k, e);
  }
  return [...m.values()]
    .map((e) => ({ name: e.name, stat: nqTally(e.rows) }))
    .sort((a, b) => b.stat.pct - a.stat.pct || b.stat.n - a.stat.n);
}

/* ---------------- الأرباع ---------------- */
const Q_WORDS = ["الأول", "الثاني", "الثالث", "الرابع"];
/** ترتيبُ ربعٍ مكتوبٍ نصّاً («الربع الثاني 2025») — للفرز والمقارنة */
export function nqQOrder(q: string): number {
  const s = nqNrm(q);
  const y = Number((s.match(/\d{4}/) || [])[0] || 0);
  let n = Q_WORDS.findIndex((w) => s.includes(nqNrm(w))) + 1;
  if (!n) n = Number((s.match(/\bq\s*([1-4])\b/i) || [])[1] || 0);
  return y * 10 + n;
}

/** كل ربعٍ ونسبتُه، بترتيبه الزمني — ومعه فرقُه عن سابقه */
export function nqQuarters(rows: NQRow[]): { q: string; stat: NQStat; delta: number | null }[] {
  const g = nqGroup(rows, "quarter").sort((a, b) => nqQOrder(a.name) - nqQOrder(b.name));
  return g.map((x, i) => ({
    q: x.name,
    stat: x.stat,
    delta: i === 0 ? null : x.stat.pct - g[i - 1].stat.pct,
  }));
}

/** صفوف ربعٍ بعينه */
export const nqOfQuarter = (rows: NQRow[], q: string): NQRow[] =>
  rows.filter((r) => nqNrm(r.data.quarter) === nqNrm(q));

/* ---------------- أبرز المشاهدات ---------------- */
export type NQObs = { criterion: string; text: string; pct: number };

/**
 * ملاحظات المقيمين لكل معيار.
 * تُشتقّ من أسباب صفوف العناصر (`r1..r4`) إن وُجدت، وإلا تُقرأ من
 * صفوف الملاحظات المُدخَلة يدوياً (`row: "obs"`). والنسبة نسبةُ
 * تكرار السبب **داخل معياره** لا من كل العناصر.
 */
export function nqObs(rows: NQRow[]): { name: string; list: NQObs[] }[] {
  const RK = ["r1", "r2", "r3", "r4"];
  return NQ_CRITERIA.map((name, i) => {
    const cnt = new Map<string, { text: string; n: number }>();
    let tot = 0;
    for (const r of rows) {
      if (nqIsObs(r) || !nqIsItem(r)) continue;
      const why = txt(r.data[RK[i]]).trim();
      if (!why) continue;
      const k = nqNrm(why);
      const e = cnt.get(k) || { text: why, n: 0 };
      e.n += 1;
      tot += 1;
      cnt.set(k, e);
    }
    if (tot > 0) {
      const list = [...cnt.values()]
        .map((e) => ({ criterion: name, text: e.text, pct: Math.round((e.n / tot) * 100) }))
        .sort((a, b) => b.pct - a.pct);
      return { name, list };
    }
    /* لا أسباب في البيانات ⇒ الملاحظات المكتوبة يدوياً */
    const manual = rows
      .filter((r) => nqIsObs(r) && nqNrm(r.data.criterion) === nqNrm(name))
      .map((r) => ({ criterion: name, text: txt(r.data.text), pct: nqNum(r.data.pct) }))
      .sort((a, b) => b.pct - a.pct);
    return { name, list: manual };
  });
}

/* ---------------- ما يخصّ موظفاً بعينه ---------------- */
/**
 * نسبة الموظف = مجاميع **جهاته** — لا عمود استشاريٍّ في الملف.
 * فالمنصة تعرف من يتولّى كل جهة من سجلّ الجهات، ولا يُكتب اسمٌ
 * مرّتين ولا يختلف إملاؤه.
 * @returns `null` إن لم تكن لجهاته صفوفٌ في هذا الربع
 */
export function nqForEntities(rows: NQRow[], names: Iterable<string>): NQStat | null {
  const mine = new Set([...names].map((x) => nqNrm(x)).filter(Boolean));
  if (!mine.size) return null;
  const sub = rows.filter((r) => !nqIsObs(r) && mine.has(nqNrm(r.data.entity)));
  if (!sub.length) return null;
  return nqTally(sub);
}

/* ---------------- عناوين ملف الرفع ---------------- */
/** عنوان عمودٍ ← مفتاح الحقل. يُطابق صيغتَي الملف معاً */
export function nqKeyOf(head: string): string {
  const h = nqNrm(head).toLowerCase();
  if (!h) return "";
  /* **السبب قبل اسم المعيار**: «سبب عدم مطابقة وصف التحدي» يحوي
     اسم معياره، فلو فُحص المعيار أولاً لوقع السبب في خانة العلامة */
  if (h.includes("سبب") || h.includes("ملاحظه المقيم") || h.includes("ملاحظات المقيم")) {
    if (h.includes("تصنيف")) return "r2";
    if (h.includes("تاريخ")) return "r4";
    if (h.includes("اجراء")) return "r3";
    return "r1";
  }
  /* المعايير الأربعة — أسماؤها تحوي كلماتٍ عامة كـ«تاريخ» فتُفحص
     مزدوجةً لا مفردة */
  if (h.includes("وصف") && h.includes("تحدي")) return "c1";
  if (h.includes("تصنيف") && h.includes("تحدي")) return "c2";
  if (h.includes("تاريخ") && h.includes("اجراء")) return "c4";
  if (h.includes("اجراء") && h.includes("تصحيح")) return "c3";
  if (h.includes("ربع") || h.includes("فتره")) return "quarter";
  if (h.includes("قطاع")) return "sector";
  if (h.includes("جهه") || h.includes("جهاز")) return "entity";
  if (h.includes("نسبه") && h.includes("التزام")) return "pct";
  if (h.includes("ملتزم") || h.includes("مطابق") || h.includes("مستوف")) return "ok";
  if (h.includes("عدد") || h.includes("العناصر")) return "total";
  if (h.includes("نوع")) return "kind";
  if (h.includes("اسم") || h.includes("المؤشر") || h.includes("المبادره")) return "name";
  return "";
}
