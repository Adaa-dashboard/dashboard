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
/** كل كم تُفتح نافذةٌ جديدة — أو مدّةٌ محدّدة لا تتكرّر */
export type Every = "daily" | "weekly" | "monthly" | "range";
export const EVERY_AR: Record<Every, string> = {
  daily: "يومي",
  weekly: "أسبوعي",
  monthly: "شهري",
  range: "فترة محدّدة",
};
export type Cycle = {
  /** بدء الفترة — ومنه تُحسب النوافذ المتعاقبة */
  startedAt: string;
  startedBy: string;
  every?: Every;
  /** في `range` وحدها: أوّل الفترة وآخرها (YYYY-MM-DD) */
  from?: string;
  to?: string;
  units: CycleUnit[];
  /** ما حُذف من الشريط بالـ✕ — ومعه وقتُه، فيعود الاسم مع كل نافذةٍ
      جديدة. ولولا الوقت لبقي محذوفاً إلى الأبد. */
  dropped: { k: string; at: string }[];
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

const DAY = 86400000;

/**
 * **بداية النافذة الحالية** — والدورة تتجدّد من نفسها: «كل شهر»
 * يعني أن الجميع يُطالَبون من جديد مع كل شهرٍ يمرّ، بلا أن يضغط
 * أحدٌ زرّاً. وبلا `every` نافذةٌ واحدة تبدأ من `startedAt`.
 */
export function windowStart(c: Cycle, now = Date.now()): number {
  const t0 = Date.parse(c.every === "range" ? c.from || c.startedAt : c.startedAt);
  if (!Number.isFinite(t0) || now <= t0) return t0;
  if (c.every === "daily") return t0 + Math.floor((now - t0) / DAY) * DAY;
  if (c.every === "weekly") return t0 + Math.floor((now - t0) / (7 * DAY)) * 7 * DAY;
  if (c.every === "monthly") {
    /* بالتقويم لا بـ30 يوماً: من بدأ في 31 يناير تقع نافذته التالية
       في آخر فبراير، فلا تنزلق البداية شهراً بعد شهر */
    const d = new Date(t0);
    let at = new Date(t0);
    for (let i = 1; ; i++) {
      const nx = new Date(t0);
      nx.setMonth(d.getMonth() + i);
      /* شهرٌ أقصر من يوم البداية ⇒ يُشدّ إلى آخر يومٍ فيه */
      if (nx.getDate() !== d.getDate()) nx.setDate(0);
      if (nx.getTime() > now) break;
      at = nx;
      if (i > 600) break;
    }
    return at.getTime();
  }
  return t0;
}

/** هل الفترة مفتوحة الآن؟ — `range` تُغلق بانقضاء آخرها */
export function isOpen(c: Cycle | null, now = Date.now()): boolean {
  if (!c) return false;
  if (c.every !== "range") return true;
  const to = c.to ? Date.parse(c.to) : NaN;
  const from = Date.parse(c.from || c.startedAt);
  if (Number.isFinite(from) && now < from) return false;
  /* `to` يومٌ كامل: تنتهي الفترة بنهايته لا بأوّله */
  return !Number.isFinite(to) || now <= to + DAY;
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
  now = Date.now(),
): { pending: Pending[]; done: number; total: number } {
  if (!cycle || !isOpen(cycle, now)) return { pending: [], done: 0, total: 0 };
  const start = windowStart(cycle, now);
  /* المحذوف يعود مع كل نافذةٍ جديدة — فحذفُه إعفاءٌ لهذه النافذة
     لا شطبٌ دائم */
  const dropped = new Set(
    (cycle.dropped || []).filter((d) => Date.parse(d.at) >= start).map((d) => d.k),
  );
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

/* ------------------------------------------------------------
   ما يخصّني من المطالَبات — لتنبيه الجرس
   ------------------------------------------------------------
   «إذا بدأ التحديث يجي تنبيه لكل الموظفين اللي عندهم جهات لها
   علاقة بالقسم». و«جهاته» صفٌّ هو استشاريُّه، أو صفٌّ جهتُه من
   جهاته التي هو نقطةُ تواصلها الأساسية.

   والناتج مشتقٌّ من الحالة القائمة: متى حدّث صفوفَه أو أُنهيت
   الفترة (فحُذف سطرُها) خلا الناتج من نفسه — فلا تنبيهٌ يُشطب
   ولا رسالةٌ تُنظَّف.
   ------------------------------------------------------------ */

/** أعمدةُ الجهة في الأقسام الخمسة — أيُّها طابق جهاتي فالصفُّ لي */
const ENT_KEYS = ["entity", "owner", "name", "sector"];

export function myPending(
  cycle: Cycle | null,
  rows: CycleRow[],
  nameKey: string,
  byConsultant: boolean,
  meName: string,
  mineNames: Set<string>,
  /* **مُوحِّد أسماء الجهات يأتي من حيث أتت `mineNames`**: الأسماء
     تُوحَّد هناك بـ`lib/commit` لا بـ`nrm` هذه — وهذه لا تُمسّ،
     فمنها تُبنى مفاتيح الوحدات المحفوظة في القاعدة. */
  entNrm: (v: unknown) => string = (v) => nrm(txt(v)),
  now = Date.now(),
): Pending[] {
  const { pending } = pendingOf(cycle, rows, nameKey, byConsultant, now);
  if (!pending.length) return [];
  const me = nrm(meName);
  /* الوحدةُ الاستشارية باسمي — وإن لم يبقَ لي صفٌّ باسم جهة */
  const keys = new Set<string>(me ? ["c:" + me] : []);
  for (const r of rows) {
    const u = unitOf(r, nameKey, byConsultant);
    if (!u) continue;
    const c = nrm(txt(r.data.consultant));
    const mine =
      (!!c && !!me && c === me) ||
      ENT_KEYS.some((k) => {
        const v = entNrm(r.data[k]);
        return !!v && mineNames.has(v);
      });
    if (mine) keys.add(u.k);
  }
  return pending.filter((u) => keys.has(u.k));
}
