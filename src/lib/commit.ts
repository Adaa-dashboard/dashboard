/* ------------------------------------------------------------
   التزام الاستشاريين بطلبات التغيير — حسبةٌ واحدة لمكانين:
   بطاقات «أعلى الاستشاريين التزاماً» فوق جدول الطلبات، و«نسبة
   التزامي» في محفظة الموظف. فالرقم واحد لا رقمان لنفس الشخص.

   الربط: كل طلبٍ يحمل «الجهة المالكة»، وسجلّ الجهات يقول من
   نقطة تواصلها الأساسية من المركز — والبديل لا تُحتسب عليه.
   ------------------------------------------------------------ */

export const nrm = (v: unknown) =>
  String(v ?? "")
    .replace(/[ً-ْـ]/g, "")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[\s/\\_-]+/g, " ")
    .trim();

export type ChangeLite = { owner: string; sla: number | null; workDays: number | null };
export type EntityLite = {
  name: string;
  ours?: { name?: string; userName?: string; role?: string }[];
};
export type Owner = { name: string; photo: string };

/** اسم الجهة ⇒ استشاريها الأساسي */
export function ownerMap(entities: EntityLite[], photoOf?: Map<string, string>): Map<string, Owner> {
  const m = new Map<string, Owner>();
  for (const e of entities || []) {
    const ours = Array.isArray(e.ours) ? e.ours : [];
    const c = ours.find((x) => (x.role || "أساسي") === "أساسي");
    const name = String(c?.userName || c?.name || "").trim();
    if (name) m.set(nrm(e.name), { name, photo: photoOf?.get(nrm(name)) || "" });
  }
  return m;
}

export type CommitRow = {
  name: string; photo: string;
  total: number; late: number; ok: number;
  /** النسبة الخام كما هي */
  raw: number;
  /** النسبة مرجَّحةً بعدد الطلبات — بها يكون الترتيب */
  pct: number;
  avg: number;
};

/* الترجيح: تُضاف لكل شخص كمّيةٌ وسيطة من الطلبات بمتوسط الإدارة،
   فقليلُ الطلبات يقترب من المتوسط حتى يتراكم عنده عددٌ يدلّ عليه،
   وكثيرُها تدلّ نسبته على نفسها. والطلب بلا مدة أو بلا أيام لا
   يُحتسب، فلا يُظلم أحد بصفٍّ ناقص في الملف. */
export function commitStats(items: ChangeLite[], owners: Map<string, Owner>): CommitRow[] {
  type Acc = { name: string; photo: string; total: number; late: number; days: number };
  const by = new Map<string, Acc>();
  for (const c of items || []) {
    if (c.sla == null || c.workDays == null) continue;
    const o = owners.get(nrm(c.owner));
    if (!o?.name) continue;
    const r = by.get(o.name) || { name: o.name, photo: o.photo, total: 0, late: 0, days: 0 };
    r.total++;
    r.days += c.workDays;
    if (c.workDays >= c.sla) r.late++;
    by.set(o.name, r);
  }
  const rows = [...by.values()];
  const sumT = rows.reduce((n, r) => n + r.total, 0);
  const sumOk = rows.reduce((n, r) => n + (r.total - r.late), 0);
  const base = sumT ? sumOk / sumT : 0;
  const mids = rows.map((r) => r.total).sort((x, y) => x - y);
  const m = Math.max(3, mids.length ? mids[Math.floor(mids.length / 2)] : 3);
  return rows
    .map((r) => {
      const ok = r.total - r.late;
      return {
        ...r,
        ok,
        raw: Math.round((ok / r.total) * 100),
        pct: Math.round(((ok + m * base) / (r.total + m)) * 100),
        avg: r.total ? Math.round((r.days / r.total) * 10) / 10 : 0,
      };
    })
    .sort((a, b) => b.pct - a.pct || b.total - a.total || a.avg - b.avg);
}
