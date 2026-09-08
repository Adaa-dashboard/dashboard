"use client";

/* ============================================================
   سجل النشاط — للتحقّق: من عدّل ماذا ومتى، ومن فعّل حسابه.

   صفحة مؤقتة لمالكة المنصة وحدها (صلاحية audit). كل ما فيها
   يُقرأ من دالتين في القاعدة تتحقّقان من الصلاحية بأنفسهما،
   فحذف الصفحة لا يترك بابًا مفتوحًا.
   ============================================================ */

import { useCallback, useEffect, useMemo, useState } from "react";
import { sb } from "@/lib/supa";

type T = (ar: string, en: string) => string;

type LogRow = { at: string; who: string; kind: string; what: string; where: string };
/* الاستخدام: عدّاد لكل نوع نشاط — بلا أي محتوى */
type UseRow = {
  name: string; job_title: string; activated: boolean;
  last_login: string | null; last_act: string | null;
  items: number; meas: number; notes: number; stickies: number;
  tasks: number; replies: number; portfolio: number; own_notes: number; total: number;
};
type UserRow = {
  name: string; username: string; active: boolean; is_lead: boolean;
  job_title: string; created_at: string; activated_at: string | null;
  last_login: string | null; activated: boolean; approx: boolean;
};

const AR_MONTHS = [
  "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
  "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
];
function when(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${d.getDate()} ${AR_MONTHS[d.getMonth()]} ${d.getFullYear()} · ${hh}:${mm}`;
}

const KIND_TONE: Record<string, string> = {
  "قسم": "#016b5f",
  "قياس": "#2f7fd1",
  "مستهدف": "#c9a020",
  "ملاحظة": "#7a5cd1",
  "مهمة": "#1a9d5c",
  "تكليف": "#e07a3a",
  "ردّ": "#0f8a8a",
  "تفويض": "#a24160",
  "ملاحظة لاصقة": "#c9a020",
  "محفظتي": "#5a7d8c",
  "ملاحظاته الخاصة": "#8a9a95",
  "صفحته الخاصة": "#8a9a95",
};

export default function Audit({ t }: { t: T }) {
  const [days, setDays] = useState(30);
  const [log, setLog] = useState<LogRow[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [use, setUse] = useState<UseRow[]>([]);
  const [who, setWho] = useState("");
  const [kind, setKind] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    const [a, b, c] = await Promise.all([
      sb().rpc("perf_audit_log", { p_days: days, p_limit: 500 }),
      sb().rpc("perf_audit_users"),
      sb().rpc("perf_usage", { p_days: days }),
    ]);
    if (a.error || b.error) setErr(a.error?.message || b.error?.message || "");
    setLog((a.data || []) as LogRow[]);
    setUsers((b.data || []) as UserRow[]);
    /* الدالة قد لا تكون منصَّبة بعد — لا يسقط باقي الصفحة لأجلها */
    setUse(c.error ? [] : ((c.data || []) as UseRow[]));
    setLoading(false);
  }, [days]);

  useEffect(() => {
    void load();
  }, [load]);

  const people = useMemo(
    () => [...new Set(log.map((r) => r.who))].filter((x) => x && x !== "—").sort((a, b) => a.localeCompare(b, "ar")),
    [log],
  );
  const kinds = useMemo(() => [...new Set(log.map((r) => r.kind))], [log]);
  const rows = useMemo(
    () => log.filter((r) => (!who || r.who === who) && (!kind || r.kind === kind)),
    [log, who, kind],
  );

  /* عدّ ما فعله كل شخص — يجيب «هل الجميع يعمل فعلاً؟» بلمحة */
  const perPerson = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of log) if (r.who && r.who !== "—") m.set(r.who, (m.get(r.who) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [log]);

  const on = users.filter((u) => u.activated).length;

  function exportCsv() {
    const head = ["الوقت", "من", "النوع", "ماذا", "أين"];
    const body = rows.map((r) => [when(r.at), r.who, r.kind, r.what, r.where]);
    const csv = "﻿" + [head, ...body].map((l) => l.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `سجل-النشاط-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="au">
      <div className="card" style={{ marginBottom: 20 }}>
        <h2 className="section-title">{t("حالة الحسابات", "Accounts")}</h2>
        <p className="muted" style={{ marginTop: -6 }}>
          {on} {t("مفعّل من", "activated of")} {users.length}
        </p>
        <table className="users-tbl au-tbl">
          <thead>
            <tr>
              <th>{t("الاسم", "Name")}</th>
              <th>{t("اسم الدخول", "Username")}</th>
              <th>{t("الحساب", "Account")}</th>
              <th>{t("وقت التفعيل", "Activated")}</th>
              <th>{t("آخر دخول", "Last sign-in")}</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.username}>
                <td className="u-name">
                  {u.name}
                  {u.job_title && <span className="u-job">{u.job_title}</span>}
                </td>
                <td dir="ltr" style={{ textAlign: "right" }}>{u.username}</td>
                <td>
                  {u.activated ? (
                    <span className="badge badge-manager">{t("مفعّل", "Active")}</span>
                  ) : (
                    <span className="badge badge-off">{t("لم يُفعّل", "Not yet")}</span>
                  )}
                </td>
                <td>
                  {when(u.activated_at)}
                  {u.approx && <span className="au-x">{t("تقديري", "approx.")}</span>}
                </td>
                <td>{when(u.last_login)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {use.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h2 className="section-title">{t("مدى الاستخدام", "Usage")}</h2>
          <p className="muted" style={{ marginTop: -6 }}>
            {t(`خلال ${days} يوماً — عدد ما فعله كلٌّ منهم. لا يظهر محتوى أي ملاحظة.`,
               `Last ${days} days — counts only, no content.`)}
          </p>
          <table className="users-tbl au-tbl">
            <thead>
              <tr>
                <th>{t("الاسم", "Name")}</th>
                <th>{t("آخر نشاط", "Last activity")}</th>
                <th title={t("بنود الأقسام", "Section items")}>{t("أقسام", "Sections")}</th>
                <th title={t("ملاحظات على المؤشرات", "KPI notes")}>{t("ملاحظات", "Notes")}</th>
                <th title={t("ملاحظات القلم اللاصقة", "Sticky notes")}>{t("لاصقة", "Sticky")}</th>
                <th title={t("مهام وتكاليف أنشأها", "Tasks created")}>{t("مهام", "Tasks")}</th>
                <th title={t("ردود على المهام", "Replies")}>{t("ردود", "Replies")}</th>
                <th title={t("بنود محفظته", "Portfolio items")}>{t("محفظتي", "Portfolio")}</th>
                <th title={t("ملاحظاته الخاصة — العدد فقط", "Private notes — count only")}>{t("خاصة", "Private")}</th>
                <th>{t("المجموع", "Total")}</th>
              </tr>
            </thead>
            <tbody>
              {use.map((u) => (
                <tr key={u.name} className={u.total === 0 ? "au-idle" : ""}>
                  <td className="u-name">
                    {u.name}
                    {u.job_title && <span className="u-job">{u.job_title}</span>}
                    {!u.activated && <span className="au-x">{t("لم يُفعّل", "not activated")}</span>}
                  </td>
                  <td>{when(u.last_act)}</td>
                  <td>{u.items || "—"}</td>
                  <td>{u.notes || "—"}</td>
                  <td>{u.stickies || "—"}</td>
                  <td>{u.tasks || "—"}</td>
                  <td>{u.replies || "—"}</td>
                  <td>{u.portfolio || "—"}</td>
                  <td>{u.own_notes || "—"}</td>
                  <td><b>{u.total}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card">
        <div className="au-bar">
          <h2 className="section-title" style={{ margin: 0 }}>
            {t("من عدّل ماذا", "Who changed what")}
            <span className="pm-n">{rows.length}</span>
          </h2>
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={7}>{t("آخر ٧ أيام", "7 days")}</option>
            <option value={30}>{t("آخر ٣٠ يومًا", "30 days")}</option>
            <option value={90}>{t("آخر ٩٠ يومًا", "90 days")}</option>
            <option value={3650}>{t("كل الفترة", "All time")}</option>
          </select>
          <select value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="">{t("كل الأشخاص", "Everyone")}</option>
            {people.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">{t("كل الأنواع", "All kinds")}</option>
            {kinds.map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
          <button className="btn btn-sm" onClick={exportCsv} disabled={!rows.length}>
            ⬇ {t("تصدير", "Export")}
          </button>
        </div>

        {perPerson.length > 0 && (
          <div className="au-sum">
            {perPerson.map(([n, c]) => (
              <button key={n} className={who === n ? "on" : ""} onClick={() => setWho(who === n ? "" : n)}>
                {n} <b>{c}</b>
              </button>
            ))}
          </div>
        )}

        {err && <div className="alert alert-error">{err}</div>}
        {loading ? (
          <div className="empty">{t("جارٍ التحميل...", "Loading...")}</div>
        ) : rows.length === 0 ? (
          <div className="empty">{t("لا نشاط في هذه الفترة.", "No activity in this period.")}</div>
        ) : (
          <table className="users-tbl au-tbl">
            <thead>
              <tr>
                <th>{t("الوقت", "When")}</th>
                <th>{t("من", "Who")}</th>
                <th>{t("النوع", "Kind")}</th>
                <th>{t("ماذا", "What")}</th>
                <th>{t("أين", "Where")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td className="au-w">{when(r.at)}</td>
                  <td className="u-name">{r.who}</td>
                  <td>
                    <span className="au-k" style={{ ["--c" as string]: KIND_TONE[r.kind] || "#8a9a95" }}>
                      {r.kind}
                    </span>
                  </td>
                  <td>{r.what}</td>
                  <td className="au-m">{r.where}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
