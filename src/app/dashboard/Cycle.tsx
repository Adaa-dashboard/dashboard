"use client";

/* ============================================================
   التحديث الدوري — فترةٌ تُفتح من ⚙️، وشريطٌ أحمر بمن لم يحدّث
   ------------------------------------------------------------
   «الاستراتيجيات الوطنية تتحدّث كل شهر»: تُفتح فترة من إعدادات
   القسم، وتُلتقط قائمة ما يجب تحديثه. ثم يبقى الشريط الأحمر في
   الصفحة يعرض ما لم يُحدَّث.

   **ومن حدّث يخرج من نفسه**: المنصة لا تسأل من الذي ضغط، وإنما هل
   تغيّر الصفّ بعد بداية النافذة — فسواءٌ حدّثه الاستشاري أم حدّثه
   صاحبُ صلاحيةٍ نيابةً عنه.

   و**النافذة تتجدّد من نفسها**: «شهري» تعني أن الجميع يُطالَبون من
   جديد مع كل شهرٍ يمرّ بلا أن يضغط أحدٌ شيئاً.

   والمنطق في `lib/cycle` ليُختبر بلا React ولا شبكة.
   ============================================================ */

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import {
  unitsOf, pendingOf, isOpen, windowStart, EVERY_AR,
  type Cycle, type CycleRow, type Every,
} from "@/lib/cycle";

type T = (ar: string, en: string) => string;

/** لكل قسمٍ: أين اسمُه، وهل يُطالَب استشاريُّه أم صفُّه */
export const CYCLE_CFG: Record<string, { nameKey: string; byConsultant: boolean }> = {
  sessions: { nameKey: "entity", byConsultant: false },
  natstrat: { nameKey: "name", byConsultant: false },
  inststrat: { nameKey: "owner", byConsultant: true },
  cx: { nameKey: "name", byConsultant: true },
  outputs: { nameKey: "name", byConsultant: false },
};

const dayTxt = (iso: string | number) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("ar-SA-u-nu-latn", { year: "numeric", month: "long", day: "numeric" });
};
const todayISO = () => new Date().toISOString().slice(0, 10);

/* ---------------- قراءة الفترة وكتابتها ---------------- */
export function useCycle(section: string) {
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
        setErr(d.error || "تعذّر الحفظ — تأكّد من تشغيل perf-cycles.sql");
        return false;
      }
      setCycle(value);
      return true;
    },
    [section],
  );

  return { cycle, setCycle, save, busy, err };
}

/* ---------------- الشريط الأحمر في الصفحة ---------------- */
export function CycleBar({
  section, rows, canEdit, t,
}: {
  section: string;
  rows: CycleRow[];
  canEdit: boolean;
  t: T;
}) {
  const cfg = CYCLE_CFG[section];
  const { cycle, save, busy } = useCycle(section);

  const { pending, done, total } = useMemo(
    () => pendingOf(cycle, rows, cfg?.nameKey || "name", cfg?.byConsultant ?? false),
    [cycle, rows, cfg],
  );

  if (!cfg || !cycle || !isOpen(cycle)) return null;

  const drop = (k: string) =>
    void save({ ...cycle, dropped: [...(cycle.dropped || []), { k, at: new Date().toISOString() }] });

  return (
    <div className="cyc">
      <div className="cyc-h">
        <span className="cyc-when">
          {t(
            `فترة تحديث ${cycle.every ? EVERY_AR[cycle.every] : ""} — بدأت ${dayTxt(windowStart(cycle))}`,
            `Update window started ${dayTxt(windowStart(cycle))}`,
          )}
          {total > 0 && <b> · {t(`حدّث ${done} من ${total}`, `${done}/${total}`)}</b>}
        </span>
      </div>

      {pending.length > 0 ? (
        <div className="cyc-bar">
          <b>{t(`لم يحدّث بعدُ · ${pending.length}`, `${pending.length} pending`)}</b>
          {pending.map((p) => (
            <span className="x" key={p.k}>
              {canEdit && (
                <button
                  className="rm"
                  disabled={busy}
                  title={t("إعفاؤه من هذه النافذة", "Skip for this window")}
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
      ) : (
        total > 0 && <div className="cyc-ok">{t("اكتمل التحديث الدوري ✅", "All updated ✅")}</div>
      )}
    </div>
  );
}

/* ---------------- لوحة الفترة داخل ⚙️ ---------------- */
export function CycleSettings({
  section, rows, t,
}: {
  section: string;
  rows: CycleRow[];
  t: T;
}) {
  const cfg = CYCLE_CFG[section];
  const { cycle, save, busy, err } = useCycle(section);
  const open = !!cycle && isOpen(cycle);

  /* الاختيارات قبل البدء — تُقرأ من الفترة الجارية إن وُجدت */
  const [every, setEvery] = useState<Every>("monthly");
  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState("");
  useEffect(() => {
    if (!cycle) return;
    if (cycle.every) setEvery(cycle.every);
    if (cycle.from) setFrom(cycle.from);
    if (cycle.to) setTo(cycle.to);
  }, [cycle]);

  if (!cfg) return null;

  const start = async () => {
    const units = unitsOf(rows, cfg.nameKey, cfg.byConsultant);
    if (!units.length) return;
    if (every === "range" && !to) return;
    await save({
      startedAt: every === "range" ? new Date(from).toISOString() : new Date().toISOString(),
      startedBy: "",
      every,
      ...(every === "range" ? { from, to } : {}),
      units,
      dropped: [],
    });
  };

  const units = unitsOf(rows, cfg.nameKey, cfg.byConsultant);

  return (
    <div className="cyc-set">
      <h4>{t("التحديث الدوري", "Update round")}</h4>

      <div className="cyc-two">
        <label className={open ? "on" : ""}>
          <input type="checkbox" checked={open} disabled={busy} onChange={() => !open && void start()} />
          <span>{t("بدء فترة التحديث", "Open a window")}</span>
        </label>
        <label>
          <input
            type="checkbox"
            checked={false}
            disabled={busy || !open}
            onChange={() => {
              if (confirm(t("إنهاء فترة التحديث وإخفاء الشريط؟", "Close the update window?"))) void save(null);
            }}
          />
          <span>{t("انتهاء فترة التحديث", "Close the window")}</span>
        </label>
      </div>

      {/* الخيارات لا تظهر إلا مع «بدء فترة التحديث» */}
      {!open && (
        <div className="cyc-opt">
          <div className="cyc-r">
            {(["daily", "weekly", "monthly", "range"] as Every[]).map((e) => (
              <button key={e} className={`chip sm ${every === e ? "on" : ""}`} onClick={() => setEvery(e)}>
                {t(EVERY_AR[e], e)}
              </button>
            ))}
          </div>
          {every === "range" && (
            <div className="cyc-r dates">
              <label>
                <span>{t("من", "From")}</span>
                <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              </label>
              <label>
                <span>{t("إلى", "To")}</span>
                <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
              </label>
            </div>
          )}
          <p className="cyc-nt">
            {units.length
              ? t(
                  every === "range"
                    ? `سيُطالَب ${units.length} بالتحديث خلال الفترة المحدّدة، ويخرج كلٌّ منهم متى حُدِّثت بنوده.`
                    : `سيُطالَب ${units.length} بالتحديث، ويتجدّد الطلب ${EVERY_AR[every]}اً من نفسه بلا ضغط زرّ.`,
                  `${units.length} will be asked to update.`,
                )
              : t("لا توجد بنود في هذه الصفحة بعد", "Nothing to update yet")}
          </p>
        </div>
      )}

      {open && cycle && (
        <p className="cyc-nt">
          {t(
            `فترة ${cycle.every ? EVERY_AR[cycle.every] : "مفتوحة"} بدأها ${cycle.startedBy || "—"}. النافذة الحالية من ${dayTxt(windowStart(cycle))}${cycle.every === "range" && cycle.to ? ` إلى ${dayTxt(cycle.to)}` : ""}.`,
            "A window is open.",
          )}
        </p>
      )}

      {err && <div className="cyc-err">{err}</div>}
    </div>
  );
}
