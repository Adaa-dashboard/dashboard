/* ------------------------------------------------------------
   قراءة ملف طلبات التغيير — **المطابقة والاشتقاق وحدهما**.

   مفصولةٌ عن الصفحة لتُختبر وحدها: الملف يأتي بشكلين — التصدير
   الكامل من منصة الرؤية (36 عموداً، كل الطلبات)، والملف اليومي
   الذي كانت الإدارة تُعدّه بمعادلات إكسل. والنتيجة واحدة.
   ------------------------------------------------------------ */

import { crAtAdaa, crAxisOf, crKindOf, crReviewOf, crSlaOf } from "./crSla";

/* ---------- مطابقة عناوين الأعمدة عربياً ---------- */
export function norm(s: string): string {
  return s
    .replace(/[ً-ْـ]/g, "")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[\s/\\_-]+/g, " ")
    .trim();
}
function digits(s: string): string {
  return s.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
}
export function toNum(s: string): number | null {
  const v = digits(String(s)).replace(/[^\d.-]/g, "");
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export type Field =
  | "code" | "program" | "itemCode" | "itemName" | "owner"
  | "category" | "reviewType" | "classification" | "sla" | "workDays"
  /* أعمدة التصدير الكامل من منصة الرؤية — يُشتقّ منها ما كانت
     الإدارة تكتبه بمعادلاتٍ في الملف اليومي */
  | "initCode" | "initName" | "kpiCode" | "kpiName"
  | "axisCol" | "stage" | "submitted" | "lastAction" | "adaaAt" | "ownerAlt";

/* المطابقة **مرتّبة ومحدَّدة**: التصدير الكامل فيه 36 عموداً،
   وفيه عناوين يتشابه بعضها («الجهة المالكة» و«الجهة المقدمة»،
   «نوع الطلب» و«نوع طلب التغيير الفرعي»). المطابقة المرنة كانت
   تُسنِد العمودَ الخطأ لأن آخر تطابقٍ يغلب. */
const HEADS: [string[], Field][] = [
  [["الرمز"], "code"],
  [["كود المبادره"], "initCode"],
  [["اسم المبادره"], "initName"],
  [["كود المؤشر"], "kpiCode"],
  [["اسم المؤشر"], "kpiName"],
  [["اسم البرنامج", "الاستراتيجيه"], "program"],
  [["الجهه المالكه"], "owner"],
  [["محور الطلب"], "axisCol"],
  [["فئه الطلب"], "category"],
  [["نوع المراجعه"], "reviewType"],
  [["اتفاقيه مستوي الخدمه", "مستوي الخدمه"], "sla"],
  [["ايام"], "workDays"],
  [["تاريخ التقديم"], "submitted"],
  [["تاريخ اخر اجراء"], "lastAction"],
  [["تاريخ الاجراء adaa"], "adaaAt"],
  [["المرحله الحاليه"], "stage"],
  [["تصنيف طلبات التغيير"], "classification"],
  [["كود"], "itemCode"],
];

export function fieldOf(headRaw: string): Field | null {
  const h = norm(headRaw).toLowerCase();
  if (!h) return null;
  for (const [keys, f] of HEADS) if (keys.some((k) => h.includes(k))) return f;
  /* عناوين الملف اليومي القديم — أوسع، وتأتي بعد المحدَّدة.
     «جهة» وحدها تذهب إلى حقلٍ احتياطي: التصدير الكامل فيه
     «الجهة المقدمة للطلب» أيضاً، وهي الجهة الطالبة لا المالكة،
     فكانت تطمس المالكة لأن آخر عمودٍ يغلب */
  if (h.includes("جهه")) return "ownerAlt";
  if (h.includes("فئه")) return "category";
  if (h.includes("نوع")) return "reviewType";
  if (h.includes("تصنيف")) return "classification";
  if (h.includes("اسم")) return "itemName";
  return null;
}

export type Parsed = {
  rows: Record<string, string | number | null>[];
  skipped: number;
  /** التصدير الكامل (فيه «المرحلة الحالية») ⇒ فُلتر على أداء */
  full: boolean;
  /** كم صفاً كان في الملف قبل الفلترة */
  all: number;
};

/** يجد صف العناوين ثم يحوّل ما بعده إلى صفوف بأسماء الحقول */
export function mapRows(grid: string[][]): Parsed {
  let headIdx = -1;
  let map: (Field | null)[] = [];
  for (let i = 0; i < Math.min(grid.length, 20); i++) {
    const m = grid[i].map(fieldOf);
    if (m.includes("code") && m.filter(Boolean).length >= 4) {
      headIdx = i;
      map = m;
      break;
    }
  }
  if (headIdx < 0) return { rows: [], skipped: 0, full: false, all: 0 };

  /* الملف اليومي يسمّي عمودَي المبادرة وعمودَي المؤشر بالاسم
     نفسه («اسم المبادرة / المؤشر» مرّتين)، فالثاني يطمس الأول.
     الترتيب يحسم: الأول للمبادرة والثاني للمؤشر. */
  const seen = new Set<Field>();
  map = map.map((f) => {
    if (!f) return f;
    const dup = seen.has(f);
    seen.add(f);
    if (!dup) return f;
    if (f === "initName") return "kpiName";
    if (f === "initCode") return "kpiCode";
    return null;
  });

  const full = map.includes("stage");
  const raw: Record<string, string | number | null>[] = [];
  let skipped = 0;
  for (let i = headIdx + 1; i < grid.length; i++) {
    const r = grid[i];
    if (!r.some((c) => c.trim() !== "")) continue;
    const o: Record<string, string | number | null> = {};
    map.forEach((f, ci) => {
      if (!f) return;
      const v = (r[ci] ?? "").trim();
      /* عنوانٌ مكرّر في الملف (مثل «اسم المبادرة / المؤشر» مرّتين):
         لا تمسح قيمةً موجودة بخليةٍ فارغة */
      if (v === "" && o[f] !== undefined && o[f] !== "") return;
      o[f] = f === "sla" || f === "workDays" ? toNum(v) : v;
    });
    if (!String(o.code || "").trim()) {
      skipped++;
      continue;
    }
    raw.push(o);
  }

  /* التصدير الكامل: نأخذ ما هو **عند أداء الآن** وحده، ثم نشتقّ
     ما كانت الإدارة تكتبه بمعادلات إكسل (التصنيف · نوع المراجعة
     · اتفاقية مستوى الخدمة). الملف اليومي القديم يمرّ كما هو. */
  const kept = full ? raw.filter((o) => crAtAdaa(o.stage)) : raw;
  const rows = kept.map((o) => {
    const axis = o.classification && String(o.classification).includes("رؤية")
      ? "رؤية 2030"
      : crAxisOf(o.axisCol ?? o.program);
    const kind = crKindOf(o.initName);
    const rv = String(o.reviewType || "");
    const review = rv.includes("جديد") || rv.includes("عاد")
      ? (rv.includes("جديد") ? "طلب جديد" : "إعادة توجيه")
      : crReviewOf(o.submitted, o.lastAction);
    return {
      ...o,
      itemCode: o.itemCode || o.initCode || o.kpiCode || "",
      itemName: o.itemName || o.initName || o.kpiName || "",
      owner: o.owner || o.ownerAlt || "",
      classification: axis,
      reviewType: review,
      kind,
      sla: o.sla != null ? o.sla : crSlaOf(axis, kind, review),
      arrivedAt: String(o.lastAction || o.submitted || "").slice(0, 10),
      adaaAt: String(o.adaaAt || "").slice(0, 10),
    };
  });
  return { rows, skipped, full, all: raw.length };
}

