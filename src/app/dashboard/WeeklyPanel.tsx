"use client";

import { apiFetch } from "@/lib/api";
import { BASE } from "@/lib/base";

import { useCallback, useEffect, useMemo, useState } from "react";
import WeeklyReportView, { arDate2 } from "./WeeklyReportView";
import WeeklyCustomize from "./WeeklyCustomize";
import { weekSummary, type Item, type SectionKey, type WeekSum } from "./Sections";
import {
  buildWeekly2,
  weekStartOf,
  shiftDays,
  type AsgRow,
  type WeeklyReport2,
} from "@/lib/weeklyReport";
import { AUTO_SECTIONS, mergePrefs, type WeeklyPrefs } from "@/lib/weeklyPrefs";

type ShareRow = {
  token: string;
  weekStart: string;
  createdAt: string;
  expiresAt: string | null;
  views: number;
  lastView: string | null;
};

export default function WeeklyPanel({
  t,
  canEdit = false,
}: {
  t: (ar: string, en: string) => string;
  canEdit?: boolean;
}) {
  const thisWeek = weekStartOf(new Date().toISOString().slice(0, 10));
  const [week, setWeek] = useState(thisWeek);
  const [sections, setSections] = useState<Partial<Record<SectionKey, Item[]>>>({});
  const [asgRows, setAsgRows] = useState<AsgRow[]>([]);
  const [base, setBase] = useState<unknown>(null);
  const [over, setOver] = useState<unknown>(null);
  const [canShare, setCanShare] = useState(false);
  const [loading, setLoading] = useState(true);
  const [shareOpen, setShareOpen] = useState(false);
  const [tune, setTune] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  /* الأقسام والتكاليف تُقرأ مرة واحدة — لا تتغيّر بتغيّر الأسبوع،
     فالتنقّل بين الأسابيع لا يعيد تحميلها. */
  const loadData = useCallback(async () => {
    setLoading(true);
    const [secs, tk, me] = await Promise.all([
      Promise.all(
        AUTO_SECTIONS.map((k) =>
          apiFetch(`/api/items?section=${k}`).then((r) => r.json()).catch(() => ({})),
        ),
      ),
      apiFetch("/api/tasks").then((r) => r.json()).catch(() => ({})),
      apiFetch("/api/me").then((r) => r.json()).catch(() => ({})),
    ]);
    const map: Partial<Record<SectionKey, Item[]>> = {};
    AUTO_SECTIONS.forEach((k, i) => {
      map[k] = (secs[i]?.items || []) as Item[];
    });
    setSections(map);
    setAsgRows((tk.tasks || []) as AsgRow[]);
    setCanShare(me?.user?.role === "admin");
    setLoading(false);
  }, []);

  const loadPrefs = useCallback(async () => {
    const r = await apiFetch(`/api/weekly?week=${week}`).then((x) => x.json()).catch(() => ({}));
    setBase(r.base ?? null);
    setOver(r.week ?? null);
  }, [week]);

  useEffect(() => {
    void loadData();
  }, [loadData]);
  useEffect(() => {
    void loadPrefs();
  }, [loadPrefs]);

  const prefs: WeeklyPrefs = useMemo(() => mergePrefs(base, over), [base, over]);

  const summaries = useMemo(() => {
    const out: Partial<Record<SectionKey, WeekSum>> = {};
    for (const k of AUTO_SECTIONS) out[k] = weekSummary(k, sections[k] || []);
    return out;
  }, [sections]);

  const report: WeeklyReport2 = useMemo(
    () =>
      buildWeekly2(
        week,
        sections,
        summaries,
        asgRows,
        prefs,
        new Date().toISOString().slice(0, 10),
      ),
    [week, sections, summaries, asgRows, prefs],
  );

  async function save(next: WeeklyPrefs, scope: "default" | "week") {
    setBusy(true);
    setMsg("");
    const r = await apiFetch("/api/weekly", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope, week, prefs: next }),
    }).then((x) => x.json()).catch(() => ({ error: "تعذّر الحفظ" }));
    setBusy(false);
    if (r.error) return setMsg(r.error);
    if (scope === "week") setOver(next);
    else setBase(next);
    setMsg(
      scope === "week"
        ? t("حُفظ لهذا الأسبوع وحده ✓", "Saved for this week ✓")
        : t("حُفظ كافتراضي لكل أسبوع ✓", "Saved as the default ✓"),
    );
    setTune(false);
  }

  if (tune)
    return (
      <div className="wk-panel">
        {msg && <div className="alert">{msg}</div>}
        <WeeklyCustomize
          prefs={prefs}
          weekStart={report.weekStart}
          weekEnd={report.weekEnd}
          asg={report.asg}
          canEdit={canEdit}
          busy={busy}
          onSave={save}
          onClose={() => setTune(false)}
          t={t}
        />
      </div>
    );

  return (
    <div className="wk-panel">
      <div className="wk-bar no-print">
        <div className="wk-nav">
          <button className="btn btn-ghost" onClick={() => setWeek(shiftDays(week, -7))}>
            {t("الأسبوع السابق", "Previous")}
          </button>
          <b>{arDate2(week)}</b>
          <button
            className="btn btn-ghost"
            onClick={() => setWeek(shiftDays(week, 7))}
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
          {/* المربع الصغير: يفتح صفحة اختيار ما يظهر في التقرير */}
          <button
            className="wk-tune"
            onClick={() => setTune(true)}
            title={t("تخصيص التقرير", "Customise the report")}
            aria-label={t("تخصيص التقرير", "Customise the report")}
          >
            <span />
            <span />
            <span />
            <span />
          </button>
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

      {msg && <div className="alert no-print">{msg}</div>}

      {loading ? (
        <div className="empty">{t("جارٍ التحميل...", "Loading...")}</div>
      ) : (
        <WeeklyReportView report={report} prefs={prefs} />
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
