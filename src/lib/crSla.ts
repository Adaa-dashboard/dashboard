/* ------------------------------------------------------------
   اتفاقية مستوى الخدمة لمراجعة طلبات التغيير — **القواعد وحدها**.

   مأخوذةٌ حرفياً من معادلات الملف اليومي الذي تُعدّه الإدارة،
   فينتقل الحساب من إكسل إلى المنصة بلا تغيير في المعنى:

     نوع المراجعة = IF(تاريخ آخر إجراء = تاريخ التقديم ؛ طلب جديد ؛ إعادة توجيه)
     التصنيف      = IF(محور الطلب فيه «برنامج» ؛ رؤية 2030 ؛ استراتيجية وطنية)
     الاتفاقية    = حسب المصفوفة أدناه، والنوع يُعرف من **اسم المبادرة**:
                    فارغٌ ⇒ الطلب على مؤشر، ممتلئٌ ⇒ على مبادرة

   و«أيام العمل» ليست حسبةً عندنا: منصة الرؤية تكتبها في عمود
   «آخر إجراء تم منذ (بالأيام)» — تحقّقنا أنها أيام عمل تستبعد
   الجمعة والسبت. والملف مفلترٌ على المرحلة «مركز أداء (مقيم)»،
   فالعدد هو **مدة جلوس الطلب عند أداء** لا عمر الطلب كله.
   ------------------------------------------------------------ */

export type CrAxis = "رؤية 2030" | "استراتيجية وطنية";
export type CrKind = "مبادرة" | "مؤشر";
export type CrReview = "طلب جديد" | "إعادة توجيه";

/** المرحلة التي تعني أن الطلب **عند أداء الآن** */
export const CR_ADAA_STAGE = "مركز أداء (مقيم)";

/** مصفوفة المدد: [الجولة الأولى، بعد إعادة التوجيه] */
export const CR_SLA: Record<CrAxis, Record<CrKind, [number, number]>> = {
  "رؤية 2030": { مبادرة: [7, 5], مؤشر: [5, 3] },
  "استراتيجية وطنية": { مبادرة: [5, 3], مؤشر: [3, 2] },
};

const nrm = (v: unknown) =>
  String(v ?? "")
    .replace(/[ً-ْـ]/g, "")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim();

/** المرحلة الحالية تعني «عند أداء» — المطابقة بالمعنى لا بالحرف */
export function crAtAdaa(stage: unknown): boolean {
  const s = nrm(stage);
  return s.includes("مركز اداء") || s.includes("اداء (مقيم)");
}

/** محور الطلب فيه «برنامج» ⇒ رؤية 2030، وما عداه استراتيجية وطنية */
export function crAxisOf(axisCol: unknown): CrAxis {
  return nrm(axisCol).includes("برنامج") ? "رؤية 2030" : "استراتيجية وطنية";
}

/** اسم المبادرة فارغ ⇒ الطلب على مؤشر */
export function crKindOf(initiativeName: unknown): CrKind {
  return String(initiativeName ?? "").trim() ? "مبادرة" : "مؤشر";
}

/** تاريخ آخر إجراء = تاريخ التقديم ⇒ لم يتحرّك بعد ⇒ طلب جديد.
    المعادلة في إكسل تقارن القيمتين كاملتين بالثانية، فنقارن مثلها
    متى حمل الحقلان وقتاً؛ وإن كانا تاريخين مجرّدين فباليوم. */
export function crReviewOf(submitted: unknown, lastAction: unknown): CrReview {
  const a = String(submitted ?? "").trim();
  const b = String(lastAction ?? "").trim();
  if (!b) return "طلب جديد";
  const timed = a.length > 10 && b.length > 10;
  const same = timed ? a === b : a.slice(0, 10) === b.slice(0, 10);
  return same ? "طلب جديد" : "إعادة توجيه";
}

export function crSlaOf(axis: CrAxis, kind: CrKind, review: CrReview): number {
  return CR_SLA[axis][kind][review === "طلب جديد" ? 0 : 1];
}

/** أيام العمل بين تاريخين — الأحد إلى الخميس، كما تحسبها المنصة.
    تُستعمل حين يُغلق الطلب فنحتاج المدة بين وصوله وإجراء أداء. */
export function crWorkDays(fromISO: string, toISO: string): number | null {
  const a = new Date(`${String(fromISO).slice(0, 10)}T00:00:00Z`);
  const b = new Date(`${String(toISO).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(+a) || Number.isNaN(+b) || b < a) return null;
  let n = 0;
  const x = new Date(a);
  while (x < b) {
    x.setUTCDate(x.getUTCDate() + 1);
    const w = x.getUTCDay(); // 5 = الجمعة · 6 = السبت
    if (w !== 5 && w !== 6) n++;
  }
  return n;
}

/** ملتزم = أيام العمل لم تتجاوز المدة */
export function crOnTime(days: number | null, sla: number | null): boolean | null {
  if (days == null || sla == null) return null;
  return days <= sla;
}

/** ربع التاريخ بصيغة «الربع الثاني 2026» — كما تُسمّى في الصفحة */
const Q_WORDS = ["الأول", "الثاني", "الثالث", "الرابع"];
export function crQuarterOf(iso: string): string {
  const d = String(iso || "").slice(0, 10);
  const m = Number(d.slice(5, 7));
  if (!m) return "";
  return `الربع ${Q_WORDS[Math.floor((m - 1) / 3)]} ${d.slice(0, 4)}`;
}
