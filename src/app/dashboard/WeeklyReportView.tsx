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
import type { Dom, WeekReport } from "@/lib/weekReport";
import { DonutRing, DonutLegend } from "./DonutCard";
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

/** عدد الطلبات الواردة في الأسبوع بصيغةٍ عربية سليمة */
function crNewText(n: number): string {
  if (!n) return "لم يرد طلبٌ هذا الأسبوع";
  if (n === 1) return "طلبٌ واحد ورد هذا الأسبوع";
  if (n === 2) return "طلبان وردا هذا الأسبوع";
  if (n <= 10) return `${n} طلبات وردت هذا الأسبوع`;
  return `${n} طلباً ورد هذا الأسبوع`;
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

/* ---------- بطاقة مجال ---------- */
function DomCard({
  d,
  support,
  texts,
  onSupport,
}: {
  d: Dom;
  support?: string;
  texts: Record<string, string>;
  /** يُمرَّر لمن يملك التحرير — فيُكتب الدعم في الصفحة مباشرةً */
  onSupport?: (id: string, text: string) => void;
}) {
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

      {d.donut && (
        <div className="wk-dw">
          <DonutLegend slices={d.donut.slices} />
          <DonutRing slices={d.donut.slices} total={d.donut.total} unit={d.donut.unit} />
        </div>
      )}

      {d.rows && d.rows.length > 0 && (
        /* جدولٌ بسيط: التكليف وحالته وما يحتاجه — العناوين فوق
           والتحديث تحتها */
        <table className="wk-tb">
          <thead>
            <tr>
              <th>التكليف</th>
              <th>الحالة</th>
              <th>الدعم المطلوب</th>
            </tr>
          </thead>
          <tbody>
            {d.rows.slice(0, 6).map((r) => {
              /* لكل تكليف دعمه، وإن لم يُكتب فنصّ الإعدادات للمتأخر */
              const v = texts[`sup:${r.id}`] ?? (r.tone === "warn" ? support || "" : "");
              return (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  <td className={r.tone}>{r.state}</td>
                  <td className="sup">
                    {onSupport ? (
                      <input
                        className="wk-supin"
                        defaultValue={v}
                        placeholder="اكتب الدعم المطلوب…"
                        onBlur={(e) => onSupport(r.id, e.target.value.trim())}
                      />
                    ) : (
                      v || "—"
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {d.big && (
        <div className="wk-big">
          <b>{d.big.n}</b>
          <span>{d.big.label}</span>
        </div>
      )}

      {d.bars && (
        <div className="wk-bars">
          {d.bars.map((b) => (
            <div className="wk-pr" key={b.name}>
              <span className="nm">{b.name}</span>
              <span className="bar">
                <i className={b.late ? "a" : ""} style={{ width: `${Math.max(0, Math.min(100, b.pct))}%` }} />
                {/* علامة المخطط — موضع المستهدف عند تاريخه */}
                {b.plan > 0 && (
                  <s style={{ insetInlineStart: `${Math.max(0, Math.min(100, b.plan))}%` }} />
                )}
              </span>
              <span className="pc">
                {b.pct}%
                {b.plan > 0 && <em>المخطط {b.plan}%</em>}
              </span>
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
  onSupport,
}: {
  report: WeekReport;
  prefs: WeeklyPrefs;
  /** كتابة «الدعم المطلوب» في الصفحة — لمن يملك تحرير التقرير */
  onSupport?: (id: string, text: string) => void;
}) {
  const { dir, band, dept } = prefs.layout;
  const r = report;
  const next = r.next.length ? r.next : listOf((prefs.texts || {}).next || "");
  /* الإنجازات المحققة تُكتب يدويًا — ما تراه الإدارة جديراً بالذكر
     فوق ما قرأته المنصة من سجلّها */
  const done = listOf((prefs.texts || {}).done || "");

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
            <span className="wk-ci lg">
              <PIcon id="report" size={30} />
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
              <b className="sm">نسبة الالتزام في مراجعة طلبات التغيير</b>
              <span>{crNewText(r.crNew)}</span>
              {r.crPctPrev != null && <em>مقابل {r.crPctPrev}% الأسبوع الماضي</em>}
            </span>
          </div>
        </div>

        {rows.map((row, i) => (
          <div className={row.length > 1 ? "wk-two" : ""} key={i}>
            {row.map((d) => (
              <DomCard
                d={d}
                key={d.k}
                support={(prefs.texts || {}).support}
                texts={prefs.texts || {}}
                onSupport={onSupport}
              />
            ))}
          </div>
        ))}

        {r.doms.length === 0 && (
          <div className="wk-card wk-empty">لم يُسجَّل أي تحديث في المنصة هذا الأسبوع.</div>
        )}

        {(done.length > 0 || next.length > 0) && (
          <div className={done.length > 0 && next.length > 0 ? "wk-two" : ""}>
            {prefs.on.done !== false && done.length > 0 && (
              <div className="wk-card">
                <div className="wk-ch">
                  <span className="wk-ci">
                    <PIcon id="report" size={18} />
                  </span>
                  <b>الإنجازات المحققة</b>
                </div>
                <ol className="wk-nx">
                  {done.map((x, i) => (
                    <li key={i}>
                      <i>{i + 1}</i>
                      {x}
                    </li>
                  ))}
                </ol>
              </div>
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
