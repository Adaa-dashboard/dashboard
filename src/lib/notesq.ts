/* ============================================================
   جودة ملاحظات الأداء — المنطق الخالص
   ------------------------------------------------------------
   صفحةٌ يرفع فيها صاحبُها بيانات الربع: لكل استشاريٍّ عددُ ما
   رُوجع من تقاريره وكم منها طابق معايير جودة الملاحظات. ومنها
   تُشتقّ نسبةُ كلِّ موظفٍ في محفظته، فلا تُدخَل مرّتين.

   **النسبة تُحسب من المجاميع لا من متوسط النسب**: استشاريٌّ له
   صفّان (20 من 20) و(1 من 10) نسبتُه 70% لا 55% — فالصفّ الصغير
   لا يوازن الكبير.

   وما لا بيانات له **صفرٌ لا رقمُ الإدارة**: كان رقم مؤشر الخطة
   التشغيلية يظهر في محفظة كل موظف كأنه رقمه — بطلب صاحبة المنصة.
   ============================================================ */

export type NQRow = { data: Record<string, unknown> };

const txt = (v: unknown) => (v === null || v === undefined ? "" : String(v));
export const nqNrm = (v: unknown) =>
  txt(v)
    .replace(/[ً-ْـ]/g, "")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[\s/\\_-]+/g, " ")
    .trim();

/** رقمٌ من خلية: الفارغ والنصّ غيرُ الرقم = 0 */
export function nqNum(v: unknown): number {
  const n = Number(txt(v).replace(/[٪%,\s]/g, "").replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export type NQStat = { total: number; ok: number; pct: number; rows: number };

/** مجاميع صفوفٍ بعينها — `pct` صفرٌ بلا بيانات */
export function nqTally(rows: NQRow[]): NQStat {
  let total = 0;
  let ok = 0;
  for (const r of rows) {
    total += nqNum(r.data.total);
    ok += nqNum(r.data.ok);
  }
  /* المطابق لا يتجاوز المراجَع: خطأ إدخالٍ لا يرفع النسبة فوق 100 */
  if (ok > total) ok = total;
  return { total, ok, pct: total > 0 ? Math.round((ok / total) * 100) : 0, rows: rows.length };
}

/** صفوف موظفٍ بعينه — بالاسم بعد التوحيد */
export function nqOf(rows: NQRow[], name: string): NQRow[] {
  const me = nqNrm(name);
  if (!me) return [];
  return rows.filter((r) => nqNrm(r.data.consultant) === me);
}

/**
 * نسبة موظفٍ بعينه كما تظهر في محفظته.
 * @returns `null` إن لم يُرفع له صفٌّ أصلاً — فيُفرَّق بين «لا بيانات»
 *          و«صفرٌ مرصود». والمحفظة تعرض 0% في الحالتين كما طُلب،
 *          ويبقى التمييز لمن أراد نصّاً مختلفاً.
 */
export function nqPct(rows: NQRow[], name: string): number | null {
  const mine = nqOf(rows, name);
  if (!mine.length) return null;
  return nqTally(mine).pct;
}

/** كل استشاريٍّ ونسبتُه — لجدول الصفحة وملخّصها */
export function nqByPerson(rows: NQRow[]): { name: string; stat: NQStat }[] {
  const m = new Map<string, { name: string; rows: NQRow[] }>();
  for (const r of rows) {
    const nm = txt(r.data.consultant).trim();
    if (!nm) continue;
    const k = nqNrm(nm);
    const e = m.get(k) || { name: nm, rows: [] };
    e.rows.push(r);
    m.set(k, e);
  }
  return [...m.values()]
    .map((e) => ({ name: e.name, stat: nqTally(e.rows) }))
    .sort((a, b) => b.stat.pct - a.stat.pct || b.stat.total - a.stat.total);
}

/** عنوان عمودٍ في ملف الرفع ← مفتاح الحقل */
export function nqKeyOf(head: string): string {
  const h = nqNrm(head);
  if (!h) return "";
  /* **الأعمدة المعدودة تُفحص قبل الأسماء**: «عدد التقارير المراجَعة»
     يحوي «المراجع» فكان يقع في عمود الاستشاري */
  if (h.includes("مطابق") || h.includes("ممتثل") || h.includes("مستوف")) return "ok";
  if (h.includes("عدد") || h.includes("تقارير") || h.includes("ملاحظات")) return "total";
  if (h.includes("ملاحظه") || h.includes("ملحوظه")) return "note";
  if (h.includes("ربع") || h.includes("فتره")) return "quarter";
  if (h.includes("جهه")) return "entity";
  if (h.includes("استشاري") || h.includes("الموظف") || h.includes("المراجع")) return "consultant";
  return "";
}
