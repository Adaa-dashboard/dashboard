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
/** عمود اسم البند يختلف باسمه في كل جدول — كما في قالب المستخدمة */
const NAME_COL: Record<string, string> = {
  kpi: "اسم المؤشر", init: "اسم المبادرة", win: "البند",
};
/** كل ما قد يُسمّى به عمود الاسم — فيُقرأ القالب القديم والجديد */
const NAME_ANY = ["اسم المؤشر", "اسم المبادرة", "اسم المكسب", "البند"];

/** أعمدة جدول المؤشرات — أرباعه ثمانية، ولا تواريخ له */
export const XL_KPI_COLS = [
  "المعرّف", NAME_COL.kpi, "الراعي", "المسؤول", "المستوى", "الوحدة", "المستهدف العام",
  "Q1 مستهدف", "Q1 فعلي", "Q2 مستهدف", "Q2 فعلي",
  "Q3 مستهدف", "Q3 فعلي", "Q4 مستهدف", "Q4 فعلي",
  "الحالة", "حالة المساهمة",
];
/** أعمدة المبادرات والمكاسب السريعة — واحدةٌ لهما، فهما سواء */
export const XL_INIT_COLS = [
  "المعرّف", NAME_COL.init, "الراعي", "المسؤول", "نوع المبادرة",
  "البداية", "النهاية", "الحالة", "آخر تحديث", "حالة المساهمة",
];
const colsOf = (kind: string) =>
  kind === "kpi" ? XL_KPI_COLS : XL_INIT_COLS.map((c, i) => (i === 1 ? NAME_COL[kind] : c));

/* أعرض الأعمدة بالمحارف — من قالب المستخدمة، إلا عمودَي الاسم
   وحالة المساهمة فوُسِّعا: قالبُها كان فارغاً، وبالبيانات الحقيقية
   يُقتطع الاسم الطويل في خمسة عشر محرفاً */
const W_KPI = [10, 46, 13, 18, 10, 9, 13, 11, 10, 11, 10, 11, 10, 11, 10, 11, 40];
const W_INIT = [10, 46, 13, 18, 12, 14, 14, 11, 12, 40];
const widthOf = (kind: string) => (kind === "kpi" ? W_KPI : W_INIT);

/* «نسبة التقدم» أُزيلت بطلب صاحبة المنصة: المبادرة والمكسب
   السريع بلا أرباع، فلا سبيل إلى حسابها، ورقمٌ يُكتب بالتقدير
   يُقرأ كأنه مقيس. والمؤشر حالُه تُقرأ من أرباعه. */
/** الحالة المحسوبة وحدها — بها نعرف هل كتب المستخدم حالةً أم تركها تلقائية */
const autoStatus = (d: Rec) => opStatus({ ...d, status: "" });

export type XlRow = { id: string; ord: number; data: Rec; updatedAt?: string };
type Cell = string | number | null;
type CellOut = Cell | { v: Cell; s?: "hd" | "c" };

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
    txt(d.start), txt(d.end), opStatus(d), dayOf(r.updatedAt), txt(d.note),
  ];
}

/** حرف العمود: 0 ⇒ A */
const colLetter = (i: number) => {
  let n = i, out = "";
  do { out = String.fromCharCode(65 + (n % 26)) + out; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return out;
};

export type XlSheetOut = {
  name: string;
  rows: CellOut[][];
  cols: number[];
  merges: string[];
  heights: Record<number, number>;
  rtl: boolean;
};

/** ورقةٌ لكل محفظة — صدرٌ باسمها ثم الجداول الثلاثة، على شكل
    القالب المعتمد: عنوان الجدول مدموجٌ بعدده بين قوسين، ورأسٌ
    أخضر، وخلايا متوسَّطة */
export function xlSheet(owner: string, rows: XlRow[]): XlSheetOut {
  const out: CellOut[][] = [];
  const merges: string[] = [];
  const heights: Record<number, number> = {};
  const hd = (v: string | number) => ({ v, s: "hd" as const });

  out.push([hd(XL_OWNER), hd(owner)]);
  out.push([]);
  for (const sec of XL_SECTIONS) {
    const list = rows.filter((r) => txt(r.data.kind) === sec.kind);
    const cols = colsOf(sec.kind);
    /* العنوان يمتدّ على عرض جدوله، فيُكتب في خلاياه كلها ليمتدّ
       اللون معه ثم تُدمج — والمدموجة التي لا تُنمَّط تبقى بيضاء */
    const titleRow = out.length + 1;
    heights[titleRow] = 29;
    out.push(cols.map((_, i) => (i === 0 ? hd(`${sec.title} (${list.length})`) : hd(""))));
    merges.push(`A${titleRow}:${colLetter(cols.length - 1)}${titleRow}`);
    out.push(cols.map((c) => hd(c)));
    for (const r of list) {
      const cells = sec.kind === "kpi" ? kpiRow(r) : initRow(r);
      out.push(cells.map((v) => ({ v, s: "c" as const })));
    }
    /* سطرٌ فارغ يفصل الجداول — وهو نفسه ما يُنهي الجدول عند القراءة */
    out.push([]);
  }
  return { name: owner || "بلا محفظة", rows: out, cols: widthOf("kpi"), merges, heights, rtl: true };
}

/** الكتاب كاملاً: ورقةٌ لكل محفظة بترتيب ظهورها في الصفحة */
export function xlBook(rows: XlRow[], owners: string[]): XlSheetOut[] {
  const seen = owners.filter((o) => o);
  for (const r of rows) {
    const o = txt(r.data.owner).trim();
    if (o && !seen.includes(o)) seen.push(o);
  }
  const book = seen
    .filter((o) => rows.some((r) => txt(r.data.owner).trim() === o))
    .map((o) => xlSheet(o, rows.filter((r) => txt(r.data.owner).trim() === o)));
  /* بندٌ بلا محفظة لا يسقط من الملف — له ورقته حتى يُسنَد */
  const orphan = rows.filter((r) => !txt(r.data.owner).trim());
  if (orphan.length) book.push(xlSheet("", orphan));
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
      /* العنوان يحمل عدده بين قوسين — «المؤشرات (6)» — والعدد
         محسوبٌ لا مُدخَل، فيُطرح قبل المطابقة */
      const first = txt(grid[i]?.[0]).replace(/\s*\(.*?\)\s*$/, "").trim();
      const sec = XL_SECTIONS.find((x) => nrm(x.title) === nrm(first));
      if (!sec) {
        i += 1;
        continue;
      }
      const head = (grid[i + 1] || []).map((x) => nrm(txt(x)));
      const col = Object.fromEntries(colsOf(sec.kind).map((c) => [c, head.indexOf(nrm(c))])) as
        Record<string, number>;
      /* عمود الاسم يُسمّى باسم جدوله («اسم المؤشر» · «اسم المبادرة»)
         أو «البند» في الملفات الأقدم — فأيُّها وُجد كفى */
      const nameAt = NAME_ANY.map((c) => head.indexOf(nrm(c))).find((x) => x >= 0) ?? -1;
      if (nameAt < 0) {
        plan.skipped.push(`${sh.name}: جدول «${sec.title}» بلا عمود لاسم البند`);
        i += 2;
        continue;
      }
      i += 2;
      for (; i < grid.length; i++) {
        const row = grid[i] || [];
        if (blank(row)) break;
        /* عنوان الجدول التالي ينهي هذا الجدول ولو لم يسبقه فراغ */
        if (
          XL_SECTIONS.some(
            (x) => nrm(x.title) === nrm(txt(row[0]).replace(/\s*\(.*?\)\s*$/, "").trim()),
          )
        ) break;
        const cell = (c: string) => txt(col[c] >= 0 ? row[col[c]] : "").trim();
        const name = txt(row[nameAt]).trim();
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

/* ============================================================
   نسبة مساهمة كل موظف
   ------------------------------------------------------------
   **مساهمةٌ بالعدد لا بالإنجاز**: كم بنداً للموظف فيه دورٌ مُسمّى.
   البند يُحسب مرةً واحدة لكل شخص مهما تعدّدت أدواره فيه، ويُحسب لكل
   من ذُكر فيه — فمجموع النسب يتجاوز 100% بطبيعته، إذ للبند راعٍ
   ومسؤولون.

   و**الاسم الجماعي ليس موظفاً**: «مدراء القطاعات» و«الفريق المركزي»
   كانا يظهران صفّاً كأنهما شخص. يُحلّان إلى أصحابهما ويُحسب البند
   لكلٍّ منهم — وما لم يُعرف له أصحاب يسقط ولا يبقى صفّاً وهمياً.

   وهنا لا في الصفحة ليُختبر بلا React ولا شبكة.
   ============================================================ */

export type OpPerson = { name: string; isLead: boolean };
export type OpShare = {
  name: string;
  items: number;
  sponsor: number;
  assignee: number;
  k: Record<string, number>;
};

/** خانةٌ قد تحمل أكثر من اسم: «أ · ب» أو «أ، ب» */
export const opNames = (v: unknown) =>
  txt(v).split(/[·,،/|]+/).map((x) => x.trim()).filter(Boolean);

/** أسماءٌ جماعية في خانات الخطة — تُحلّ إلى أصحابها */
export const OP_GROUPS: Record<string, "leads" | "all"> = {
  "مدراء القطاعات": "leads",
  "مديري القطاعات": "leads",
  "مدراء المحافظ": "leads",
  "الفريق المركزي": "all",
  "فريق العمل": "all",
  الفريق: "all",
  "فريق الإدارة": "all",
};
const GROUP_KEY: Record<string, "leads" | "all"> = Object.fromEntries(
  Object.entries(OP_GROUPS).map(([k, v]) => [nrm(k), v]),
);

/**
 * صفٌّ لكل موظف — ولو بلا بند، فهذا معنى «على كل موظف».
 * @param both احسب الرعاية مع المسؤولية، أو المسؤولية وحدها
 */
export function opShares(
  rows: { data: Rec }[],
  people: OpPerson[],
  both: boolean,
  /** تصحيح الأسماء القديمة — تمرّره الصفحة، وبدونه يُؤخذ الاسم كما هو */
  fix: (n: string) => string = (n) => n,
): OpShare[] {
  const leads = people.filter((x) => x.isLead).map((x) => x.name);
  const everyone = people.map((x) => x.name);
  const spread = (n: string): string[] => {
    const g = GROUP_KEY[nrm(n)];
    if (!g) return [n];
    return g === "leads" ? leads : everyone;
  };

  const m = new Map<string, OpShare>();
  const touch = (n: string) => {
    const name = fix(n);
    const key = nrm(name);
    const e = m.get(key) || { name, items: 0, sponsor: 0, assignee: 0, k: { kpi: 0, init: 0, win: 0 } };
    m.set(key, e);
    return e;
  };
  for (const x of people) if (x.name.trim()) touch(x.name);

  const fields = both ? (["sponsor", "assignee"] as const) : (["assignee"] as const);
  for (const r of rows) {
    const kind = txt(r.data.kind);
    const seen = new Set<string>();
    for (const f of fields) {
      for (const raw of opNames(r.data[f])) {
        for (const n of spread(raw)) {
          const key = nrm(fix(n));
          if (!key) continue;
          const e = touch(n);
          e[f] += 1;
          if (!seen.has(key)) {
            e.items += 1;
            e.k[kind] = (e.k[kind] || 0) + 1;
            seen.add(key);
          }
        }
      }
    }
  }
  return [...m.values()].sort((a, b) => b.items - a.items || a.name.localeCompare(b.name, "ar"));
}
