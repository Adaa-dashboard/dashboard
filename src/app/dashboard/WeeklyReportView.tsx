"use client";

/* ============================================================
   الإنجاز الأسبوعي — **بطاقةٌ لكل مجال**.

   الصفحة ورقةٌ واحدة بخلفية الهوية: ترويسة، ثم شريط ملخّص
   (التحديثات ونسبة الالتزام، ولكلٍّ مقارنته بالأسبوع الماضي)،
   ثم بطاقات المجالات بالترتيب المعتمد.

   للوطنية والمؤسسية **حلقة حالة** تُظهر أين تقف المحفظة كلها،
   وفي وسطها العدد الإجمالي، وأسطورتها بالأعداد لا بالنسب —
   فهي أعداد جهات واستراتيجيات لا نِسَب.

   والقاعدة الحاكمة: ما لا تحديث فيه لا يُطبع — لا بطاقة فارغة
   ولا صفر.
   ============================================================ */

import { asset } from "@/lib/base";
import { listOf, type WeeklyPrefs } from "@/lib/weeklyPrefs";
import type { Dom, Slice, WeekReport } from "@/lib/weekReport";
import { PIcon } from "./pickicons";

/* أيقونات مكتبة المنصة (`PICK_ICONS`) — خطّية خضراء بلا تعبئة،
   لا رموز تعبيرية يرسمها كل نظامٍ بألوانه */
const DOM_ICON: Record<string, string> = {
  task: "clipboard",
  nat: "bank",
  inst: "building",
  ses: "bars",
  cx: "users",
  proj: "gantt",
};

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

/* ---------- الحلقات ---------- */
function Ring({ pct }: { pct: number }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  return (
    <span className="wk-rg">
      <svg width="64" height="64" viewBox="0 0 64 64">
        <circle cx="32" cy="32" r={r} fill="none" stroke="var(--line2)" strokeWidth="8" />
        <circle
          cx="32" cy="32" r={r} fill="none" stroke="#1b9c74" strokeWidth="8" strokeLinecap="round"
          strokeDasharray={`${(c * Math.max(0, Math.min(100, pct))) / 100} 999`}
        />
      </svg>
      <b>{pct}%</b>
    </span>
  );
}

/** حلقة الحالات — في وسطها العدد الإجمالي ووحدته */
function Donut({ slices, total, unit }: { slices: Slice[]; total: number; unit: string }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const sum = slices.reduce((n, s) => n + s.n, 0) || 1;
  let off = 0;
  return (
    <span className="wk-dn">
      <svg width="92" height="92" viewBox="0 0 92 92">
        <circle cx="46" cy="46" r={r} fill="none" stroke="var(--line2)" strokeWidth="13" />
        {slices
          .filter((s) => s.n > 0)
          .map((s) => {
            const len = (c * s.n) / sum;
            const el = (
              <circle
                key={s.label}
                cx="46" cy="46" r={r} fill="none" stroke={s.color} strokeWidth="13"
                strokeDasharray={`${len} ${c - len}`}
                strokeDashoffset={-off}
              />
            );
            off += len;
            return el;
          })}
      </svg>
      <b>
        {total}
        <span>{unit}</span>
      </b>
    </span>
  );
}

/* ---------- بطاقة مجال ---------- */
function DomCard({ d, support }: { d: Dom; support?: string }) {
  return (
    <div className="wk-card">
      <div className="wk-ch">
        <span className="wk-ci">
          <PIcon id={DOM_ICON[d.k] || "award"} size={18} />
        </span>
        <b>{d.title}</b>
        {d.updates > 0 && <span className="wk-cnt">{d.updates} تحديثاً</span>}
      </div>

      {d.stats && (
        <div className="wk-sts">
          {d.stats.map((s) => (
            <div key={s.label}>
              {s.icon && (
                <span className={`wk-ci ${s.tone}`}>
                  <PIcon id={s.icon} size={21} />
                </span>
              )}
              <b className={s.tone}>{s.n}</b>
              <span>{s.label}</span>
            </div>
          ))}
        </div>
      )}

      {d.support && d.support.length > 0 && (
        /* المتأخر لا يُترك رقماً: يُقابله ما يلزم لرفعه */
        <div className="wk-sup">
          <div className="wk-suph">
            <PIcon id="alert" size={15} />
            <b>الدعم المطلوب</b>
          </div>
          {support ? (
            <p>{support}</p>
          ) : (
            <ul className="wk-lst">
              {d.support.slice(0, 4).map((l) => (
                <li key={l.name}>
                  {l.name}
                  {l.detail ? <u> — {l.detail}</u> : null}
                </li>
              ))}
              {d.support.length > 4 && <li className="more">{`و${d.support.length - 4} غيرها`}</li>}
            </ul>
          )}
        </div>
      )}

      {d.big && (
        <div className="wk-big">
          <b>{d.big.n}</b>
          <span>{d.big.label}</span>
        </div>
      )}

      {d.donut && (
        <div className="wk-dw">
          <div className="wk-lg">
            {d.donut.slices.map((s) => (
              <div key={s.label}>
                <i style={{ background: s.color }} />
                {s.label}
                <u>{s.n}</u>
              </div>
            ))}
          </div>
          <Donut slices={d.donut.slices} total={d.donut.total} unit={d.donut.unit} />
        </div>
      )}

      {d.bars && (
        <div className="wk-bars">
          {d.bars.map((b) => (
            <div className="wk-pr" key={b.name}>
              <span className="nm">{b.name}</span>
              <span className="bar">
                <i className={b.late ? "a" : ""} style={{ width: `${Math.max(0, Math.min(100, b.pct))}%` }} />
              </span>
              <span className="pc">{b.pct}%</span>
            </div>
          ))}
        </div>
      )}

      {d.note ? (
        <div className="wk-note2">
          <b>أبرزها:</b> {d.note}
        </div>
      ) : (
        d.lines &&
        d.lines.length > 0 && (
          <ul className="wk-lst">
            {d.lines.slice(0, 6).map((l) => (
              <li key={l.name}>
                {l.name}
                {l.detail ? <u> — {l.detail}</u> : null}
              </li>
            ))}
            {d.lines.length > 6 && <li className="more">{`و${d.lines.length - 6} غيرها`}</li>}
          </ul>
        )
      )}
    </div>
  );
}

/* المجالات التي تُعرض بطاقتين في الصف — وما عداها بعرض الصفحة */
const PAIRED = new Set(["nat", "inst", "ses", "cx"]);

export default function WeeklyReportView({
  report,
  prefs,
}: {
  report: WeekReport;
  prefs: WeeklyPrefs;
}) {
  const { dir, band, dept } = prefs.layout;
  const r = report;
  const next = r.next.length ? r.next : listOf((prefs.texts || {}).next || "");

  /* ترتيب الصفوف: المتجاور اثنين اثنين، وما عداه وحده */
  const rows: Dom[][] = [];
  for (const d of r.doms) {
    const last = rows[rows.length - 1];
    if (PAIRED.has(d.k) && last && last.length === 1 && PAIRED.has(last[0].k)) last.push(d);
    else rows.push([d]);
  }

  return (
    <div className={`wkx ${dir === "h" ? "wkx-h" : "wkx-v"} ${band ? "has-band" : ""}`}>
      {band && (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          className="wkx-bg"
          src={asset(dir === "h" ? "/wk-cover-h.jpg" : "/wk-cover-v.jpg")}
          alt=""
          aria-hidden
        />
      )}
      <div className="wkx-in">
        <header className="wkx-head">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={asset("/adaa-logo.png")} alt="أداء" className="wkx-logo" />
          <h2>الإنجاز الأسبوعي</h2>
          <div className="wkx-dept">{dept}</div>
          <div className="wkx-dt">
            <PIcon id="calendar" size={14} />
            {rangeText2(r.weekStart, r.weekEnd)}
          </div>
        </header>

        <div className="wk-kpi">
          <div>
            <span className="wk-ic lg">
              <PIcon id="report" size={22} />
            </span>
            <span className="tx">
              <b>{r.total}</b>
              <span>تحديثاً هذا الأسبوع</span>
              {r.totalPrev != null && <em>مقابل {r.totalPrev} الأسبوع الماضي</em>}
            </span>
          </div>
          <div>
            <Ring pct={r.crPct ?? 0} />
            <span className="tx">
              <b className="sm">نسبة الالتزام في طلبات التغيير</b>
              <span>
                {r.crOpen} قيد الإجراء · {r.crClosed} أُغلق هذا الأسبوع
              </span>
              {r.crPctPrev != null && <em>مقابل {r.crPctPrev}% الأسبوع الماضي</em>}
            </span>
          </div>
        </div>

        {rows.map((row, i) => (
          <div className={row.length > 1 ? "wk-two" : ""} key={i}>
            {row.map((d) => (
              <DomCard d={d} key={d.k} support={(prefs.texts || {}).support} />
            ))}
          </div>
        ))}

        {r.doms.length === 0 && (
          <div className="wk-card wk-empty">لم يُسجَّل أي تحديث في المنصة هذا الأسبوع.</div>
        )}

        {prefs.on.next !== false && next.length > 0 && (
          <div className="wk-card">
            <div className="wk-ch">
              <span className="wk-ci">
                <PIcon id="target" size={18} />
              </span>
              <b>الخطوات القادمة</b>
            </div>
            <ol className="wk-nx">
              {next.map((x, i) => (
                <li key={i}>
                  <i>{i + 1}</i>
                  {x}
                </li>
              ))}
            </ol>
          </div>
        )}

        <footer className="wkx-foot">
          <span>مركز أداء · {dept}</span>
          <span>صدر في {arDate2(new Date().toISOString().slice(0, 10))}</span>
        </footer>
      </div>
    </div>
  );
}
