"use client";

/* ============================================================
   الجهات ونقاط التواصل
   ------------------------------------------------------------
   سجلٌّ مركزي يجيب سؤالاً يتكرّر: «هل عندنا نقطة تواصل مع جهة
   كذا؟» — فيُقرأ من المنصة بلا سؤال أحد في مجموعة.

   البحث في صدر الصفحة لا في زاويتها: هو الغرض لا زينة.
   والجدول يفرّق بوضوح بين نقطتنا (من المركز) ونقطتهم (من الجهة).
   ============================================================ */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { readXlsxSheets } from "@/lib/sheet";
import { mapHeaders, buildRows, type MapResult, type Mapped, type Field } from "@/lib/entimport";

type T = (ar: string, en: string) => string;

type Contact = {
  id: string; side: string; role: string; name: string; jobTitle: string;
  email: string; phone: string; note: string; userId: string | null; userName: string;
};
export type Entity = {
  id: string; name: string; kind: string; sector: string; note: string;
  /** أعمدة الملف التي لم تُقرأ نقاطَ تواصل — تُعرض كما وردت */
  extra: Record<string, string>;
  ours: Contact[]; theirs: Contact[];
};

/* شعار الجهة إن وُجد في الملف عمودٌ يحمله، وإلا حرفان من اسمها
   بلونٍ ثابت مشتقٍّ من الاسم نفسه — فلكل جهة وجهٌ يُعرف بلمحة */
function logoOf(e: Entity): string {
  for (const [k, v] of Object.entries(e.extra || {})) {
    const n = k.toLowerCase();
    if ((n.includes("شعار") || n.includes("logo")) && /^https?:\/\//i.test(v)) return v;
  }
  return "";
}
const LOGO_SKIP = new Set(["ال", "في", "من", "على", "و", "عن", "مع"]);
function initials(name: string): string {
  const w = String(name || "").replace(/[«»"'()]/g, " ").split(/\s+/).filter((x) => x && !LOGO_SKIP.has(x));
  const head = (x: string) => (x.startsWith("ال") && x.length > 2 ? x[2] : x[0]);
  if (!w.length) return "؟";
  return w.length === 1 ? head(w[0]) : head(w[0]) + head(w[1]);
}
const LOGO_TONES = ["#016b5f", "#1a9d5c", "#2f7fd1", "#7a5cd1", "#c9a020", "#d34a4a", "#e0971a", "#5aaba2"];
function toneOf(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return LOGO_TONES[h % LOGO_TONES.length];
}

function Logo({ e }: { e: Entity }) {
  const src = logoOf(e);
  const c = toneOf(e.name);
  return (
    <span className="en2-lg" style={{ background: c + "1f", color: c }}>
      <i>{initials(e.name)}</i>
      {src && <img src={src} alt="" onError={(ev) => { ev.currentTarget.style.display = "none"; }} />}
    </span>
  );
}

function Person({ c, t }: { c: Contact; t: T }) {
  return (
    <div className={`en2-p ${c.role === "بديل" ? "alt" : ""}`}>
      {c.role === "بديل" && <span className="en2-alt">{t("بديل", "Alternate")}</span>}
      <b>{c.name || t("— بلا اسم —", "—")}</b>
      {c.jobTitle && <em>{c.jobTitle}</em>}
      <span className="en2-w">
        {c.email && <a href={`mailto:${c.email}`} dir="ltr">{c.email}</a>}
        {c.phone && <a href={`tel:${c.phone}`} dir="ltr">{c.phone}</a>}
      </span>
      {c.note && <i>{c.note}</i>}
    </div>
  );
}

export default function Entities2({ t, canEdit }: { t: T; canEdit: boolean }) {
  const [rows, setRows] = useState<Entity[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [q, setQ] = useState("");
  const [only, setOnly] = useState<"" | "ours" | "none" | "nothem">("");
  const [sector, setSector] = useState("");
  const [who, setWho] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const file = useRef<HTMLInputElement | null>(null);
  /* الملف يبقى في اليد حتى تُقرّ الخريطة: تعديل عمودٍ يعيد البناء
     فوراً، فترى المستخدمة أثر التغيير قبل أن يُكتب شيء */
  const [prev, setPrev] = useState<{ heads: string[]; rowsIn: Record<string, string>[]; map: MapResult } | null>(null);
  const [rev, setRev] = useState<{ name: string; entities: number; reviewed: number }[]>([]);
  useEffect(() => {
    if (!canEdit) return;
    void apiFetch("/api/entities/review").then((r) => r.json())
      .then((d) => setRev(Array.isArray(d.status) ? d.status : [])).catch(() => setRev([]));
  }, [canEdit]);

  const load = useCallback(async () => {
    const r = await apiFetch("/api/entities").then((x) => x.json()).catch(() => ({}));
    setRows(Array.isArray(r.entities) ? r.entities : []);
    setLoaded(true);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const shown = useMemo(() => {
    const term = q.trim();
    return rows.filter((e) => {
      if (only === "ours" && !e.ours.length) return false;
      if (only === "none" && e.ours.length) return false;
      if (only === "nothem" && e.theirs.length) return false;
      if (sector && e.sector !== sector) return false;
      if (who && !e.ours.some((c) => c.name === who)) return false;
      if (!term) return true;
      const hay = [e.name, e.kind, e.sector, ...e.ours.map((c) => c.name + " " + c.jobTitle),
                   ...e.theirs.map((c) => c.name + " " + c.jobTitle)].join(" ");
      return hay.includes(term);
    });
  }, [rows, q, only, sector, who]);

  const withOurs = rows.filter((e) => e.ours.length).length;
  const withTheirs = rows.filter((e) => e.theirs.length).length;
  /* خيارات الفلترة من البيانات نفسها لا من قائمة ثابتة */
  const sectors = useMemo(
    () => [...new Set(rows.map((e) => e.sector).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ar")),
    [rows],
  );
  const whos = useMemo(
    () => [...new Set(rows.flatMap((e) => e.ours.map((c) => c.name)).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, "ar")),
    [rows],
  );
  const filtered = only !== "" || !!sector || !!who || !!q.trim();

  /* ما سيُحفظ — يُعاد بناؤه مع كل تعديل على الخريطة */
  const built = useMemo(() => (prev ? buildRows(prev.rowsIn, prev.map) : []), [prev]);
  const nUs = built.reduce((n, e) => n + e.contacts.filter((c) => c.side === "نحن").length, 0);
  const nThem = built.reduce((n, e) => n + e.contacts.filter((c) => c.side !== "نحن").length, 0);

  /* الاستيراد: الأعمدة تُطابَق بعناوينها مهما اختلفت صياغتها،
     فلا يُطلب من المستخدم ترتيبٌ بعينه */
  /* القراءة تسبق الحفظ: تُعرض خريطة الأعمدة وعيّنة على المستخدم
     أولاً. نسبة الأعمدة التي تُخمَّن من ترتيبها تجعل التأكيد
     واجباً لا ترفاً — والملف لا يُكتب حتى تُقرّه. */
  async function readFile(f: File) {
    setErr(""); setMsg(t("يُقرأ الملف…", "Reading…"));
    try {
      const sheets = await readXlsxSheets(await f.arrayBuffer());
      const rowsIn: Record<string, string>[] = [];
      for (const sh of sheets) {
        if (sh.rows.length < 2) continue;
        const head = sh.rows[0].map((x) => String(x ?? "").trim());
        for (const r of sh.rows.slice(1)) {
          const o: Record<string, string> = {};
          head.forEach((h, i) => { if (h) o[h] = String(r[i] ?? "").trim(); });
          if (Object.values(o).some((v) => v)) rowsIn.push(o);
        }
      }
      if (!rowsIn.length) throw new Error(t("الملف فارغ", "Empty file"));
      const heads = [...new Set(rowsIn.flatMap((r) => Object.keys(r)))];
      const m = mapHeaders(heads);
      if (!m.entityCol) throw new Error(t("لم يُعثر على عمود اسم الجهة", "No entity-name column"));
      setMsg("");
      setPrev({ heads, rowsIn, map: m });
    } catch (e) {
      setMsg(""); setErr(e instanceof Error ? e.message : String(e));
    }
  }

  /* تغيير قراءة عمود: طرفُه أو حقلُه أو دورُه، أو ألّا يُقرأ أصلاً.
     التخمين يخطئ أحياناً — العمود «المستشار» قد يُقرأ من الجهة —
     فالقرار للمستخدمة، وأثره يظهر في العيّنة وفي العدّادين فوراً. */
  function setCol(h: string, patch: Partial<Mapped> | null) {
    setPrev((p) => {
      if (!p) return p;
      const cols = p.map.cols.filter((c) => c.header !== h);
      const ignored = p.map.ignored.filter((x) => x !== h);
      if (patch === null) return { ...p, map: { ...p.map, cols, ignored: [...ignored, h] } };
      const cur: Mapped =
        p.map.cols.find((c) => c.header === h) ?? { header: h, side: "نحن", role: "أساسي", field: "name" };
      const next = { ...cur, ...patch };
      const all = [...cols, next].sort((x, y) => p.heads.indexOf(x.header) - p.heads.indexOf(y.header));
      return { ...p, map: { ...p.map, cols: all, ignored } };
    });
  }

  async function commit() {
    if (!prev) return;
    setMsg(t(`يُحفظ ${built.length} جهة…`, `Saving…`));
    const res = await apiFetch("/api/entities/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entities: built }),
    }).then((x) => x.json()).catch(() => ({ error: "تعذّر الاتصال" }));
    if (res.error) { setMsg(""); setErr(res.error); return; }
    setPrev(null);
    setMsg(t(
      `تمّ: ${res.entities} جهة · ${res.contacts} نقطة تواصل · رُبط ${res.linked} باسم الموظف` +
        (res.unmatched ? ` · ${res.unmatched} بلا حساب مطابق` : ""),
      `Done: ${res.entities} entities, ${res.contacts} contacts, ${res.linked} linked`,
    ));
    await load();
  }

  return (
    <div className="en2">
      <div className="en2-ask">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("اكتب اسم الجهة أو الشخص… مثال: هيئة المقاولين", "Search entity or person…")}
        />
        {q && <button className="en2-x" onClick={() => setQ("")}>✕</button>}
      </div>

      <div className="en2-bar">
        <button className={`chip ${only === "" ? "on" : ""}`} onClick={() => setOnly("")}>
          {t("الكل", "All")} · {rows.length}
        </button>
        <button className={`chip ${only === "ours" ? "on" : ""}`} onClick={() => setOnly("ours")}>
          {t("لها نقطة تواصل عندنا", "We have a contact")} · {withOurs}
        </button>
        <button className={`chip ${only === "none" ? "on" : ""}`} onClick={() => setOnly("none")}>
          {t("بلا نقطة من المركز", "No contact of ours")} · {rows.length - withOurs}
        </button>
        <button className={`chip ${only === "nothem" ? "on" : ""}`} onClick={() => setOnly("nothem")}>
          {t("بلا نقطة من الجهة", "No contact of theirs")} · {rows.length - withTheirs}
        </button>
        <select className="en2-sel" value={sector} onChange={(e) => setSector(e.target.value)}>
          <option value="">{t("كل القطاعات", "All sectors")}</option>
          {sectors.map((x) => (
            <option key={x} value={x}>{x}</option>
          ))}
        </select>
        <select className="en2-sel" value={who} onChange={(e) => setWho(e.target.value)}>
          <option value="">{t("كل الأسماء", "All names")}</option>
          {whos.map((x) => (
            <option key={x} value={x}>{x}</option>
          ))}
        </select>
        <div style={{ flex: 1 }} />
        {canEdit && (
          <>
            <input ref={file} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void readFile(f); e.target.value = ""; }} />
            <button className="btn btn-sm" onClick={() => file.current?.click()}>
              ⬆ {t("رفع ملف الجهات", "Import")}
            </button>
          </>
        )}
      </div>

      {canEdit && rev.length > 0 && rev.some((x) => x.reviewed < x.entities) && (
        <div className="en2-rev">
          <b>{t("مراجعة هذا الربع", "This quarter's review")}</b>
          {rev.map((x) => (
            <span key={x.name} className={x.reviewed >= x.entities ? "ok" : ""}>
              {x.name} <i>{x.reviewed}/{x.entities}</i>
            </span>
          ))}
        </div>
      )}

      {filtered && loaded && (
        <div className="en2-cnt">
          {t(`عرض ${shown.length} من ${rows.length}`, `${shown.length} of ${rows.length}`)}
          <button
            onClick={() => { setOnly(""); setSector(""); setWho(""); setQ(""); }}
          >
            {t("مسح الفلاتر", "Clear filters")}
          </button>
        </div>
      )}

      {msg && <div className="dcs-busy">{msg}</div>}
      {err && <div className="alert alert-error">{err}</div>}

      {prev && (
        <div className="modal-overlay" onClick={() => setPrev(null)}>
          <div className="modal" style={{ maxWidth: 720 }} onClick={(e) => e.stopPropagation()}>
            <div className="m-h">
              <h3>{t("راجعي قراءة الملف قبل الحفظ", "Review before saving")}</h3>
              <button className="mx" onClick={() => setPrev(null)}>✕</button>
            </div>
            <div className="m-b">
              <p className="muted" style={{ marginTop: 0 }}>
                {t(
                  `${built.length} جهة · ${nUs} نقطة تواصل من المركز · ${nThem} من الجهة. عمود اسم الجهة: «${prev.map.entityCol}».`,
                  `${built.length} entities.`,
                )}
              </p>
              {nUs === 0 && (
                <div className="alert alert-info" style={{ marginBottom: 10 }}>
                  {t(
                    "لم يُقرأ أي عمود على أنه نقطة تواصل من المركز — حدّدي عمود الاستشاري أدناه واجعلي طرفه «من المركز».",
                    "No column was read as our contact.",
                  )}
                </div>
              )}
              <label>{t("كيف تُقرأ الأعمدة — عدّليها إن أخطأ التخمين", "Column mapping")}</label>
              <div className="imp-map edit">
                {prev.heads
                  .filter((h) => h && h !== prev.map.entityCol)
                  .map((h) => {
                    const c = prev.map.cols.find((x) => x.header === h) || null;
                    return (
                      <div key={h}>
                        <b>{h}</b>
                        <select
                          value={c ? c.side : ""}
                          onChange={(ev) =>
                            setCol(h, ev.target.value ? { side: ev.target.value as Mapped["side"] } : null)
                          }
                        >
                          <option value="">{t("لا تُقرأ", "Skip")}</option>
                          <option value="نحن">{t("من المركز", "Ours")}</option>
                          <option value="الجهة">{t("من الجهة", "Theirs")}</option>
                        </select>
                        <select
                          value={c ? c.field : "name"}
                          disabled={!c}
                          onChange={(ev) => setCol(h, { field: ev.target.value as Field })}
                        >
                          <option value="name">{t("الاسم", "Name")}</option>
                          <option value="jobTitle">{t("المسمّى", "Title")}</option>
                          <option value="phone">{t("الجوال", "Phone")}</option>
                          <option value="email">{t("البريد", "Email")}</option>
                        </select>
                        <select
                          value={c ? c.role : "أساسي"}
                          disabled={!c}
                          onChange={(ev) => setCol(h, { role: ev.target.value as Mapped["role"] })}
                        >
                          <option value="أساسي">{t("أساسي", "Primary")}</option>
                          <option value="بديل">{t("بديل", "Alternate")}</option>
                        </select>
                      </div>
                    );
                  })}
              </div>
              <p className="muted" style={{ fontSize: 11.5 }}>
                {t(
                  "العمود «لا تُقرأ» يُحفظ كما هو تحت بطاقة الجهة، فلا تضيع معلومة.",
                  "Skipped columns are kept as-is on the entity card.",
                )}
              </p>
              <label>{t("عيّنة — أول جهتين", "Sample")}</label>
              {built.slice(0, 2).map((e) => (
                <div className="imp-s" key={e.name}>
                  <b>{e.name}</b>
                  {e.contacts.map((c, i) => (
                    <div key={i}>
                      <span>{c.side} · {c.role}</span>
                      {c.name || "—"} {c.jobTitle ? `· ${c.jobTitle}` : ""} {c.phone ? `· ${c.phone}` : ""} {c.email ? `· ${c.email}` : ""}
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <div className="m-f">
              <button className="btn btn-ghost btn-sm" onClick={() => setPrev(null)}>{t("إلغاء", "Cancel")}</button>
              <button className="btn btn-sm" onClick={() => void commit()}>
                {t("صحيحة — احفظي", "Looks right — save")}
              </button>
            </div>
          </div>
        </div>
      )}

      {!loaded ? (
        <div className="empty">{t("جارٍ التحميل...", "Loading...")}</div>
      ) : !shown.length ? (
        <div className="soon">
          <b>{rows.length ? t("لا نتائج", "No results") : t("لا توجد جهات بعد", "No entities yet")}</b>
          {rows.length
            ? t("جرّبي اسماً آخر أو جزءاً منه.", "Try another name.")
            : canEdit
              ? t("ارفعي ملف الجهات ونقاط التواصل — تُربط الأسماء بحسابات الموظفين تلقائياً.",
                  "Import the contacts file.")
              : t("ستظهر هنا الجهات ونقاط التواصل معها.", "Entities will appear here.")}
        </div>
      ) : (
        <div className="en2-g">
          {shown.map((e) => (
            <div className={`en2-c ${e.ours.length ? "" : "bare"}`} key={e.id}>
              <div className="en2-h">
                <Logo e={e} />
                <b>{e.name}</b>
                {e.kind && <span className="en2-k">{e.kind}</span>}
                {e.sector && <span className="en2-s">{e.sector}</span>}
              </div>
              <div className="en2-two">
                <div>
                  <div className="en2-t">{t("نقطة التواصل من المركز", "Our contact")}</div>
                  {e.ours.length
                    ? e.ours.map((c) => <Person key={c.id} c={c} t={t} />)
                    : <div className="en2-no">{t("لا يوجد — لم تُسند بعد", "None yet")}</div>}
                </div>
                <div>
                  <div className="en2-t">{t("نقطة التواصل من الجهة", "Their contact")}</div>
                  {e.theirs.length
                    ? e.theirs.map((c) => <Person key={c.id} c={c} t={t} />)
                    : <div className="en2-no">{t("لا يوجد", "None")}</div>}
                </div>
              </div>
              {e.extra && Object.keys(e.extra).length > 0 && (
                <div className="en2-ex">
                  {Object.entries(e.extra).map(([k, v]) => (
                    <span key={k}><i>{k}</i>{v}</span>
                  ))}
                </div>
              )}
              {e.note && <p className="en2-n">{e.note}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
