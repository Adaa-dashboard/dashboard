"use client";

/* ============================================================
   تخصيص التقرير الأسبوعي.

   كل أقسام التقرير معروضة، والمؤشَّر عليه هو ما يظهر. وتحتها
   الخانات المكتوبة يدويًا: الخطوات القادمة والدعم المطلوب
   والتحديات وأولويات الأسبوع القادم — وهي أيضاً ضمن الاختيار.

   الحفظ على مستويين: «افتراضي لكل أسبوع» و«هذا الأسبوع وحده».
   الافتراضي هو الأساس، وتغيير الأسبوع يُبنى فوقه — فلا يضيع
   الافتراضي بتعديل أسبوع واحد.
   ============================================================ */

import { useMemo, useState } from "react";
import { WEEK_BLOCKS, type WeeklyPrefs } from "@/lib/weeklyPrefs";
import type { WeeklyAsg } from "@/lib/weeklyReport";
import { rangeText2 } from "./WeeklyReportView";

type T = (ar: string, en: string) => string;

export default function WeeklyCustomize({
  prefs,
  weekStart,
  weekEnd,
  asg,
  canEdit,
  busy,
  onSave,
  onClose,
  t,
}: {
  prefs: WeeklyPrefs;
  weekStart: string;
  weekEnd: string;
  asg: WeeklyAsg[];
  canEdit: boolean;
  busy: boolean;
  /** scope: الافتراضي لكل أسبوع، أو هذا الأسبوع وحده */
  onSave: (next: WeeklyPrefs, scope: "default" | "week") => void;
  onClose: () => void;
  t: T;
}) {
  const [draft, setDraft] = useState<WeeklyPrefs>({
    on: { ...prefs.on },
    texts: { ...prefs.texts },
  });

  const nOn = useMemo(() => WEEK_BLOCKS.filter((b) => draft.on[b.k]).length, [draft.on]);

  const toggle = (k: string) =>
    setDraft((d) => ({ ...d, on: { ...d.on, [k]: !d.on[k] } }));
  const setText = (k: string, v: string) =>
    setDraft((d) => ({ ...d, texts: { ...d.texts, [k]: v } }));
  const setAll = (v: boolean) =>
    setDraft((d) => ({
      ...d,
      on: Object.fromEntries(WEEK_BLOCKS.map((b) => [b.k, b.fixed ? true : v])),
    }));

  const writable = WEEK_BLOCKS.filter((b) => b.kind !== "auto");

  return (
    <div className="wc">
      <div className="wc-bar no-print">
        <button className="btn btn-ghost" onClick={onClose}>
          ‹ {t("رجوع إلى التقرير", "Back to the report")}
        </button>
        <b className="wc-week">{rangeText2(weekStart, weekEnd)}</b>
      </div>

      {!canEdit && (
        <div className="alert">
          {t(
            "العرض فقط — تخصيص التقرير لمن يحرّره.",
            "View only — customising the report is for its editors.",
          )}
        </div>
      )}

      <div className="wc-hd">
        <div>
          <h3>{t("أقسام التقرير", "Report sections")}</h3>
          <span>
            {nOn} {t("من", "of")} {WEEK_BLOCKS.length} {t("قسمًا مُفعّل", "sections on")}
          </span>
        </div>
        {canEdit && (
          <div className="wc-acts">
            <button className="btn btn-ghost btn-sm" onClick={() => setAll(true)}>
              {t("الكل", "All")}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setAll(false)}>
              {t("إلغاء الكل", "None")}
            </button>
          </div>
        )}
      </div>

      <div className="wc-ops">
        {WEEK_BLOCKS.map((b) => (
          <button
            key={b.k}
            className={`wc-op ${draft.on[b.k] ? "on" : ""}`}
            disabled={!canEdit || !!b.fixed}
            onClick={() => toggle(b.k)}
          >
            <span className={`wc-bx ${draft.on[b.k] ? "on" : ""}`}>{draft.on[b.k] ? "✓" : ""}</span>
            <span className="wc-tt">
              <b>{b.name}</b>
              <span>{b.note}</span>
            </span>
            {b.fixed && <span className="wc-lk">{t("ثابت", "fixed")}</span>}
          </button>
        ))}
      </div>

      <h3 className="wc-h">
        {t("الخانات المكتوبة يدويًا", "Written by hand")}
        <em>{t("تظهر في التقرير كما تُكتب هنا", "They appear in the report as written")}</em>
      </h3>
      <div className="wc-wr">
        {writable.map((b) => (
          <div className={`wc-wb ${draft.on[b.k] ? "" : "off"}`} key={b.k}>
            <label>
              {b.name}
              {!draft.on[b.k] && <em>{t("مُطفأ — لن يظهر", "off — hidden")}</em>}
            </label>
            <textarea
              rows={b.kind === "list" ? 4 : 3}
              value={draft.texts[b.k] || ""}
              placeholder={b.hint}
              disabled={!canEdit}
              onChange={(e) => setText(b.k, e.target.value)}
            />
          </div>
        ))}
      </div>

      {draft.on.asg && (
        <>
          <h3 className="wc-h">
            {t("التكاليف الواردة للمركز", "Assignments")}
            <em>{t("ما يُكتب هنا يظهر تحت كل تكليف", "Shown under each assignment")}</em>
          </h3>
          {asg.length === 0 ? (
            <div className="empty">{t("لا توجد تكاليف مفتوحة هذا الأسبوع.", "No open assignments this week.")}</div>
          ) : (
            <div className="wc-asg">
              {asg.map((a) => (
                <div className="wc-a" key={a.id}>
                  <div className="wc-at">
                    <b>{a.title}</b>
                    <span>{a.stateAr}</span>
                  </div>
                  <div className="wc-af">
                    {[
                      ["next", t("الخطوات القادمة", "Next steps")],
                      ["challenge", t("التحدي", "Challenge")],
                      ["support", t("الدعم المطلوب", "Support needed")],
                    ].map(([f, label]) => (
                      <label key={f}>
                        {label}
                        <textarea
                          rows={2}
                          value={draft.texts[`asg:${a.id}:${f}`] || ""}
                          disabled={!canEdit}
                          onChange={(e) => setText(`asg:${a.id}:${f}`, e.target.value)}
                        />
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <p className="wc-note">
        {t(
          "ما لا يُؤشَّر عليه لا يظهر في التقرير ولا في ملف الـPDF ولا في الرابط المشترَك. الأقسام المقروءة آليًا تُحدَّث من صفحات المنصة نفسها.",
          "Unchecked sections never appear — not in the report, the PDF, or the shared link.",
        )}
      </p>

      {canEdit && (
        <div className="wc-save no-print">
          <button className="btn" disabled={busy} onClick={() => onSave(draft, "default")}>
            {busy ? t("جارٍ الحفظ...", "Saving...") : t("حفظ كافتراضي لكل أسبوع", "Save as the default")}
          </button>
          <button className="btn btn-ghost" disabled={busy} onClick={() => onSave(draft, "week")}>
            {t("لهذا الأسبوع وحده", "This week only")}
          </button>
        </div>
      )}
    </div>
  );
}
