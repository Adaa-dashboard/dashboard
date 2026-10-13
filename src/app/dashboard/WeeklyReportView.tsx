"use client";

/* ============================================================
   الإنجاز الأسبوعي — **منجزاتٌ لا حالة**.

   كل بطاقة منجزٌ وقع في الأسبوع، مصدرُه سجلّ تغييرات المنصة
   نفسها: من حدّث صفحته سُجِّل عملُه. والأرقام تُراجَع لا تُصدَّق —
   تحت كل بطاقة أسماء البنود التي تحقّق فيها المنجز.

   الشكل: شريطٌ علويٌّ بخلفية الهوية (أو بلا)، واتجاه الصفحة
   عمودي أو أفقي — كلاهما من إعدادات التقرير.
   ============================================================ */

import { asset } from "@/lib/base";
import { listOf, type WeeklyPrefs } from "@/lib/weeklyPrefs";
import { arCount, type WeekAch } from "@/lib/achievements";

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

/** أسماء البنود تحت الرقم — ثلاثة ثم «و٤ غيرها» */
function Names({ items }: { items: { name: string; detail?: string }[] }) {
  const show = items.slice(0, 3);
  const rest = items.length - show.length;
  return (
    <ul className="wkx-names">
      {show.map((x, i) => (
        <li key={i}>
          <b>{x.name}</b>
          {x.detail && <span>{x.detail}</span>}
        </li>
      ))}
      {rest > 0 && <li className="more">{`و${rest} غيرها`}</li>}
    </ul>
  );
}

export default function WeeklyReportView({
  report,
  prefs,
}: {
  report: WeekAch;
  prefs: WeeklyPrefs;
}) {
  const on = (k: string) => prefs.on[k] !== false;
  const { dir, band, dept } = prefs.layout;
  const r = report;
  const texts = prefs.texts || {};
  const prio = listOf(texts.priorities || "");
  /* البطاقة الفارغة تبقى ظاهرة بصفر — الصفر خبرٌ أيضاً */
  const groups = r.groups;

  return (
    <div className={`wkx ${dir === "h" ? "wkx-h" : "wkx-v"} ${band ? "has-band" : ""}`}>
      {band && (
        /* الخلفية تملأ الورقة كلها لا شريطاً منها — المحتوى يعلوها
           في جهة البياض، فتبدو الصفحة كما صُمِّمت */
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
          <div className="wkx-ht">
            <h2>الإنجاز الأسبوعي</h2>
            <span className="wkx-dept">{dept}</span>
            <span className="wkx-meta">
              {rangeText2(r.weekStart, r.weekEnd)} · صدر في{" "}
              {arDate2(new Date().toISOString().slice(0, 10))}
            </span>
          </div>
        </header>

      <div className="wkx-sum">
        <b>{r.total}</b>
        <span>منجزاً هذا الأسبوع</span>
        {r.crPct != null && <em>التزام طلبات التغيير {r.crPct}%</em>}
      </div>

      <div className="wkx-grid">
        {groups.map((g) => (
          <div className={`wkx-k ${g.items.length ? "" : "zero"}`} key={g.kind.k}>
            <b>{g.items.length}</b>
            <span>{g.kind.title}</span>
            {g.items.length ? (
              <Names items={g.items} />
            ) : (
              <span className="wkx-none">لا شيء هذا الأسبوع</span>
            )}
          </div>
        ))}
      </div>

      {groups.length === 0 && (
        <div className="empty">لا منجزات مسجّلة في هذا الأسبوع.</div>
      )}

      {on("next") && !!texts.next && (
        <section className="wkx-sec">
          <h3>الخطوات القادمة</h3>
          <p>{texts.next}</p>
        </section>
      )}
      {on("challenges") && !!texts.challenges && (
        <section className="wkx-sec">
          <h3>التحديات</h3>
          <p>{texts.challenges}</p>
        </section>
      )}
      {on("support") && !!texts.support && (
        <section className="wkx-sec">
          <h3>الدعم المطلوب</h3>
          <p>{texts.support}</p>
        </section>
      )}
      {on("priorities") && prio.length > 0 && (
        <section className="wkx-sec">
          <h3>أولويات الأسبوع القادم</h3>
          <ol className="wkx-list">
            {prio.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ol>
        </section>
      )}

        <footer className="wkx-foot">
          <span>مركز أداء · {dept}</span>
          <span>{arCount(r.total, "منجز")}</span>
        </footer>
      </div>
    </div>
  );
}
