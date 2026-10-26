"use client";

import { apiFetch } from "@/lib/api";
import { BASE } from "@/lib/base";

import { useCallback, useEffect, useMemo, useState } from "react";
import WeeklyReportView, { arDate2 } from "./WeeklyReportView";
import WeeklyCustomize from "./WeeklyCustomize";
import { weekStartOf, shiftDays } from "@/lib/weeklyReport";
import { mergePrefs, type WeeklyPrefs } from "@/lib/weeklyPrefs";
import type { ChangeLite, ContactLite, LogRow, TaskLite } from "@/lib/achievements";
import { buildWeekReport, type ItemLite, type WeekReport } from "@/lib/weekReport";
import { listOf, QUARTER_AR, quarterOf } from "@/lib/weeklyPrefs";

type ShareRow = {
  token: string;
  weekStart: string;
  createdAt: string;
  expiresAt: string | null;
  views: number;
  lastView: string | null;
};


/* ============================================================
   تنزيل PDF بلا نظام الطباعة — بعض الأجهزة تقف معاينة الطباعة
   فيها على «Loading preview…» وخانة الطابعة تدور بلا نهاية:
   العطل في خدمة الطباعة بويندوز لا في الصفحة، ولا حيلة للمتصفح.
   فنرسم الورقة بأنفسنا إلى صورة ثم نقطّعها صفحاتِ A4 في ملف PDF
   يُنزَّل مباشرة. المكتبتان تُحمَّلان عند الضغط لا مع الصفحة.
   ============================================================ */
/** ما يُصدَّر: الأسبوعي · تقرير الدورة · كلاهما في ملف واحد */
type PdfPick = "week" | "cycle" | "all";
const PDF_NAME: Record<PdfPick, string> = {
  week: "الإنجاز-الأسبوعي",
  cycle: "تقرير-دورة-القياس",
  all: "تقارير-الأداء",
};

async function makePdf(week: string, pick: PdfPick) {
  /* الورقتان مرسومتان في الصفحة دائماً — غير المعروضة خارج الشاشة
     لا مخفيّة، فتُصوَّر كما هي. و«الكل» يبدأ بالأسبوعي ثم الدورة. */
  const ids = pick === "all" ? ["wkx-week", "wkx-cycle"] : [`wkx-${pick}`];
  const els = ids
    .map((id) => document.getElementById(id) as HTMLElement | null)
    .filter((x): x is HTMLElement => !!x);
  if (!els.length) return;
  const [h2c, jsp] = await Promise.all([import("html2canvas-pro"), import("jspdf")]);
  /* أدوات التحرير ليست من التقرير — تُخفى أثناء التصوير. ومعها
     تُستعاد قيمُ اللابتوب للورقة، فملفُ الجوال كملف اللابتوب. */
  document.body.classList.add("wk-shot");
  /* إطارٌ واحد حتى يُطبَّق الترتيب الجديد قبل القياس */
  await new Promise((r) => requestAnimationFrame(() => r(null)));
  const canvases: HTMLCanvasElement[] = [];
  try {
    for (const el of els)
      canvases.push(
        await h2c.default(el, {
          scale: 2,
          backgroundColor: "#ffffff",
          useCORS: true,
          /* النسخةُ المصوَّرة تُرسم في إطارٍ بعرض اللابتوب، فلا
             تنطبق عليها استعلاماتُ الشاشات الصغيرة */
          windowWidth: Math.max(document.documentElement.clientWidth, 1400),
          windowHeight: Math.max(document.documentElement.clientHeight, 1800),
        }),
      );
  } finally {
    document.body.classList.remove("wk-shot");
  }
  /* **صفحةٌ بمقاس كل ورقة**: لا تقطيع إلى A4 ولا هامشٌ أبيض —
     الملف صورةُ التقرير كما يُرى على الشاشة */
  const first = canvases[0];
  const pdf = new jsp.jsPDF({
    orientation: first.width > first.height ? "l" : "p",
    unit: "px",
    format: [first.width, first.height],
    compress: true,
  });
  canvases.forEach((c, i) => {
    if (i > 0) pdf.addPage([c.width, c.height], c.width > c.height ? "l" : "p");
    pdf.addImage(c.toDataURL("image/jpeg", 0.95), "JPEG", 0, 0, c.width, c.height);
  });
  pdf.save(`${PDF_NAME[pick]}-${week}.pdf`);
}

export default function WeeklyPanel({
  t,
  canEdit = false,
}: {
  t: (ar: string, en: string) => string;
  canEdit?: boolean;
}) {
  const thisWeek = weekStartOf(new Date().toISOString().slice(0, 10));
  const [week, setWeek] = useState(thisWeek);
  const weekEnd = shiftDays(week, 6);
  /* مصادر المنجزات: سجلّ تغييرات المنصة، وما له تاريخٌ أصلاً */
  const [log, setLog] = useState<LogRow[]>([]);
  const [changes, setChanges] = useState<ChangeLite[]>([]);
  const [tasks, setTasks] = useState<TaskLite[]>([]);
  const [contacts, setContacts] = useState<ContactLite[]>([]);
  /* بنود الأقسام — منها حلقات الحالة وأشرطة المشاريع */
  const [items, setItems] = useState<Record<string, ItemLite[]>>({});
  const [logPrev, setLogPrev] = useState<LogRow[] | null>(null);
  const [logErr, setLogErr] = useState("");
  const [base, setBase] = useState<unknown>(null);
  const [over, setOver] = useState<unknown>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  /* التقرير المعروض: الأسبوعي افتراضاً، وتقرير دورة القياس بضغطة */
  const [view, setView] = useState<"week" | "cycle">("week");
  /* قائمة التنزيل الثلاثية */
  const [pdfMenu, setPdfMenu] = useState(false);
  const [canShare, setCanShare] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tune, setTune] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  /* التكاليف وجهات التواصل تُقرأ مرة واحدة — لا تتغيّر بتغيّر
     الأسبوع. والسجلّ وحده يُعاد طلبه لأنه مقيَّد بمداه. */
  const loadData = useCallback(async () => {
    const sec = ["natstrat", "inststrat", "sessions", "cx", "projects"];
    const [tk, me, ch, en, ...its] = await Promise.all([
      apiFetch("/api/tasks").then((r) => r.json()).catch(() => ({})),
      apiFetch("/api/me").then((r) => r.json()).catch(() => ({})),
      apiFetch("/api/changes").then((r) => r.json()).catch(() => ({})),
      apiFetch("/api/entities").then((r) => r.json()).catch(() => ({})),
      ...sec.map((k) =>
        apiFetch(`/api/items?section=${k}`).then((r) => r.json()).catch(() => ({})),
      ),
    ]);
    const bag: Record<string, ItemLite[]> = {};
    sec.forEach((k, i) => (bag[k] = (its[i]?.items || []) as ItemLite[]));
    setItems(bag);
    setTasks((tk.tasks || []) as TaskLite[]);
    setChanges((ch.changes || []) as ChangeLite[]);
    type Ent = { name?: string; ours?: { reviewedAt?: string }[]; theirs?: { reviewedAt?: string }[] };
    const cts: ContactLite[] = [];
    for (const e of (en.entities || []) as Ent[])
      for (const c of [...(e.ours || []), ...(e.theirs || [])])
        if (c.reviewedAt) cts.push({ entity: e.name || "", reviewedAt: c.reviewedAt });
    setContacts(cts);
    setCanShare(me?.user?.role === "admin");
  }, []);

  const loadLog = useCallback(async () => {
    setLoading(true);
    /* المدى يوم كامل: من بداية الأحد إلى نهاية السبت.
       ويُطلب أسبوعان معاً — الثاني للمقارنة «مقابل الأسبوع الماضي» */
    const [r, rp] = await Promise.all([
      apiFetch(`/api/itemlog?from=${week}T00:00:00&to=${shiftDays(week, 7)}T00:00:00`)
        .then((x) => x.json()).catch(() => ({})),
      apiFetch(`/api/itemlog?from=${shiftDays(week, -7)}T00:00:00&to=${week}T00:00:00`)
        .then((x) => x.json()).catch(() => ({})),
    ]);
    setLog((r.log || []) as LogRow[]);
    setLogPrev(rp.error ? null : ((rp.log || []) as LogRow[]));
    setLogErr(r.error ? String(r.error) : "");
    setLoading(false);
  }, [week]);

  const loadPrefs = useCallback(async () => {
    const r = await apiFetch(`/api/weekly?week=${week}`).then((x) => x.json()).catch(() => ({}));
    setBase(r.base ?? null);
    setOver(r.week ?? null);
  }, [week]);

  useEffect(() => {
    void loadData();
  }, [loadData]);
  useEffect(() => {
    void loadLog();
  }, [loadLog]);
  useEffect(() => {
    void loadPrefs();
  }, [loadPrefs]);

  const prefs: WeeklyPrefs = useMemo(() => mergePrefs(base, over), [base, over]);

  const report: WeekReport = useMemo(
    () =>
      buildWeekReport({
        weekStart: week,
        weekEnd,
        log,
        logPrev,
        changes,
        tasks,
        contacts,
        items,
        on: prefs.on,
        next: listOf(prefs.texts?.next || ""),
      }),
    [week, weekEnd, log, logPrev, changes, tasks, contacts, items, prefs.on, prefs.texts],
  );

  /* اختيار ما يظهر من التكاليف والمشاريع — يُحفظ لهذا الأسبوع
     وحده فور الضغط، فلا يحتاج فتح الإعدادات. المفتاح يصل كاملاً
     من العرض (`tsk:<id>` أو `prj:<name>`) */
  const pickRow = useCallback(
    async (key: string, keep: boolean) => {
      const next: WeeklyPrefs = { ...prefs, on: { ...prefs.on, [key]: keep } };
      setOver(next);
      const r = await apiFetch("/api/weekly", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "week", week, prefs: next }),
      })
        .then((x) => x.json())
        .catch(() => ({ error: "تعذّر الحفظ" }));
      if (r?.error) setMsg(String(r.error));
    },
    [prefs, week],
  );

  /* خانتا «التحديث» و«الدعم المطلوب» في جدول التكاليف — تُكتبان
     في مكانهما وتُحفظان لهذا الأسبوع وحده. التحديث المكتوب هنا
     يغلب المنقولَ من صفحة التكاليف، وإفراغُه يُرجع المنقول.
     و«الدعم المطلوب» العام في آخر التقرير شيءٌ آخر يُكتب من ⚙️ */
  const saveTaskText = useCallback(
    async (key: string, text: string) => {
      if ((prefs.texts?.[key] || "") === text) return;
      const next: WeeklyPrefs = { ...prefs, texts: { ...prefs.texts, [key]: text } };
      setOver(next);
      const r = await apiFetch("/api/weekly", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "week", week, prefs: next }),
      })
        .then((x) => x.json())
        .catch(() => ({ error: "تعذّر الحفظ" }));
      setMsg(
        r?.error
          ? String(r.error)
          : key.startsWith("upd:")
            ? t("حُفظ التحديث ✓", "Saved ✓")
            : t("حُفظ الدعم المطلوب ✓", "Saved ✓"),
      );
    },
    [prefs, week, t],
  );

  /* أرقام دورة القياس — تُحفظ في **الافتراضي** لا في استثناء
     الأسبوع: الدورةُ ربعية، فرقمُها واحدٌ في أسابيع الربع كلها،
     ولو كُتب في استثناء أسبوعٍ لاختفى من بقيتها. */
  const saveCycle = useCallback(
    async (key: string, text: string) => {
      const b = mergePrefs(base, null);
      if ((b.texts?.[key] || "") === text) return;
      const next: WeeklyPrefs = { ...b, texts: { ...b.texts, [key]: text } };
      setBase(next);
      const r = await apiFetch("/api/weekly", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "default", week, prefs: next }),
      })
        .then((x) => x.json())
        .catch(() => ({ error: "تعذّر الحفظ" }));
      setMsg(r?.error ? String(r.error) : t("حُفظ ✓", "Saved ✓"));
    },
    [base, week, t],
  );

  async function save(next: WeeklyPrefs, scope: "default" | "week") {
    setBusy(true);
    setMsg("");
    const r = await apiFetch("/api/weekly", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope, week, prefs: next }),
    }).then((x) => x.json()).catch(() => ({ error: "تعذّر الحفظ" }));
    setBusy(false);
    if (r.error) return setMsg(r.error);
    if (scope === "week") setOver(next);
    else setBase(next);
    setMsg(
      scope === "week"
        ? t("حُفظ لهذا الأسبوع وحده ✓", "Saved for this week ✓")
        : t("حُفظ كافتراضي لكل أسبوع ✓", "Saved as the default ✓"),
    );
    setTune(false);
  }

  if (tune)
    return (
      <div className="wk-panel">
        {msg && <div className="alert">{msg}</div>}
        <WeeklyCustomize
          prefs={prefs}
          weekStart={report.weekStart}
          weekEnd={report.weekEnd}
          canEdit={canEdit}
          busy={busy}
          onSave={save}
          onClose={() => setTune(false)}
          share={canShare ? <ShareBox week={week} t={t} /> : undefined}
          t={t}
        />
      </div>
    );

  return (
    <div className="wk-panel">
      <div className="wk-bar no-print">
        <div className="wk-nav">
          <button className="btn btn-ghost" onClick={() => setWeek(shiftDays(week, -7))}>
            {t("الأسبوع السابق", "Previous")}
          </button>
          <b>{arDate2(week)}</b>
          <button
            className="btn btn-ghost"
            onClick={() => setWeek(shiftDays(week, 7))}
            disabled={week >= thisWeek}
          >
            {t("الأسبوع التالي", "Next")}
          </button>
          {week !== thisWeek && (
            <button className="btn btn-ghost" onClick={() => setWeek(thisWeek)}>
              {t("هذا الأسبوع", "This week")}
            </button>
          )}
        </div>
        <div className="wk-acts">
          {/* زرٌّ صريح بدل المربّع الصغير — والمشاركة صارت مجموعةً
              داخل اللوحة لا نافذةً منفصلة */}
          <button className="btn btn-ghost" onClick={() => setTune(true)}>
            ⚙️ {t("إعدادات التقرير", "Report settings")}
          </button>
          {/* اختيار الربع خارج الورقة: شريطُه كان يُطبع معها */}
          {view === "cycle" && canEdit && (
            <select
              className="wk-qsel"
              value={(prefs.texts || {})["cyc:q"] || quarterOf(week)}
              onChange={(e) => void saveCycle("cyc:q", e.target.value)}
            >
              {[0, 1].flatMap((back) => {
                const y = Number(quarterOf(week).slice(0, 4)) - back;
                return QUARTER_AR.map((lab, i) => (
                  <option key={`${y}Q${i + 1}`} value={`${y}Q${i + 1}`}>
                    {lab} {y}
                  </option>
                ));
              })}
            </select>
          )}
          {/* مربّعٌ يقلب المعروض بين التقريرين — والأساسي الأسبوعي */}
          <button
            className={`btn btn-ghost wk-swx ${view === "cycle" ? "on" : ""}`}
            onClick={() => setView(view === "cycle" ? "week" : "cycle")}
          >
            {view === "cycle"
              ? t("الإنجاز الأسبوعي", "Weekly report")
              : t("تقرير دورات القياس", "Cycle report")}
          </button>
          <div className="wk-pdf">
            <button className="btn" disabled={pdfBusy} onClick={() => setPdfMenu(!pdfMenu)}>
              {pdfBusy ? t("جارٍ التجهيز…", "Preparing…") : t("تنزيل PDF", "Download PDF")}
              <i className="ar">▾</i>
            </button>
            {pdfMenu && !pdfBusy && (
              <div className="wk-pdfm">
                {(
                  [
                    ["week", t("الإنجاز الأسبوعي", "Weekly report")],
                    ["cycle", t("دورة القياس", "Cycle report")],
                    ["all", t("الكل — ورقتان", "Both")],
                  ] as [PdfPick, string][]
                ).map(([k, lab]) => (
                  <button
                    key={k}
                    onClick={async () => {
                      setPdfMenu(false);
                      setPdfBusy(true);
                      setMsg(t("جارٍ تجهيز الملف…", "Preparing the file…"));
                      try {
                        await makePdf(week, k);
                        setMsg(t("نُزِّل الملف ✓", "Downloaded ✓"));
                      } catch (e) {
                        setMsg(`${t("تعذّر التصدير", "Export failed")}: ${(e as Error)?.message || e}`);
                      }
                      setPdfBusy(false);
                    }}
                  >
                    {lab}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {msg && <div className="alert no-print">{msg}</div>}

      {logErr && (
        <div className="alert no-print">
          {t(
            "سجلّ التغييرات غير مركَّب في قاعدة البيانات بعد — شغّلي supabase/perf-item-log.sql، وستظهر المنجزات تلقائياً بعدها.",
            "The change log is not installed yet.",
          )}
        </div>
      )}

      {/* الورقتان مرسومتان معاً: المعروضة في مكانها، والأخرى خارج
          الشاشة — فيلتقطهما «الكل» في ملفٍ واحد بلا إعادة رسم */}
      {loading ? (
        <div className="empty">{t("جارٍ التحميل...", "Loading...")}</div>
      ) : (
        <>
          <div className={view === "week" ? "" : "wk-off"} aria-hidden={view !== "week"}>
            <WeeklyReportView
              report={report}
              prefs={prefs}
              onPick={canEdit && view === "week" ? pickRow : undefined}
              onTaskText={canEdit && view === "week" ? saveTaskText : undefined}
            />
          </div>
          <div className={view === "cycle" ? "" : "wk-off"} aria-hidden={view !== "cycle"}>
            <WeeklyReportView
              report={report}
              prefs={prefs}
              mode="cycle"
              onCycleText={canEdit && view === "cycle" ? saveCycle : undefined}
            />
          </div>
        </>
      )}

    </div>
  );
}

function ShareBox({
  week,
  t,
}: {
  week: string;
  t: (ar: string, en: string) => string;
}) {
  const [rows, setRows] = useState<ShareRow[]>([]);
  const [days, setDays] = useState("30");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState("");
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    const r = await apiFetch("/api/report/share").then((x) => x.json());
    setRows(r.shares || []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function create() {
    setBusy(true);
    setErr("");
    const r = await apiFetch("/api/report/share", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ weekStart: week, days: days === "0" ? null : Number(days) }),
    }).then((x) => x.json());
    setBusy(false);
    if (r.error) return setErr(r.error);
    await load();
    copy(r.token);
  }

  async function copy(token: string) {
    const url = `${window.location.origin}${BASE}/w/?t=${token}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(token);
      setTimeout(() => setCopied(""), 2000);
    } catch {
      window.prompt(t("انسخ الرابط:", "Copy the link:"), url);
    }
  }

  async function revoke(token: string) {
    if (!window.confirm(t("إلغاء هذا الرابط نهائيًا؟", "Revoke this link permanently?"))) return;
    await apiFetch(`/api/report/share?token=${token}`, { method: "DELETE" });
    await load();
  }

  return (
    <div className="wk-share">
        <div>
          <p className="wk-note">
            {t(
              "الرابط يفتح تقرير هذا الأسبوع للاطّلاع فقط — بلا حساب وبلا أي صلاحية تعديل.",
              "The link opens this week's report read-only — no account, no editing."
            )}
          </p>
          <div className="wk-mk">
            <label>
              {t("مدة الصلاحية", "Valid for")}
              <select value={days} onChange={(e) => setDays(e.target.value)}>
                <option value="7">{t("٧ أيام", "7 days")}</option>
                <option value="30">{t("٣٠ يومًا", "30 days")}</option>
                <option value="90">{t("٩٠ يومًا", "90 days")}</option>
                <option value="0">{t("بلا انتهاء", "No expiry")}</option>
              </select>
            </label>
            <button className="btn" onClick={create} disabled={busy}>
              {busy ? t("جارٍ...", "Working...") : t("إنشاء رابط", "Create link")}
            </button>
          </div>
          {err && <div className="alert alert-error">{err}</div>}

          {rows.length === 0 ? (
            <div className="empty">{t("لا روابط بعد.", "No links yet.")}</div>
          ) : (
            <table className="wk-tbl wk-shares">
              <thead>
                <tr>
                  <th>{t("الأسبوع", "Week")}</th>
                  <th>{t("ينتهي", "Expires")}</th>
                  <th>{t("مرات الفتح", "Views")}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.token}>
                    <td className="ltr">{s.weekStart}</td>
                    <td className="ltr">{s.expiresAt ? s.expiresAt.slice(0, 10) : "—"}</td>
                    <td className="ltr">
                      {s.views}
                      {s.lastView ? ` · ${s.lastView.slice(0, 10)}` : ""}
                    </td>
                    <td className="wk-sact">
                      <button className="btn btn-ghost btn-sm" onClick={() => copy(s.token)}>
                        {copied === s.token ? t("نُسخ ✓", "Copied ✓") : t("نسخ", "Copy")}
                      </button>
                      <button className="btn btn-ghost btn-sm wk-danger" onClick={() => revoke(s.token)}>
                        {t("إلغاء", "Revoke")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
    </div>
  );
}
