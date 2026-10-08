"use client";

/* ============================================================
   التحديث الدوري — زرٌّ يفتح دورة، وشريطٌ بمن لم يحدّث
   ------------------------------------------------------------
   «الاستراتيجيات الوطنية تتحدّث كل شهر»: يضغط صاحب الصلاحية
   «التحديث الدوري» فتُفتح دورة، وتُلتقط قائمة ما يجب تحديثه
   لحظتَها. ثم يبقى الشريط الأحمر يعرض ما لم يُحدَّث.

   **ومن حدّث يخرج من نفسه**: المنصة لا تسأل من الذي ضغط، وإنما
   هل تغيّر الصفّ بعد بداية الدورة — فسواءٌ حدّثه الاستشاري أم
   حدّثه صاحبُ صلاحيةٍ نيابةً عنه.

   والمنطق في `lib/cycle` ليُختبر بلا React ولا شبكة.
   ============================================================ */

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import { unitsOf, pendingOf, type Cycle, type CycleRow } from "@/lib/cycle";

type T = (ar: string, en: string) => string;

/** لكل قسمٍ: أين اسمُه، وهل يُطالَب استشاريُّه أم صفُّه */
export const CYCLE_CFG: Record<string, { nameKey: string; byConsultant: boolean }> = {
  sessions: { nameKey: "entity", byConsultant: false },
  natstrat: { nameKey: "name", byConsultant: false },
  inststrat: { nameKey: "owner", byConsultant: true },
  cx: { nameKey: "name", byConsultant: true },
  outputs: { nameKey: "name", byConsultant: false },
};

const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("ar-SA-u-nu-latn", { year: "numeric", month: "long", day: "numeric" });
};

export function CycleBar({
  section, rows, canEdit, t,
}: {
  section: string;
  rows: CycleRow[];
  canEdit: boolean;
  t: T;
}) {
  const cfg = CYCLE_CFG[section];
  const [cycle, setCycle] = useState<Cycle | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(() => {
    void apiFetch(`/api/cycle?section=${encodeURIComponent(section)}`)
      .then((r) => r.json())
      .then((d) => setCycle((d.cycle as Cycle) ?? null))
      .catch(() => {});
  }, [section]);
  useEffect(() => load(), [load]);

  const save = useCallback(
    async (value: Cycle | null) => {
      setBusy(true);
      setErr("");
      const r = await apiFetch("/api/cycle", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ section, value }),
      });
      setBusy(false);
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setErr(d.error || t("تعذّر الحفظ", "Could not save"));
        return;
      }
      setCycle(value);
    },
    [section, t],
  );

  const { pending, done, total } = useMemo(
    () => pendingOf(cycle, rows, cfg?.nameKey || "name", cfg?.byConsultant ?? false),
    [cycle, rows, cfg],
  );

  if (!cfg) return null;

  const start = async () => {
    const units = unitsOf(rows, cfg.nameKey, cfg.byConsultant);
    if (!units.length) {
      setErr(t("لا توجد بنود في هذه الصفحة بعد", "Nothing to update yet"));
      return;
    }
    if (
      cycle &&
      !confirm(
        t(
          `توجد دورة مفتوحة بدأت ${when(cycle.startedAt)} ولم يحدّث فيها ${pending.length}. بدء دورة جديدة يُلغيها ويطالب الجميع من جديد. متابعة؟`,
          "A cycle is already open. Start a new one?",
        ),
      )
    )
      return;
    if (
      !cycle &&
      !confirm(
        t(
          `سيُطالَب ${units.length} بالتحديث، ويخرج كلٌّ منهم من الشريط متى حُدِّثت بنوده. متابعة؟`,
          `${units.length} will be asked to update. Continue?`,
        ),
      )
    )
      return;
    await save({
      startedAt: new Date().toISOString(),
      startedBy: "",
      units,
      dropped: [],
    });
  };

  const drop = (k: string) =>
    cycle && void save({ ...cycle, dropped: [...(cycle.dropped || []), k] });

  return (
    <div className="cyc">
      <div className="cyc-h">
        {canEdit && (
          <button className="btn btn-sm" disabled={busy} onClick={() => void start()}>
            🔄 {t("التحديث الدوري", "Update round")}
          </button>
        )}
        {cycle && (
          <span className="cyc-when">
            {t(
              `دورة بدأها ${cycle.startedBy || "—"} في ${when(cycle.startedAt)}`,
              `Started by ${cycle.startedBy || "—"} on ${when(cycle.startedAt)}`,
            )}
            {total > 0 && <b> · {t(`حدّث ${done} من ${total}`, `${done}/${total}`)}</b>}
          </span>
        )}
        {cycle && canEdit && (
          <button
            className="cyc-end"
            disabled={busy}
            onClick={() => {
              if (confirm(t("إنهاء الدورة وإخفاء الشريط؟", "End this round?"))) void save(null);
            }}
          >
            {t("إنهاء الدورة", "End")}
          </button>
        )}
      </div>

      {err && <div className="cyc-err">{err}</div>}

      {cycle && pending.length > 0 && (
        <div className="cyc-bar">
          <b>{t(`لم يحدّث بعدُ · ${pending.length}`, `${pending.length} pending`)}</b>
          {pending.map((p) => (
            <span className="x" key={p.k}>
              {canEdit && (
                <button
                  className="rm"
                  disabled={busy}
                  title={t("حذفه من هذه الدورة", "Remove from this round")}
                  aria-label={t("حذف", "Remove")}
                  onClick={() => drop(p.k)}
                >
                  ✕
                </button>
              )}
              {p.label}
              {p.total > 1 && <i>{p.done}/{p.total}</i>}
            </span>
          ))}
        </div>
      )}

      {cycle && pending.length === 0 && total > 0 && (
        <div className="cyc-ok">{t("اكتمل التحديث الدوري ✅", "All updated ✅")}</div>
      )}
    </div>
  );
}
