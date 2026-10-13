/* ============================================================
   بناء «الإنجاز الأسبوعي» بشكله الجديد: بطاقةٌ لكل مجال.

   التقرير مجالات لا أنواع منجزات: حالة التكليفات · الاستراتيجيات
   الوطنية · المؤسسية · جلسات مراجعة الأداء · تجربة المستفيد ·
   المشاريع · مراجعة طلبات التغيير. وداخل كل بطاقة:

     • **رقم الأسبوع** — ما تحرّك فيها هذه الأسبوع (من سجلّ التغييرات)
     • **حلقة الحالة** — أين تقف المحفظة كلها الآن (للوطنية والمؤسسية)
     • **الأسماء** — البنود التي وقع عليها المنجز

   القاعدة الحاكمة: **المجال بلا تحديث لا يظهر إطلاقاً** — لا بطاقة
   فارغة ولا صفر. وما تراه في التقرير وقع فعلاً هذا الأسبوع.
   ============================================================ */

import {
  achFromLog,
  achChanges,
  type Ach,
  type ChangeLite,
  type ContactLite,
  type LogRow,
  type TaskLite,
} from "./achievements";

export type Rec = Record<string, unknown>;
export type ItemLite = { id: string; data: Rec };

/* ---------------- أدوات ---------------- */
const txt = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const num = (v: unknown, d = 0) => {
  const n = Number(txt(v).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : d;
};
const day = (iso: string) => txt(iso).slice(0, 10);
const inRange = (iso: string, a: string, b: string) => {
  const d = day(iso);
  return !!d && d >= a && d <= b;
};

/** مراحل اعتماد الاستراتيجية الوطنية — كما في صفحة القسم */
export const NAT_STEPS = [
  "طور الإعداد/التحديث",
  "قيد المراجعة",
  "معتمدة من اللجنة",
  "معتمدة من مجلس الوزراء",
];
/** مسار الجهة في الاستراتيجيات المؤسسية */
export const INST_STAGES = [
  "وصلت المركز",
  "قيد المراجعة",
  "معالجة الملاحظات",
  "اعتُمدت",
  "فُعِّل القياس",
];

/* تدرّج لوني واحد: الأخضر للمنجَز ثم يفتح، والذهبي للمتأخر،
   والرمادي لما لم يبدأ — فالحلقة تُقرأ بلا أسطورة أيضاً */
const RAMP = ["#d7e2de", "#9ecdbb", "#5bb594", "#1b9c74", "#0b6b50"];

/* ---------------- أنواع المخرجات ---------------- */
export type Slice = { label: string; n: number; color: string };
export type Bar = { name: string; pct: number; late: boolean };
export type Stat = { n: number; label: string; tone: "ok" | "warn" | "mute"; icon?: string };
export type Line = { name: string; detail?: string };

export type Dom = {
  k: string;
  title: string;
  /** عدد ما تغيّر في هذا المجال خلال الأسبوع */
  updates: number;
  big?: { n: number; label: string };
  donut?: { total: number; unit: string; slices: Slice[] };
  stats?: Stat[];
  lines?: Line[];
  bars?: Bar[];
  /** سطر «أبرزها» تحت الحلقة */
  note?: string;
};

export type WeekReport = {
  weekStart: string;
  weekEnd: string;
  /** مجموع ما تغيّر في المنصة هذا الأسبوع */
  total: number;
  /** الأسبوع الماضي — `null` إن لم يُطلب أو لم يكن للسجلّ عمرٌ كافٍ */
  totalPrev: number | null;
  crPct: number | null;
  crPctPrev: number | null;
  crClosed: number;
  crOpen: number;
  doms: Dom[];
  /** الخطوات القادمة — تُكتب يدوياً في الإعدادات */
  next: string[];
};

/** مفاتيح المجالات — هي نفسها مفاتيح التفضيلات، فلا قائمتان تفترقان */
export const DOM_KEYS = ["task", "nat", "inst", "ses", "cx", "proj"] as const;
export type DomKey = (typeof DOM_KEYS)[number];

/* الأيقونة ليست هنا: الواجهة ترسمها بأيقونات المنصة نفسها
   (`icons.tsx`) حسب المفتاح، فلا رموز تعبيرية في التقرير */
export const DOM_META: Record<DomKey, { title: string }> = {
  task: { title: "حالة التكليفات" },
  nat: { title: "الاستراتيجيات الوطنية" },
  inst: { title: "الاستراتيجيات المؤسسية" },
  ses: { title: "جلسات مراجعة الأداء" },
  cx: { title: "تجربة المستفيد" },
  proj: { title: "حالة المشاريع الاستراتيجية" },
};

/* المنجز إلى أي مجال ينتمي */
const KIND_DOM: Record<string, DomKey> = {
  meas: "nat", natstage: "nat", tech: "nat",
  live: "inst", instep: "inst",
  session: "ses",
  cxrep: "cx", cxstep: "cx",
  proj: "proj",
  task: "task",
};

/** أسماءٌ بلا تكرار، والتفصيل من أحدث منجز للاسم نفسه */
function linesOf(list: Ach[]): Line[] {
  const seen = new Map<string, Line>();
  for (const a of list) {
    const nm = a.name || "—";
    seen.set(nm, { name: nm, detail: a.detail });
  }
  return [...seen.values()];
}

const noteOf = (lines: Line[], max = 2) =>
  lines
    .slice(0, max)
    .map((l) => (l.detail ? `${l.name} — ${l.detail}` : l.name))
    .join(" · ");

/* ---------------- الحلقات ---------------- */
function natDonut(items: ItemLite[]) {
  const c = [0, 0, 0, 0];
  for (const it of items) {
    const s = Math.max(1, Math.min(4, num(it.data.stage, 1)));
    c[s - 1]++;
  }
  return {
    total: items.length,
    unit: "استراتيجية",
    slices: NAT_STEPS.map((label, i) => ({
      label,
      n: c[i],
      /* المرحلة الأبعد أغمق: الحلقة تُقرأ تدرّجاً من «طور الإعداد» إلى «معتمدة» */
      color: RAMP[i + 1],
    })),
  };
}

function instDonut(items: ItemLite[]) {
  const c = [0, 0, 0, 0, 0];
  for (const it of items) {
    const s = Math.max(0, Math.min(5, num(it.data.stage)));
    if (s > 0) c[s - 1]++;
  }
  return {
    total: items.length,
    unit: "جهة",
    slices: INST_STAGES.map((label, i) => ({ label, n: c[i], color: RAMP[i] })),
  };
}

/* ---------------- التكليفات ---------------- */
function taskDom(tasks: TaskLite[], a: string, b: string, upd: number): Dom | null {
  const rows = tasks.filter((x) => txt(x.kind) === "assignment");
  const done = rows.filter((x) => inRange(txt(x.completedAt), a, b));
  const fresh = rows.filter((x) => inRange(txt(x.createdAt), a, b));
  const open = rows.filter((x) => txt(x.state) !== "done" && txt(x.state) !== "hold");
  const late = open.filter((x) => {
    const d = day(txt(x.dueDate));
    return !!d && d < day(new Date().toISOString());
  });
  const updates = done.length + fresh.length + upd;
  if (!updates) return null;
  return {
    k: "task",
    ...DOM_META.task,
    updates,
    stats: [
      { n: fresh.length, label: "جديد", tone: "mute", icon: "inbox" },
            /* سهم دائري لا ترس: `gear` في المكتبة دائرةٌ بأشعة تُقرأ شمساً */
      { n: open.length, label: "قيد العمل", tone: "ok", icon: "cycle" },
      { n: done.length, label: "مكتمل", tone: "ok", icon: "check" },
      { n: late.length, label: "متأخر", tone: "warn", icon: "clock" },
    ],
    lines: done.map((x) => ({ name: txt(x.title) })),
  };
}

/* ---------------- المشاريع ---------------- */
function projDom(items: ItemLite[], moved: Ach[]): Dom | null {
  if (!moved.length) return null;
  const names = new Set(moved.map((m) => m.name));
  const bars: Bar[] = items
    .filter((it) => names.has(txt(it.data.name)))
    .map((it) => {
      const actual = num(it.data.actual);
      const planned = num(it.data.planned);
      return {
        name: txt(it.data.name),
        pct: Math.round(actual * 10) / 10,
        late: actual < planned,
      };
    });
  /* المشروع في السجلّ ولا بند له (حُذف مثلاً): يُعرض بما في المنجز */
  for (const m of moved)
    if (!bars.some((x) => x.name === m.name))
      bars.push({ name: m.name, pct: num((m.detail || "").split("←").pop()), late: false });
  return {
    k: "proj",
    ...DOM_META.proj,
    updates: moved.length,
    big: { n: bars.length, label: bars.length === 1 ? "مشروع تقدّم هذا الأسبوع" : "مشاريع تقدّمت هذا الأسبوع" },
    bars,
  };
}

/* ---------------- البناء ---------------- */
export function buildWeekReport(args: {
  weekStart: string;
  weekEnd: string;
  log: LogRow[];
  /** سجلّ الأسبوع الماضي — للمقارنة وحدها، ويجوز تركه فارغاً */
  logPrev?: LogRow[] | null;
  changes: ChangeLite[];
  tasks: TaskLite[];
  contacts: ContactLite[];
  items: Partial<Record<string, ItemLite[]>>;
  /** المجالات المؤشَّر عليها في الإعدادات */
  on: Record<string, boolean>;
  /** الخطوات القادمة — سطرٌ لكل خطوة */
  next?: string[];
}): WeekReport {
  const { weekStart: a, weekEnd: b } = args;
  const ach = achFromLog(args.log);
  const of = (k: string) => ach.filter((x) => x.k === k);
  const domAch = (d: DomKey) => ach.filter((x) => KIND_DOM[x.k] === d);

  const cr = achChanges(args.changes, a, b);
  const prevA = shift(a, -7);
  const prevB = shift(b, -7);
  const crPrev = achChanges(args.changes, prevA, prevB);

  const doms: Dom[] = [];
  const add = (d: Dom | null) => {
    if (d && d.updates > 0 && args.on[d.k] !== false) doms.push(d);
  };

  /* ١) التكليفات */
  add(taskDom(args.tasks, a, b, 0));

  /* ٢) الاستراتيجيات الوطنية */
  const nat = domAch("nat");
  if (nat.length) {
    const lines = linesOf(nat);
    add({
      k: "nat",
      ...DOM_META.nat,
      updates: nat.length,
      big: {
        n: lines.length,
        label: lines.length === 1 ? "استراتيجية تقدّمت هذا الأسبوع" : "استراتيجيات تقدّمت هذا الأسبوع",
      },
      donut: natDonut(args.items.natstrat || []),
      note: noteOf(lines),
      lines,
    });
  }

  /* ٣) الاستراتيجيات المؤسسية */
  const inst = domAch("inst");
  if (inst.length) {
    const lines = linesOf(inst);
    const live = linesOf(of("live"));
    add({
      k: "inst",
      ...DOM_META.inst,
      updates: inst.length,
      big: live.length
        ? { n: live.length, label: live.length === 1 ? "جهة فُعِّل قياسها هذا الأسبوع" : "جهات فُعِّل قياسها هذا الأسبوع" }
        : { n: lines.length, label: "جهات تقدّمت هذا الأسبوع" },
      donut: instDonut(args.items.inststrat || []),
      note: noteOf(lines),
      lines,
    });
  }

  /* ٤) جلسات مراجعة الأداء */
  const ses = linesOf(domAch("ses"));
  if (ses.length)
    add({
      k: "ses",
      ...DOM_META.ses,
      updates: domAch("ses").length,
      big: { n: ses.length, label: ses.length === 1 ? "جهة تقدّمت جلستها" : "جهات تقدّمت جلساتها" },
      lines: ses,
    });

  /* ٥) تجربة المستفيد */
  const cx = domAch("cx");
  if (cx.length) {
    const reps = linesOf(of("cxrep"));
    add({
      k: "cx",
      ...DOM_META.cx,
      updates: cx.length,
      big: reps.length
        ? { n: reps.length, label: reps.length === 1 ? "جهاز صدر له تقرير" : "أجهزة صدرت لها تقارير" }
        : { n: linesOf(cx).length, label: "أجهزة تقدّمت في المسار" },
      lines: linesOf(cx),
    });
  }

  /* ٦) المشاريع */
  add(projDom(args.items.projects || [], of("proj")));

  /* طلبات التغيير **بلا بطاقة**: نسبتها وأعدادها في شريط الملخّص
     أعلى الصفحة وحده — بطلب المستخدمة، فلا تتكرر المعلومة */
  const open = args.changes.filter((c) => !day(txt(c.closedAt))).length;

  const total = ach.length + cr.n;
  const prevAch = args.logPrev ? achFromLog(args.logPrev).length + crPrev.n : null;

  return {
    weekStart: a,
    weekEnd: b,
    total,
    totalPrev: prevAch,
    crPct: cr.pct,
    crPctPrev: crPrev.pct,
    crClosed: cr.n,
    crOpen: open,
    doms,
    next: args.next || [],
  };
}

/** إزاحة تاريخ ISO بعدد أيام — موضعية حتى لا يستورد الملف غيره */
function shift(iso: string, days: number): string {
  const d = new Date(`${day(iso)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
