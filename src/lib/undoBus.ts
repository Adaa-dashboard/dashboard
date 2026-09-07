/* ------------------------------------------------------------
   ناقل التراجع
   --------------
   خطوة التراجع تولد داخل الصفحة (بنود القسم · التكاليف)، وسهم
   التراجع في رأس اللوحة خارجها. بدل تمرير الحالة عبر عشر طبقات،
   تنشر الصفحة آخر خطوة هنا ويقرأها الرأس.

   لكل ناشر مُعرِّف: النشر بـ null لا يمسح إلا خطوة صاحبه، فلا
   تمسح صفحةٌ خطوةَ صفحةٍ أخرى عند إغلاقها.
   المكدّس نفسه يبقى داخل الصفحة — هنا رأسه وحده.
   ------------------------------------------------------------ */

export type UndoEntry = {
  /** حُذف · عُدِّل · أُضيف — لصياغة التلميح */
  kind: "edit" | "add" | "delete";
  /** اسم البند كما يعرفه المستخدم */
  label: string;
  /** ينفّذ التراجع؛ يُرجع نص خطأ إن تعذّر */
  run: () => Promise<string | null | void>;
};

type Slot = { owner: string; entry: UndoEntry } | null;

let cur: Slot = null;
const subs = new Set<() => void>();

/** ينشر آخر خطوة قابلة للتراجع، أو null لإزالة خطوة صاحبها */
export function publishUndo(owner: string, entry: UndoEntry | null) {
  if (!entry) {
    if (!cur || cur.owner !== owner) return;
    cur = null;
  } else {
    if (cur && cur.owner === owner && cur.entry === entry) return;
    cur = { owner, entry };
  }
  for (const f of subs) f();
}

export function subscribeUndo(f: () => void) {
  subs.add(f);
  return () => {
    subs.delete(f);
  };
}

export function undoSnapshot(): Slot {
  return cur;
}

/** على الخادم لا يوجد ناقل — لقطة ثابتة تمنع اختلاف العرض */
export function undoServerSnapshot(): Slot {
  return null;
}
