"use client";

/* ============================================================
   التقرير الأسبوعي — بشكل «الإنجاز الأسبوعي» الأول:
   ترويسة · حلقة الأداء العام ومسارها · أقسام تُطوى.

   والفرق عن ذاك: الأرقام تُقرأ من أقسام المنصة (perf_items) لا من
   نموذج المؤشرات القديم — فما يظهر هنا هو ما في الصفحات نفسها.
   وكل كتلة تُظهر أو تُخفى من «تخصيص التقرير».
   ============================================================ */

import { useState } from "react";
import { asset } from "@/lib/base";
import type { WeeklyCell, WeeklyReport2 } from "@/lib/weeklyReport";
import type { WeeklyPrefs } from "@/lib/weeklyPrefs";

const AR_MONTHS = [
  "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
  "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
];

export function arDate2(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}/.test(iso || "")) return iso || "—";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${d} ${AR_MONTHS[m - 1]} ${y}`;
}

export function rangeText2(a: string, b: string): string {
  if (!a || !b) return "—";
  return a.slice(0, 7) === b.slice(0, 7)
    ? `${Number(a.slice(8))} – ${arDate2(b)}`
    : `${arDate2(a)} – ${arDate2(b)}`;
}

/* الأقسام غايات سنوية تُنجَز على مدار السنة، فمقارنة تقدّمها بـ١٠٠٪
   في يوليو تجعل كل شيء أحمر بلا معنى. المقارنة هنا بـ«المتوقّع حتى
   اليوم» = ما انقضى من السنة: بلغه فأخضر، قاربه فذهبي، تخلّف عنه
   كثيراً فأحمر. القاعدة مكتوبة تحت الجدول حتى لا تكون لوناً مبهماً. */
export function expectedPct(now = new Date()): number {
  const y = now.getUTCFullYear();
  const start = Date.UTC(y, 0, 1);
  const end = Date.UTC(y + 1, 0, 1);
  return Math.round(((now.getTime() - start) / (end - start)) * 100);
}
function toneOf(p: number | null, expected: number): string {
  if (p == null) return "#8a9a95";
  if (p >= expected) return "#22c55e";
  if (p >= expected * 0.8) return "#f59e0b";
  return "#ef4444";
}
const pct = (v: number | null) => (v == null ? "—" : `${Math.round(v)}%`);

const DOT: Record<string, string> = {
  done: "#1a9d5c",
  open: "#e0971a",
  risk: "#e0971a",
  late: "#d34a4a",
};

/** خط صغير لتاريخ ستة أسابيع — يتجاهل الفجوات الفارغة */
function Spark({ points, color }: { points: number[]; color: string }) {
  const vals = points.filter((v) => Number.isFinite(v));
  if (vals.length < 2 || Math.max(...vals) === 0) return <span className="wk-nospark">—</span>;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = Math.max(1, max - min);
  const W = 86;
  const H = 26;
  const step = W / Math.max(1, points.length - 1);
  const d = points
    .map((v, i) => `${(i * step).toFixed(1)},${(H - ((v - min) / span) * (H - 6) - 3).toFixed(1)}`)
    .join(" ");
  return (
    <svg className="wk-spark" width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      <polyline points={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function Ring({ value, color }: { value: number | null; color: string }) {
  const R = 52;
  const C = 2 * Math.PI * R;
  const v = value == null ? 0 : Math.max(0, Math.min(100, value));
  return (
    <svg className="wk-ring" viewBox="0 0 130 130" width="118" height="118" role="img" aria-label={`الإنجاز ${pct(value)}`}>
      <circle cx="65" cy="65" r={R} fill="none" stroke="#e9f1ef" strokeWidth="12" />
      <circle
        cx="65" cy="65" r={R} fill="none" stroke={color} strokeWidth="12" strokeLinecap="round"
        strokeDasharray={`${(C * v) / 100} ${C}`} transform="rotate(-90 65 65)"
      />
      <text
        x="65" y="72" textAnchor="middle"
        style={{ font: "800 24px 'Noto Kufi Arabic', sans-serif", direction: "ltr" }}
        fill="#0f2e28"
      >
        {pct(value)}
      </text>
    </svg>
  );
}

function deltaText(n: number): { txt: string; cls: string } {
  if (n === 0) return { txt: "بلا تغيّر", cls: "flat" };
  return n > 0 ? { txt: `▲ ${n}`, cls: "up" } : { txt: `▼ ${Math.abs(n)}`, cls: "down" };
}

/** صفّ قسم — يُفتح فيعرض توزيع حالاته */
function SecRow({ c, expected }: { c: WeeklyCell; expected: number }) {
  const [open, setOpen] = useState(false);
  const p = c.sum.prog && c.sum.prog.of > 0
    ? Math.min(100, Math.round((c.sum.prog.done / c.sum.prog.of) * 100))
    : null;
  const color = toneOf(p, expected);
  const d = deltaText(c.moved - c.prev);
  return (
    <>
      <tr className={`wk-krow ${open ? "open" : ""}`} onClick={() => setOpen(!open)}>
        <td className="wk-kname">
          <span className="wk-caret">▾</span>
          {c.name}
        </td>
        <td className="ltr" data-l="المستهدف">{c.sum.prog ? c.sum.prog.of : "—"}</td>
        <td className="ltr" data-l="المحقق">{c.sum.prog ? c.sum.prog.done : "—"}</td>
        <td data-l="الإنجاز">
          <span className="wk-badge" style={{ background: color }}>{pct(p)}</span>
        </td>
        <td className="ltr" data-l="تحرّك هذا الأسبوع">{c.moved}</td>
        <td className={`wk-delta ${d.cls}`} data-l="عن الأسبوع الماضي">{d.txt}</td>
        <td className="wk-sparkcell" data-l="المسار">
          <Spark points={c.history} color={color} />
        </td>
      </tr>
      {open && (
        <tr className="wk-sub">
          <td colSpan={7}>
            <div className="wk-secgrid">
              {c.sum.breakdown.map((b) => (
                <div className="wk-sec" key={b.k}>
                  <b>{b.k}</b>
                  <span className="wk-secv">{b.n}</span>
                  <span className="wk-secd ltr">
                    {c.sum.total} {c.sum.totalLabel}
                  </span>
                </div>
              ))}
              {c.sum.breakdown.length === 0 && <div className="empty">لا بيانات في هذا القسم بعد.</div>}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <section className={`wk-sect ${open ? "open" : ""}`}>
      <button className="wk-sh" onClick={() => setOpen(!open)}>
        <h3>{title}</h3>
        {count != null && <span className="wk-count">{count}</span>}
        <span className="wk-caret">▾</span>
      </button>
      {open && <div className="wk-sb">{children}</div>}
    </section>
  );
}

export default function WeeklyReportView({
  report,
  prefs,
  dept = "إدارة عمليات الأداء",
}: {
  report: WeeklyReport2;
  prefs: WeeklyPrefs;
  dept?: string;
}) {
  const on = (k: string) => !!prefs.on[k];
  const r = report;
  const expected = expectedPct();
  const color = toneOf(r.overall, expected);
  const movedNow = r.overallHistory[r.overallHistory.length - 1] ?? 0;
  const movedPrev = r.overallHistory[r.overallHistory.length - 2] ?? 0;
  const d = deltaText(movedNow - movedPrev);

  return (
    <div className="wk">
      <header className="wk-head">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={asset("/adaa-logo.png")} alt="أداء" className="wk-logo" />
        <div className="wk-ht">
          <h2>الإنجاز الأسبوعي</h2>
          <span>{dept}</span>
        </div>
        <div className="wk-hr">
          <b>{rangeText2(r.weekStart, r.weekEnd)}</b>
          <span>صدر في {arDate2(new Date().toISOString().slice(0, 10))}</span>
        </div>
      </header>

      {on("perf") && (
        <div className="wk-hero">
          <Ring value={r.overall} color={color} />
          <div className="wk-heroT">
            <span className="wk-lbl">الأداء العام</span>
            <b className={`wk-hd ${d.cls}`}>
              {movedNow} بندًا تحرّك هذا الأسبوع · {d.txt} عن الأسبوع الماضي
            </b>
            <span className="wk-sub2">متوسط تقدّم الأقسام المعروضة نحو غاياتها المعتمدة</span>
          </div>
          <div className="wk-heroS">
            <span className="wk-lbl">حركة ستة أسابيع</span>
            <Spark points={r.overallHistory} color={color} />
          </div>
        </div>
      )}

      {r.cells.length > 0 && (
        <Section title="أقسام الإدارة" count={r.cells.length}>
          <table className="wk-tbl">
            <thead>
              <tr>
                <th>القسم</th>
                <th>المستهدف</th>
                <th>المحقق</th>
                <th>الإنجاز</th>
                <th>تحرّك هذا الأسبوع</th>
                <th>عن الأسبوع الماضي</th>
                <th>المسار</th>
              </tr>
            </thead>
            <tbody>
              {r.cells.map((c) => (
                <SecRow c={c} expected={expected} key={c.k} />
              ))}
            </tbody>
          </table>
          <p className="wk-rule">
            اللون بالمقارنة مع المتوقّع حتى اليوم ({expected}٪ من السنة): بلغه أخضر · قاربه ذهبي · تخلّف عنه أحمر.
          </p>
        </Section>
      )}

      {on("asg") && (
        <Section title="التكاليف الواردة للمركز" count={r.asg.length}>
          {r.asg.length === 0 ? (
            <div className="empty">لا توجد تكاليف مفتوحة هذا الأسبوع.</div>
          ) : (
            <table className="wk-tbl wk-tasks">
              <thead>
                <tr>
                  <th>موضوع التكليف</th>
                  <th>الورود</th>
                  <th>الحالة</th>
                  <th>الخطوات القادمة</th>
                  <th>التحدي</th>
                  <th>الدعم المطلوب</th>
                </tr>
              </thead>
              <tbody>
                {r.asg.map((a) => (
                  <tr key={a.id}>
                    <td className="wk-tname">{a.title}</td>
                    <td className="ltr" data-l="الورود">{a.at ? arDate2(a.at) : "—"}</td>
                    <td data-l="الحالة">
                      <span className="wk-st2">
                        <em style={{ background: DOT[a.state] }} />
                        {a.stateAr}
                      </span>
                    </td>
                    <td className="wk-upd" data-l="الخطوات القادمة">{a.next || "—"}</td>
                    <td className="wk-upd" data-l="التحدي">{a.challenge || "—"}</td>
                    <td className="wk-upd" data-l="الدعم المطلوب">{a.support || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>
      )}

      {on("next") && !!r.texts.next && (
        <Section title="الخطوات القادمة">
          <p className="wk-p">{r.texts.next}</p>
        </Section>
      )}

      {on("support") && !!r.texts.support && (
        <Section title="الدعم المطلوب">
          <p className="wk-p">{r.texts.support}</p>
        </Section>
      )}

      {on("challenges") && !!r.texts.challenges && (
        <Section title="التحديات">
          <p className="wk-p">{r.texts.challenges}</p>
        </Section>
      )}

      {on("priorities") && r.texts.priorities.length > 0 && (
        <Section title="خطة الأسبوع القادم" count={r.texts.priorities.length}>
          <ul className="wk-list">
            {r.texts.priorities.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
        </Section>
      )}

      <footer className="wk-foot">مركز أداء · {dept}</footer>
    </div>
  );
}
