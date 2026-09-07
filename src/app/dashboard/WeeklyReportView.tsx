"use client";

/* ============================================================
   التقرير الأسبوعي — الشكل المعتمد.

   القاعدة: لون واحد للأرقام والعناوين، رمادي للتوضيح، وأخضر
   للفروقات. البرتقالي والأحمر نقطةٌ صغيرة في حالة التكليف وحدها.
   كل كتلة هنا تُظهر أو تُخفى من «تخصيص التقرير» — الشرط عند
   موضع الاستدعاء لا داخل المكوّن، فالمخفيّ لا يُبنى أصلاً.
   ============================================================ */

import type { WeeklyReport2 } from "@/lib/weeklyReport";
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

/** المدى: 26 – 30 يوليو 2026 — الشهر مرة واحدة إن اتّحد الطرفان */
export function rangeText2(a: string, b: string): string {
  if (!a || !b) return "—";
  return a.slice(0, 7) === b.slice(0, 7)
    ? `${Number(a.slice(8))} – ${arDate2(b)}`
    : `${arDate2(a)} – ${arDate2(b)}`;
}

const DOT: Record<string, string> = {
  done: "#1a9d5c",
  open: "#e0971a",
  risk: "#e0971a",
  late: "#d34a4a",
};

function Delta({ n }: { n: number }) {
  if (n === 0) return <span className="wr-dl flat">—</span>;
  return (
    <span className={`wr-dl ${n > 0 ? "up" : "down"}`}>
      {n > 0 ? "▲" : "▼"} {Math.abs(n)}
    </span>
  );
}

function Donut({ v }: { v: number | null }) {
  const R = 46;
  const C = 2 * Math.PI * R;
  const p = v == null ? 0 : Math.max(0, Math.min(100, v));
  return (
    <svg className="wr-donut" viewBox="0 0 116 116" role="img" aria-label={`الأداء العام ${p}%`}>
      <circle cx="58" cy="58" r={R} fill="none" stroke="#e9f1ef" strokeWidth="11" />
      <circle
        cx="58" cy="58" r={R} fill="none" stroke="#1a9d5c" strokeWidth="11" strokeLinecap="round"
        strokeDasharray={`${(C * p) / 100} ${C}`} transform="rotate(-90 58 58)"
      />
      <text x="58" y="66" textAnchor="middle" className="wr-donut-t">
        {v == null ? "—" : `${p}%`}
      </text>
    </svg>
  );
}

const Buildings = () => (
  <svg className="wr-bld" viewBox="0 0 320 120" preserveAspectRatio="none" aria-hidden="true">
    <g fill="rgba(255,255,255,.10)">
      <rect x="6" y="46" width="26" height="74" /><rect x="38" y="28" width="20" height="92" />
      <rect x="64" y="58" width="30" height="62" /><rect x="100" y="14" width="24" height="106" />
      <rect x="130" y="40" width="18" height="80" /><rect x="154" y="66" width="34" height="54" />
      <rect x="194" y="22" width="22" height="98" /><rect x="222" y="52" width="28" height="68" />
      <rect x="256" y="34" width="20" height="86" /><rect x="282" y="60" width="32" height="60" />
    </g>
    <g fill="rgba(255,255,255,.16)">
      <rect x="44" y="40" width="3" height="3" /><rect x="50" y="40" width="3" height="3" />
      <rect x="44" y="52" width="3" height="3" /><rect x="50" y="52" width="3" height="3" />
      <rect x="106" y="26" width="3" height="3" /><rect x="112" y="26" width="3" height="3" />
      <rect x="106" y="38" width="3" height="3" /><rect x="112" y="38" width="3" height="3" />
      <rect x="200" y="34" width="3" height="3" /><rect x="206" y="34" width="3" height="3" />
      <rect x="200" y="46" width="3" height="3" /><rect x="206" y="46" width="3" height="3" />
    </g>
  </svg>
);

const Mountains = () => (
  <svg className="wr-mtn" viewBox="0 0 1000 90" preserveAspectRatio="none" aria-hidden="true">
    <path d="M0 90 L120 40 L190 66 L300 18 L400 62 L470 44 L580 78 L680 34 L760 60 L860 26 L1000 72 L1000 90 Z" fill="rgba(13,61,34,.07)" />
    <path d="M0 90 L90 58 L170 76 L280 42 L380 74 L500 54 L620 82 L720 56 L820 74 L1000 48 L1000 90 Z" fill="rgba(13,61,34,.05)" />
  </svg>
);

const CalIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
    <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
  </svg>
);

function Head({ title, sub }: { title: string; sub: string }) {
  return (
    <h3 className="wr-h">
      {title}
      <em>{sub}</em>
    </h3>
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
  const hasTwo = (on("challenges") && !!r.texts.challenges) || (on("priorities") && r.texts.priorities.length > 0);

  return (
    <div className="wr">
      <header className="wr-hd">
        <div className="wr-art">
          <Buildings />
          <span className="wr-cut" />
        </div>
        <div className="wr-lg">
          <b>أداء</b>
          <span>
            المركز الوطني لقياس
            <br />
            أداء الأجهزة العامة
          </span>
        </div>
        <div className="wr-mid">
          <b>التحديث الأسبوعي</b>
          <span>{dept}</span>
          <span className="wr-pdw">
            <span className="wr-pd">
              <span className="wr-ci">
                <CalIcon />
              </span>
              الفترة: {rangeText2(r.weekStart, r.weekEnd)}
            </span>
          </span>
        </div>
        <div className="wr-mot">
          من البيانات
          <br />
          <em>إلى أثر في الأداء</em>
        </div>
      </header>

      <div className="wr-bd">
        {on("perf") && (
          <div className="wr-top">
            <Donut v={r.overall} />
            <div className="wr-tx">
              <b>الأداء العام</b>
              <span className="wr-note">متوسط تقدّم الأقسام المعروضة نحو غاياتها المعتمدة</span>
            </div>
            <div className="wr-facts">
              {r.facts.map((f) => (
                <div key={f.label}>
                  <b>{f.n}</b>
                  <span>{f.label}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {r.cells.length > 0 && (
          <>
            <Head title="ماذا وصلنا هذا الأسبوع" sub="مقارنةً بالأسبوع الماضي" />
            <div className="wr-cells">
              {r.cells.map((c) => (
                <div className="wr-cl" key={c.k}>
                  <span className="wr-ttl">{c.name}</span>
                  <span className="wr-num">
                    <b>{c.moved}</b>
                    <Delta n={c.moved - c.prev} />
                  </span>
                  <span className="wr-unit">
                    بندًا تحرّك — من {c.sum.total} {c.sum.totalLabel}
                  </span>
                  <span className="wr-brk">
                    {c.sum.breakdown.map((b) => `${b.k} ${b.n}`).join(" · ")}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}

        {on("asg") && (
          <>
            <Head title="التكاليف الواردة للمركز" sub="وما آلت إليه" />
            {r.asg.length === 0 ? (
              <div className="wr-empty">لا توجد تكاليف مفتوحة هذا الأسبوع.</div>
            ) : (
              <div className="wr-asgs">
                {r.asg.map((a, i) => {
                  const bits = [
                    { k: "الخطوات القادمة", v: a.next, s: true },
                    { k: "التحدي", v: a.challenge, s: false },
                    { k: "الدعم المطلوب", v: a.support, s: true },
                  ].filter((b) => !!b.v);
                  return (
                    <div className="wr-ac" key={a.id}>
                      <div className="wr-ah">
                        <i>{i + 1}</i>
                        <b>{a.title}</b>
                        <span className="wr-st">
                          <em style={{ background: DOT[a.state] }} />
                          {a.stateAr}
                        </span>
                        {a.at && <span className="wr-at">ورد في {arDate2(a.at)}</span>}
                      </div>
                      {bits.length > 0 && (
                        <div className="wr-abs">
                          {bits.map((b) => (
                            <div className="wr-ab" key={b.k}>
                              <span>{b.k}</span>
                              <b className={b.s ? "s" : ""}>{b.v}</b>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {on("next") && !!r.texts.next && (
          <>
            <Head title="الخطوات القادمة" sub="" />
            <p className="wr-p">{r.texts.next}</p>
          </>
        )}

        {on("support") && !!r.texts.support && (
          <>
            <Head title="الدعم المطلوب" sub="" />
            <p className="wr-p">{r.texts.support}</p>
          </>
        )}

        {hasTwo && (
          <div className="wr-two">
            {on("challenges") && !!r.texts.challenges && (
              <div>
                <Head title="التحديات" sub="" />
                <p className="wr-p">{r.texts.challenges}</p>
              </div>
            )}
            {on("priorities") && r.texts.priorities.length > 0 && (
              <div>
                <Head title="أولويات الأسبوع القادم" sub="" />
                <div className="wr-li">
                  {r.texts.priorities.map((x, i) => (
                    <div key={i}>
                      <i>{i + 1}</i>
                      <b>{x}</b>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <footer className="wr-ft">
        <Mountains />
        <span className="wr-sl">
          معاً ..
          <em>لأداء أكثر أثراً</em>
        </span>
        <span className="wr-r">مركز أداء &nbsp;|&nbsp; {dept}</span>
      </footer>
    </div>
  );
}
