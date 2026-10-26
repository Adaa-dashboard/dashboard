/* ============================================================
   تخصيص التقرير الأسبوعي.

   كل قسم في التقرير له مفتاح، وما لا يُؤشَّر عليه لا يظهر —
   لا في الصفحة ولا في ملف الـPDF ولا في الرابط المشترَك.

   يُحفظ في perf_settings بمفتاحين:
     weekly_prefs            → الافتراضي، يسري على كل أسبوع
     weekly_wk_<YYYY-MM-DD>  → استثناء أسبوع بعينه، يُبنى فوق الافتراضي
   فالتغيير الدائم يُكتب في الأول، وتغيير هذا الأسبوع في الثاني.
   ============================================================ */

export type BlockKind = "auto" | "text" | "list";
export type Block = {
  k: string;
  name: string;
  note: string;
  kind: BlockKind;
  /** ثابت لا يُطفأ — الترويسة تعرّف التقرير نفسه */
  fixed?: boolean;
  /** نص الإرشاد داخل خانة الكتابة */
  hint?: string;
};

export const WEEK_BLOCKS: Block[] = [
  { k: "head", name: "ترويسة التقرير والفترة", note: "اسم التقرير والإدارة والفترة", kind: "auto", fixed: true },
  /* المجالات — مفاتيحها مفاتيح `DOM_KEYS` في `lib/weekReport.ts`
     فلا قائمتان تفترقان */
  /* دورة القياس — مربّع أعلى التقرير بأرقام الربع، تُكتب يدوياً
     وتبقى محفوظة لكل ربع على حدة */
  { k: "cycle", name: "دورة القياس (Cycle)", note: "أرقام الربع — تُكتب يدوياً وتبقى لكل ربع", kind: "text" },
  { k: "task", name: "حالة التكليفات", note: "الوارد والمكتمل والمتأخر", kind: "auto" },
  { k: "nat", name: "الاستراتيجيات الوطنية", note: "قابلية القياس · مسار الاعتماد · القبول الفني", kind: "auto" },
  { k: "inst", name: "الاستراتيجيات المؤسسية", note: "تفعيل القياس ومسار التفعيل", kind: "auto" },
  { k: "ses", name: "جلسات مراجعة الأداء", note: "ما تقدّم من مراحل الجلسات", kind: "auto" },
  { k: "cx", name: "تجربة المستفيد", note: "التقارير الصادرة ومسار القياس", kind: "auto" },
  { k: "proj", name: "المشاريع الاستراتيجية", note: "ما ارتفعت نسبة إنجازه", kind: "auto" },
  {
    k: "done", name: "الإنجازات المحققة", note: "تُكتب يدويًا — سطر لكل إنجاز", kind: "list",
    hint: "إنجاز في كل سطر — تظهر مرقّمة في التقرير بجانب الخطوات القادمة.",
  },
  {
    k: "next", name: "الخطوات القادمة", note: "تُكتب يدويًا — سطر لكل خطوة", kind: "list",
    hint: "خطوة في كل سطر — تظهر مرقّمة في التقرير.",
  },
  {
    k: "support", name: "الدعم المطلوب", note: "بطاقةٌ في آخر التقرير — دعمٌ عامٌّ لا يخصّ تكليفاً", kind: "text",
    hint: "ما تحتاجه الإدارة عموماً: مخاطبة، قرار، تنسيق… وإن تُرك فارغاً لم تظهر البطاقة أصلاً. ودعمُ كلّ تكليف يُكتب في جدول التكاليف نفسه.",
  },
];

/** المفاتيح المقروءة آليًا من أقسام المنصة */
export const AUTO_SECTIONS = ["sessions", "natstrat", "inststrat", "outputs", "cx", "projects"] as const;

/** شكل التقرير: اتجاه الصفحة وشريط الخلفية واسم الإدارة */
export type WeeklyLayout = {
  dir: "v" | "h";
  band: boolean;
  dept: string;
};

export const DEFAULT_LAYOUT: WeeklyLayout = {
  dir: "v",
  band: true,
  dept: "إدارة عمليات الأداء",
};

export type WeeklyPrefs = {
  /** المؤشَّر عليه — المفتاح الغائب يعني «مُطفأ» */
  on: Record<string, boolean>;
  /** الخانات المكتوبة يدويًا */
  texts: Record<string, string>;
  layout: WeeklyLayout;
};

/** الافتراضي: كل المنجزات ظاهرة */
export const DEFAULT_PREFS: WeeklyPrefs = {
  on: Object.fromEntries(WEEK_BLOCKS.map((b) => [b.k, true])),
  texts: {},
  layout: DEFAULT_LAYOUT,
};

export const weekPrefKey = (weekStart: string) => `weekly_wk_${weekStart}`;
export const WEEK_PREF_DEFAULT_KEY = "weekly_prefs";

function clean(v: unknown): Partial<WeeklyPrefs> {
  if (!v || typeof v !== "object") return {};
  const o = v as Record<string, unknown>;
  const on: Record<string, boolean> = {};
  if (o.on && typeof o.on === "object")
    for (const [k, b] of Object.entries(o.on as Record<string, unknown>)) on[k] = !!b;
  const texts: Record<string, string> = {};
  if (o.texts && typeof o.texts === "object")
    for (const [k, s] of Object.entries(o.texts as Record<string, unknown>))
      texts[k] = s == null ? "" : String(s);
  const layout: Partial<WeeklyLayout> = {};
  if (o.layout && typeof o.layout === "object") {
    const l = o.layout as Record<string, unknown>;
    if (l.dir === "v" || l.dir === "h") layout.dir = l.dir;
    if (typeof l.band === "boolean") layout.band = l.band;
    if (typeof l.dept === "string" && l.dept.trim()) layout.dept = l.dept.trim();
  }
  return { on, texts, layout: layout as WeeklyLayout };
}

/** الافتراضي ثم فوقه استثناء الأسبوع — الغائب يرث ما تحته */
export function mergePrefs(base: unknown, week: unknown): WeeklyPrefs {
  const b = clean(base);
  const w = clean(week);
  const on: Record<string, boolean> = { ...DEFAULT_PREFS.on, ...(b.on || {}), ...(w.on || {}) };
  /* الترويسة ثابتة مهما كُتب في القاعدة */
  for (const blk of WEEK_BLOCKS) if (blk.fixed) on[blk.k] = true;
  return {
    on,
    texts: { ...(b.texts || {}), ...(w.texts || {}) },
    layout: { ...DEFAULT_LAYOUT, ...(b.layout || {}), ...(w.layout || {}) },
  };
}

/** أسطر «الخطوات القادمة» من نصّها الحر */
export const listOf = (s: string): string[] =>
  (s || "").split("\n").map((x) => x.trim()).filter(Boolean);

/* ============================================================
   دورة القياس — أرقام الربع في أعلى التقرير
   ------------------------------------------------------------
   ستة أرقامٍ تُكتب يدوياً بعد كل ربع، ولكل ربعٍ أرقامُه. تُحفظ في
   `texts` بمفاتيح `cyc:<2026Q3>:<حقل>` فتمرّ بنفس مسار حفظ
   التقرير ولا تحتاج جدولاً ولا سياسةً جديدة.

   ولا مصدر لها في المنصة: هي حصيلةُ عملٍ يجمعه صاحب التقرير من
   دورة القياس نفسها — بطلب صاحبة المنصة صريحاً.
   ============================================================ */
export type CycField = { k: string; label: string; icon?: string; tone?: "warn" };
export type CycGroup = {
  /** عنوان المجموعة — بلا عنوانٍ للمربّعين الأولين في الصدارة */
  title?: string;
  /** أيقونة العنوان — المربّعات تحته بلا أيقونات */
  icon?: string;
  /** عنوانٌ يذكر الربع، فيُكمَل باسمه عند العرض */
  withQ?: boolean;
  tone?: "warn";
  fields: CycField[];
};

/* ترتيب الورقة كما طلبته صاحبة المنصة: مربّعان في الصدارة لهما
   أيقونتاهما، ثم أربع مجموعاتٍ أيقونتُها في عنوانها لا في مربّعاتها */
export const CYCLE_GROUPS: CycGroup[] = [
  {
    fields: [
      { k: "t1", label: "التقارير الصادرة هذا الربع", icon: "report" },
      { k: "t2", label: "مؤشرات الالتزام التي تم توثيقها", icon: "shield" },
    ],
  },
  {
    title: "المؤشرات",
    icon: "line",
    fields: [
      { k: "k1", label: "مؤشرات رؤية السعودية 2030" },
      { k: "k2", label: "مؤشرات الاستراتيجيات الوطنية" },
      { k: "k3", label: "مؤشرات المخرجات الوطنية" },
    ],
  },
  {
    title: "المبادرات",
    icon: "milestone",
    fields: [
      { k: "b1", label: "مبادرات رؤية السعودية 2030" },
      { k: "b2", label: "مبادرات الاستراتيجيات الوطنية" },
    ],
  },
  {
    title: "ملاحظات الأداء للعناصر المتعثرة خلال",
    icon: "alert",
    withQ: true,
    tone: "warn",
    fields: [
      { k: "w1", label: "ملاحظات الأداء للمؤشرات المتعثرة", tone: "warn" },
      { k: "w2", label: "ملاحظات الأداء للمبادرات المتعثرة", tone: "warn" },
    ],
  },
  {
    title: "نتائج قياس تجربة المستفيد",
    icon: "user-check",
    withQ: true,
    fields: [{ k: "x1", label: "الجهات التي تم قياسها خلال الربع" }],
  },
];

/** كل الحقول مسطَّحةً — لمعرفة هل في الربع رقمٌ مكتوب */
export const CYCLE_FIELDS: CycField[] = CYCLE_GROUPS.flatMap((g) => g.fields);

export const QUARTER_AR = ["الربع الأول", "الربع الثاني", "الربع الثالث", "الربع الرابع"];
/** رمز ربع تاريخٍ بعينه — `2026Q3` */
export function quarterOf(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}Q${Math.floor(d.getMonth() / 3) + 1}`;
}
/** نصُّ الرمز بالعربية — «الربع الثالث لعام 2026» */
export function quarterText(q: string): string {
  const m = /^(\d{4})Q([1-4])$/.exec(q || "");
  return m ? `${QUARTER_AR[Number(m[2]) - 1]} لعام ${m[1]}` : "";
}
/** عنوان التقرير — «دورة القياس للربع الثالث لعام 2026» */
export function cycleTitle(q: string): string {
  const m = /^(\d{4})Q([1-4])$/.exec(q || "");
  return m ? `دورة القياس للربع ${QUARTER_AR[Number(m[2]) - 1].replace("الربع ", "")} لعام ${m[1]}` : "دورة القياس";
}

/** مدى أشهر الربع — «يوليو – سبتمبر 2026» */
export function quarterRange(q: string): string {
  const M = [
    "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
    "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
  ];
  const m = /^(\d{4})Q([1-4])$/.exec(q || "");
  if (!m) return "";
  const i = (Number(m[2]) - 1) * 3;
  return `${M[i]} – ${M[i + 2]} ${m[1]}`;
}

/** مفتاح حقلٍ من حقول الدورة في `texts` */
export const cycKey = (q: string, f: string) => `cyc:${q}:${f}`;
