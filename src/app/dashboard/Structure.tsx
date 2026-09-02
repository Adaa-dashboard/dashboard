"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

/* ============================================================
   الهيكل التنظيمي — إدارة عمليات الأداء وتحتها القطاعات
   وتحت كل قطاع موظفوه. يُبنى من حسابات المستخدمين نفسها،
   فإضافة موظف وإسناد قطاع له تظهر هنا فوراً بلا إدخال ثانٍ.
   ============================================================ */

type Sector = { id: string; name: string };
type Person = { id: string; name: string; role: string; sectorIds: string[] };

export default function Structure({
  sectors,
  canEdit,
  reload,
  t,
}: {
  sectors: Sector[];
  canEdit: boolean;
  reload: () => void;
  t: (ar: string, en: string) => string;
}) {
  const [people, setPeople] = useState<Person[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState("");
  const [err, setErr] = useState("");
  const [manage, setManage] = useState(false);

  const load = useCallback(async () => {
    const d = await apiFetch("/api/people").then((r) => r.json());
    setPeople(d.people || []);
    setLoaded(true);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const inSector = (sid: string) => people.filter((p) => (p.sectorIds || []).includes(sid));
  // من لا قطاع له يُعرض تحت الإدارة مباشرة — مدير الإدارة ومن يتبعه
  const head = people.filter((p) => (p.sectorIds || []).length === 0);

  async function addSector() {
    setErr("");
    const res = await apiFetch("/api/sectors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const d = await res.json();
    if (!res.ok) return setErr(d.error || t("تعذّرت الإضافة", "Could not add"));
    setName("");
    reload();
  }
  async function renameSector(id: string, current: string) {
    const v = window.prompt(t("اسم القطاع الجديد:", "New name:"), current);
    if (!v || !v.trim()) return;
    await apiFetch(`/api/sectors/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: v.trim() }),
    });
    reload();
  }
  async function removeSector(id: string, n: number) {
    if (n > 0) {
      window.alert(
        t(
          "لا يمكن حذف قطاع فيه موظفون. انقليهم أولاً من «المستخدمون والصلاحيات».",
          "Move its people first."
        )
      );
      return;
    }
    if (!window.confirm(t("حذف القطاع سيحذف قياساته. متابعة؟", "Delete the sector and its data?"))) return;
    await apiFetch(`/api/sectors/${id}`, { method: "DELETE" });
    reload();
  }

  const total = people.length;

  return (
    <div className="org">
      <div className="toolbar">
        <div style={{ flex: 1 }} />
        <button className="btn btn-ghost btn-sm" onClick={load}>
          {t("تحديث", "Refresh")}
        </button>
        {canEdit && (
          <button className={`btn btn-sm ${manage ? "btn-ghost" : ""}`} onClick={() => setManage(!manage)}>
            {manage ? t("تمّ", "Done") : t("⚙ إدارة القطاعات", "⚙ Manage sectors")}
          </button>
        )}
      </div>

      {manage && canEdit && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ marginTop: 0 }}>{t("إضافة قطاع", "Add sector")}</h3>
          {err && <div className="alert alert-error">{err}</div>}
          <div className="row">
            <input
              placeholder={t("اسم القطاع", "Sector name")}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <div style={{ flex: "0 0 auto" }}>
              <button className="btn" onClick={addSector} disabled={!name.trim()}>
                {t("إضافة", "Add")}
              </button>
            </div>
          </div>
        </div>
      )}

      {!loaded ? (
        <div className="empty">{t("جارٍ التحميل...", "Loading...")}</div>
      ) : (
        <>
          <div className="org-top">
            <div className="org-head">
              <b>{t("إدارة عمليات الأداء", "Performance Operations")}</b>
              <span>
                {t(`${total} موظفاً`, `${total} people`)} ·{" "}
                {t(`${sectors.length} قطاعات`, `${sectors.length} sectors`)}
              </span>
            </div>
            {head.length > 0 && (
              <div className="org-people org-head-people">
                {head.map((p) => (
                  <span className="org-p" key={p.id}>
                    <i className="av s">{(p.name || "?").trim().charAt(0)}</i>
                    {p.name}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="org-line" />

          <div className="org-grid">
            {sectors.map((s) => {
              const list = inSector(s.id);
              return (
                <div className="org-col" key={s.id}>
                  <div className="org-sec">
                    <b>{s.name}</b>
                    <span className="org-n">{list.length}</span>
                    {manage && canEdit && (
                      <span className="org-x">
                        <button onClick={() => renameSector(s.id, s.name)} title={t("تعديل", "Rename")}>
                          ✎
                        </button>
                        <button onClick={() => removeSector(s.id, list.length)} title={t("حذف", "Delete")}>
                          🗑
                        </button>
                      </span>
                    )}
                  </div>
                  {list.length === 0 ? (
                    <div className="org-empty">{t("لا موظفين بعد", "No people yet")}</div>
                  ) : (
                    <div className="org-people">
                      {list.map((p) => (
                        <span className="org-p" key={p.id}>
                          <i className="av s">{(p.name || "?").trim().charAt(0)}</i>
                          {p.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <p className="org-note">
            {t(
              "الهيكل يُبنى من الحسابات نفسها — أضيفي موظفاً من «المستخدمون والصلاحيات» وأسندي له قطاعه فيظهر هنا مباشرة.",
              "Built from user accounts — add a person and assign their sector and they appear here."
            )}
          </p>
        </>
      )}
    </div>
  );
}
