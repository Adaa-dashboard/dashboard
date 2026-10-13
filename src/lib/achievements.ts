/* ============================================================
   منجزات الأسبوع — تُقرأ من المنصة نفسها لا تُكتب يدوياً.

   مصدران:
   ١) **سجلّ تغييرات البنود** (`perf_item_log`): كل تعديل على صفّ
      قسمٍ محفوظٌ بحقله وقيمته قبل وبعد. القواعد هنا تترجم ما
      يستحقّ منها إلى منجز: «رُفعت قابلية قياس استراتيجية الطاقة
      من 40% إلى 100%». وما لا يعني شيئاً (اسمٌ صُحِّح) يبقى في
      السجلّ ولا يظهر.
   ٢) **ما له تاريخٌ أصلاً**: طلبات التغيير المُغلقة، والتكاليف
      المكتملة، وجهات التواصل المراجَعة — هذه لا تحتاج سجلّاً.

   الترجمة كلها هنا، فالواجهة تعرض ولا تحسب.
   ============================================================ */

export type LogRow = {
  at: string;
  section: string;
  itemId: string;
  name: string;
  field: string;
  oldVal: string;
  newVal: string;
  byName: string;
};

/** منجزٌ واحد بعد الترجمة */
export type Ach = {
  /** مفتاح النوع — به تُجمع البطاقات */
  k: string;
  /** اسم البند: الجهة أو الاستراتيجية */
  name: string;
  /** تفصيلٌ قصير يظهر تحت الاسم: «40% ← 100%» */
  detail?: string;
  at: string;
  by?: string;
};

export type AchKind = {
  k: string;
  /** عنوان البطاقة — صيغة الجمع */
  title: string;
  /** وحدة العدّ في العنوان المفرد، للصياغة العربية */
  unit: string;
};

/* ترتيب البطاقات في التقرير — وهو ترتيب الأهمية */
export const ACH_KINDS: AchKind[] = [
  { k: "meas", title: "استراتيجيات رُفعت قابلية قياسها", unit: "استراتيجية" },
  { k: "natstage", title: "استراتيجيات تقدّمت في الاعتماد", unit: "استراتيجية" },
  { k: "tech", title: "استراتيجيات قُبلت فنياً", unit: "استراتيجية" },
  { k: "live", title: "جهات فُعِّل قياسها", unit: "جهة" },
  { k: "instep", title: "جهات تقدّمت في مسار التفعيل", unit: "جهة" },
  { k: "session", title: "جلسات مراجعة أداء تقدّمت", unit: "جلسة" },
  { k: "cxrep", title: "تقارير تجربة مستفيد صدرت", unit: "تقرير" },
  { k: "cxstep", title: "أجهزة تقدّمت في مسار القياس", unit: "جهاز" },
  { k: "proj", title: "مشاريع تقدّمت", unit: "مشروع" },
  { k: "notesq", title: "أرباع رُفعت لجودة الملاحظات", unit: "ربع" },
  { k: "review", title: "جهات روجعت بياناتها", unit: "جهة" },
  { k: "cr", title: "طلبات تغيير روجعت", unit: "طلب" },
  { k: "task", title: "تكاليف أُكملت", unit: "تكليف" },
];

const txt = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const numOf = (v: unknown) => {
  const n = Number(txt(v).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : null;
};
const isYes = (v: string) => ["نعم", "true", "✓", "✅", "مفعل", "تم", "مكتمل"].includes(v.trim());

/* مراحل اعتماد الاستراتيجية الوطنية — الرقم في الحقل `stage` */
const NAT_STEPS = ["طور الإعداد", "قيد المراجعة", "معتمدة من اللجنة", "معتمدة من مجلس الوزراء"];
const natStep = (v: string) => NAT_STEPS[Math.max(1, Math.min(4, numOf(v) ?? 1)) - 1];

/* مسار الجهة في الاستراتيجيات المؤسسية */
const INST_FIELDS: Record<string, string> = {
  rep: "تسمية ممثل",
  meet: "الاجتماع التعريفي",
  docs: "استلام الوثائق",
  docsState: "حالة الوثائق",
};
/* مسار الجهاز في تجربة المستفيد */
const CX_FIELDS: Record<string, string> = {
  meet: "الاجتماع التعريفي",
  survey: "حصر الخدمات",
  card: "بطاقة القياس",
  l1: "استبيان المستفيدين",
};

/**
 * ترجمة سطرٍ من السجلّ إلى منجز — أو `null` إن كان تعديلاً
 * لا يُعدّ إنجازاً (تصحيح اسم، تراجعٌ في قيمة، حقلٌ لا يعنينا).
 */
export function achOf(r: LogRow): Ach | null {
  const base = { name: r.name || r.itemId, at: r.at, by: r.byName };
  const o = r.oldVal.trim();
  const n = r.newVal.trim();
  if (r.field === "__new") return null;

  if (r.section === "natstrat") {
    if (r.field === "meas") {
      const a = numOf(o) ?? 0;
      const b = numOf(n);
      /* الارتفاع وحده منجز — والهبوط خبرٌ آخر لا مكان له هنا */
      if (b == null || b <= a) return null;
      return { ...base, k: "meas", detail: `${a}% ← ${b}%` };
    }
    if (r.field === "stage") {
      const a = numOf(o) ?? 0;
      const b = numOf(n) ?? 0;
      if (b <= a) return null;
      return { ...base, k: "natstage", detail: `${natStep(o)} ← ${natStep(n)}` };
    }
    if (r.field === "tech" && isYes(n) && !isYes(o))
      return { ...base, k: "tech", detail: "مقبولة فنياً" };
    return null;
  }

  if (r.section === "inststrat") {
    if (r.field === "live")
      return isYes(n) && !isYes(o) ? { ...base, k: "live", detail: "فُعِّل القياس" } : null;
    const lbl = INST_FIELDS[r.field];
    if (lbl && n && n !== o && !/^(لم|غير|✗)/.test(n))
      return { ...base, k: "instep", detail: `${lbl}: ${n}` };
    return null;
  }

  if (r.section === "cx") {
    /* عدد التقارير في سنةٍ ارتفع ⇒ صدر تقرير */
    if (/^rep\d{4}$/.test(r.field)) {
      const a = numOf(o) ?? 0;
      const b = numOf(n) ?? 0;
      if (b <= a) return null;
      return { ...base, k: "cxrep", detail: b - a > 1 ? `${b - a} تقارير` : "تقرير واحد" };
    }
    const lbl = CX_FIELDS[r.field];
    if (lbl && n && n !== o && !/^(لم|غير|✗)/.test(n))
      return { ...base, k: "cxstep", detail: `${lbl}: ${n}` };
    return null;
  }

  if (r.section === "sessions" && r.field === "done") {
    const a = numOf(o) ?? 0;
    const b = numOf(n) ?? 0;
    if (b <= a) return null;
    return { ...base, k: "session", detail: `${a} ← ${b} من 6 مراحل` };
  }

  if (r.section === "projects" && (r.field === "act" || r.field === "progress")) {
    const a = numOf(o) ?? 0;
    const b = numOf(n);
    if (b == null || b <= a) return null;
    return { ...base, k: "proj", detail: `${a}% ← ${b}%` };
  }

  if (r.section === "notesq" && r.field === "pct") {
    const b = numOf(n);
    if (b == null) return null;
    return { ...base, k: "notesq", detail: `الالتزام ${b}%` };
  }

  return null;
}

/** كل منجزات السجلّ في المدى — مرتّبةً بوقتها */
export function achFromLog(rows: LogRow[]): Ach[] {
  const out: Ach[] = [];
  for (const r of rows) {
    const a = achOf(r);
    if (a) out.push(a);
  }
  return out;
}

/* ---------------- ما له تاريخٌ أصلاً ---------------- */

export type ChangeLite = {
  code?: string; owner?: string; itemName?: string;
  sla?: number | null; workDays?: number | null;
  status?: string; closedAt?: string;
};
export type TaskLite = { id?: string; title?: string; kind?: string; state?: string; completedAt?: string };
export type ContactLite = { entity?: string; reviewedAt?: string };

const inRange = (iso: string, from: string, to: string) => {
  const d = (iso || "").slice(0, 10);
  return !!d && d >= from && d <= to;
};

/** طلبات التغيير التي أُغلقت في المدى، ومعها نسبة الالتزام */
export function achChanges(rows: ChangeLite[], from: string, to: string) {
  const done = rows.filter((c) => inRange(txt(c.closedAt), from, to));
  let n = 0, ok = 0;
  for (const c of done) {
    if (c.sla == null || c.workDays == null) continue;
    n++;
    if (Number(c.workDays) < Number(c.sla)) ok++;
  }
  return {
    list: done.map<Ach>((c) => ({
      k: "cr",
      name: txt(c.code),
      detail: txt(c.itemName) || txt(c.owner),
      at: txt(c.closedAt),
    })),
    pct: n ? Math.round((ok / n) * 100) : null,
    n,
  };
}

/** التكاليف المكتملة في المدى */
export function achTasks(rows: TaskLite[], from: string, to: string): Ach[] {
  return rows
    .filter((x) => txt(x.kind) === "assignment" && inRange(txt(x.completedAt), from, to))
    .map((x) => ({ k: "task", name: txt(x.title), at: txt(x.completedAt) }));
}

/** جهات روجعت بياناتها في المدى */
export function achReviews(rows: ContactLite[], from: string, to: string): Ach[] {
  const seen = new Set<string>();
  const out: Ach[] = [];
  for (const c of rows) {
    if (!inRange(txt(c.reviewedAt), from, to)) continue;
    const nm = txt(c.entity);
    if (!nm || seen.has(nm)) continue;
    seen.add(nm);
    out.push({ k: "review", name: nm, at: txt(c.reviewedAt) });
  }
  return out;
}

/** تجميع المنجزات ببطاقاتها بترتيب `ACH_KINDS` */
export function achGroups(list: Ach[]): { kind: AchKind; items: Ach[] }[] {
  return ACH_KINDS.map((kind) => ({
    kind,
    items: list.filter((a) => a.k === kind.k),
  }));
}

/** صيغة العدد العربية: «جهة واحدة» · «جهتان» · «٣ جهات» */
export function arCount(n: number, unit: string): string {
  const plural: Record<string, string> = {
    استراتيجية: "استراتيجيات", جهة: "جهات", جلسة: "جلسات", تقرير: "تقارير",
    جهاز: "أجهزة", مشروع: "مشاريع", ربع: "أرباع", طلب: "طلبات", تكليف: "تكاليف",
  };
  const p = plural[unit] || unit;
  if (n === 1) return `${unit} واحدة`;
  /* المثنى: «جهة» ⇒ «جهتان» لا «جهةان» — التاء المربوطة تُفتح */
  if (n === 2) return unit.endsWith("ة") ? `${unit.slice(0, -1)}تان` : `${unit}ان`;
  if (n <= 10) return `${n} ${p}`;
  return `${n} ${unit}`;
}

/* ---------------- تجميع تقرير الأسبوع ---------------- */

export type WeekAch = {
  weekStart: string;
  weekEnd: string;
  /** البطاقات بترتيب `ACH_KINDS` — المطفأة في التفضيلات مُسقَطة */
  groups: { kind: AchKind; items: Ach[] }[];
  /** نسبة الالتزام في طلبات التغيير المُغلقة هذا الأسبوع */
  crPct: number | null;
  /** مجموع المنجزات */
  total: number;
};

export function buildWeekAch(args: {
  weekStart: string;
  weekEnd: string;
  log: LogRow[];
  changes: ChangeLite[];
  tasks: TaskLite[];
  contacts: ContactLite[];
  /** مفاتيح المنجزات المؤشَّر عليها */
  on: Record<string, boolean>;
}): WeekAch {
  const { weekStart: a, weekEnd: b } = args;
  const cr = achChanges(args.changes, a, b);
  const all: Ach[] = [
    ...achFromLog(args.log),
    ...cr.list,
    ...achTasks(args.tasks, a, b),
    ...achReviews(args.contacts, a, b),
  ];
  /* المنجَز أولاً والأكثر عدداً قبل غيره، والأصفار في آخر الصفحة —
     فالتقرير يبدأ بما وقع لا بما لم يقع، وترتيب `ACH_KINDS` يفصل
     بين المتساويين فيبقى الشكل ثابتاً من أسبوع لآخر */
  const groups = achGroups(all)
    .filter((g) => args.on[g.kind.k] !== false)
    .map((g, i) => ({ g, i }))
    .sort((x, y) => y.g.items.length - x.g.items.length || x.i - y.i)
    .map((x) => x.g);
  return {
    weekStart: a,
    weekEnd: b,
    groups,
    crPct: cr.pct,
    total: groups.reduce((n, g) => n + g.items.length, 0),
  };
}
