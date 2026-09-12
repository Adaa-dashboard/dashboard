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
import { mapHeaders, buildRows, type MapResult, type OutEntity } from "@/lib/entimport";

type T = (ar: string, en: string) => string;

type Contact = {
  id: string; side: string; role: string; name: string; jobTitle: string;
  email: string; phone: string; note: string; userId: string | null; userName: string;
};
export type Entity = {
  id: string; name: string; kind: string; sector: string; note: string;
  ours: Contact[]; theirs: Contact[];
};

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
  const [only, setOnly] = useState<"" | "ours" | "none">("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const file = useRef<HTMLInputElement | null>(null);
  const [prev, setPrev] = useState<{ map: MapResult; built: OutEntity[] } | null>(null);

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
      if (!term) return true;
      const hay = [e.name, e.kind, e.sector, ...e.ours.map((c) => c.name + " " + c.jobTitle),
                   ...e.theirs.map((c) => c.name + " " + c.jobTitle)].join(" ");
      return hay.includes(term);
    });
  }, [rows, q, only]);

  const withOurs = rows.filter((e) => e.ours.length).length;

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
      const built = buildRows(rowsIn, m);
      setMsg("");
      setPrev({ map: m, built });
    } catch (e) {
      setMsg(""); setErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function commit() {
    if (!prev) return;
    setMsg(t(`يُحفظ ${prev.built.length} جهة…`, `Saving…`));
    const res = await apiFetch("/api/entities/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entities: prev.built }),
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
          {t("بلا نقطة تواصل", "No contact yet")} · {rows.length - withOurs}
        </button>
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
                  `${prev.built.length} جهة · ${prev.built.reduce((n, e) => n + e.contacts.length, 0)} نقطة تواصل. عمود اسم الجهة: «${prev.map.entityCol}».`,
                  `${prev.built.length} entities.`,
                )}
              </p>
              <label>{t("كيف قُرئت الأعمدة", "Column mapping")}</label>
              <div className="imp-map">
                {prev.map.cols.map((c) => (
                  <div key={c.header}>
                    <span className={c.side === "نحن" ? "us" : "them"}>{c.side}</span>
                    <span className="ro">{c.role}</span>
                    <span className="fl">
                      {c.field === "name" ? t("الاسم", "Name")
                        : c.field === "jobTitle" ? t("المسمّى", "Title")
                        : c.field === "phone" ? t("الجوال", "Phone") : t("البريد", "Email")}
                    </span>
                    <b>{c.header}</b>
                  </div>
                ))}
              </div>
              {prev.map.ignored.length > 0 && (
                <p className="muted" style={{ fontSize: 11.5 }}>
                  {t("أعمدة لم تُقرأ كنقاط تواصل:", "Not read as contacts:")} {prev.map.ignored.join(" · ")}
                </p>
              )}
              <label>{t("عيّنة — أول جهتين", "Sample")}</label>
              {prev.built.slice(0, 2).map((e) => (
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
              {e.note && <p className="en2-n">{e.note}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
