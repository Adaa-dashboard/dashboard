/* ------------------------------------------------------------
   قراءة ملف الجهات ونقاط التواصل
   ------------------------------------------------------------
   الملف يحمل لكل جهة أربعة أشخاص أو أكثر: أساسي وبديل من المركز،
   وأساسي وبديل من الجهة — ولكلٍّ اسم ومسمّى وجوال وبريد. وأعمدته
   تُسمّى بعشرات الصياغات.

   فبدل قائمة أعمدة ثابتة، يُصنَّف **كل عمود** بثلاثة أوصاف:
     · الطرف: نحن أم الجهة
     · الدور: أساسي أم بديل
     · الحقل: اسم · مسمّى · جوال · بريد
   وما لم يُصرَّح بطرفه يرث طرف العمود الذي قبله — وهو ترتيب هذه
   الملفات عادةً: مجموعة أعمدة للمركز ثم مجموعة للجهة.

   ولأن الوراثة تخمين، تُعرض الخريطة على المستخدم قبل الحفظ.
   ------------------------------------------------------------ */

export type Field = "name" | "jobTitle" | "phone" | "email";
export type Side = "نحن" | "الجهة";
/** الدور نصٌّ حرّ: «أساسي» · «بديل» · أو تسمية العمود نفسه حين
    يحمل الملف أكثر من شخصين لطرفٍ واحد (قائد VRO · نقطة الاتصال
    · قائد رضا المستفيد…). فالطرف والدور معاً يميّزان الشخص. */
export type Mapped = {
  header: string; side: Side; role: string; field: Field;
  /** صفة الشخص كما سمّاها الملف: «قائد مكتب تحقيق الرؤية» · «نقطة
      الاتصال لدى الجهة» — تُكتب مسمّىً له فيُعرف عمّن يليه */
  title: string;
};
export type MapResult = { entityCol: string; cols: Mapped[]; ignored: string[] };

const nrm = (v: string) =>
  String(v || "")
    .replace(/[ً-ْـ]/g, "")
    .replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه")
    .replace(/\s+/g, " ").trim().toLowerCase();

const has = (h: string, ...w: string[]) => w.some((x) => h.includes(nrm(x)));

/** أعمدةٌ تصف الجهة لا تسمّيها — لا تصلح مفتاحاً للصف */
const NOT_ENTITY = ["رمز", "كود", "رقم", "قطاع", "حاله", "نوع", "تصنيف", "ملاحظ",
                    "ممثل", "منسق", "مسؤول", "جوال", "بريد", "ايميل", "مسمي"];

/** أي عمود يحمل اسم الجهة — يُبحث عنه أولاً فهو مفتاح كل صف */
function findEntityCol(heads: string[]): string {
  const ok = (n: string) => !has(n, ...NOT_ENTITY);
  for (const h of heads) {
    const n = nrm(h);
    if ((n === "الجهه" || n === "الجهات" || n === "اسم الجهه") && ok(n)) return h;
  }
  for (const h of heads) {
    const n = nrm(h);
    if (has(n, "اسم الجهه") && ok(n)) return h;
  }
  for (const h of heads) {
    const n = nrm(h);
    if (has(n, "الجهه", "جهه", "entity", "organization") && ok(n)) return h;
  }
  return "";
}

/** صفة الشخص كاملةً من عنوان عموده — تُعرض مسمّىً تحت اسمه */
function titleOf(h: string): string {
  let s = String(h || "").replace(/\s+/g, " ").trim();
  s = s.split(/\s+(?:او|أو)\s+/)[0];              // «… او مدير الجهة» ⇐ الأول
  s = s.replace(/^(اسم|أسم)\s+/, "").replace(/^بديل\s+/, "").trim();
  return s;
}

/** تسمية قصيرة للشخص من عنوان عموده — حين لا يكفي «أساسي/بديل» */
function labelOf(h: string): string {
  const s = titleOf(h);
  const w = s.split(" ").filter(Boolean);
  return w.length <= 4 ? s : w.slice(0, 4).join(" ") + "…";
}

function fieldOf(n: string): Field | null {
  return has(n, "جوال", "هاتف", "تلفون", "رقم التواصل", "phone", "mobile") ? "phone"
    : has(n, "بريد", "ايميل", "email", "mail") ? "email"
    : has(n, "مسمي", "منصب", "وظيفه", "title", "position") ? "jobTitle"
    : has(n, "اسم", "الاسم", "ممثل", "منسق", "مسؤول", "استشاري", "مستشار",
           "المتابع", "متابع", "consultant", "advisor", "قائد", "مدير",
           "نقطه تواصل", "نقطه التواصل", "نقطه الاتصال", "اتصال", "جهه اتصال",
           "contact", "name") ? "name"
    : null;
}

function sideOf(n: string): Side | null {
  return has(n, "المركز", "اداء", "لدينا", "عندنا", "الاستشاري", "استشاري",
             "المستشار", "مستشار", "consultant", "advisor", "المتابع") ? "نحن"
    : has(n, "الجهه", "جهه", "الوزاره", "الهيئه") ? "الجهة"
    : null;
}

/* عمود «الاسم» يبدأ شخصاً جديداً، وما بعده من جوال وبريد ومسمّى
   يلتحق به. فملفٌ فيه أربعة أشخاص من الجهة يُقرأ أربعةً لا واحداً —
   والنموذج السابق (طرف × أساسي/بديل) كان يدمجهم في شخصين. */
export function mapHeaders(heads: string[]): MapResult {
  const entityCol = findEntityCol(heads);
  const cols: Mapped[] = [];
  const ignored: string[] = [];
  const used: Record<Side, Set<string>> = { نحن: new Set(), الجهة: new Set() };
  let cur: { side: Side; role: string; title: string } | null = null;
  let lastSide: Side | null = null;

  /** دورٌ فريد داخل الطرف الواحد، وإلا ابتلع أحدُهما الآخر عند الحفظ */
  const uniq = (side: Side, want: string) => {
    let r = want || "أساسي";
    for (let i = 2; used[side].has(r); i++) r = `${want} ${i}`;
    used[side].add(r);
    return r;
  };
  const roleFor = (h: string, n: string, side: Side) => {
    if (has(n, "بديل", "احتياطي", "الثاني", "نائب", "backup", "alternate")) return uniq(side, "بديل");
    if (!used[side].size) return uniq(side, "أساسي");
    return uniq(side, labelOf(h));
  };

  for (const h of heads) {
    if (!h || h === entityCol) continue;
    const n = nrm(h);
    const field = fieldOf(n);
    if (!field) { ignored.push(h); continue; }
    const side = sideOf(n);

    if (field === "name" || !cur || (side && side !== cur.side)) {
      const use: Side = side ?? lastSide ?? "الجهة";
      lastSide = use;
      cur = { side: use, role: roleFor(h, n, use), title: field === "name" ? titleOf(h) : "" };
    }
    cols.push({ header: h, side: cur.side, role: cur.role, field, title: cur.title });
  }
  return { entityCol, cols, ignored };
}

export type OutContact = { side: string; role: string; name: string; jobTitle: string; phone: string; email: string };
export type OutEntity = {
  name: string; kind: string; sector: string; note: string;
  contacts: OutContact[];
  /** كل عمود لم يُقرأ كنقطة تواصل — يُحفظ كما هو فلا تضيع معلومة */
  extra: Record<string, string>;
};

export function buildRows(rows: Record<string, string>[], map: MapResult): OutEntity[] {
  const out = new Map<string, OutEntity>();
  for (const r of rows) {
    const name = String(r[map.entityCol] || "").trim();
    if (!name) continue;
    const key = nrm(name);
    if (!out.has(key)) {
      const kindCol = Object.keys(r).find((k) => has(nrm(k), "نوع", "تصنيف", "kind", "type"));
      const secCol = Object.keys(r).find((k) => has(nrm(k), "قطاع", "sector"));
      const noteCol = Object.keys(r).find((k) => has(nrm(k), "ملاحظ", "note"));
      out.set(key, {
        name,
        kind: kindCol ? String(r[kindCol] || "").trim() : "",
        sector: secCol ? String(r[secCol] || "").trim() : "",
        note: noteCol ? String(r[noteCol] || "").trim() : "",
        contacts: [],
        extra: {},
      });
    }
    const E = out.get(key)!;
    /* الأعمدة التي لم تُصنَّف نقاطَ تواصل تُحفظ بعناوينها كما هي:
       الملف قد يحمل ما لم يخطر ببالنا، وإهمالُه ضياع معلومة. */
    for (const k of map.ignored) {
      const n = nrm(k);
      // القطاع والنوع والملاحظة لها مكانها في البطاقة، فلا تُكرَّر أسفلها
      if (has(n, "قطاع", "sector", "نوع", "تصنيف", "ملاحظ", "note")) continue;
      const v = String(r[k] || "").trim();
      if (v && !E.extra[k]) E.extra[k] = v;
    }
    // تجميع الأعمدة في أشخاص: لكل (طرف × دور) شخصٌ واحد
    const people = new Map<string, OutContact>();
    for (const c of map.cols) {
      const v = String(r[c.header] || "").trim();
      if (!v) continue;
      const k = c.side + "|" + c.role;
      if (!people.has(k))
        people.set(k, { side: c.side, role: c.role, name: "", jobTitle: "", phone: "", email: "" });
      const P = people.get(k)!;
      if (!P[c.field]) P[c.field] = v;
      /* صفةُ العمود مسمّىً للشخص ما لم يحمل الملف عمود مسمّى —
         فيُعرف «قائد مكتب تحقيق الرؤية» من «نقطة الاتصال لدى الجهة»
         ولا يبدوان نقطتَي تواصل مكرَّرتين */
      if (!P.jobTitle && c.title && c.title !== c.role) P.jobTitle = c.title;
    }
    for (const P of people.values()) {
      if (!P.name && !P.phone && !P.email) continue;   // عمودٌ فارغ لا يصنع شخصاً
      const dup = E.contacts.find(
        (x) => x.side === P.side && x.role === P.role && nrm(x.name) === nrm(P.name));
      if (dup) {
        // صفٌّ آخر لنفس الشخص: يُكمل ما نقص ولا يُكرّره
        for (const f of ["jobTitle", "phone", "email"] as const) if (!dup[f] && P[f]) dup[f] = P[f];
      } else E.contacts.push(P);
    }
  }
  return [...out.values()];
}
