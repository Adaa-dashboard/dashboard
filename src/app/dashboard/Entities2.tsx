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

type T = (ar: string, en: string) => string;

type Contact = {
  id: string; side: string; name: string; jobTitle: string;
  email: string; phone: string; note: string; userId: string | null; userName: string;
};
export type Entity = {
  id: string; name: string; kind: string; sector: string; note: string;
  ours: Contact[]; theirs: Contact[];
};

function Person({ c, t }: { c: Contact; t: T }) {
  return (
    <div className="en2-p">
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
  async function importXl(f: File) {
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
      setMsg(t(`يُحفظ ${rowsIn.length} صفاً…`, `Saving ${rowsIn.length} rows…`));
      const res = await apiFetch("/api/entities/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: rowsIn }),
      }).then((x) => x.json());
      if (res.error) throw new Error(res.error);
      setMsg(t(
        `تمّ: ${res.entities} جهة · ${res.contacts} نقطة تواصل · رُبط ${res.linked} بحسابات الموظفين`,
        `Done: ${res.entities} entities, ${res.contacts} contacts, ${res.linked} linked`,
      ));
      await load();
    } catch (e) {
      setMsg(""); setErr(e instanceof Error ? e.message : String(e));
    }
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
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void importXl(f); e.target.value = ""; }} />
            <button className="btn btn-sm" onClick={() => file.current?.click()}>
              ⬆ {t("رفع ملف الجهات", "Import")}
            </button>
          </>
        )}
      </div>

      {msg && <div className="dcs-busy">{msg}</div>}
      {err && <div className="alert alert-error">{err}</div>}

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
