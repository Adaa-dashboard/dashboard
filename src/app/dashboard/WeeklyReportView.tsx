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
import {
  listOf, CYCLE_GROUPS, quarterOf, quarterRange, quarterText, cycleTitle, cycKey,
  type CycField, type WeeklyPrefs,
} from "@/lib/weeklyPrefs";
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

/** الحقل يعلو بقدر سطوره: التحديث يُكتب نقاطاً في أسطر، و`rows=1`
    وحدها تُخفي ما بعد السطر الأول */
function grow(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

/* ---------- بطاقة مجال ---------- */
function DomCard({
  d,
  on,
  texts,
  onPick,
  onTaskText,
}: {
  d: Dom;
  /** مفاتيح الإظهار — `tsk:<id>` يختار تكليفاً */
  on: Record<string, boolean>;
  /** النصوص المحفوظة — `sup:<id>` دعمُ تكليفٍ بعينه،
      و`upd:<id>` تحديثُه إن كُتب هنا بدل المنقول من صفحة التكاليف */
  texts: Record<string, string>;
  /** يُمرَّر لمن يملك التحرير — فيُختار ما يظهر من التكاليف
      والمشاريع. المفتاح كامل: `tsk:<id>` أو `prj:<name>` */
  onPick?: (key: string, keep: boolean) => void;
  /** خانتا «التحديث» و«الدعم المطلوب» تُكتبان في مكانهما —
      المفتاح كامل: `upd:<id>` أو `sup:<id>` */
  onTaskText?: (key: string, text: string) => void;
}) {
  /* ما يُكتب الآن — قبل أن يصل الحفظ ويعود في `texts` */
  const [draft, setDraft] = useState<Record<string, string>>({});
  /* عمود «الدعم المطلوب» يُخفى بضغطة × ويُعاد بزرّه — واختياره
     محفوظٌ مع بقية مفاتيح الأسبوع */
  const sup = on["col:sup"] !== false;
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
        /* خمسة مربّعات أو أكثر: خطٌّ أصغر وإلا انكسرت العناوين */
        <div className={`wk-sts ${d.stats.length > 4 ? "five" : ""}`}>
          {d.stats.map((s) => (
            <div key={s.label} className={s.big ? "big" : ""}>
              {/* المربّع بلا أيقونة لا يُترك فراغُها: الرقم يرتفع
                  إلى أعلى المربّع فلا تبقى مساحةٌ بيضاء فوقه */}
              {s.icon && (
                <span className={`wk-ci ${s.tone}`}>
                  <PIcon id={s.icon} size={s.big ? 25 : 21} />
                </span>
              )}
              <b className={s.tone}>{s.n}</b>
              <span>
                {s.label}
                {s.sub && <em className="sub">{s.sub}</em>}
              </span>
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
            nested={d.donut.nested}
          />
        </div>
      )}

      {/* ما تقدّم هذا الأسبوع — نقطةٌ بلون مرحلته الجديدة ثم اسمه */}
      {d.ups && d.ups.length > 0 && (
        <ul className="wk-ups">
          {d.ups.slice(0, 12).map((l) => (
            <li key={l.name} title={l.name}>
              <i style={{ background: l.color }} />
              {l.name}
            </li>
          ))}
          {d.ups.length > 12 && <li className="more">{`و${d.ups.length - 12} غيرها`}</li>}
        </ul>
      )}

      {d.rows && d.rows.length > 0 && (
        /* جدولٌ بسيط: التكليف وحالته — العناوين فوق والتحديث تحتها.
           والمربّع يختار ما يظهر في التقرير المطبوع والمشترَك */
        <table className="wk-tb">
          <thead>
            <tr>
              {onPick && <th className="pick" />}
              <th className="nm">التكليف</th>
              {/* آخر ما كُتب على التكليف لا حالته المجرّدة */}
              <th className="upd">التحديث</th>
              {sup && (
                <th className="sup">
                  الدعم المطلوب
                  {/* × صغيرة تُخفي العمود كله حين لا يُحتاج */}
                  {onPick && (
                    <button className="colx" title="إخفاء العمود" onClick={() => onPick("col:sup", false)}>
                      ✕
                    </button>
                  )}
                </th>
              )}
              {!sup && onPick && (
                <th className="colback">
                  <button onClick={() => onPick("col:sup", true)}>+ الدعم المطلوب</button>
                </th>
              )}
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
                const sk = `sup:${r.id}`;
                const v = draft[sk] ?? texts[sk] ?? "";
                /* التحديث: ما كُتب هنا يغلب المنقولَ من صفحة
                   التكاليف. **وجودُ المفتاح** هو الاستثناء لا امتلاؤه،
                   فمسحُ الخانة يمسحها فعلاً ولا يُرجع المنقول */
                const uk = `upd:${r.id}`;
                const own = uk in draft || uk in texts;
                const uv = draft[uk] ?? texts[uk] ?? "";
                const ushow = own ? uv : r.state;
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
                    <td className="nm">{r.name}</td>
                    <td className={`upd ${own ? "" : r.tone}`}>
                      {onTaskText ? (
                        <>
                          <textarea
                            className="wk-supin wk-updin"
                            rows={1}
                            ref={grow}
                            value={ushow}
                            placeholder="اكتب التحديث…"
                            onChange={(e) => {
                              grow(e.target);
                              setDraft((x) => ({ ...x, [uk]: e.target.value }));
                            }}
                            onBlur={(e) => {
                              /* ما لم يُمسّ أصلاً لا يُحفظ استثناءً:
                                 الخانة تبقى تابعةً لصفحة التكاليف
                                 فتتحدّث معها */
                              const nv = e.target.value.trim();
                              if (!own && nv === (r.state || "").trim()) return;
                              onTaskText(uk, nv);
                            }}
                          />
                          {/* نصّاً لا حقلاً في الملف المصدَّر */}
                          <span className="sup-txt">{ushow || "—"}</span>
                        </>
                      ) : (
                        ushow
                      )}
                    </td>
                    {!sup && onPick && <td className="colback" />}
                    {sup && (
                    <td className="sup">
                      {onTaskText ? (
                        <>
                          <input
                            className="wk-supin"
                            value={v}
                            placeholder="اكتب الدعم المطلوب…"
                            onChange={(e) => setDraft((x) => ({ ...x, [sk]: e.target.value }))}
                            onBlur={(e) => onTaskText(sk, e.target.value.trim())}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                            }}
                          />
                          {/* نسخةٌ نصّية تحلّ محلّ الحقل في الملف المصدَّر */}
                          <span className="sup-txt">{v || "—"}</span>
                        </>
                      ) : (
                        v || "—"
                      )}
                    </td>
                    )}
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

      {/* `upsOnly` ⇒ لا أسماءَ إلا المرحلة المطلوبة: سطر «أبرزها»
          وقائمة ما تحرّك كانا يظهران حين لا يتقدّم شيءٌ في تلك
          المرحلة، فيُذكر اسمُ استراتيجيةٍ لم تُعتمد بعد */}
      {(d.ups && d.ups.length > 0) || d.upsOnly ? null : d.note ? (
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

/* ============================================================
   تقرير دورة القياس — صفحةٌ مستقلة بترويسة التقرير نفسها
   ------------------------------------------------------------
   ستة أرقامٍ لكل ربع، تُكتب يدوياً وتبقى محفوظةً لذلك الربع
   وحده: فالتقرير الأسبوعي يمرّ، والدورة تبقى. ولكل رقمٍ سطرٌ
   صغيرٌ تحته يُكتب فيه ما يوضّحه («من ٦٩ جهة» مثلاً).

   ولا تُقرأ من المنصة — هي حصيلةُ الدورة يجمعها صاحب التقرير،
   بطلب صاحبة المنصة صريحاً. وبطاقةٌ لكل رقمٍ بأيقونتها، موزّعةً
   على الصفحة لا في سطرٍ واحد.
   ============================================================ */
function CycleBody({
  q, texts, onText,
}: {
  q: string;
  texts: Record<string, string>;
  /** يُمرَّر لمن يملك تحرير التقرير وحده */
  onText?: (key: string, value: string) => void;
}) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const val = (f: string) => draft[cycKey(q, f)] ?? texts[cycKey(q, f)] ?? "";
  const put = (f: string, v: string) => onText?.(cycKey(q, f), v.trim());

  /** بطاقةُ رقمٍ واحد — رقمُه وعنوانُه وسطرٌ يوضّحه */
  const box = (f: CycField, lead = false) => {
    const sk = `s${f.k}`;
    const n = texts[cycKey(q, f.k)] || "";
    const sub = texts[cycKey(q, sk)] || "";
    return (
      <div className={`wk-card cyc-b ${f.tone || ""} ${lead ? "lead" : ""}`} key={f.k}>
        {f.icon && (
          <span className={`wk-ci ${f.tone || ""}`}>
            <PIcon id={f.icon} size={lead ? 30 : 26} />
          </span>
        )}
        {onText ? (
          <input
            className="cyc-n"
            value={val(f.k)}
            placeholder="—"
            onChange={(e) => setDraft((x) => ({ ...x, [cycKey(q, f.k)]: e.target.value }))}
            onBlur={(e) => put(f.k, e.target.value)}
          />
        ) : (
          <b className="cyc-n">{n || "—"}</b>
        )}
        <span className="cyc-l">{f.label}</span>
        {onText ? (
          <input
            className="cyc-s"
            value={val(sk)}
            placeholder="سطر توضيحي…"
            onChange={(e) => setDraft((x) => ({ ...x, [cycKey(q, sk)]: e.target.value }))}
            onBlur={(e) => put(sk, e.target.value)}
          />
        ) : (
          sub && <em className="cyc-s">{sub}</em>
        )}
      </div>
    );
  };

  /* المجموعة الأولى بلا عنوان — مربّعا الصدارة. وما بعدها معنونٌ
     مرقَّم، وعنوانان منها يُذيَّلان باسم الربع */
  return (
    <>
      {CYCLE_GROUPS.map((g, gi) => {
        const lead = !g.title;
        return (
          <section className="cyc-sec" key={gi}>
            {g.title && (
              <h3 className={`cyc-sh ${g.tone || ""}`}>
                {g.icon && (
                  <i>
                    <PIcon id={g.icon} size={19} />
                  </i>
                )}
                {g.title}
                {g.withQ ? ` ${quarterText(q)}` : ""}
              </h3>
            )}
            <div className="cyc-g" data-n={g.fields.length}>
              {g.fields.map((f) => box(f, lead))}
            </div>
          </section>
        );
      })}
    </>
  );
}

/* المجالات التي تُعرض بطاقتين في الصف — وما عداها بعرض الصفحة */
const PAIRED = new Set(["nat", "inst", "ses", "cx"]);

export default function WeeklyReportView({
  report,
  prefs,
  onPick,
  onTaskText,
  onCycleText,
  mode = "week",
}: {
  report: WeekReport;
  prefs: WeeklyPrefs;
  /** اختيار ما يظهر من التكاليف والمشاريع — لمن يملك التحرير */
  onPick?: (key: string, keep: boolean) => void;
  /** خانتا «التحديث» و«الدعم المطلوب» تُكتبان في جدول التكاليف
      مباشرة — المفتاح `upd:<id>` أو `sup:<id>` */
  onTaskText?: (key: string, text: string) => void;
  /** أرقام دورة القياس — تُحفظ افتراضاً لكل الأسابيع لا لأسبوعٍ */
  onCycleText?: (key: string, text: string) => void;
  /** أيّ تقرير يُعرض: الأسبوعي، أم تقرير دورة القياس */
  mode?: "week" | "cycle";
}) {
  const { dir, band, dept } = prefs.layout;
  const r = report;
  const cyc = mode === "cycle";
  /* ربع الدورة المعروض: ما اختير، وإلا ربعُ أسبوع التقرير */
  const cq = (prefs.texts || {})["cyc:q"] || quarterOf(r.weekStart);
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
    <div
      id={cyc ? "wkx-cycle" : "wkx-week"}
      className={`wkx ${dir === "h" ? "wkx-h" : "wkx-v"} ${band ? "has-band" : ""}`}
    >
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
          {/* التقريران يتشاركان الترويسة: الأسبوعي باسمه ومدى
              أسبوعه، وتقرير الدورة باسم ربعه ومدى أشهره */}
          <h2>{cyc ? cycleTitle(cq) : "الإنجاز الأسبوعي"}</h2>
          <div className="wkx-dept">{dept}</div>
          <div className="wkx-dt">
            <PIcon id={cyc ? "cycle" : "calendar"} size={14} />
            {cyc ? quarterRange(cq) : rangeText2(r.weekStart, r.weekEnd)}
          </div>
        </header>

        {cyc ? (
          <CycleBody q={cq} texts={prefs.texts || {}} onText={onCycleText} />
        ) : (
          <>
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
                onTaskText={onTaskText}
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

        </>
        )}

        <footer className="wkx-foot">
          <span>مركز أداء · {dept}</span>
          <span>صدر في {arDate2(new Date().toISOString().slice(0, 10))}</span>
        </footer>
      </div>
    </div>
  );
}
