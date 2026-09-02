"use client";

import { asset } from "@/lib/base";

import { useState } from "react";
import type { WeeklyKpi, WeeklyReport } from "@/lib/weekly";

const AR_MONTHS = [
  "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
  "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
];

/** 2026-03-08 ⇐ 8 مارس 2026 */
export function arDate(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso || "—";
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${AR_MONTHS[m - 1]} ${y}`;
}

/** المدى: 8 – 14 مارس 2026 (الشهر مرة واحدة إن كان الطرفان في شهر واحد) */
function rangeText(a: string, b: string): string {
  if (a.slice(0, 7) === b.slice(0, 7)) {
    return `${Number(a.slice(8))} – ${arDate(b)}`;
  }
  return `${arDate(a)} – ${arDate(b)}`;
}

function pct(v: number | null): string {
  return v == null ? "—" : `${Math.round(v)}%`;
}

function deltaText(v: number | null): { txt: string; cls: string } {
  if (v == null || Math.round(v) === 0) return { txt: "بلا تغيّر", cls: "flat" };
  const n = Math.round(v);
  return n > 0
    ? { txt: `▲ ${n} نقطة`, cls: "up" }
    : { txt: `▼ ${Math.abs(n)} نقطة`, cls: "down" };
}

const STATE_AR: Record<string, string> = {
  ok: "وفق الخطة",
  risk: "متعثرة",
  done: "مكتملة",
  late: "متأخرة",
};

/** خط صغير لتاريخ ست نقاط — يتجاهل الفجوات الفارغة. */
function Spark({ points, color }: { points: (number | null)[]; color: string }) {
  const vals = points.filter((v): v is number => v != null);
  // نقطة واحدة لا ترسم مساراً — تُعرض شرطة بدل عمود فارغ لا يُفهم
  if (vals.length < 2) return <span className="wk-nospark">—</span>;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = Math.max(1, max - min);
  const W = 86;
  const H = 26;
  const step = W / Math.max(1, points.length - 1);
  const d = points
    .map((v, i) => (v == null ? null : `${(i * step).toFixed(1)},${(H - ((v - min) / span) * (H - 6) - 3).toFixed(1)}`))
    .filter(Boolean)
    .join(" ");
  return (
    <svg className="wk-spark" width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      <polyline points={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/** قوس نصف دائري للإنجاز العام. */
function Ring({ value, color }: { value: number | null; color: string }) {
  const R = 52;
  const C = 2 * Math.PI * R;
  const v = value == null ? 0 : Math.max(0, Math.min(100, value));
  return (
    <svg className="wk-ring" viewBox="0 0 130 130" width="118" height="118" role="img" aria-label={`الإنجاز ${pct(value)}`}>
      <circle cx="65" cy="65" r={R} fill="none" stroke="#e9f1ef" strokeWidth="12" />
      <circle
        cx="65"
        cy="65"
        r={R}
        fill="none"
        stroke={color}
        strokeWidth="12"
        strokeLinecap="round"
        strokeDasharray={`${(C * v) / 100} ${C}`}
        transform="rotate(-90 65 65)"
      />
      <text x="65" y="72" textAnchor="middle" style={{ font: "800 24px 'Noto Kufi Arabic', sans-serif", direction: "ltr" }} fill="#0f2e28">
        {pct(value)}
      </text>
    </svg>
  );
}

function KpiRow({ k }: { k: WeeklyKpi }) {
  const [open, setOpen] = useState(false);
  const d = deltaText(k.delta);
  const measured = k.sectors.filter((s) => s.achievement != null).length;
  return (
    <>
      <tr className={`wk-krow ${open ? "open" : ""}`} onClick={() => setOpen(!open)}>
        <td className="wk-kname">
          <span className="wk-caret">▾</span>
          {k.name}
        </td>
        <td className="ltr" data-l="المستهدف">
          {k.target == null ? "—" : k.target}
        </td>
        <td className="ltr" data-l="الفعلي">
          {k.actual == null ? "—" : k.actual}
        </td>
        <td data-l="الإنجاز">
          <span className="wk-badge" style={{ background: k.color }}>
            {pct(k.achievement)}
          </span>
        </td>
        <td className={`wk-delta ${d.cls}`} data-l="عن الأسبوع الماضي">
          {d.txt}
        </td>
        <td className="wk-sparkcell" data-l="المسار">
          <Spark points={k.history} color={k.color} />
        </td>
      </tr>
      {open && (
        <tr className="wk-sub">
          <td colSpan={6}>
            <div className="wk-secgrid">
              {k.sectors.map((s) => (
                <div className="wk-sec" key={s.id}>
                  <b>{s.name}</b>
                  <span className="wk-secv" style={{ color: s.color }}>{pct(s.achievement)}</span>
                  <span className="wk-secd ltr">
                    {s.actual == null ? "—" : s.actual} / {s.target == null ? "—" : s.target}
                  </span>
                </div>
              ))}
              {measured === 0 && <div className="empty">لم تُسجَّل قياسات لهذا المؤشر بعد.</div>}
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

export default function WeeklyView({
  report,
  dept = "إدارة عمليات الأداء",
}: {
  report: WeeklyReport;
  dept?: string;
}) {
  const d = deltaText(report.overallDelta);
  const overallColor = report.overallColor;

  return (
    <div className="wk">
      <header className="wk-head">
        <img src={asset("/adaa-logo.png")} alt="أداء" className="wk-logo" />
        <div className="wk-ht">
          <h2>الإنجاز الأسبوعي</h2>
          <span>{dept}</span>
        </div>
        <div className="wk-hr">
          <b>{rangeText(report.weekStart, report.weekEnd)}</b>
          <span>صدر في {arDate(report.generatedAt.slice(0, 10))}</span>
        </div>
      </header>

      <div className="wk-hero">
        <Ring value={report.overall} color={overallColor} />
        <div className="wk-heroT">
          <span className="wk-lbl">الأداء العام</span>
          <b className={`wk-hd ${d.cls}`}>{d.txt} عن الأسبوع الماضي</b>
          <span className="wk-sub2">
            {report.kpis.filter((k) => k.achievement != null).length} من {report.kpis.length} مؤشرات مقيسة
          </span>
        </div>
        <div className="wk-heroS">
          <span className="wk-lbl">مسار ستة أسابيع</span>
          {report.overallHistory.filter((v) => v != null).length < 2 ? (
            <span className="wk-nospark">يظهر المسار بعد قياسَي أسبوعين</span>
          ) : (
            <Spark points={report.overallHistory} color={overallColor} />
          )}
        </div>
      </div>

      <Section title="مؤشرات الأداء" count={report.kpis.length}>
        {report.kpis.length === 0 ? (
          <div className="empty">لا توجد مؤشرات.</div>
        ) : (
          <table className="wk-tbl">
            <thead>
              <tr>
                <th>المؤشر</th>
                <th>المستهدف</th>
                <th>الفعلي</th>
                <th>الإنجاز</th>
                <th>عن الأسبوع الماضي</th>
                <th>المسار</th>
              </tr>
            </thead>
            <tbody>
              {report.kpis.map((k) => (
                <KpiRow k={k} key={k.id} />
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="المهام والتكاليف" count={report.tasks.length}>
        {report.tasks.length === 0 ? (
          <div className="empty">لا توجد مهام مفتوحة.</div>
        ) : (
          <table className="wk-tbl wk-tasks">
            <thead>
              <tr>
                <th>المهمة</th>
                <th>المسؤول</th>
                <th>الموعد</th>
                <th>الحالة</th>
                <th>آخر تحديث</th>
              </tr>
            </thead>
            <tbody>
              {report.tasks.map((tk) => (
                <tr key={tk.id}>
                  <td className="wk-tname">{tk.title}</td>
                  <td data-l="المسؤول">{tk.who}</td>
                  <td className="ltr" data-l="الموعد">
                    {tk.due}
                  </td>
                  <td data-l="الحالة">
                    <span className={`wk-st ${tk.state}`}>{STATE_AR[tk.state]}</span>
                  </td>
                  <td className="wk-upd" data-l="آخر تحديث">
                    {tk.lastUpdate}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="أبرز المنجزات" count={report.achievements.length}>
        {report.achievements.length === 0 ? (
          <div className="empty">لم تُغلق مهام هذا الأسبوع.</div>
        ) : (
          <ul className="wk-list good">
            {report.achievements.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="التحديات" count={report.challenges.length}>
        {report.challenges.length === 0 ? (
          <div className="empty">لا توجد تحديات قائمة.</div>
        ) : (
          <div className="wk-chal">
            {report.challenges.map((c, i) => (
              <div className="wk-ch" key={i}>
                <b>{c.title}</b>
                <span className="wk-chw">{c.who}</span>
                <p>{c.plan}</p>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="خطة الأسبوع القادم" count={report.nextWeek.length}>
        {report.nextWeek.length === 0 ? (
          <div className="empty">لا مهام مستحقة الأسبوع القادم.</div>
        ) : (
          <ul className="wk-list">
            {report.nextWeek.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        )}
      </Section>

      <footer className="wk-foot">مركز أداء · {dept}</footer>
    </div>
  );
}
