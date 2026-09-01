"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Band, bandOf, tint } from "@/lib/calc";

/* ============ الأنواع (نسخة الواجهة) ============ */
export interface DSector {
  id: string;
  name: string;
}
export interface DIndicator {
  id: string;
  name: string;
  unit: "percent" | "number";
}
export interface DPeriod {
  id: string;
  weekStart?: string;
}
export interface DMeasurement {
  sectorId: string;
  indicatorId: string;
  periodId: string;
  actual: number | null;
  updatedAt: string;
}
export interface DNote {
  id: string;
  sectorId: string;
  indicatorId: string;
  text: string;
  byName: string;
  at: string;
}

interface Props {
  isAdmin: boolean;
  mySectorIds: string[];
  sectors: DSector[];
  indicators: DIndicator[];
  periods: DPeriod[];
  statuses: Band[];
  targetOf: (sectorId: string, indicatorId: string, quarter: number | null) => number | null;
  t: (ar: string, en: string) => string;
  reload: () => void;
}

const QUARTERS = [1, 2, 3, 4];

function quarterOf(iso: string): number {
  const m = Number((iso || "").slice(5, 7));
  return m ? Math.floor((m - 1) / 3) + 1 : 0;
}
function yearOf(iso: string): number {
  return Number((iso || "").slice(0, 4)) || 0;
}
/** أول يوم في ربع معيّن — حدّ المقارنة مع الربع السابق. */
function quarterStart(year: number, q: number): string {
  return `${year}-${String((q - 1) * 3 + 1).padStart(2, "0")}-01`;
}

function pct(v: number | null): string {
  return v == null ? "—" : `${Math.round(v)}%`;
}
function num(v: number | null): string {
  return v == null ? "—" : String(v);
}

/** تاريخ القياس: بداية أسبوع فترته، وإلا وقت آخر تحديث. */
function dateOf(m: DMeasurement, periods: DPeriod[]): string {
  const p = periods.find((x) => x.id === m.periodId);
  return p?.weekStart || (m.updatedAt || "").slice(0, 10);
}

export default function Details({
  isAdmin,
  mySectorIds,
  sectors,
  indicators,
  periods,
  statuses,
  targetOf,
  t,
  reload,
}: Props) {
  const [by, setBy] = useState<"indicator" | "sector">("indicator");
  const [scope, setScope] = useState<number | null>(null); // null = كل السنة
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<DMeasurement[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [notesFor, setNotesFor] = useState<{ sectorId: string; indicatorId: string } | null>(null);
  const [noteCount, setNoteCount] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState<Record<string, "busy" | "ok" | "err">>({});

  const load = useCallback(async () => {
    setLoading(true);
    const [m, n] = await Promise.all([
      fetch("/api/measurements").then((r) => r.json()),
      fetch("/api/notes").then((r) => r.json()),
    ]);
    setRows(m.measurements || []);
    const counts: Record<string, number> = {};
    for (const nt of (n.notes || []) as DNote[]) {
      const k = `${nt.sectorId}|${nt.indicatorId}`;
      counts[k] = (counts[k] || 0) + 1;
    }
    setNoteCount(counts);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const year = useMemo(() => {
    let max = 0;
    for (const m of rows) {
      const y = yearOf(dateOf(m, periods));
      if (y > max) max = y;
    }
    return max || new Date().getFullYear();
  }, [rows, periods]);

  /** أحدث قياس لكل خلية — إمّا مطلقاً، أو حتى تاريخ معيّن (للمقارنة). */
  const cellsUpTo = useCallback(
    (cutoff: string | null) => {
      const map = new Map<string, DMeasurement>();
      for (const m of rows) {
        if (cutoff && dateOf(m, periods) >= cutoff) continue;
        const k = `${m.sectorId}|${m.indicatorId}`;
        const cur = map.get(k);
        if (!cur || (m.updatedAt || "") > (cur.updatedAt || "")) map.set(k, m);
      }
      return map;
    },
    [rows, periods]
  );

  const now = useMemo(() => cellsUpTo(null), [cellsUpTo]);
  // مقارنة بالربع السابق: آخر قيمة قبل بداية الربع المعروض (أو الربع الجاري إن كان النطاق سنة كاملة)
  const refQ = scope ?? (quarterOf(new Date().toISOString().slice(0, 10)) || 1);
  const prev = useMemo(
    () => cellsUpTo(quarterStart(refQ === 1 ? year - 1 : year, refQ === 1 ? 4 : refQ - 1)),
    [cellsUpTo, refQ, year]
  );

  const canEdit = (sectorId: string) => isAdmin || mySectorIds.includes(sectorId);

  function cell(sectorId: string, indicatorId: string) {
    const k = `${sectorId}|${indicatorId}`;
    const target = targetOf(sectorId, indicatorId, scope);
    const m = now.get(k);
    const actual = m?.actual ?? null;
    const ach = target != null && target > 0 && actual != null ? (actual / target) * 100 : null;
    const pm = prev.get(k);
    const pAch =
      target != null && target > 0 && pm?.actual != null ? (pm.actual / target) * 100 : null;
    return {
      key: k,
      target,
      actual,
      diff: target != null && actual != null ? actual - target : null,
      ach,
      delta: ach != null && pAch != null ? ach - pAch : null,
      band: bandOf(ach, statuses),
      updatedAt: m?.updatedAt || "",
    };
  }

  /** الفعلي يُحفظ في الفترة الجارية نفسها التي تكتب فيها شاشة الإدخال — بلا مساس بالتاريخ. */
  async function currentPeriodId(): Promise<string> {
    if (periods.length > 0) return periods[0].id;
    const res = await fetch("/api/periods", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "التحديث" }),
    });
    const d = await res.json();
    if (!res.ok || !d.period) throw new Error(d.error || "تعذّر التهيئة");
    return d.period.id as string;
  }

  async function saveActual(sectorId: string, indicatorId: string, raw: string) {
    const k = `${sectorId}|${indicatorId}`;
    const before = now.get(k)?.actual ?? null;
    const value = raw.trim() === "" ? null : Number(raw);
    if (value != null && !Number.isFinite(value)) return;
    if (value === before) return; // لا تكتب ما لم يتغيّر

    setSaving((s) => ({ ...s, [k]: "busy" }));
    try {
      const pid = await currentPeriodId();
      const res = await fetch("/api/measurements", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [
            {
              sectorId,
              indicatorId,
              periodId: pid,
              target: targetOf(sectorId, indicatorId, null) ?? "",
              actual: raw.trim(),
            },
          ],
        }),
      });
      if (!res.ok) throw new Error("save failed");
      setSaving((s) => ({ ...s, [k]: "ok" }));
      setTimeout(() => setSaving((s) => ({ ...s, [k]: undefined as never })), 1600);
      await load();
      reload();
    } catch {
      setSaving((s) => ({ ...s, [k]: "err" }));
    }
  }

  const term = q.trim();
  const groups =
    by === "indicator"
      ? indicators
          .filter((i) => !term || i.name.includes(term))
          .map((i) => ({ id: i.id, name: i.name, unit: i.unit, items: sectors }))
      : sectors
          .filter((s) => !term || s.name.includes(term))
          .map((s) => ({ id: s.id, name: s.name, unit: undefined, items: indicators }));

  const isOpen = (id: string) => open[id] !== false; // مفتوحة افتراضياً

  /** تصدير كل الخلايا (لا المعروض فقط) — CSV بترميز UTF-8 يفتحه إكسل مباشرة. */
  function exportCSV() {
    const head = [
      "القطاع",
      "المؤشر",
      "المستهدف",
      "الفعلي",
      "الفرق",
      "نسبة الإنجاز %",
      "الفرق عن الربع السابق",
      "الحالة",
      "آخر تحديث",
    ];
    const out: string[][] = [];
    for (const s of sectors)
      for (const i of indicators) {
        const c = cell(s.id, i.id);
        out.push([
          s.name,
          i.name,
          c.target == null ? "" : String(c.target),
          c.actual == null ? "" : String(c.actual),
          c.diff == null ? "" : String(c.diff),
          c.ach == null ? "" : String(Math.round(c.ach)),
          c.delta == null ? "" : String(Math.round(c.delta)),
          c.band?.label || "",
          (c.updatedAt || "").slice(0, 10),
        ]);
      }
    const csv = [head, ...out]
      .map((r) => r.map((v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(","))
      .join("\r\n");
    const url = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "المؤشرات-التفصيلية.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="dt">
      <div className="dt-bar">
        <div className="segs">
          <button className={`sg ${by === "indicator" ? "on" : ""}`} onClick={() => setBy("indicator")}>
            {t("حسب المؤشر", "By KPI")}
          </button>
          <button className={`sg ${by === "sector" ? "on" : ""}`} onClick={() => setBy("sector")}>
            {t("حسب القطاع", "By sector")}
          </button>
        </div>
        <div className="segs">
          <button className={`sg ${scope == null ? "on" : ""}`} onClick={() => setScope(null)}>
            {t("كل السنة", "Full year")}
          </button>
          {QUARTERS.map((n) => (
            <button key={n} className={`sg ${scope === n ? "on" : ""}`} onClick={() => setScope(n)}>
              Q{n}
            </button>
          ))}
        </div>
        <input
          className="dt-q"
          placeholder={t("بحث…", "Search…")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button className="btn btn-ghost btn-sm" onClick={exportCSV}>
          ⬇ Excel
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => window.print()}>
          🖨 {t("طباعة", "Print")}
        </button>
      </div>

      {loading ? (
        <div className="empty">{t("جارٍ التحميل...", "Loading...")}</div>
      ) : groups.length === 0 ? (
        <div className="empty">{t("لا نتائج مطابقة.", "No matches.")}</div>
      ) : (
        groups.map((g) => (
          <section className={`dt-g ${isOpen(g.id) ? "open" : ""}`} key={g.id}>
            <button className="dt-gh" onClick={() => setOpen((s) => ({ ...s, [g.id]: !isOpen(g.id) }))}>
              <span className="dt-caret">▾</span>
              <h3>{g.name}</h3>
              <GroupSummary
                cells={g.items.map((it) =>
                  by === "indicator" ? cell(it.id, g.id) : cell(g.id, it.id)
                )}
                statuses={statuses}
                t={t}
              />
            </button>

            {isOpen(g.id) && (
              <div className="dt-tw">
                <table className="dt-tbl">
                  <thead>
                    <tr>
                      <th>{by === "indicator" ? t("القطاع", "Sector") : t("المؤشر", "KPI")}</th>
                      <th>{t("المستهدف", "Target")}</th>
                      <th>{t("الفعلي", "Actual")}</th>
                      <th>{t("الفرق", "Gap")}</th>
                      <th>{t("الإنجاز", "Achievement")}</th>
                      <th>{t("مقارنة بالربع السابق", "vs. previous quarter")}</th>
                      <th>{t("الحالة", "Status")}</th>
                      <th>{t("ملاحظات", "Notes")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.items.map((it) => {
                      const sectorId = by === "indicator" ? it.id : g.id;
                      const indicatorId = by === "indicator" ? g.id : it.id;
                      const c = cell(sectorId, indicatorId);
                      const editable = canEdit(sectorId);
                      const st = saving[c.key];
                      const notes = noteCount[c.key] || 0;
                      return (
                        <tr key={it.id}>
                          <td className="dt-name">{it.name}</td>
                          <td className="ltr" data-l={t("المستهدف", "Target")}>
                            {num(c.target)}
                          </td>
                          <td className={`dt-act ${st ? st : ""}`} data-l={t("الفعلي", "Actual")}>
                            {editable ? (
                              <input
                                type="number"
                                className="ltr"
                                defaultValue={c.actual ?? ""}
                                placeholder="—"
                                key={`${c.key}-${c.actual ?? ""}`}
                                onBlur={(e) => saveActual(sectorId, indicatorId, e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                                }}
                              />
                            ) : (
                              <span className="ltr">{num(c.actual)}</span>
                            )}
                            {st === "ok" && <span className="dt-tick">✓</span>}
                            {st === "err" && <span className="dt-x">!</span>}
                          </td>
                          <td
                            className={`ltr dt-diff ${c.diff == null ? "" : c.diff < 0 ? "neg" : "pos"}`}
                            data-l={t("الفرق", "Gap")}
                          >
                            {c.diff == null ? "—" : c.diff > 0 ? `+${c.diff}` : String(c.diff)}
                          </td>
                          <td className="ltr dt-ach" data-l={t("الإنجاز", "Achievement")}>
                            {pct(c.ach)}
                          </td>
                          <td
                            className={`dt-delta ${c.delta == null || Math.round(c.delta) === 0 ? "flat" : c.delta > 0 ? "up" : "down"}`}
                            data-l={t("عن الربع السابق", "vs. prev. quarter")}
                          >
                            {c.delta == null ? (
                              "—"
                            ) : Math.round(c.delta) === 0 ? (
                              t("بلا تغيّر", "no change")
                            ) : (
                              <bdi dir="ltr">
                                {c.delta > 0 ? "▲" : "▼"} {Math.abs(Math.round(c.delta))}
                              </bdi>
                            )}
                          </td>
                          <td data-l={t("الحالة", "Status")}>
                            {c.band ? (
                              <span
                                className="dt-badge"
                                style={{ background: tint(c.band.color), color: c.band.color }}
                              >
                                {c.band.label}
                              </span>
                            ) : (
                              <span className="muted">—</span>
                            )}
                          </td>
                          <td data-l={t("ملاحظات", "Notes")}>
                            <button
                              className={`dt-note ${notes ? "has" : ""}`}
                              onClick={() => setNotesFor({ sectorId, indicatorId })}
                              title={t("ملاحظات", "Notes")}
                            >
                              💬{notes ? ` ${notes}` : ""}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ))
      )}

      {notesFor && (
        <NotesPanel
          sectorId={notesFor.sectorId}
          indicatorId={notesFor.indicatorId}
          title={`${sectors.find((s) => s.id === notesFor.sectorId)?.name || ""} · ${
            indicators.find((i) => i.id === notesFor.indicatorId)?.name || ""
          }`}
          onClose={() => {
            setNotesFor(null);
            load();
          }}
          t={t}
        />
      )}
    </div>
  );
}

/** ملخّص المجموعة في رأسها: الإنجاز المتوسط وعدد الخلايا المقيسة. */
function GroupSummary({
  cells,
  statuses,
  t,
}: {
  cells: { ach: number | null }[];
  statuses: Band[];
  t: (ar: string, en: string) => string;
}) {
  const vals = cells.map((c) => c.ach).filter((v): v is number => v != null);
  const avg = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
  const band = bandOf(avg, statuses);
  return (
    <span className="dt-gs">
      <b style={{ color: avg == null ? "var(--muted)" : band?.color }} className="ltr">
        {avg == null ? "—" : `${avg}%`}
      </b>
      <span className="muted">
        {vals.length}/{cells.length} {t("مقيسة", "measured")}
      </span>
    </span>
  );
}

/** لوحة ملاحظات خلية واحدة مع منشن (@) لمستخدم. */
function NotesPanel({
  sectorId,
  indicatorId,
  title,
  onClose,
  t,
}: {
  sectorId: string;
  indicatorId: string;
  title: string;
  onClose: () => void;
  t: (ar: string, en: string) => string;
}) {
  const [notes, setNotes] = useState<DNote[]>([]);
  const [people, setPeople] = useState<{ id: string; name: string }[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    const r = await fetch(`/api/notes?sectorId=${sectorId}&indicatorId=${indicatorId}`).then((x) =>
      x.json()
    );
    setNotes((r.notes || []).slice().reverse());
    setPeople(r.people || []);
  }, [sectorId, indicatorId]);

  useEffect(() => {
    load();
  }, [load]);

  // المنشن يُستخرج من النص: كل @اسم يطابق مستخدماً نشطاً
  const mentioned = people.filter((p) => text.includes("@" + p.name));

  async function send() {
    if (!text.trim()) return;
    setBusy(true);
    setErr("");
    const r = await fetch("/api/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sectorId,
        indicatorId,
        text: text.trim(),
        mentions: mentioned.map((p) => p.id),
      }),
    }).then((x) => x.json());
    setBusy(false);
    if (r.error) return setErr(r.error);
    setText("");
    await load();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal task-modal" onClick={(e) => e.stopPropagation()}>
        <div className="m-h">
          <h3>{title}</h3>
          <button className="mx" onClick={onClose} aria-label="close">
            ✕
          </button>
        </div>
        <div className="m-b">
          {notes.length === 0 ? (
            <div className="empty">{t("لا ملاحظات على هذا المؤشر بعد.", "No notes yet.")}</div>
          ) : (
            <div className="nt-list">
              {notes.map((n) => (
                <div className="nt" key={n.id}>
                  <span className="av s">{(n.byName || "?").trim().charAt(0)}</span>
                  <div>
                    <div className="nt-h">
                      <b>{n.byName}</b>
                      <span className="muted ltr">{(n.at || "").slice(0, 10)}</span>
                    </div>
                    <p>{n.text}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {err && <div className="alert alert-error">{err}</div>}
          <label>{t("ملاحظة جديدة", "New note")}</label>
          <textarea
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t("اكتب ملاحظتك… واذكر زميلاً بـ @اسمه", "Write a note… mention with @name")}
          />
          <div className="nt-people">
            {people.map((p) => (
              <button
                key={p.id}
                className={`nt-chip ${mentioned.some((m) => m.id === p.id) ? "on" : ""}`}
                onClick={() => setText((s) => (s.includes("@" + p.name) ? s : `${s}${s ? " " : ""}@${p.name} `))}
              >
                @{p.name}
              </button>
            ))}
          </div>
        </div>
        <div className="m-f">
          <button className="btn" onClick={send} disabled={busy || !text.trim()}>
            {busy ? t("جارٍ...", "Sending...") : t("إضافة", "Add")}
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            {t("إغلاق", "Close")}
          </button>
        </div>
      </div>
    </div>
  );
}
