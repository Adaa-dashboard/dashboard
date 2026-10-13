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

import { useState } from "react";
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
  on,
  texts,
  onPick,
  onTaskSup,
}: {
  d: Dom;
  /** مفاتيح الإظهار — `tsk:<id>` يختار تكليفاً */
  on: Record<string, boolean>;
  /** النصوص المحفوظة — `sup:<id>` دعمُ تكليفٍ بعينه */
  texts: Record<string, string>;
  /** يُمرَّر لمن يملك التحرير — فيُختار ما يظهر من التكاليف
      والمشاريع. المفتاح كامل: `tsk:<id>` أو `prj:<name>` */
  onPick?: (key: string, keep: boolean) => void;
  /** دعم التكليف يُكتب في خلّيته مباشرة */
  onTaskSup?: (id: string, text: string) => void;
}) {
  /* ما يُكتب الآن — قبل أن يصل الحفظ ويعود في `texts` */
  const [draft, setDraft] = useState<Record<string, string>>({});
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
          <DonutRing
            slices={d.donut.slices}
            total={d.donut.total}
            unit={d.donut.unit}
            base={d.donut.base}
          />
        </div>
      )}

      {/* ما تقدّم هذا الأسبوع — نقطةٌ بلون مرحلته الجديدة ثم اسمه */}
      {d.ups && d.ups.length > 0 && (
        <ul className="wk-ups">
          {d.ups.slice(0, 6).map((l) => (
            <li key={l.name}>
              <i style={{ background: l.color }} />
              {l.name}
            </li>
          ))}
          {d.ups.length > 6 && <li className="more">{`و${d.ups.length - 6} غيرها`}</li>}
        </ul>
      )}

      {d.rows && d.rows.length > 0 && (
        /* جدولٌ بسيط: التكليف وحالته — العناوين فوق والتحديث تحتها.
           والمربّع يختار ما يظهر في التقرير المطبوع والمشترَك */
        <table className="wk-tb">
          <thead>
            <tr>
              {onPick && <th className="pick" />}
              <th>التكليف</th>
              <th>الحالة</th>
              <th>الدعم المطلوب</th>
            </tr>
          </thead>
          <tbody>
            {d.rows
              .filter((r) => onPick || on[`tsk:${r.id}`] !== false)
              .slice(0, 8)
              .map((r) => {
                const keep = on[`tsk:${r.id}`] !== false;
                /* لكل تكليف دعمه الخاص — غير «الدعم المطلوب» العام
                   في آخر التقرير */
                const v = draft[r.id] ?? texts[`sup:${r.id}`] ?? "";
                return (
                  <tr key={r.id} className={keep ? "" : "off"}>
                    {onPick && (
                      <td className="pick">
                        <input
                          type="checkbox"
                          checked={keep}
                          title="يظهر في التقرير"
                          onChange={(e) => onPick(`tsk:${r.id}`, e.target.checked)}
                        />
                      </td>
                    )}
                    <td>{r.name}</td>
                    <td className={r.tone}>{r.state}</td>
                    <td className="sup">
                      {onTaskSup ? (
                        <input
                          className="wk-supin"
                          value={v}
                          placeholder="اكتب الدعم المطلوب…"
                          onChange={(e) => setDraft((x) => ({ ...x, [r.id]: e.target.value }))}
                          onBlur={(e) => onTaskSup(r.id, e.target.value.trim())}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          }}
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

      {d.bars && (
        <div className="wk-bars">
          {d.bars
            .filter((b) => onPick || on[`prj:${b.name}`] !== false)
            .map((b) => {
              const keep = on[`prj:${b.name}`] !== false;
              return (
            <div className={`wk-pr ${keep ? "" : "off"}`} key={b.name}>
              {onPick && (
                <input
                  type="checkbox"
                  className="pick"
                  checked={keep}
                  title="يظهر في التقرير"
                  onChange={(e) => onPick(`prj:${b.name}`, e.target.checked)}
                />
              )}
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
              );
            })}
        </div>
      )}

      {d.ups && d.ups.length > 0 ? null : d.note ? (
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
  onPick,
  onTaskSup,
}: {
  report: WeekReport;
  prefs: WeeklyPrefs;
  /** اختيار ما يظهر من التكاليف والمشاريع — لمن يملك التحرير */
  onPick?: (key: string, keep: boolean) => void;
  /** دعم كل تكليف يُكتب في جدوله مباشرة */
  onTaskSup?: (id: string, text: string) => void;
}) {
  const { dir, band, dept } = prefs.layout;
  const r = report;
  const next = r.next.length ? r.next : listOf((prefs.texts || {}).next || "");
  /* الإنجازات المحققة تُكتب يدويًا — ما تراه الإدارة جديراً بالذكر
     فوق ما قرأته المنصة من سجلّها */
  const done = listOf((prefs.texts || {}).done || "");
  /* الدعم المطلوب عامٌّ للإدارة لا للتكاليف وحدها، فموضعه الآخر */
  const support = ((prefs.texts || {}).support || "").trim();

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
                on={prefs.on || {}}
                texts={prefs.texts || {}}
                onPick={onPick}
                onTaskSup={onTaskSup}
              />
            ))}
          </div>
        ))}

        {r.doms.length === 0 && (
          <div className="wk-card wk-empty">لم يُسجَّل أي تحديث في المنصة هذا الأسبوع.</div>
        )}

        {(done.length > 0 || next.length > 0 || support) && (
          <div
            className={
              [done.length > 0, next.length > 0, !!support].filter(Boolean).length > 1 ? "wk-two" : ""
            }
          >
            {prefs.on.done !== false && done.length > 0 && (
              <div className="wk-card">
                <div className="wk-ch">
                  <span className="wk-ci">
                    {/* الوسام نفسه الذي يحمله «الإنجاز الأسبوعي» في القائمة */}
                    <PIcon id="award" size={18} />
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
                    {/* خارطة طريق — تدلّ على ما هو آتٍ، لا على هدفٍ قائم */}
                    <PIcon id="map" size={18} />
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

            {prefs.on.support !== false && support && (
              <div className="wk-card">
                <div className="wk-ch">
                  <span className="wk-ci warn">
                    <PIcon id="alert" size={18} />
                  </span>
                  <b>الدعم المطلوب</b>
                </div>
                <p className="wk-sup2">{support}</p>
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
