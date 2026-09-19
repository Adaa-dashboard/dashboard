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
  /** قطاعات صاحب نقطة التواصل عندنا — للفلترة ولحقّ الاطّلاع */
  sectorIds?: string[];
};
type Sector = { id: string; name: string };
type MeLite = { id: string; sectorIds: string[]; scopes: string[] };
/** ورقةٌ من الملف بعد قراءتها: عناوينها وصفوفها وخريطة أعمدتها */
type Sheet = {
  name: string;
  heads: string[];
  rowsIn: Record<string, string>[];
  map: MapResult;
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

/** البطاقة تعرض الأسماء، والتفاصيل (بريد وجوال) في نافذة البند
    لمن يحقّ له — فلا تُنشر بيانات التواصل على الصفحة كلها */
function Person({ c, t, full }: { c: Contact; t: T; full?: boolean }) {
  /* الملف قد يحمل أكثر من شخصين للطرف الواحد (قائد VRO · نقطة الاتصال
     · رضا المستفيد)، فالدور يُعرض كما هو لا «بديل» وحده */
  const tag = c.role && c.role !== "أساسي" ? c.role : "";
  return (
    <div className={`en2-p ${tag ? "alt" : ""}`}>
      {tag && <span className="en2-alt">{tag === "بديل" ? t("بديل", "Alternate") : tag}</span>}
      <b>{c.name || t("— بلا اسم —", "—")}</b>
      {c.jobTitle && <em>{c.jobTitle}</em>}
      {full && (
        <span className="en2-w">
          {c.email && <a href={`mailto:${c.email}`} dir="ltr">{c.email}</a>}
          {c.phone && <a href={`tel:${c.phone}`} dir="ltr">{c.phone}</a>}
        </span>
      )}
      {full && c.note && <i>{c.note}</i>}
    </div>
  );
}

/** تفاصيل الجهة — تُفتح بالضغط على بطاقتها */
function EntityModal({
  e, t, full, secNames, onClose,
}: {
  e: Entity; t: T; full: boolean; secNames: string[]; onClose: () => void;
}) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 620 }} onClick={(ev) => ev.stopPropagation()}>
        <div className="m-h">
          <h3>{e.name}</h3>
          <button className="mx" onClick={onClose} aria-label="close">✕</button>
        </div>
        <div className="m-b">
          <div className="en2-h" style={{ marginBottom: 14 }}>
            <Logo e={e} />
            {e.kind && <span className="en2-k">{e.kind}</span>}
            {e.sector && <span className="en2-s">{e.sector}</span>}
            {secNames.map((n) => (
              <span key={n} className="en2-s">{n}</span>
            ))}
          </div>
          {!full && (
            <div className="alert alert-info" style={{ marginBottom: 12 }}>
              {t(
                "بيانات التواصل تظهر لمن يتولّى الجهة، أو لزملاء قطاعه، أو لصاحب صلاحية «الجهات».",
                "Contact details are visible to the owner, their sector peers, or an entities admin.",
              )}
            </div>
          )}
          <div className="en2-two">
            <div>
              <div className="en2-t">{e.ours.length > 1 ? t("نقاط التواصل من المركز", "Our contacts") : t("نقطة التواصل من المركز", "Our contact")}</div>
              {e.ours.length
                ? e.ours.map((c) => <Person key={c.id} c={c} t={t} full={full} />)
                : <div className="en2-no">{t("لا يوجد — لم تُسند بعد", "None yet")}</div>}
            </div>
            <div>
              <div className="en2-t">{e.theirs.length > 1 ? t("نقاط التواصل من الجهة", "Their contacts") : t("نقطة التواصل من الجهة", "Their contact")}</div>
              {e.theirs.length
                ? e.theirs.map((c) => <Person key={c.id} c={c} t={t} full={full} />)
                : <div className="en2-no">{t("لا يوجد", "None")}</div>}
            </div>
          </div>
          {e.extra && Object.keys(e.extra).length > 0 && (
            <div className="en2-ex" style={{ marginTop: 14 }}>
              {Object.entries(e.extra).map(([k, v]) => (
                <span key={k}><i>{k}</i>{v}</span>
              ))}
            </div>
          )}
          {e.note && <p className="en2-n">{e.note}</p>}
        </div>
      </div>
    </div>
  );
}

export default function Entities2({
  t,
  canEdit,
  me,
}: {
  t: T;
  canEdit: boolean;
  me: MeLite;
}) {
  const [rows, setRows] = useState<Entity[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [q, setQ] = useState("");
  const [only, setOnly] = useState<"" | "ours" | "none" | "nothem">("");
  const [sector, setSector] = useState("");
  const [who, setWho] = useState("");
  const [secs, setSecs] = useState<Sector[]>([]);
  const [open, setOpen] = useState<Entity | null>(null);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const file = useRef<HTMLInputElement | null>(null);
  /* الملف يبقى في اليد حتى تُقرّ الخريطة: تعديل عمودٍ يعيد البناء
     فوراً، فترى المستخدمة أثر التغيير قبل أن يُكتب شيء */
  const [prev, setPrev] = useState<{ sheets: Sheet[]; pick: number } | null>(null);
  const cur = prev ? prev.sheets[prev.pick] : null;
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
  /* قطاعات الإدارة الأربعة — لا قطاع الجهة في ملف الرفع */
  useEffect(() => {
    void apiFetch("/api/sectors").then((r) => r.json())
      .then((d) => setSecs(Array.isArray(d.sectors) ? d.sectors : []))
      .catch(() => setSecs([]));
  }, []);

  const shown = useMemo(() => {
    const term = q.trim();
    return rows.filter((e) => {
      if (only === "ours" && !e.ours.length) return false;
      if (only === "none" && e.ours.length) return false;
      if (only === "nothem" && e.theirs.length) return false;
      if (sector && !e.ours.some((c) => (c.sectorIds || []).includes(sector))) return false;
      if (who && !e.ours.some((c) => (c.userName || c.name || "").trim() === who)) return false;
      if (!term) return true;
      const hay = [e.name, e.kind, e.sector, ...e.ours.map((c) => c.name + " " + c.jobTitle),
                   ...e.theirs.map((c) => c.name + " " + c.jobTitle)].join(" ");
      return hay.includes(term);
    });
  }, [rows, q, only, sector, who]);

  const withOurs = rows.filter((e) => e.ours.length).length;
  const withTheirs = rows.filter((e) => e.theirs.length).length;
  /* خيارات الأسماء من البيانات نفسها لا من قائمة ثابتة */
  /* أسماء الاستشاريين وحدهم: نقاط التواصل من المركز، ومن رُبط منها
     بحسابٍ يظهر باسم الحساب. وتُستبعد العلامات النائبة («—» · «_»
     · «لا يوجد») فهي ليست أسماء */
  const whos = useMemo(() => {
    const bad = /^[-_—–.\s]*$/;
    const out = new Set<string>();
    for (const e of rows)
      for (const c of e.ours) {
        const n = (c.userName || c.name || "").trim();
        if (!n || bad.test(n) || /لا ?يوجد|لم ?ي/.test(n)) continue;
        out.add(n);
      }
    return [...out].sort((a, b) => a.localeCompare(b, "ar"));
  }, [rows]);
  const filtered = only !== "" || !!sector || !!who || !!q.trim();

  /* بيانات التواصل لمن يتولّى الجهة، أو لزميلٍ في قطاعه، أو لصاحب
     صلاحية «الجهات» — لا لكل من يفتح الصفحة */
  const mySecs = new Set(me.sectorIds || []);
  const canSee = (e: Entity) =>
    canEdit ||
    me.scopes.includes("users") ||
    e.ours.some((c) => c.userId === me.id) ||
    e.ours.some((c) => (c.sectorIds || []).some((x) => mySecs.has(x)));
  const secNamesOf = (e: Entity) => {
    const ids = new Set(e.ours.flatMap((c) => c.sectorIds || []));
    return secs.filter((x) => ids.has(x.id)).map((x) => x.name);
  };

  /* ما سيُحفظ — يُعاد بناؤه مع كل تعديل على الخريطة */
  const built = useMemo(() => (cur ? buildRows(cur.rowsIn, cur.map) : []), [cur]);
  /* خيارات الدور: «أساسي» و«بديل» وما اشتقّه القارئ من عناوين الملف */
  const roleOpts = useMemo(
    () => [...new Set(["أساسي", "بديل", ...(cur?.map.cols || []).map((c) => c.role)])],
    [cur],
  );
  const nUs = built.reduce((n, e) => n + e.contacts.filter((c) => c.side === "نحن").length, 0);
  const nThem = built.reduce((n, e) => n + e.contacts.filter((c) => c.side !== "نحن").length, 0);

  /* الاستيراد: الأعمدة تُطابَق بعناوينها مهما اختلفت صياغتها،
     فلا يُطلب من المستخدم ترتيبٌ بعينه */
  /* القراءة تسبق الحفظ: تُعرض خريطة الأعمدة وعيّنة على المستخدم
     أولاً. نسبة الأعمدة التي تُخمَّن من ترتيبها تجعل التأكيد
     واجباً لا ترفاً — والملف لا يُكتب حتى تُقرّه. */
  /* كل ورقة على حدة: ملف الجهات يحمل عادةً أوراقاً أخرى (تصنيف
     الأنشطة مثلاً) بعناوين مختلفة. دمجُها كان يخلط الصفوف، فيُختار
     عمودُ اسم الجهة من ورقة وتُهمل صفوف الأخرى كأنها بلا اسم. */
  function sheetRows(sh: { name: string; rows: string[][] }): Sheet | null {
    if (sh.rows.length < 2) return null;
    const raw = sh.rows[0].map((x) => String(x ?? "").trim());
    /* عنوانٌ مكرَّر (بريد الأساسي وبريد البديل باسم واحد) يُميَّز برقمه،
       وإلا ابتلع الثاني الأول وضاعت بيانات البديل */
    const seen = new Map<string, number>();
    const heads = raw.map((h) => {
      if (!h) return "";
      const n = (seen.get(h) || 0) + 1;
      seen.set(h, n);
      return n === 1 ? h : `${h} (${n})`;
    });
    const rowsIn: Record<string, string>[] = [];
    for (const r of sh.rows.slice(1)) {
      const o: Record<string, string> = {};
      heads.forEach((h, i) => { if (h) o[h] = String(r[i] ?? "").trim(); });
      if (Object.values(o).some((v) => v)) rowsIn.push(o);
    }
    if (!rowsIn.length) return null;
    const map = mapHeaders(heads.filter(Boolean));
    return { name: sh.name, heads: heads.filter(Boolean), rowsIn, map };
  }

  async function readFile(f: File) {
    setErr(""); setMsg(t("يُقرأ الملف…", "Reading…"));
    try {
      const all = (await readXlsxSheets(await f.arrayBuffer()))
        .map(sheetRows)
        .filter((x): x is Sheet => !!x && !!x.map.entityCol);
      if (!all.length) throw new Error(t("لم يُعثر على عمود اسم الجهة", "No entity-name column"));
      /* الورقة المرشَّحة: أكثرها أعمدةَ نقاط تواصل، ثم أكثرها صفوفاً */
      const best = [...all].sort(
        (x, y) => y.map.cols.length - x.map.cols.length || y.rowsIn.length - x.rowsIn.length,
      )[0];
      setMsg("");
      setPrev({ sheets: all, pick: all.indexOf(best) });
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
      const sh = p.sheets[p.pick];
      const cols = sh.map.cols.filter((c) => c.header !== h);
      const ignored = sh.map.ignored.filter((x) => x !== h);
      const map: MapResult =
        patch === null
          ? { ...sh.map, cols, ignored: [...ignored, h] }
          : (() => {
              const was: Mapped =
                sh.map.cols.find((c) => c.header === h) ??
                { header: h, side: "نحن", role: "أساسي", field: "name", title: "" };
              const next = { ...was, ...patch };
              const all = [...cols, next].sort(
                (x, y) => sh.heads.indexOf(x.header) - sh.heads.indexOf(y.header),
              );
              return { ...sh.map, cols: all, ignored };
            })();
      const sheets = p.sheets.map((x, i) => (i === p.pick ? { ...x, map } : x));
      return { ...p, sheets };
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
        {/* نقاط التواصل في قائمة واحدة: الحالات الثلاث لا تجتمع، فالشرائح
            المتجاورة كانت توهم بأنها تتراكم */}
        <select
          className="en2-sel"
          value={only}
          onChange={(e) => setOnly(e.target.value as typeof only)}
        >
          <option value="">{t(`كل الجهات · ${rows.length}`, `All · ${rows.length}`)}</option>
          <option value="ours">
            {t(`جميع الجهات التي لديها نقطة تواصل · ${withOurs}`, `Has a contact · ${withOurs}`)}
          </option>
          <option value="none">
            {t(`ليس لديها نقطة تواصل في المركز · ${rows.length - withOurs}`,
               `No contact of ours · ${rows.length - withOurs}`)}
          </option>
          <option value="nothem">
            {t(`ليس لها نقطة تواصل من الجهة · ${rows.length - withTheirs}`,
               `No contact of theirs · ${rows.length - withTheirs}`)}
          </option>
        </select>
        <select className="en2-sel" value={sector} onChange={(e) => setSector(e.target.value)}>
          <option value="">{t("كل القطاعات", "All sectors")}</option>
          {secs.map((x) => (
            <option key={x.id} value={x.id}>{x.name}</option>
          ))}
        </select>
        <select className="en2-sel" value={who} onChange={(e) => setWho(e.target.value)}>
          <option value="">{t(`كل الاستشاريين · ${whos.length}`, `All consultants · ${whos.length}`)}</option>
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
              {prev.sheets.length > 1 && (
                <>
                  <label>{t("ورقة الملف", "Sheet")}</label>
                  <select
                    value={prev.pick}
                    onChange={(ev) => setPrev((p) => (p ? { ...p, pick: Number(ev.target.value) } : p))}
                    style={{ marginBottom: 12 }}
                  >
                    {prev.sheets.map((sh, i) => (
                      <option key={sh.name} value={i}>
                        {sh.name} — {t(`${sh.rowsIn.length} صف · ${sh.map.cols.length} عمود تواصل`,
                                       `${sh.rowsIn.length} rows`)}
                      </option>
                    ))}
                  </select>
                </>
              )}
              <p className="muted" style={{ marginTop: 0 }}>
                {t(
                  `${built.length} جهة · ${nUs} نقطة تواصل من المركز · ${nThem} من الجهة. عمود اسم الجهة: «${cur?.map.entityCol}».`,
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
                {(cur?.heads || [])
                  .filter((h) => h && h !== cur?.map.entityCol)
                  .map((h) => {
                    const c = cur?.map.cols.find((x) => x.header === h) || null;
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
                          onChange={(ev) => setCol(h, { role: ev.target.value })}
                        >
                          {roleOpts.map((r) => (
                            <option key={r} value={r}>{r}</option>
                          ))}
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
            <button
              type="button"
              className={`en2-c ${e.ours.length ? "" : "bare"}`}
              key={e.id}
              onClick={() => setOpen(e)}
              title={t("اضغط للتفاصيل", "Open details")}
            >
              <div className="en2-h">
                <Logo e={e} />
                <b>{e.name}</b>
                {e.kind && <span className="en2-k">{e.kind}</span>}
                {e.sector && <span className="en2-s">{e.sector}</span>}
              </div>
              <div className="en2-two">
                <div>
                  <div className="en2-t">{e.ours.length > 1 ? t("نقاط التواصل من المركز", "Our contacts") : t("نقطة التواصل من المركز", "Our contact")}</div>
                  {e.ours.length
                    ? e.ours.map((c) => <Person key={c.id} c={c} t={t} />)
                    : <div className="en2-no">{t("لا يوجد — لم تُسند بعد", "None yet")}</div>}
                </div>
                <div>
                  <div className="en2-t">{e.theirs.length > 1 ? t("نقاط التواصل من الجهة", "Their contacts") : t("نقطة التواصل من الجهة", "Their contact")}</div>
                  {e.theirs.length
                    ? e.theirs.map((c) => <Person key={c.id} c={c} t={t} />)
                    : <div className="en2-no">{t("لا يوجد", "None")}</div>}
                </div>
              </div>
              {e.note && <p className="en2-n">{e.note}</p>}
              <span className="en2-more">{t("التفاصيل ←", "Details →")}</span>
            </button>
          ))}
        </div>
      )}

      {open && (
        <EntityModal
          e={open}
          t={t}
          full={canSee(open)}
          secNames={secNamesOf(open)}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}
