/* ============================================================
   بناء «الإنجاز الأسبوعي» بشكله الجديد: بطاقةٌ لكل مجال.

   التقرير مجالات لا أنواع منجزات: حالة التكليفات · الاستراتيجيات
   الوطنية · المؤسسية · جلسات مراجعة الأداء · تجربة المستفيد ·
   المشاريع · مراجعة طلبات التغيير. وداخل كل بطاقة:

     • **رقم الأسبوع** — ما تحرّك فيها هذه الأسبوع (من سجلّ التغييرات)
     • **حلقة الحالة** — أين تقف المحفظة كلها الآن (للوطنية والمؤسسية)
     • **الأسماء** — البنود التي وقع عليها المنجز

   طبقتان في كل بطاقة:
     • **الحالة الآن** — تُقرأ من بنود القسم نفسها، فتظهر ولو لم
       يقع في الأسبوع شيء (الحلقة، أشرطة المشاريع، حالات التكليفات).
     • **ما تغيّر هذا الأسبوع** — من السجلّ، أو من تاريخ تعديل البند
       (`updatedAt`) إن لم يكن السجلّ مركَّباً بعد.

   والقاعدة الحاكمة: **المجال بلا بياناتٍ أصلاً لا يظهر** — لا بطاقة
   فارغة ولا صفر. أما المجال الذي له بيانات فيظهر بحالته، وشارة
   «N تحديثاً» لا تُطبع إلا إن وقع تحديثٌ فعلاً.
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
export type ItemLite = { id: string; data: Rec; updatedAt?: string | null };

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
/** مسار الجهة في الاستراتيجيات المؤسسية — **بعناوين صفحة القسم
    نفسها**، وتُحسب من حقولها لا من حقل `stage`: ملف المتابعة لا
    يملأ `stage` أصلاً، فكانت الحلقة تخرج أصفاراً كلها */
export const INST_STAGES = [
  "لم يُعقد اجتماعها",
  "عُقد الاجتماع التعريفي",
  "الوثائق مستلمة",
  "اكتملت الوثائق",
  "فُعِّل القياس",
];

/* تدرّج لوني واحد: الأخضر للمنجَز ثم يفتح، والذهبي للمتأخر،
   والرمادي لما لم يبدأ — فالحلقة تُقرأ بلا أسطورة أيضاً */
const RAMP = ["#d7e2de", "#9ecdbb", "#5bb594", "#1b9c74", "#0b6b50"];

/* ---------------- أنواع المخرجات ---------------- */
export type Slice = { label: string; n: number; color: string };
/** شريط مشروع: الإنجاز الفعلي، والمخطط له (المستهدف عند تاريخه) */
export type Bar = { name: string; pct: number; plan: number; late: boolean };
export type Stat = { n: number; label: string; tone: "ok" | "warn" | "mute"; icon?: string };
export type Line = { name: string; detail?: string };
/** مستهدف المجال: ما تحقّق منه وكم المستهدف */
export type Goal = { n: number; of: number; label: string };

export type Dom = {
  k: string;
  title: string;
  /** يظهر في بطاقة التكليفات حين يوجد متأخر: ما يحتاج تدخّلاً */
  support?: Line[];
  /** عدد ما تغيّر في هذا المجال خلال الأسبوع */
  updates: number;
  big?: { n: number; label: string };
  donut?: { total: number; unit: string; slices: Slice[] };
  stats?: Stat[];
  lines?: Line[];
  bars?: Bar[];
  goal?: Goal;
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
  /** ما ورد من طلبات في الأسبوع نفسه */
  crNew: number;
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

/** البنود التي عُدِّلت في المدى — بديل السجلّ قبل تركيبه، وهو
    يعرف **أنّ** البند تغيّر ولا يعرف **ماذا** تغيّر فيه */
function touchedIn(items: ItemLite[], a: string, b: string): Line[] {
  return items
    .filter((it) => inRange(txt(it.updatedAt), a, b))
    .map((it) => ({ name: txt(it.data.name) || txt(it.data.entity) || it.id }))
    .filter((l) => !!l.name);
}

/** أسماءٌ بلا تكرار، والتفصيل من أحدث منجز للاسم نفسه */
function linesOf(list: Ach[]): Line[] {
  const seen = new Map<string, Line>();
  for (const a of list) {
    const nm = a.name || "—";
    seen.set(nm, { name: nm, detail: a.detail });
  }
  return [...seen.values()];
}

/** صيغة المفرد والجمع — «استراتيجية واحدة» مقابل «٣ استراتيجيات» */
const pl = (n: number, one: string, many: string) => (n === 1 ? one : many);

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
  /* قسمةٌ بأبعد مرحلةٍ بلغتها الجهة، فمجموع الشرائح = عدد الجهات.
     أما عدّادات الصفحة فمتداخلة (الجهة المفعَّل قياسها معدودةٌ في
     «عُقد اجتماعها» أيضاً)، فلا تصلح شرائحَ حلقة */
  const c = [0, 0, 0, 0, 0];
  for (const it of items) {
    const d = it.data;
    const i =
      txt(d.live) === "مفعل" ? 4
      : txt(d.docsState) === "مكتمل" ? 3
      : txt(d.docs) === "✓" ? 2
      : txt(d.meet) === "تم" ? 1
      : 0;
    c[i]++;
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
  if (!rows.length) return null;
  const updates = done.length + fresh.length + upd;
  /* المتأخر يحتاج تدخّلاً، فيُسمّى صراحةً مع مدّة تأخّره */
  const today = day(new Date().toISOString());
  const support: Line[] = late
    .map((x) => {
      const d = day(txt(x.dueDate));
      const n = Math.round((new Date(today).getTime() - new Date(d).getTime()) / 86400000);
      return { name: txt(x.title), detail: n > 0 ? `متأخر ${arDays(n)}` : "" };
    })
    .filter((l) => !!l.name);
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
    support: support.length ? support : undefined,
  };
}

/** صيغة الأيام بالعربية — كما في لوحة التكاليف */
function arDays(n: number): string {
  if (n === 1) return "يوماً";
  if (n === 2) return "يومين";
  if (n <= 10) return `${n} أيام`;
  return `${n} يوماً`;
}

/* ---------------- المشاريع ---------------- */
/** كل المشاريع بأشرطتها — الحالة الآن، ويُذكر فوقها ما تقدّم منها
    هذا الأسبوع إن وُجد */
function projDom(items: ItemLite[], moved: Ach[], touched: Line[]): Dom | null {
  if (!items.length && !moved.length) return null;
  const bars: Bar[] = items
    .map((it) => {
      const actual = num(it.data.actual);
      const planned = num(it.data.planned);
      return {
        name: txt(it.data.name),
        pct: Math.round(actual * 10) / 10,
        plan: Math.round(planned * 10) / 10,
        late: actual < planned,
      };
    })
    .filter((x) => !!x.name)
    .sort((x, y) => y.pct - x.pct);
  /* المشروع في السجلّ ولا بند له (حُذف مثلاً): يُعرض بما في المنجز */
  for (const m of moved)
    if (!bars.some((x) => x.name === m.name))
      bars.push({ name: m.name, pct: num((m.detail || "").split("←").pop()), plan: 0, late: false });
  const n = moved.length ? linesOf(moved).length : touched.length;
  return {
    k: "proj",
    ...DOM_META.proj,
    updates: moved.length || touched.length,
    big: n
      ? {
          n,
          label: moved.length
            ? pl(n, "مشروع تقدّم هذا الأسبوع", "مشاريع تقدّمت هذا الأسبوع")
            : pl(n, "مشروع حُدِّث هذا الأسبوع", "مشاريع حُدِّثت هذا الأسبوع"),
        }
      : undefined,
    bars,
  };
}

/* ---------------- حلقتا الجلسات وتجربة المستفيد ---------------- */
/** مراحل الجلسة الستّ: `done` عدد المكتمل منها */
function sesDonut(items: ItemLite[]) {
  let done = 0, live = 0, none = 0;
  for (const it of items) {
    const stages = Array.isArray(it.data.stages) ? (it.data.stages as unknown[]) : [];
    const full = stages.length || 6;
    const d = num(it.data.done);
    if (d >= full && full > 0) done++;
    else if (d > 0) live++;
    else none++;
  }
  return {
    total: items.length,
    unit: "جهة",
    slices: [
      { label: "اكتملت جلستها", n: done, color: RAMP[4] },
      { label: "قيد التنفيذ", n: live, color: RAMP[2] },
      { label: "لم تبدأ", n: none, color: RAMP[0] },
    ],
  };
}

/** تجربة المستفيد: صدر لها تقرير · في المسار · لم تبدأ.
    «صدر لها تقرير» = اعتُمد تقريرها في أيّ ربع، وهو تعريف الملف نفسه */
const CX_OK = "تم الاعتماد";
const CX_QK = ["q0", "q1", "q2", "q3", "q4"];
/** مستهدف البكس — من صفّ الإعدادات `cx-meta`، وإن لم يُضبط بعد
    فالمعتمد في الملف ٦٩ جهازاً */
export function cxTarget(items: ItemLite[]): number {
  const meta = items.find((it) => it.id === "cx-meta");
  const t = num(meta?.data.target);
  return t > 0 ? t : 69;
}

function cxDonut(items: ItemLite[]) {
  /* صفّ الإعدادات (`cx-meta`) ليس جهازاً فلا يُعدّ */
  const rows = items.filter((it) => it.id !== "cx-meta");
  let rep = 0, live = 0, none = 0;
  for (const it of rows) {
    const d = it.data;
    if (CX_QK.some((q) => txt(d[`${q}Issue`]) === CX_OK)) rep++;
    else if (txt(d.meet) === "تم" || txt(d.survey) || txt(d.card) || txt(d.l1)) live++;
    else none++;
  }
  return {
    total: rows.length,
    unit: "جهاز",
    slices: [
      { label: "صدر لها تقرير", n: rep, color: RAMP[4] },
      { label: "في المسار", n: live, color: RAMP[2] },
      { label: "لم تبدأ", n: none, color: RAMP[0] },
    ],
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

  const items = args.items;
  const sec = (k: string) => items[k] || [];
  /* ما عُدِّل من البنود هذا الأسبوع — يُستعمل حين لا يُسعف السجلّ */
  const tch = (k: string) => touchedIn(sec(k), a, b);

  const doms: Dom[] = [];
  const add = (d: Dom | null) => {
    if (d && args.on[d.k] !== false) doms.push(d);
  };

  /* ١) التكليفات — حالتها الآن، وما وقع فيها هذا الأسبوع */
  add(taskDom(args.tasks, a, b, 0));

  /* ٢) الاستراتيجيات الوطنية */
  const nat = domAch("nat");
  const natT = tch("natstrat");
  if (sec("natstrat").length || nat.length) {
    const lines = nat.length ? linesOf(nat) : natT;
    add({
      k: "nat",
      ...DOM_META.nat,
      updates: nat.length || natT.length,
      big: lines.length
        ? {
            n: lines.length,
            label: nat.length
              ? pl(lines.length, "استراتيجية تقدّمت هذا الأسبوع", "استراتيجيات تقدّمت هذا الأسبوع")
              : pl(lines.length, "استراتيجية حُدِّثت هذا الأسبوع", "استراتيجيات حُدِّثت هذا الأسبوع"),
          }
        : undefined,
      donut: natDonut(sec("natstrat")),
      note: nat.length ? noteOf(lines) : undefined,
      lines,
    });
  }

  /* ٣) الاستراتيجيات المؤسسية */
  const inst = domAch("inst");
  const instT = tch("inststrat");
  if (sec("inststrat").length || inst.length) {
    const lines = inst.length ? linesOf(inst) : instT;
    const live = linesOf(of("live"));
    add({
      k: "inst",
      ...DOM_META.inst,
      updates: inst.length || instT.length,
      big: live.length
        ? {
            n: live.length,
            label: live.length === 1 ? "جهة فُعِّل قياسها هذا الأسبوع" : "جهات فُعِّل قياسها هذا الأسبوع",
          }
        : lines.length
          ? {
              n: lines.length,
              label: inst.length
                ? pl(lines.length, "جهة تقدّمت هذا الأسبوع", "جهات تقدّمت هذا الأسبوع")
                : pl(lines.length, "جهة حُدِّثت هذا الأسبوع", "جهات حُدِّثت هذا الأسبوع"),
            }
          : undefined,
      donut: instDonut(sec("inststrat")),
      note: inst.length ? noteOf(lines) : undefined,
      lines,
    });
  }

  /* ٤) جلسات مراجعة الأداء */
  const sesA = domAch("ses");
  const sesT = tch("sessions");
  if (sec("sessions").length || sesA.length) {
    const lines = sesA.length ? linesOf(sesA) : sesT;
    add({
      k: "ses",
      ...DOM_META.ses,
      updates: sesA.length || sesT.length,
      big: lines.length
        ? {
            n: lines.length,
            label: sesA.length
              ? pl(lines.length, "جهة تقدّمت جلستها", "جهات تقدّمت جلساتها")
              : pl(lines.length, "جهة حُدِّثت جلستها هذا الأسبوع", "جهات حُدِّثت جلساتها هذا الأسبوع"),
          }
        : undefined,
      donut: sesDonut(sec("sessions")),
      note: sesA.length ? noteOf(lines, 3) : undefined,
      lines,
    });
  }

  /* ٥) تجربة المستفيد */
  const cx = domAch("cx");
  const cxT = tch("cx");
  if (sec("cx").length || cx.length) {
    const reps = linesOf(of("cxrep"));
    const lines = cx.length ? linesOf(cx) : cxT;
    add({
      k: "cx",
      ...DOM_META.cx,
      updates: cx.length || cxT.length,
      big: reps.length
        ? { n: reps.length, label: reps.length === 1 ? "جهاز صدر له تقرير" : "أجهزة صدرت لها تقارير" }
        : lines.length
          ? {
              n: lines.length,
              label: cx.length
                ? pl(lines.length, "جهاز تقدّم في المسار", "أجهزة تقدّمت في المسار")
                : pl(lines.length, "جهاز حُدِّث هذا الأسبوع", "أجهزة حُدِّثت هذا الأسبوع"),
            }
          : undefined,
      donut: cxDonut(sec("cx")),
      goal: {
        n: cxDonut(sec("cx")).slices[0].n,
        of: cxTarget(sec("cx")),
        label: "جهازاً صدر له تقرير",
      },
      note: cx.length ? noteOf(lines, 3) : undefined,
      lines,
    });
  }

  /* ٦) المشاريع */
  add(projDom(sec("projects"), of("proj"), tch("projects")));

  /* طلبات التغيير **بلا بطاقة**: نسبتها وأعدادها في شريط الملخّص
     أعلى الصفحة وحده — بطلب المستخدمة، فلا تتكرر المعلومة */
  const open = args.changes.filter((c) => !day(txt(c.closedAt))).length;
  /* ما ورد هذا الأسبوع — `first_seen` أول ظهورٍ للطلب في الملف اليومي */
  const crNew = args.changes.filter((c) => inRange(txt(c.firstSeen), a, b)).length;
  /* النسبة الكلية لكل ما أُغلق — تُعرض حين لا يُغلق شيءٌ هذا الأسبوع،
     فالحلقة لا تظهر صفراً وكأن الالتزام انهار */
  let crAllN = 0, crAllOk = 0;
  for (const c of args.changes) {
    if (!day(txt(c.closedAt)) || c.sla == null || c.workDays == null) continue;
    crAllN++;
    if (Number(c.workDays) < Number(c.sla)) crAllOk++;
  }
  const crAll = crAllN ? Math.round((crAllOk / crAllN) * 100) : null;

  /* ما تحرّك هذا الأسبوع: السجلّ أولاً، وإلا تواريخ تعديل البنود */
  const touchedAll = ["natstrat", "inststrat", "sessions", "cx", "projects"].reduce(
    (n, k) => n + tch(k).length,
    0,
  );
  const taskEv = args.tasks.filter(
    (x) => txt(x.kind) === "assignment" && (inRange(txt(x.completedAt), a, b) || inRange(txt(x.createdAt), a, b)),
  ).length;

  const total = (ach.length || touchedAll) + cr.n + taskEv;
  const prevAch = args.logPrev ? achFromLog(args.logPrev).length + crPrev.n : null;

  return {
    weekStart: a,
    weekEnd: b,
    total,
    totalPrev: prevAch,
    crPct: cr.pct ?? crAll,
    crPctPrev: crPrev.pct,
    crClosed: cr.n,
    crOpen: open,
    crNew,
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
