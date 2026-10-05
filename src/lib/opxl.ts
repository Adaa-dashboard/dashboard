/* ============================================================
   الخطة التشغيلية — المنطق الخالص
   ------------------------------------------------------------
   حسابُ حالة المؤشر ونسبة تقدّمه، وجولةُ الإكسل: بناء صفوف الملف
   وقراءتها. فُصلت عن الصفحة لتُختبر وحدها بلا React ولا شبكة —
   وهي أخطر ما فيها، إذ ترجع من ملفٍ حرّره بشرٌ في إكسل.
   ============================================================ */

export type Rec = Record<string, unknown>;

const txt = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const num = (v: unknown, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const has = (v: unknown) => v !== undefined && v !== null && String(v).trim() !== "";
/** توحيد النصّ للمطابقة — نفس قاعدة بقية المنصة */
const nrm = (v: string) =>
  String(v || "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي")
    .replace(/[\u064B-\u0652]/g, "").replace(/\s+/g, " ").trim().toLowerCase();

export const OP_STATUSES = ["على المسار", "متأخرة", "مكتملة", "لم تبدأ"];

/* ---------- حالة المؤشر: آخر ربعٍ فيه فعلي، مقارناً بمستهدفه ---------- */
export type QCell = { t: number | null; a: number | null };
export function quarters(d: Rec): QCell[] {
  return [1, 2, 3, 4].map((i) => ({
    t: has(d[`q${i}t`]) ? num(d[`q${i}t`]) : null,
    a: has(d[`q${i}a`]) ? num(d[`q${i}a`]) : null,
  }));
}
/** آخر ربعٍ أُدخل فيه فعليّ — هو ما يُحكم به على المؤشر */
export function lastQ(qs: QCell[]) {
  for (let i = qs.length - 1; i >= 0; i--) if (qs[i].a !== null) return { i, ...qs[i] };
  return null;
}
/** على المسار إن بلغ فعليُّه مستهدفَ ربعه — وبلا مستهدفٍ لا حكم */
export function onTrack(d: Rec): boolean | null {
  const q = lastQ(quarters(d));
  if (!q || q.a === null) return null;
  if (q.t === null) return null;
  return q.a >= q.t;
}


/** الحالة المعروضة: المُدخَلة يدوياً، وإلا تُشتقّ للمؤشر من آخر ربعٍ فيه فعلي */
export function opStatus(d: Rec): string {
  const s = txt(d.status).trim();
  if (s) return s;
  if (txt(d.kind) !== "kpi") return "";
  const ok = onTrack(d);
  if (ok === true) return "على المسار";
  if (ok === false) return "متأخرة";
  return lastQ(quarters(d)) ? "على المسار" : "لم تبدأ";
}

/* ============================================================
   جولة الإكسل — ورقةٌ لكل محفظة
   ------------------------------------------------------------
   الخطة تُراجَع في اجتماعٍ ويُكتب عليها في إكسل، فردُّها إلى
   المنصة بنداً بنداً عملٌ لا يُحتمل.

   **الملف مرآةُ الصفحة**: ورقةٌ لكل صاحب محفظة، في صدرها اسمه،
   ثم ثلاثة جداول بالترتيب نفسه — المؤشرات بأرباعها، ثم المبادرات
   بتواريخها وآخر تحديثٍ عليها، ثم المكاسب السريعة مثلها. فمن
   يفتح ورقته يجد عمله وحده أمامه، ويرسلها المديرُ لصاحبها كما
   هي.

   وعمود **المعرّف** مفتاح المطابقة: به يُحدَّث البند نفسه ولا
   يُستنسخ. ومن حذفه طُوبق السطر بـ«المحفظة + البند»، والمحفظة
   تُقرأ من صدر الورقة لا من كل سطر.

   و**الرفع لا يحذف شيئاً**: بندٌ غائبٌ عن الملف يبقى في المنصة.
   الحذف فعلٌ يُقصد، ولا يُستنتج من غياب سطرٍ عن ورقة.
   ============================================================ */

/** عنوان صدر الورقة — به تُعرف المحفظة عند الرفع */
const XL_OWNER = "المحفظة";
/** عناوين الجداول الثلاثة داخل الورقة */
export const XL_SECTIONS: { kind: string; title: string }[] = [
  { kind: "kpi", title: "المؤشرات" },
  { kind: "init", title: "المبادرات" },
  { kind: "win", title: "المكاسب السريعة" },
];
/** أعمدة جدول المؤشرات — أرباعه ثمانية، ولا تواريخ له */
export const XL_KPI_COLS = [
  "المعرّف", "البند", "الراعي", "المسؤول", "المستوى", "الوحدة", "المستهدف العام",
  "Q1 مستهدف", "Q1 فعلي", "Q2 مستهدف", "Q2 فعلي",
  "Q3 مستهدف", "Q3 فعلي", "Q4 مستهدف", "Q4 فعلي",
  "الحالة", "حالة المساهمة",
];
/** أعمدة المبادرات والمكاسب السريعة — واحدةٌ لهما، فهما سواء */
export const XL_INIT_COLS = [
  "المعرّف", "البند", "الراعي", "المسؤول", "نوع المبادرة",
  "البداية", "النهاية", "نسبة التقدم ٪", "الحالة", "آخر تحديث", "حالة المساهمة",
];
const colsOf = (kind: string) => (kind === "kpi" ? XL_KPI_COLS : XL_INIT_COLS);

/** نسبة تقدّم البند: المؤشر تُحسب من آخر فعليٍّ على مستهدفه
    العام، وغيرُه رقمٌ يُكتب بيده إذ لا أرباع له */
export function opPct(d: Rec): number | null {
  if (txt(d.kind) !== "kpi") return has(d.pct) ? Math.max(0, Math.min(100, num(d.pct))) : null;
  const q = lastQ(quarters(d));
  const tgt = has(d.yearTarget) ? num(d.yearTarget) : null;
  if (!q || q.a === null || !tgt) return null;
  return Math.max(0, Math.min(100, Math.round((q.a / tgt) * 100)));
}
/** الحالة المحسوبة وحدها — بها نعرف هل كتب المستخدم حالةً أم تركها تلقائية */
const autoStatus = (d: Rec) => opStatus({ ...d, status: "" });

export type XlRow = { id: string; ord: number; data: Rec; updatedAt?: string };
type Cell = string | number | null;

/** تاريخٌ قصير يُقرأ: 2026-10-05 */
const dayOf = (iso?: string) => (iso && iso.length >= 10 ? iso.slice(0, 10) : "");

function kpiRow(r: XlRow): Cell[] {
  const d = r.data;
  const q = (i: number, k: "t" | "a") => (has(d[`q${i}${k}`]) ? num(d[`q${i}${k}`]) : null);
  return [
    r.id, txt(d.name), txt(d.sponsor), txt(d.assignee),
    num(d.level) > 0 ? num(d.level) : null,
    txt(d.unit) || "%",
    has(d.yearTarget) ? num(d.yearTarget) : null,
    q(1, "t"), q(1, "a"), q(2, "t"), q(2, "a"),
    q(3, "t"), q(3, "a"), q(4, "t"), q(4, "a"),
    opStatus(d), txt(d.note),
  ];
}
function initRow(r: XlRow): Cell[] {
  const d = r.data;
  return [
    r.id, txt(d.name), txt(d.sponsor), txt(d.assignee), txt(d.itype),
    txt(d.start), txt(d.end), opPct(d), opStatus(d), dayOf(r.updatedAt), txt(d.note),
  ];
}

/** ورقةٌ لكل محفظة — صدرٌ باسمها ثم الجداول الثلاثة */
export function xlSheet(owner: string, rows: XlRow[]): Cell[][] {
  const out: Cell[][] = [[XL_OWNER, owner], []];
  for (const sec of XL_SECTIONS) {
    const list = rows.filter((r) => txt(r.data.kind) === sec.kind);
    out.push([sec.title, list.length]);
    out.push(colsOf(sec.kind));
    for (const r of list) out.push(sec.kind === "kpi" ? kpiRow(r) : initRow(r));
    /* سطرٌ فارغ يفصل الجداول — وهو نفسه ما يُنهي الجدول عند القراءة */
    out.push([]);
  }
  return out;
}

/** الكتاب كاملاً: ورقةٌ لكل محفظة بترتيب ظهورها في الصفحة */
export function xlBook(rows: XlRow[], owners: string[]): { name: string; rows: Cell[][] }[] {
  const seen = owners.filter((o) => o);
  for (const r of rows) {
    const o = txt(r.data.owner).trim();
    if (o && !seen.includes(o)) seen.push(o);
  }
  const book = seen
    .map((o) => ({ name: o, rows: xlSheet(o, rows.filter((r) => txt(r.data.owner).trim() === o)) }))
    .filter((sh) => rows.some((r) => txt(r.data.owner).trim() === sh.name));
  /* بندٌ بلا محفظة لا يسقط من الملف — له ورقته حتى يُسنَد */
  const orphan = rows.filter((r) => !txt(r.data.owner).trim());
  if (orphan.length) book.push({ name: "بلا محفظة", rows: xlSheet("", orphan) });
  return book;
}

/** ما سيفعله الرفع قبل أن يُنفَّذ — يُعرض ليُقرّ */
export type XlPlan = {
  put: { id: string; ord: number; data: Rec; name: string; add: boolean }[];
  same: number;
  skipped: string[];
};

const blank = (row: string[]) => !row || row.every((c) => txt(c).trim() === "");

/** قراءة الكتاب: كل ورقة محفظة، وكل جدولٍ فيها نوعٌ من البنود */
export function xlParseBook(sheets: { name: string; rows: string[][] }[], rows: XlRow[]): XlPlan {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const byKey = new Map(rows.map((r) => [nrm(txt(r.data.owner)) + "|" + nrm(txt(r.data.name)), r]));
  const plan: XlPlan = { put: [], same: 0, skipped: [] };
  let ord = rows.reduce((a, r) => Math.max(a, r.ord), 0);
  let seq = 0;

  for (const sh of sheets) {
    const grid = sh.rows || [];
    /* المحفظة من صدر الورقة، وإلا من اسمها — واسم الورقة قد يكون
       مقتطعاً (٣١ محرفاً حدّ إكسل) فالصدر أوثق */
    let owner = "";
    for (let i = 0; i < Math.min(grid.length, 5); i++) {
      if (nrm(txt(grid[i]?.[0])) === nrm(XL_OWNER)) {
        owner = txt(grid[i]?.[1]).trim();
        break;
      }
    }
    if (!owner && sh.name && nrm(sh.name) !== nrm("بلا محفظة")) owner = sh.name.trim();

    let i = 0;
    while (i < grid.length) {
      const first = txt(grid[i]?.[0]).trim();
      const sec = XL_SECTIONS.find((x) => nrm(x.title) === nrm(first));
      if (!sec) {
        i += 1;
        continue;
      }
      const head = (grid[i + 1] || []).map((x) => nrm(txt(x)));
      const col = Object.fromEntries(colsOf(sec.kind).map((c) => [c, head.indexOf(nrm(c))])) as
        Record<string, number>;
      if (col["البند"] < 0) {
        plan.skipped.push(`${sh.name}: جدول «${sec.title}» بلا عمود «البند»`);
        i += 2;
        continue;
      }
      i += 2;
      for (; i < grid.length; i++) {
        const row = grid[i] || [];
        if (blank(row)) break;
        /* عنوان الجدول التالي ينهي هذا الجدول ولو لم يسبقه فراغ */
        if (XL_SECTIONS.some((x) => nrm(x.title) === nrm(txt(row[0]).trim()))) break;
        const cell = (c: string) => txt(col[c] >= 0 ? row[col[c]] : "").trim();
        const name = cell("البند");
        if (!name) {
          plan.skipped.push(`${sh.name} · ${sec.title}: سطر ${i + 1} بلا اسم بند`);
          continue;
        }
        const hit = byId.get(cell("المعرّف")) || byKey.get(nrm(owner) + "|" + nrm(name));
        const d: Rec = hit ? { ...hit.data } : {};

        const setT = (k: string, v: string) => {
          if (v === "") delete d[k];
          else d[k] = v;
        };
        const setN = (k: string, v: string) => {
          if (v === "") delete d[k];
          else if (Number.isFinite(Number(v))) d[k] = Number(v);
        };

        d.kind = sec.kind;
        d.name = name;
        if (owner) d.owner = owner;
        setT("sponsor", cell("الراعي"));
        setT("assignee", cell("المسؤول"));
        setT("note", cell("حالة المساهمة"));
        if (sec.kind === "kpi") {
          setN("level", cell("المستوى"));
          const u = cell("الوحدة");
          if (u) d.unit = u === "٪" || u === "%" ? "%" : "عدد";
          setN("yearTarget", cell("المستهدف العام"));
          for (const q of [1, 2, 3, 4]) {
            setN(`q${q}t`, cell(`Q${q} مستهدف`));
            setN(`q${q}a`, cell(`Q${q} فعلي`));
          }
          delete d.pct;
        } else {
          setT("itype", cell("نوع المبادرة"));
          setT("start", cell("البداية"));
          setT("end", cell("النهاية"));
          setN("pct", cell("نسبة التقدم ٪"));
        }
        /* «آخر تحديث» تكتبه القاعدة عند الحفظ، فما في الملف خبرٌ
           يُقرأ لا قيمةٌ تُكتب — ولو قُبل لكذب التاريخ */

        /* الحالة: عمودٌ **محسوبٌ للمؤشر**، فالخلية التي لم تُمسّ تحمل
           حالة يوم التنزيل. فلو كُتبت كما جاءت لجمّدت المؤشر على حالةٍ
           قديمة بعد تعديل أرباعه. تبقى تلقائيةً إن وافقت المحسوبة
           الجديدة، أو إن كانت عين ما نُزِّل لبندٍ لم تُكتب حالته
           أصلاً — أي لم تُمسّ. وما خالف ذلك قصدٌ فيُكتب صريحاً. */
        const st = cell("الحالة");
        const wasAuto = !hit || !txt(hit.data.status).trim();
        const shown = hit ? opStatus(hit.data) : "";
        if (!st || st === autoStatus(d) || (wasAuto && st === shown)) delete d.status;
        else if (OP_STATUSES.includes(st)) d.status = st;

        if (hit && JSON.stringify(hit.data) === JSON.stringify(d)) {
          plan.same += 1;
          continue;
        }
        plan.put.push({
          id: hit ? hit.id : `op-x${Date.now().toString(36)}${seq++}`,
          ord: hit ? hit.ord : ++ord,
          data: d,
          name,
          add: !hit,
        });
      }
    }
  }
  return plan;
}
