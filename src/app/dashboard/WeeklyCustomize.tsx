"use client";

/* ============================================================
   إعدادات التقرير الأسبوعي — لوحةٌ واحدة بأربع مجموعات:
   الشكل · ما يظهر · كتابة الأسبوع · المشاركة.

   كانت الإعدادات مبعثرة: مربّعٌ بلا عنوان يفتح صفحةً فيها
   الأقسام والنصوص، والمشاركة في نافذةٍ أخرى، ولا خيار للشكل
   أصلاً. وجُمعت هنا لأن المستخدم يضبطها في جلسةٍ واحدة.

   والحفظ على مستويين: «افتراضي لكل أسبوع» و«هذا الأسبوع وحده» —
   فالافتراضي أساسٌ لا يضيع بتعديل أسبوع.
   ============================================================ */

import { useMemo, useState, type ReactNode } from "react";
import { WEEK_BLOCKS, DEFAULT_LAYOUT, type WeeklyPrefs } from "@/lib/weeklyPrefs";
import { rangeText2 } from "./WeeklyReportView";

type T = (ar: string, en: string) => string;

function Grp({ icon, title, extra, children }: { icon: string; title: string; extra?: ReactNode; children: ReactNode }) {
  return (
    <div className="wcx-g">
      <div className="wcx-gt">
        <i>{icon}</i>
        {title}
        {extra && <span className="wcx-ge">{extra}</span>}
      </div>
      {children}
    </div>
  );
}

export default function WeeklyCustomize({
  prefs,
  weekStart,
  weekEnd,
  canEdit,
  busy,
  onSave,
  onClose,
  share,
  t,
}: {
  prefs: WeeklyPrefs;
  weekStart: string;
  weekEnd: string;
  canEdit: boolean;
  busy: boolean;
  onSave: (next: WeeklyPrefs, scope: "default" | "week") => void;
  onClose: () => void;
  /** مجموعة المشاركة — تُمرَّر من اللوحة لمن يملكها */
  share?: ReactNode;
  t: T;
}) {
  const [draft, setDraft] = useState<WeeklyPrefs>({
    on: { ...prefs.on },
    texts: { ...prefs.texts },
    layout: { ...DEFAULT_LAYOUT, ...prefs.layout },
  });

  /* المنجزات وحدها في قائمة المفاتيح — الترويسة ثابتة، والنصوص
     لها مجموعتها */
  const kinds = useMemo(() => WEEK_BLOCKS.filter((b) => b.kind === "auto" && !b.fixed), []);
  const writable = useMemo(() => WEEK_BLOCKS.filter((b) => b.kind !== "auto"), []);
  const nOn = kinds.filter((b) => draft.on[b.k] !== false).length;

  const toggle = (k: string) => setDraft((d) => ({ ...d, on: { ...d.on, [k]: d.on[k] === false } }));
  const setText = (k: string, v: string) => setDraft((d) => ({ ...d, texts: { ...d.texts, [k]: v } }));
  const setLay = (p: Partial<WeeklyPrefs["layout"]>) =>
    setDraft((d) => ({ ...d, layout: { ...d.layout, ...p } }));
  const setAll = (v: boolean) =>
    setDraft((d) => ({ ...d, on: { ...d.on, ...Object.fromEntries(kinds.map((b) => [b.k, v])) } }));

  return (
    <div className="wcx">
      <div className="wcx-bar no-print">
        <button className="btn btn-ghost" onClick={onClose}>
          ‹ {t("رجوع إلى التقرير", "Back to the report")}
        </button>
        <b className="wcx-week">{rangeText2(weekStart, weekEnd)}</b>
      </div>

      {!canEdit && <div className="alert">{t("العرض فقط.", "View only.")}</div>}

      <Grp icon="📄" title={t("شكل التقرير", "Layout")}>
        <div className="wcx-f">
          <span className="wcx-l">{t("اتجاه الصفحة", "Orientation")}</span>
          <span className="wcx-seg">
            <button className={draft.layout.dir === "v" ? "on" : ""} onClick={() => setLay({ dir: "v" })} disabled={!canEdit}>
              {t("عمودي", "Portrait")}
            </button>
            <button className={draft.layout.dir === "h" ? "on" : ""} onClick={() => setLay({ dir: "h" })} disabled={!canEdit}>
              {t("أفقي", "Landscape")}
            </button>
          </span>
        </div>
        <div className="wcx-f">
          <span className="wcx-l">{t("شريط الهوية", "Identity band")}</span>
          <span className="wcx-seg">
            <button className={draft.layout.band ? "on" : ""} onClick={() => setLay({ band: true })} disabled={!canEdit}>
              {t("بالخلفية", "With image")}
            </button>
            <button className={!draft.layout.band ? "on" : ""} onClick={() => setLay({ band: false })} disabled={!canEdit}>
              {t("بلا", "Plain")}
            </button>
          </span>
        </div>
        <div className="wcx-f">
          <span className="wcx-l">{t("اسم الإدارة", "Department")}</span>
          <input
            className="wcx-in"
            value={draft.layout.dept}
            onChange={(e) => setLay({ dept: e.target.value })}
            disabled={!canEdit}
          />
        </div>
      </Grp>

      <Grp
        icon="✓"
        title={t("ما يظهر من المنجزات", "Achievements shown")}
        extra={
          <>
            <span className="muted">{`${nOn} ${t("من", "of")} ${kinds.length}`}</span>
            {canEdit && (
              <>
                <button className="btn btn-ghost btn-sm" onClick={() => setAll(true)}>{t("الكل", "All")}</button>
                <button className="btn btn-ghost btn-sm" onClick={() => setAll(false)}>{t("لا شيء", "None")}</button>
              </>
            )}
          </>
        }
      >
        <div className="wcx-tg">
          {kinds.map((b) => (
            <button
              key={b.k}
              className={`wcx-t ${draft.on[b.k] !== false ? "on" : ""}`}
              onClick={() => canEdit && toggle(b.k)}
              title={b.note}
              disabled={!canEdit}
            >
              <span className="sw" />
              <span className="nm">{b.name}</span>
            </button>
          ))}
        </div>
      </Grp>

      <Grp icon="✎" title={t("كتابة هذا الأسبوع", "This week's notes")}>
        {writable.map((b) => (
          <div className="wcx-f col" key={b.k}>
            <span className="wcx-l">
              {b.name}
              <em>{b.hint}</em>
            </span>
            <textarea
              className="wcx-ta"
              rows={b.kind === "list" ? 4 : 3}
              value={draft.texts[b.k] || ""}
              onChange={(e) => setText(b.k, e.target.value)}
              disabled={!canEdit}
            />
          </div>
        ))}
      </Grp>

      {share && <Grp icon="🔗" title={t("المشاركة", "Sharing")}>{share}</Grp>}

      {canEdit && (
        <div className="wcx-save no-print">
          <button className="btn" disabled={busy} onClick={() => onSave(draft, "week")}>
            {busy ? t("جارٍ الحفظ…", "Saving…") : t("حفظ لهذا الأسبوع", "Save for this week")}
          </button>
          <button className="btn btn-ghost" disabled={busy} onClick={() => onSave(draft, "default")}>
            {t("حفظ كافتراضي لكل أسبوع", "Save as the default")}
          </button>
          <span className="muted">{t("يُطبَّق فوراً على المعاينة", "Applies to the preview at once")}</span>
        </div>
      )}
    </div>
  );
}
