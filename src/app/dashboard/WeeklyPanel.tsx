"use client";

import { apiFetch } from "@/lib/api";
import { BASE } from "@/lib/base";

import { useCallback, useEffect, useState } from "react";
import WeeklyView, { arDate } from "./WeeklyView";
import type { WeeklyReport } from "@/lib/weekly";

type ShareRow = {
  token: string;
  weekStart: string;
  createdAt: string;
  expiresAt: string | null;
  views: number;
  lastView: string | null;
};

/** بداية الأسبوع (الأحد) لتاريخ — نسخة الواجهة من weekStartOf. */
function weekStartOf(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.toISOString().slice(0, 10);
}
function shift(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export default function WeeklyPanel({ t }: { t: (ar: string, en: string) => string }) {
  const thisWeek = weekStartOf(new Date().toISOString().slice(0, 10));
  const [week, setWeek] = useState(thisWeek);
  const [report, setReport] = useState<WeeklyReport | null>(null);
  const [canShare, setCanShare] = useState(false);
  const [loading, setLoading] = useState(true);
  const [shareOpen, setShareOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await apiFetch(`/api/report?week=${week}`).then((x) => x.json());
    setReport(r.report || null);
    setCanShare(!!r.canShare);
    setLoading(false);
  }, [week]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="wk-panel">
      <div className="wk-bar no-print">
        <div className="wk-nav">
          <button className="btn btn-ghost" onClick={() => setWeek(shift(week, -7))}>
            {t("الأسبوع السابق", "Previous")}
          </button>
          <b>{arDate(week)}</b>
          <button
            className="btn btn-ghost"
            onClick={() => setWeek(shift(week, 7))}
            disabled={week >= thisWeek}
          >
            {t("الأسبوع التالي", "Next")}
          </button>
          {week !== thisWeek && (
            <button className="btn btn-ghost" onClick={() => setWeek(thisWeek)}>
              {t("هذا الأسبوع", "This week")}
            </button>
          )}
        </div>
        <div className="wk-acts">
          <button className="btn" onClick={() => window.print()}>
            {t("تصدير PDF", "Export PDF")}
          </button>
          {canShare && (
            <button className="btn btn-ghost" onClick={() => setShareOpen(true)}>
              {t("مشاركة رابط", "Share link")}
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="empty">{t("جارٍ التحميل...", "Loading...")}</div>
      ) : !report ? (
        <div className="empty">{t("تعذّر بناء التقرير.", "Could not build the report.")}</div>
      ) : (
        <WeeklyView report={report} />
      )}

      {shareOpen && <ShareModal week={week} onClose={() => setShareOpen(false)} t={t} />}
    </div>
  );
}

function ShareModal({
  week,
  onClose,
  t,
}: {
  week: string;
  onClose: () => void;
  t: (ar: string, en: string) => string;
}) {
  const [rows, setRows] = useState<ShareRow[]>([]);
  const [days, setDays] = useState("30");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState("");
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    const r = await apiFetch("/api/report/share").then((x) => x.json());
    setRows(r.shares || []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function create() {
    setBusy(true);
    setErr("");
    const r = await apiFetch("/api/report/share", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ weekStart: week, days: days === "0" ? null : Number(days) }),
    }).then((x) => x.json());
    setBusy(false);
    if (r.error) return setErr(r.error);
    await load();
    copy(r.token);
  }

  async function copy(token: string) {
    const url = `${window.location.origin}${BASE}/w/?t=${token}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(token);
      setTimeout(() => setCopied(""), 2000);
    } catch {
      window.prompt(t("انسخ الرابط:", "Copy the link:"), url);
    }
  }

  async function revoke(token: string) {
    if (!window.confirm(t("إلغاء هذا الرابط نهائيًا؟", "Revoke this link permanently?"))) return;
    await apiFetch(`/api/report/share?token=${token}`, { method: "DELETE" });
    await load();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal task-modal" onClick={(e) => e.stopPropagation()}>
        <div className="m-h">
          <h3>{t("مشاركة التقرير", "Share the report")}</h3>
          <button className="mx" onClick={onClose} aria-label="close">
            ✕
          </button>
        </div>
        <div className="m-b">
          <p className="wk-note">
            {t(
              "الرابط يفتح تقرير هذا الأسبوع للاطّلاع فقط — بلا حساب وبلا أي صلاحية تعديل.",
              "The link opens this week's report read-only — no account, no editing."
            )}
          </p>
          <div className="wk-mk">
            <label>
              {t("مدة الصلاحية", "Valid for")}
              <select value={days} onChange={(e) => setDays(e.target.value)}>
                <option value="7">{t("٧ أيام", "7 days")}</option>
                <option value="30">{t("٣٠ يومًا", "30 days")}</option>
                <option value="90">{t("٩٠ يومًا", "90 days")}</option>
                <option value="0">{t("بلا انتهاء", "No expiry")}</option>
              </select>
            </label>
            <button className="btn" onClick={create} disabled={busy}>
              {busy ? t("جارٍ...", "Working...") : t("إنشاء رابط", "Create link")}
            </button>
          </div>
          {err && <div className="alert alert-error">{err}</div>}

          {rows.length === 0 ? (
            <div className="empty">{t("لا روابط بعد.", "No links yet.")}</div>
          ) : (
            <table className="wk-tbl wk-shares">
              <thead>
                <tr>
                  <th>{t("الأسبوع", "Week")}</th>
                  <th>{t("ينتهي", "Expires")}</th>
                  <th>{t("مرات الفتح", "Views")}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.token}>
                    <td className="ltr">{s.weekStart}</td>
                    <td className="ltr">{s.expiresAt ? s.expiresAt.slice(0, 10) : "—"}</td>
                    <td className="ltr">
                      {s.views}
                      {s.lastView ? ` · ${s.lastView.slice(0, 10)}` : ""}
                    </td>
                    <td className="wk-sact">
                      <button className="btn btn-ghost btn-sm" onClick={() => copy(s.token)}>
                        {copied === s.token ? t("نُسخ ✓", "Copied ✓") : t("نسخ", "Copy")}
                      </button>
                      <button className="btn btn-ghost btn-sm wk-danger" onClick={() => revoke(s.token)}>
                        {t("إلغاء", "Revoke")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
