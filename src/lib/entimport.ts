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
export type Mapped = { header: string; side: "نحن" | "الجهة"; role: "أساسي" | "بديل"; field: Field };
export type MapResult = { entityCol: string; cols: Mapped[]; ignored: string[] };

const nrm = (v: string) =>
  String(v || "")
    .replace(/[ً-ْـ]/g, "")
    .replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه")
    .replace(/\s+/g, " ").trim().toLowerCase();

const has = (h: string, ...w: string[]) => w.some((x) => h.includes(nrm(x)));

/** أي عمود يحمل اسم الجهة — يُبحث عنه أولاً فهو مفتاح كل صف */
function findEntityCol(heads: string[]): string {
  for (const h of heads) {
    const n = nrm(h);
    if (has(n, "اسم الجهه", "اسم الجهة") && !has(n, "ممثل", "منسق", "مسؤول")) return h;
  }
  for (const h of heads) {
    const n = nrm(h);
    if (has(n, "الجهه", "جهه", "entity", "organization") &&
        !has(n, "ممثل", "منسق", "مسؤول", "جوال", "بريد", "ايميل", "مسمي")) return h;
  }
  return "";
}

export function mapHeaders(heads: string[]): MapResult {
  const entityCol = findEntityCol(heads);
  const cols: Mapped[] = [];
  const ignored: string[] = [];
  let lastSide: "نحن" | "الجهة" | null = null;

  for (const h of heads) {
    if (!h || h === entityCol) continue;
    const n = nrm(h);

    const field: Field | null =
      has(n, "جوال", "هاتف", "تلفون", "رقم التواصل", "phone", "mobile") ? "phone"
      : has(n, "بريد", "ايميل", "email", "mail") ? "email"
      : has(n, "مسمي", "منصب", "وظيفه", "title", "position") ? "jobTitle"
      : has(n, "اسم", "الاسم", "ممثل", "منسق", "مسؤول", "استشاري",
             "نقطه تواصل", "نقطه التواصل", "جهه اتصال", "contact", "name") ? "name"
      : null;
    if (!field) { ignored.push(h); continue; }

    const side: "نحن" | "الجهة" | null =
      has(n, "المركز", "اداء", "لدينا", "عندنا", "الاستشاري", "استشاري") ? "نحن"
      : has(n, "الجهه", "جهه", "الوزاره", "الهيئه") ? "الجهة"
      : null;
    const role: "أساسي" | "بديل" =
      has(n, "بديل", "احتياطي", "الثاني", "نائب", "backup", "alternate") ? "بديل" : "أساسي";

    const use = side ?? lastSide ?? "الجهة";
    if (side) lastSide = side;
    cols.push({ header: h, side: use, role, field });
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
      const secCol = Object.keys(r).find((k) => has(nrm(k), "القطاع", "sector"));
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
