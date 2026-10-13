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
  { k: "head", name: "ترويسة التقرير والفترة", note: "اسم التقرير والإدارة والفترة الزمنية", kind: "auto", fixed: true },
  /* المنجزات — تُقرأ من سجلّ تغييرات المنصة، مفتاحها مفتاح نوعها
     في `lib/achievements.ts` فلا قائمتان تفترقان */
  { k: "meas", name: "رفع قابلية القياس", note: "استراتيجية وطنية ارتفعت نسبة قابلية قياسها", kind: "auto" },
  { k: "natstage", name: "تقدّم اعتماد الاستراتيجيات", note: "انتقال الاستراتيجية إلى مرحلة اعتمادٍ أعلى", kind: "auto" },
  { k: "tech", name: "القبول الفني", note: "استراتيجية صارت مقبولة فنياً", kind: "auto" },
  { k: "live", name: "تفعيل قياس الجهات", note: "جهة مؤسسية فُعِّل قياسها", kind: "auto" },
  { k: "instep", name: "تقدّم مسار التفعيل", note: "تسمية ممثل · اجتماع تعريفي · وثائق", kind: "auto" },
  { k: "session", name: "تقدّم جلسات مراجعة الأداء", note: "اكتمال مرحلة من مراحل الجلسة", kind: "auto" },
  { k: "cxrep", name: "تقارير تجربة المستفيد", note: "صدور تقرير لجهاز", kind: "auto" },
  { k: "cxstep", name: "تقدّم مسار تجربة المستفيد", note: "حصر الخدمات · بطاقة القياس · الاستبيان", kind: "auto" },
  { k: "proj", name: "تقدّم المشاريع الاستراتيجية", note: "ارتفاع نسبة الإنجاز الفعلي", kind: "auto" },
  { k: "notesq", name: "جودة ملاحظات الأداء", note: "رفع بيانات ربعٍ جديد", kind: "auto" },
  { k: "review", name: "مراجعة بيانات الجهات", note: "المراجعة الربعية لجهات التواصل", kind: "auto" },
  { k: "cr", name: "مراجعة طلبات التغيير", note: "ما أُغلق منها في الأسبوع ونسبة الالتزام", kind: "auto" },
  { k: "task", name: "التكاليف المكتملة", note: "تكليفٌ وارد للمركز أُنجز", kind: "auto" },
  {
    k: "next", name: "الخطوات القادمة", note: "تُكتب يدويًا — نص حر", kind: "text",
    hint: "ما ستعمل عليه الإدارة الأسبوع القادم، في سطرين أو ثلاثة.",
  },
  {
    k: "support", name: "الدعم المطلوب", note: "تُكتب يدويًا — نص حر", kind: "text",
    hint: "ما تحتاجه الإدارة من جهة أعلى: مخاطبة، قرار، تنسيق…",
  },
  {
    k: "challenges", name: "التحديات", note: "تُكتب يدويًا — نص حر", kind: "text",
    hint: "ما يعيق العمل هذا الأسبوع.",
  },
  {
    k: "priorities", name: "أولويات الأسبوع القادم", note: "تُكتب يدويًا — سطر لكل أولوية", kind: "list",
    hint: "أولوية في كل سطر — تظهر مرقّمة في التقرير.",
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

/** أسطر «أولويات الأسبوع القادم» من نصّها الحر */
export const listOf = (s: string): string[] =>
  (s || "").split("\n").map((x) => x.trim()).filter(Boolean);
