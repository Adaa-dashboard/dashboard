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
   جولة الإكسل — تنزيلٌ وتعديلٌ ورفع
   ------------------------------------------------------------
   الخطة تُراجَع في اجتماعٍ ويُكتب عليها في إكسل، فردُّها إلى
   المنصة يدويّاً بنداً بنداً عملٌ لا يُحتمل. الملف صفٌّ لكل بند:
   المحفظة ونوعه واسمه والراعي والمسؤول وحالته ونسبة تقدّمه
   وبدايته ونهايته وأرباعه.

   وعموده الأول **المعرّف**، وهو مفتاح المطابقة: به يُحدَّث البند
   نفسه لا يُستنسخ. ومن حذف العمود أو أضاف صفّاً بلا معرّف تُطابَق
   سطورُه بـ«المحفظة + البند»، فإن لم تُعرف صارت بنداً جديداً.

   و**الرفع لا يحذف شيئاً**: بندٌ غائبٌ عن الملف يبقى في المنصة.
   الحذف فعلٌ يُقصد، ولا يُستنتج من غياب سطرٍ عن ورقة.
   ============================================================ */
export const XL_KIND: Record<string, string> = { kpi: "مؤشر", init: "مبادرة", win: "مكسب سريع" };
const XL_KIND_BACK: Record<string, string> = {
  مؤشر: "kpi", مبادرة: "init", "مكسب سريع": "win", "مكاسب سريعة": "win", "مكسب": "win",
};
export const XL_COLS = [
  "المعرّف", "المحفظة", "النوع", "البند", "الراعي", "المسؤول", "الحالة",
  "نسبة التقدم ٪", "البداية", "النهاية", "المستوى", "الوحدة", "المستهدف العام", "نوع المبادرة",
  "Q1 مستهدف", "Q1 فعلي", "Q2 مستهدف", "Q2 فعلي",
  "Q3 مستهدف", "Q3 فعلي", "Q4 مستهدف", "Q4 فعلي", "حالة المساهمة",
];

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

export type XlRow = { id: string; ord: number; data: Rec };

/** صفوف الملف — الرأس ثم بندٌ في كل سطر. تُبنى هنا وتُغلَّف
    في الصفحة، فتُختبر بلا متصفّح */
export function xlRows(rows: XlRow[]): (string | number | null)[][] {
  const body = rows.map((r) => {
    const d = r.data;
    const q = (i: number, k: "t" | "a") => (has(d[`q${i}${k}`]) ? num(d[`q${i}${k}`]) : null);
    return [
      r.id,
      txt(d.owner),
      XL_KIND[txt(d.kind)] || txt(d.kind),
      txt(d.name),
      txt(d.sponsor),
      txt(d.assignee),
      opStatus(d),
      opPct(d),
      txt(d.start),
      txt(d.end),
      txt(d.kind) === "kpi" && num(d.level) > 0 ? num(d.level) : null,
      txt(d.kind) === "kpi" ? txt(d.unit) || "%" : "",
      has(d.yearTarget) ? num(d.yearTarget) : null,
      txt(d.itype),
      q(1, "t"), q(1, "a"), q(2, "t"), q(2, "a"),
      q(3, "t"), q(3, "a"), q(4, "t"), q(4, "a"),
      txt(d.note),
    ];
  });
  return [XL_COLS, ...body];
}

/** ما سيفعله الرفع قبل أن يُنفَّذ — يُعرض ليُقرّ */
export type XlPlan = {
  put: { id: string; ord: number; data: Rec; name: string; add: boolean }[];
  same: number;
  skipped: string[];
};

export function xlParse(sheet: string[][], rows: XlRow[]): XlPlan {
  const head = (sheet[0] || []).map((x) => nrm(txt(x)));
  const at = (name: string) => head.indexOf(nrm(name));
  const col = Object.fromEntries(XL_COLS.map((c) => [c, at(c)])) as Record<string, number>;
  const byId = new Map(rows.map((r) => [r.id, r]));
  /* المطابقة الاحتياطية: محفظةٌ واسم — لمن حذف عمود المعرّف */
  const byKey = new Map(rows.map((r) => [nrm(txt(r.data.owner)) + "|" + nrm(txt(r.data.name)), r]));

  const plan: XlPlan = { put: [], same: 0, skipped: [] };
  let ord = rows.reduce((a, r) => Math.max(a, r.ord), 0);

  for (let i = 1; i < sheet.length; i++) {
    const row = sheet[i] || [];
    const cell = (c: string) => txt(col[c] >= 0 ? row[col[c]] : "").trim();
    const name = cell("البند");
    const owner = cell("المحفظة");
    if (!name && !owner) continue;
    if (!name) {
      plan.skipped.push(`سطر ${i + 1}: بلا اسم بند`);
      continue;
    }
    const hit = byId.get(cell("المعرّف")) || byKey.get(nrm(owner) + "|" + nrm(name));
    const base: Rec = hit ? { ...hit.data } : {};
    const d: Rec = { ...base };

    const setT = (k: string, v: string) => {
      if (v === "") delete d[k];
      else d[k] = v;
    };
    const setN = (k: string, v: string) => {
      if (v === "") delete d[k];
      else if (Number.isFinite(Number(v))) d[k] = Number(v);
    };

    const kind = XL_KIND_BACK[cell("النوع")] || txt(base.kind) || "kpi";
    d.kind = kind;
    setT("owner", owner || txt(base.owner));
    d.name = name;
    setT("sponsor", cell("الراعي"));
    setT("assignee", cell("المسؤول"));
    setT("start", cell("البداية"));
    setT("end", cell("النهاية"));
    setT("note", cell("حالة المساهمة"));
    if (kind === "kpi") {
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
      setN("pct", cell("نسبة التقدم ٪"));
    }
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

    const id = hit ? hit.id : `op-x${Date.now().toString(36)}${i}`;
    if (hit && JSON.stringify(hit.data) === JSON.stringify(d)) {
      plan.same += 1;
      continue;
    }
    plan.put.push({ id, ord: hit ? hit.ord : ++ord, data: d, name, add: !hit });
  }
  return plan;
}

