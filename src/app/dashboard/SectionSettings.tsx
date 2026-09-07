"use client";

/* ============================================================
   إعدادات القسم — التفويض أثناء الإجازة.

   صاحب القسم يفوّض من ينوب عنه: اطّلاعاً أو تحريراً، إلى تاريخٍ
   ينتهي عنده التفويض من نفسه فلا يُنسى مفتوحاً.

   الحارس سياسات RLS: المنح لمن يملك «القسم:edit» في حسابه — لا
   لمن فُوِّض هو، فالتفويض لا يُورَّث. وهذه الواجهة تجميل فوقه.
   ============================================================ */

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";

type T = (ar: string, en: string) => string;
type Person = { id: string; name: string; jobTitle?: string; sectorIds?: string[] };
type Grant = {
  granteeId: string;
  name: string;
  canEdit: boolean;
  grantedBy: string;
  expiresAt: string | null;
  note: string;
  active: boolean;
};

/** بعد كم يوماً من اليوم — لأزرار المدد السريعة */
function inDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

const AR_MONTHS = [
  "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
  "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
];
function arDate(iso: string | null): string {
  if (!iso) return "بلا انتهاء";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${d} ${AR_MONTHS[m - 1]} ${y}`;
}

export default function SectionSettings({
  section,
  title,
  meId,
  onClose,
  t,
}: {
  section: string;
  title: string;
  meId: string;
  onClose: () => void;
  t: T;
}) {
  const [people, setPeople] = useState<Person[]>([]);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [may, setMay] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const [who, setWho] = useState("");
  const [canEdit, setCanEdit] = useState(true);
  const [until, setUntil] = useState(inDays(14));
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const [g, p] = await Promise.all([
      apiFetch(`/api/grants?section=${section}`).then((r) => r.json()).catch(() => ({})),
      apiFetch("/api/people").then((r) => r.json()).catch(() => ({})),
    ]);
    setGrants(g.grants || []);
    setMay(!!g.canDelegate);
    setPeople((p.people || []).filter((x: Person) => String(x.id) !== String(meId)));
    setLoading(false);
  }, [section, meId]);

  useEffect(() => {
    void load();
  }, [load]);

  const free = useMemo(
    () => people.filter((p) => !grants.some((g) => g.granteeId === String(p.id))),
    [people, grants],
  );

  async function save() {
    if (!who) return;
    setBusy(true);
    setErr("");
    const r = await apiFetch("/api/grants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ section, granteeId: who, canEdit, expiresAt: until, note }),
    }).then((x) => x.json()).catch(() => ({ error: "تعذّر الحفظ" }));
    setBusy(false);
    if (r.error) return setErr(r.error);
    setWho("");
    setNote("");
    await load();
  }

  async function revoke(g: Grant) {
    if (!confirm(t(`سحب التفويض من ${g.name}؟`, `Revoke ${g.name}?`))) return;
    setBusy(true);
    await apiFetch(`/api/grants?section=${section}&granteeId=${g.granteeId}`, { method: "DELETE" });
    setBusy(false);
    await load();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal sg" onClick={(e) => e.stopPropagation()}>
        <div className="m-h">
          <h3>{t("إعدادات", "Settings")} — {title}</h3>
          <button className="mx" onClick={onClose} aria-label="close">
            ✕
          </button>
        </div>

        <div className="m-b">
          {err && <div className="alert alert-error">{err}</div>}

          {loading ? (
            <div className="empty">{t("جارٍ التحميل...", "Loading...")}</div>
          ) : !may ? (
            <div className="empty">
              {t("التفويض لصاحب هذا القسم.", "Only the section owner can delegate.")}
            </div>
          ) : (
            <>
              <p className="sg-note">
                {t(
                  "من ينوب عنك في هذا القسم أثناء إجازتك — إلى تاريخٍ ينتهي عنده التفويض بنفسه.",
                  "Whoever stands in for you while you are away — until a date it ends on its own.",
                )}
              </p>

              <div className="sg-form">
                <label>
                  {t("الموظف", "Person")}
                  <select value={who} onChange={(e) => setWho(e.target.value)}>
                    <option value="">{t("— اختر —", "— pick —")}</option>
                    {free.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                        {p.jobTitle ? ` — ${p.jobTitle}` : ""}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  {t("المستوى", "Level")}
                  <select value={canEdit ? "edit" : "view"} onChange={(e) => setCanEdit(e.target.value === "edit")}>
                    <option value="edit">{t("اطّلاع وتحديث", "View and edit")}</option>
                    <option value="view">{t("اطّلاع فقط", "View only")}</option>
                  </select>
                </label>

                <label>
                  {t("حتى تاريخ", "Until")}
                  <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
                </label>

                <label className="grow">
                  {t("السبب", "Reason")}
                  <input
                    value={note}
                    placeholder={t("إجازة · انتداب · تغطية", "Leave · secondment")}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </label>
              </div>

              <div className="sg-quick">
                {[
                  [7, t("أسبوع", "1 week")],
                  [14, t("أسبوعان", "2 weeks")],
                  [30, t("شهر", "1 month")],
                ].map(([n, lb]) => (
                  <button key={String(n)} className="sg-q" onClick={() => setUntil(inDays(Number(n)))}>
                    {lb as string}
                  </button>
                ))}
                <button className="sg-q" onClick={() => setUntil("")}>
                  {t("بلا انتهاء", "No end")}
                </button>
                <button className="btn btn-sm sg-add" disabled={!who || busy} onClick={save}>
                  {busy ? t("جارٍ...", "Working...") : t("تفويض", "Delegate")}
                </button>
              </div>

              <h4 className="sg-h">{t("التفويضات القائمة", "Current delegations")}</h4>
              {grants.length === 0 ? (
                <div className="empty">{t("لا يوجد تفويض على هذا القسم.", "No delegations.")}</div>
              ) : (
                <table className="sg-tbl">
                  <thead>
                    <tr>
                      <th>{t("الموظف", "Person")}</th>
                      <th>{t("المستوى", "Level")}</th>
                      <th>{t("حتى", "Until")}</th>
                      <th>{t("السبب", "Reason")}</th>
                      <th>{t("منحه", "By")}</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {grants.map((g) => (
                      <tr key={g.granteeId} className={g.active ? "" : "off"}>
                        <td>
                          <b>{g.name}</b>
                          {!g.active && <span className="sg-x">{t("منتهٍ", "expired")}</span>}
                        </td>
                        <td>{g.canEdit ? t("اطّلاع وتحديث", "View and edit") : t("اطّلاع فقط", "View only")}</td>
                        <td className="ltr">{arDate(g.expiresAt)}</td>
                        <td className="sg-m">{g.note || "—"}</td>
                        <td className="sg-m">{g.grantedBy || "—"}</td>
                        <td>
                          <button className="sg-del" onClick={() => revoke(g)} disabled={busy}>
                            {t("سحب", "Revoke")}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </div>

        <div className="m-f">
          <button className="btn btn-ghost btn-sm" onClick={onClose}>
            {t("إغلاق", "Close")}
          </button>
        </div>
      </div>
    </div>
  );
}
