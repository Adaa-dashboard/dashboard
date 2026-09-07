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
  { k: "perf", name: "الأداء العام + الفرق عن الأسبوع الماضي", note: "الدائرة والنسبة والحقائق أعلى التقرير", kind: "auto" },
  { k: "sessions", name: "جلسات مراجعة الأداء", note: "يُقرأ آليًا من صفحة الجلسات", kind: "auto" },
  { k: "natstrat", name: "الاستراتيجيات الوطنية", note: "يُقرأ آليًا من صفحة الاستراتيجيات الوطنية", kind: "auto" },
  { k: "inststrat", name: "الاستراتيجيات المؤسسية", note: "يُقرأ آليًا من صفحة الاستراتيجيات المؤسسية", kind: "auto" },
  { k: "outputs", name: "المخرجات الوطنية", note: "يُقرأ آليًا من صفحة المخرجات", kind: "auto" },
  { k: "cx", name: "أعمال قياس تجربة المستفيد", note: "يُقرأ آليًا من صفحة تجربة المستفيد", kind: "auto" },
  { k: "projects", name: "المشاريع الاستراتيجية", note: "يُقرأ آليًا من صفحة المشاريع", kind: "auto" },
  { k: "asg", name: "التكاليف الواردة للمركز", note: "الموضوع والحالة وما كُتب لكل تكليف", kind: "auto" },
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

export type WeeklyPrefs = {
  /** المؤشَّر عليه — المفتاح الغائب يعني «مُطفأ» */
  on: Record<string, boolean>;
  /** الخانات المكتوبة يدويًا */
  texts: Record<string, string>;
};

/** الافتراضي: كل شيء ظاهر ما عدا المخرجات (لم تُعتمد بياناتها بعد) */
export const DEFAULT_PREFS: WeeklyPrefs = {
  on: Object.fromEntries(WEEK_BLOCKS.map((b) => [b.k, b.k !== "outputs"])),
  texts: {},
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
  return { on, texts };
}

/** الافتراضي ثم فوقه استثناء الأسبوع — الغائب يرث ما تحته */
export function mergePrefs(base: unknown, week: unknown): WeeklyPrefs {
  const b = clean(base);
  const w = clean(week);
  const on: Record<string, boolean> = { ...DEFAULT_PREFS.on, ...(b.on || {}), ...(w.on || {}) };
  /* الترويسة ثابتة مهما كُتب في القاعدة */
  for (const blk of WEEK_BLOCKS) if (blk.fixed) on[blk.k] = true;
  return { on, texts: { ...(b.texts || {}), ...(w.texts || {}) } };
}

/** أسطر «أولويات الأسبوع القادم» من نصّها الحر */
export const listOf = (s: string): string[] =>
  (s || "").split("\n").map((x) => x.trim()).filter(Boolean);
