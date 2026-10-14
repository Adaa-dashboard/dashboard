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
export type Slice = {
  label: string;
  n: number;
  color: string;
  /** ما زاد في هذه المرحلة هذا الأسبوع — يظهر سهماً أخضر في الأسطورة */
  up?: number;
};
/** شريط مشروع: الإنجاز الفعلي، والمخطط له (المستهدف عند تاريخه) */
export type Bar = { name: string; pct: number; plan: number; late: boolean };
export type Stat = { n: number; label: string; tone: "ok" | "warn" | "mute"; icon?: string };
export type Line = { name: string; detail?: string; id?: string };
/** بندٌ تقدّم هذا الأسبوع — لونه لون شريحته في الحلقة */
export type Up = { name: string; label: string; color: string };

/** صفٌّ في جدول التكليفات: التكليف وحالته وما يحتاجه */
export type Row = { id: string; name: string; state: string; tone: "ok" | "warn" | "mute" };

export type Dom = {
  k: string;
  title: string;
  /** جدول التكليفات — ما تحرّك منها هذا الأسبوع وما تأخّر */
  rows?: Row[];
  /** عدد ما تغيّر في هذا المجال خلال الأسبوع */
  updates: number;
  /** `base` قاعدة رسم الحلقة إن خالفت مجموع الشرائح — تُرسم
      الشرائح منسوبةً إليها ويبقى ما سواها رمادياً */
  donut?: { total: number; unit: string; slices: Slice[]; base?: number };
  /** ما تقدّم هذا الأسبوع: الاسم ولون مرحلته — تحت الحلقة */
  ups?: Up[];
  /** لا تُذكر أسماءٌ غير `ups`: المجال اختير له أن يُسمّي مراحلَ
      بعينها، فسطرُ «أبرزها» أو قائمةُ ما تحرّك يُدخلان أسماءً من
      مراحلَ أخرى — وهي ما لا يُراد ذكره */
  upsOnly?: boolean;
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
    .map((it) => ({ id: it.id, name: txt(it.data.name) || txt(it.data.entity) || it.id }))
    .filter((l) => !!l.name);
}

/** أسماءٌ بلا تكرار، والتفصيل من أحدث منجز للاسم نفسه */
function linesOf(list: Ach[]): Line[] {
  const seen = new Map<string, Line>();
  for (const a of list) {
    const nm = a.name || "—";
    seen.set(nm, { name: nm, detail: a.detail, id: a.id });
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

/* ---------------- الحلقات ----------------
   مُصدَّرة لأن **صفحة «نظرة عامة» ترسم الحلقات نفسها**: حسبةٌ
   واحدة لا حسبتان، فلا يفترق رقم التقرير عن رقم الصفحة. */
/* مرحلة البند الآن — تُستعمل في بناء الحلقة وفي معرفة أين وقع
   ما تقدّم هذا الأسبوع، فلا تفترق حسبتان */
export function natLabel(d: Rec) {
  return NAT_STEPS[Math.max(1, Math.min(4, num(d.stage, 1))) - 1];
}
export function instLabel(d: Rec) {
  const i =
    txt(d.live) === "مفعل" ? 4
    : txt(d.docsState) === "مكتمل" ? 3
    : txt(d.docs) === "✓" ? 2
    : txt(d.meet) === "تم" ? 1
    : 0;
  return INST_STAGES[i];
}
export function sesLabel(d: Rec) {
  const stages = Array.isArray(d.stages) ? (d.stages as unknown[]) : [];
  const full = stages.length || 6;
  const n = num(d.done);
  return n >= full && full > 0 ? "اكتملت جلستها" : n > 0 ? "قيد التنفيذ" : "لم تبدأ";
}
export function cxLabel(d: Rec) {
  if (CX_QK.some((q) => txt(d[`${q}Issue`]) === CX_OK)) return "صدر له تقرير";
  if (txt(d.meet) === "تم" || txt(d.survey) || txt(d.card) || txt(d.l1)) return "في المسار";
  return "لم يبدأ بعد";
}

export function natDonut(items: ItemLite[]) {
  const c = [0, 0, 0, 0];
  for (const it of items) c[NAT_STEPS.indexOf(natLabel(it.data))]++;
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

/** @param startedOnly يُسقط «لم يُعقد اجتماعها» ويقصر الحلقة على ما
    بدأ مساره — في **تقرير المنجزات** تحديداً: ما لم يبدأ ليس
    إنجازاً، وعرضه بين المنجزات يُقرأ تقصيراً. وصفحة «نظرة عامة»
    تبقى على المحفظة كاملةً، فهي حالةٌ لا إنجاز. */
export function instDonut(items: ItemLite[], startedOnly = false) {
  /* قسمةٌ بأبعد مرحلةٍ بلغتها الجهة، فمجموع الشرائح = عدد الجهات.
     أما عدّادات الصفحة فمتداخلة (الجهة المفعَّل قياسها معدودةٌ في
     «عُقد اجتماعها» أيضاً)، فلا تصلح شرائحَ حلقة */
  const c = [0, 0, 0, 0, 0];
  for (const it of items) c[INST_STAGES.indexOf(instLabel(it.data))]++;
  const slices = INST_STAGES.map((label, i) => ({ label, n: c[i], color: RAMP[i] }));
  if (!startedOnly) return { total: items.length, unit: "جهة", slices };
  /* في التقرير تُحذف «لم يُعقد اجتماعها» من الأسطورة — فهي تقصيرٌ
     لا إنجاز — **ويبقى العدد في الوسط عدد الجهات كلها**: الحلقة
     تقول كم جهة لدينا، والشرائح تقول أين وصل منها، وما لم يبدأ
     يبقى فراغاً رمادياً في الحلقة */
  return {
    total: items.length,
    unit: "جهة",
    slices: slices.slice(1),
    base: items.length,
  };
}

/* ---------------- التكليفات ---------------- */
function taskDom(tasks: TaskLite[], a: string, b: string, upd: number): Dom | null {
  const rows = tasks.filter((x) => txt(x.kind) === "assignment");
  const done = rows.filter((x) => inRange(txt(x.completedAt), a, b));
  /* المعلَّق حالةٌ قائمة بنفسها — لها مربّعها، فلا تختفي من العدّ
     كما كانت (٢ + ٠ + ٠ لا تساوي ٣) */
  const held = rows.filter((x) => txt(x.state) === "hold");
  const open = rows.filter((x) => txt(x.state) !== "done" && txt(x.state) !== "hold");
  const late = open.filter((x) => {
    const d = day(txt(x.dueDate));
    return !!d && d < day(new Date().toISOString());
  });
  /* **الحالات الأربع لا تتداخل**: التكليف يُعدّ مرةً واحدة.
     و«جديد» = ما **ورد** هذا الأسبوع لا ما أُدخل المنصة فيه:
     تكليفٌ قديم يُدخَل اليوم ليس جديداً — إن مضى موعده فهو متأخر،
     وإلا فهو قيد العمل. فإن غاب تاريخ الورود رجعنا إلى تاريخ
     الإدخال، وهو ما كان يسبّب الالتباس */
  const fresh = open.filter(
    (x) => !late.includes(x) && inRange(txt(x.assignedAt) || txt(x.createdAt), a, b),
  );
  const doing = open.filter((x) => !late.includes(x) && !fresh.includes(x));
  if (!rows.length) return null;
  const updates = done.length + fresh.length + upd;

  /* جدول التكليفات: ما اكتمل أو ورد هذا الأسبوع، وما تأخّر —
     بلا تكرارٍ إن كان التكليف جديداً ومتأخراً معاً */
  const today = day(new Date().toISOString());
  const lateDays = (x: TaskLite) => {
    const d = day(txt(x.dueDate));
    if (!d) return 0;
    return Math.round((new Date(today).getTime() - new Date(d).getTime()) / 86400000);
  };
  const seen = new Set<string>();
  const tbl: Row[] = [];
  /** آخر تحديثٍ كُتب على التكليف — وهو ما يُعرض في عمود «التحديث»،
      فإن لم يُكتب شيء عُرضت حالته المحسوبة */
  const lastUpd = (x: TaskLite) => {
    const u = Array.isArray(x.updates) ? x.updates : [];
    let best = "";
    let at = "";
    for (const r of u) {
      const t2 = txt(r?.text).trim();
      if (!t2) continue;
      const a2 = txt(r?.at);
      if (!best || a2 >= at) {
        best = t2;
        at = a2;
      }
    }
    return best.replace(/\s+/g, " ");
  };
  const push = (x: TaskLite, state: string, tone: "ok" | "warn" | "mute") => {
    const nm = txt(x.title);
    const key = txt(x.id) || nm;
    if (!nm || seen.has(key)) return;
    seen.add(key);
    const u = lastUpd(x);
    /* المعرّف يثبت بين الأسابيع، فالدعم المكتوب يلتصق بالتكليف نفسه */
    tbl.push({ id: key, name: nm, state: u || state, tone: u ? "mute" : tone });
  };
  for (const x of late) push(x, `متأخر ${arDays(lateDays(x))}`, "warn");
  for (const x of done) push(x, "مكتمل", "ok");
  for (const x of fresh) push(x, "ورد هذا الأسبوع", "mute");
  for (const x of doing) push(x, "قيد العمل", "mute");
  for (const x of held) push(x, "معلَّق", "warn");
  return {
    k: "task",
    ...DOM_META.task,
    updates,
    /* الشريط: كم تكليفاً لدينا، ثم أين هي منه — بطلب المستخدمة.
       و«على المسار» تجمع الوارد حديثاً وما هو قيد العمل، فالمربّع
       الأول صار عدداً كلياً لا حالة */
    /* المربّعات الأربعة تستوعب كل تكليف مرةً واحدة:
       العدد = على المسار + معلَّق + مكتمل. والمتأخر يبقى ظاهراً
       في عمود «التحديث» بلونه حين لم يُكتب تحديثٌ بعد */
    stats: [
      { n: rows.length, label: "عدد التكاليف", tone: "mute", icon: "clipboard" },
      /* خطٌّ صاعد: «على المسار» حالٌ لا دورة */
      { n: open.length, label: "على المسار", tone: "ok", icon: "trend" },
      { n: held.length, label: "معلَّق", tone: "warn", icon: "hourglass" },
      { n: done.length, label: "مكتمل", tone: "ok", icon: "check" },
    ],
    rows: tbl.length ? tbl : undefined,
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
  /* لا رقمَ كبيراً: الأشرطة نفسها تقول أين وصل كل مشروع، وشارة
     «ن تحديثاً» في الزاوية تقول كم تحرّك هذا الأسبوع */
  return {
    k: "proj",
    ...DOM_META.proj,
    updates: moved.length || touched.length,
    bars,
  };
}

/* ---------------- حلقتا الجلسات وتجربة المستفيد ---------------- */
/** مراحل الجلسة الستّ: `done` عدد المكتمل منها */
export function sesDonut(items: ItemLite[]) {
  let done = 0, live = 0, none = 0;
  for (const it of items) {
    const l = sesLabel(it.data);
    if (l === "اكتملت جلستها") done++;
    else if (l === "قيد التنفيذ") live++;
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

/** تجربة المستفيد — **الحلقة على المستهدف لا على كل الأجهزة**:
    في وسطها ٦٩ (المستهدف)، وشريحتاها ما صدر له تقرير وما بقي
    منه. وقائمة الملف كلها ١٥٤ جهازاً، فحلقةٌ عليها تُخفي السؤال
    الحقيقي: كم بقي من المستهدف.
    «صدر له تقرير» = اعتُمد تقريره في أيّ ربع، وهو تعريف الملف نفسه */
const CX_OK = "تم الاعتماد";
const CX_QK = ["q0", "q1", "q2", "q3", "q4"];
/** مستهدف البكس — من صفّ الإعدادات `cx-meta`، وإن لم يُضبط بعد
    فالمعتمد في الملف ٦٩ جهازاً */
export function cxTarget(items: ItemLite[]): number {
  const meta = items.find((it) => it.id === "cx-meta");
  const t = num(meta?.data.target);
  return t > 0 ? t : 69;
}

export function cxDonut(items: ItemLite[]) {
  /* صفّ الإعدادات (`cx-meta`) ليس جهازاً فلا يُعدّ */
  const rows = items.filter((it) => it.id !== "cx-meta");
  let rep = 0, live = 0;
  for (const it of rows) {
    const l = cxLabel(it.data);
    if (l === "صدر له تقرير") rep++;
    else if (l === "في المسار") live++;
  }
  const target = cxTarget(items);
  /* ما في المسار لا يُحتسب إلا في حدود ما بقي من المستهدف */
  const left = Math.max(0, target - rep);
  const prog = Math.min(live, left);
  return {
    /* تجاوُز المستهدف لا يُخفى: الوسط يصير العدد المحقَّق نفسه */
    total: Math.max(target, rep),
    /* الوحدة «جهاز» دائماً: الرقم في الوسط عددُ أجهزة لا اسمُ هدف */
    unit: "جهاز",
    slices: [
      { label: "صدر له تقرير", n: rep, color: RAMP[4] },
      { label: "في المسار", n: prog, color: RAMP[2] },
      { label: "لم يبدأ بعد", n: Math.max(0, left - prog), color: RAMP[0] },
    ],
  };
}

/** أين وقع ما تقدّم هذا الأسبوع — تُطابَق أسماء المنجزات ببنود
    القسم، وتُقرأ مرحلةُ كلٍّ منها الآن. فالسهم الأخضر يقف عند
    المرحلة التي صار إليها البند، والأسماء تحت الحلقة هي هي. */
function upsIn(
  items: ItemLite[],
  lines: Line[],
  label: (d: Rec) => string,
  slices: Slice[],
  /** مراحلُ تُذكر أسماؤها دون غيرها — بلا قائمة تُذكر كلها */
  only?: string[],
) {
  /* المطابقة **بالمعرّف أولاً**: اسم البند في السجلّ قد يختلف عن
     اسمه في الجدول (تسميةٌ من جدول الجهات، أو مسافةٌ زائدة)، فكان
     المخرج يخلو من السهم رغم وقوع التقدّم فعلاً */
  const byId = new Map(items.map((it) => [it.id, it]));
  const byName = new Map<string, ItemLite>();
  for (const it of items) {
    const nm = txt(it.data.name) || txt(it.data.entity);
    if (nm) byName.set(nm.trim(), it);
  }
  const color = new Map(slices.map((x) => [x.label, x.color]));
  const count: Record<string, number> = {};
  const named: Up[] = [];
  for (const l of lines) {
    const it = (l.id && byId.get(l.id)) || byName.get(l.name.trim());
    const lab = it ? label(it.data) : "";
    /* بندٌ لم يعد في الجدول (حُذف مثلاً): يبقى اسمه بلا لون شريحة */
    if (lab) count[lab] = (count[lab] || 0) + 1;
    if (only && !only.includes(lab)) continue;
    named.push({
      name: it ? txt(it.data.name) || txt(it.data.entity) || l.name : l.name,
      label: lab,
      color: (lab && color.get(lab)) || "#9aa6a2",
    });
  }
  return { count, named };
}

/** أسماء **كل** مَن بلغ المرحلة المطلوبة — لا ما تحرّك منها هذا
    الأسبوع وحده: الجهة التي فُعِّل قياسها الأسبوع الماضي لا تغيب
    من تقرير هذا الأسبوع. ولون كلٍّ لون شريحتها في الحلقة. */
function stageNames(
  items: ItemLite[],
  label: (d: Rec) => string,
  slices: Slice[],
  /** المراحل المطلوبة بترتيب ذكرها */
  only: string[],
): Up[] {
  const color = new Map(slices.map((x) => [x.label, x.color]));
  const out: Up[] = [];
  for (const lab of only) {
    for (const it of items) {
      if (label(it.data) !== lab) continue;
      const nm = txt(it.data.name) || txt(it.data.entity) || txt(it.data.owner);
      if (nm) out.push({ name: nm, label: lab, color: color.get(lab) || "#9aa6a2" });
    }
  }
  return out;
}

/** الحلقة نفسها، وقد وُسمت شرائحها بما زاد فيها هذا الأسبوع */
function withUps<T extends { slices: Slice[] }>(donut: T, count: Record<string, number>): T {
  return {
    ...donut,
    slices: donut.slices.map((x) => (count[x.label] ? { ...x, up: count[x.label] } : x)),
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
    /* لا رقمَ كبيراً فوق الحلقة: التحديث يُقرأ من سهم الأسطورة
       ومن أسماء ما تقدّم تحتها */
    const dn = natDonut(sec("natstrat"));
    /* تحت الحلقة أسماءُ ما بلغ الاعتماد وحدها — وهي الأهمّ،
       وقائمةُ كل ما تحرّك كانت تطول بلا طائل */
    const up = upsIn(sec("natstrat"), lines, natLabel, dn.slices, NAT_STEPS.slice(2));
    add({
      k: "nat",
      ...DOM_META.nat,
      updates: nat.length || natT.length,
      donut: withUps(dn, up.count),
      /* **كل** المعتمدة تُذكر بأسمائها لا ما تحرّك منها هذا الأسبوع
         وحده: المعتمدة من مجلس الوزراء أولاً ثم المعتمدة من اللجنة —
         وهي أهمّ ما في التقرير، فلا تغيب لأنها لم تتغيّر */
      ups: stageNames(sec("natstrat"), natLabel, dn.slices, [NAT_STEPS[3]]),
      upsOnly: true,
      lines,
    });
  }

  /* ٣) الاستراتيجيات المؤسسية */
  const inst = domAch("inst");
  const instT = tch("inststrat");
  if (sec("inststrat").length || inst.length) {
    const lines = inst.length ? linesOf(inst) : instT;
    const dn = instDonut(sec("inststrat"), true);
    /* المؤسسية: مَن فُعِّل قياسها وحدها */
    const up = upsIn(sec("inststrat"), lines, instLabel, dn.slices, [INST_STAGES[4]]);
    add({
      k: "inst",
      ...DOM_META.inst,
      updates: inst.length || instT.length,
      donut: withUps(dn, up.count),
      /* **كل** جهة فُعِّل قياسها تُذكر بالاسم لا ما تحرّك منها هذا
         الأسبوع وحده — فالجهة التي فُعِّلت قبل أسبوع كانت تغيب */
      ups: stageNames(sec("inststrat"), instLabel, dn.slices, [INST_STAGES[4]]),
      upsOnly: true,
      lines,
    });
  }

  /* ٤) جلسات مراجعة الأداء */
  const sesA = domAch("ses");
  const sesT = tch("sessions");
  if (sec("sessions").length || sesA.length) {
    const lines = sesA.length ? linesOf(sesA) : sesT;
    const dn = sesDonut(sec("sessions"));
    const up = upsIn(sec("sessions"), lines, sesLabel, dn.slices);
    add({
      k: "ses",
      ...DOM_META.ses,
      updates: sesA.length || sesT.length,
      donut: withUps(dn, up.count),
      ups: up.named,
      lines,
    });
  }

  /* ٥) تجربة المستفيد */
  const cx = domAch("cx");
  const cxT = tch("cx");
  if (sec("cx").length || cx.length) {
    const lines = cx.length ? linesOf(cx) : cxT;
    const dn = cxDonut(sec("cx"));
    const up = upsIn(sec("cx"), lines, cxLabel, dn.slices);
    add({
      k: "cx",
      ...DOM_META.cx,
      updates: cx.length || cxT.length,
      donut: withUps(dn, up.count),
      ups: up.named,
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
