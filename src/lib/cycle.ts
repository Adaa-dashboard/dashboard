/* ============================================================
   دورة التحديث الدوري — المنطق الخالص
   ------------------------------------------------------------
   «التحديث الدوري» زرٌّ يفتح دورةً جديدة في القسم: تُلتقط قائمةُ
   ما يجب تحديثه لحظتَها، ثم يبقى الشريط الأحمر يعرض ما لم يُحدَّث
   منها. ومن حدّث صفّاً من صفوفه خرج من الشريط من نفسه — سواءٌ
   حدّثه الاستشاري أم حدّثه صاحبُ صلاحيةٍ نيابةً عنه، فالمنصة لا
   تسأل من الذي ضغط وإنما هل تغيّر الصفّ بعد بداية الدورة.

   و**الحالة لا تُخزَّن**: المخزون هو بداية الدورة وقائمتُها وما
   حُذف منها يدوياً، و«من لم يحدّث» تُشتقّ من الصفوف نفسها في كل
   فتحة. فلا يبقى في القاعدة رقمٌ يكذب على البيانات.

   هنا لا في الصفحة ليُختبر بلا React ولا شبكة.
   ============================================================ */

export type CycleRow = { id: string; data: Record<string, unknown>; updatedAt?: string };
/** وحدةٌ تُطالَب بالتحديث: استشاريٌّ أو جهةٌ أو استراتيجية */
export type CycleUnit = { k: string; label: string; sub?: string };
export type Cycle = {
  startedAt: string;
  startedBy: string;
  units: CycleUnit[];
  /** ما حُذف من الشريط يدوياً بالـ✕ — لا يُطالَب في هذه الدورة */
  dropped: string[];
};

const txt = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const nrm = (v: string) =>
  String(v || "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي")
    .replace(/[ً-ْ]/g, "").replace(/\s+/g, " ").trim().toLowerCase();

/** قيمةٌ ليست اسماً: «—» · «لا يوجد» · فراغ */
const NOT_A_NAME = /^[-_—–.\s]*$/;
export const realName = (v: unknown) => {
  const x = txt(v).trim();
  return !x || NOT_A_NAME.test(x) || /لا ?يوجد|لم ?يُ?حدَّ?د/.test(x) ? "" : x;
};

/**
 * وحدةُ كل صفّ: الاستشاري إن كان للقسم عمود استشاري وللصفّ اسمٌ
 * فيه، وإلا الصفُّ نفسه باسمه. فالشريط يقول «أسماء الاستشاريين أو
 * الجهات التي لم تحدّث» كما هو في صفحة الجهات.
 */
export function unitOf(r: CycleRow, nameKey: string, byConsultant: boolean): CycleUnit | null {
  const label = realName(r.data.name) || realName(r.data[nameKey]) || realName(r.data.owner);
  if (byConsultant) {
    const c = realName(r.data.consultant);
    if (c) return { k: "c:" + nrm(c), label: c };
  }
  if (!label) return null;
  return { k: "r:" + r.id, label };
}

/** قائمة الوحدات بلا تكرار، بترتيب ظهورها */
export function unitsOf(rows: CycleRow[], nameKey: string, byConsultant: boolean): CycleUnit[] {
  const m = new Map<string, CycleUnit>();
  for (const r of rows) {
    const u = unitOf(r, nameKey, byConsultant);
    if (u && !m.has(u.k)) m.set(u.k, u);
  }
  return [...m.values()];
}

export type Pending = CycleUnit & { done: number; total: number };

/**
 * ما لم يُحدَّث بعد بداية الدورة.
 * @returns `pending` للعرض، و`done` لما اكتمل، و`total` لكل الوحدات
 */
export function pendingOf(
  cycle: Cycle | null,
  rows: CycleRow[],
  nameKey: string,
  byConsultant: boolean,
): { pending: Pending[]; done: number; total: number } {
  if (!cycle) return { pending: [], done: 0, total: 0 };
  const start = Date.parse(cycle.startedAt);
  const dropped = new Set(cycle.dropped || []);
  /* العدّ من الصفوف الحاضرة الآن: صفٌّ حُذف بعد بدء الدورة لا
     يُطالَب به، وصفٌّ أُضيف بعدها لا يُحشر فيها */
  const tally = new Map<string, { done: number; total: number }>();
  for (const r of rows) {
    const u = unitOf(r, nameKey, byConsultant);
    if (!u) continue;
    const e = tally.get(u.k) || { done: 0, total: 0 };
    e.total += 1;
    const at = r.updatedAt ? Date.parse(r.updatedAt) : NaN;
    if (Number.isFinite(at) && Number.isFinite(start) && at >= start) e.done += 1;
    tally.set(u.k, e);
  }

  const pending: Pending[] = [];
  let done = 0;
  const units = (cycle.units || []).filter((u) => !dropped.has(u.k));
  for (const u of units) {
    const e = tally.get(u.k);
    /* وحدةٌ لم يبقَ لها صفٌّ في القسم — حُذفت صفوفها، فلا مطالبة */
    if (!e || e.total === 0) { done += 1; continue; }
    if (e.done >= e.total) { done += 1; continue; }
    pending.push({ ...u, done: e.done, total: e.total });
  }
  return { pending, done, total: units.length };
}
