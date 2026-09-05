"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import { writeXlsx } from "@/lib/sheet";

/* ============================================================
   الأقسام الخمسة المتفرّعة من المؤشرات التفصيلية:
     جلسات مراجعة الأداء · الاستراتيجيات الوطنية ·
     الاستراتيجيات المؤسسية · المخرجات الوطنية · المشاريع

   كلها تقرأ من جدول واحد (perf_items) والمحتوى في عمود jsonb،
   لأن حقول كل قسم لم تُحسم بعد — فتغييرها لاحقاً لا يحتاج ترحيلاً.
   لكل قسم كتلة مختصرة في «نظرة عامة» وصفحة كاملة في القائمة.
   ============================================================ */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Rec = Record<string, any>;
export type Item = { id: string; ord: number; data: Rec; updatedAt?: string; updatedBy?: string };
type T = (ar: string, en: string) => string;

export type SectionKey = "sessions" | "natstrat" | "inststrat" | "outputs" | "projects";

export const SECTION_TITLE: Record<SectionKey, [string, string]> = {
  sessions: ["جلسات مراجعة الأداء", "Performance review sessions"],
  natstrat: ["الاستراتيجيات الوطنية", "National strategies"],
  inststrat: ["الاستراتيجيات المؤسسية", "Institutional strategies"],
  outputs: ["المخرجات الوطنية", "National outputs"],
  projects: ["المشاريع الاستراتيجية", "Strategic projects"],
};

/* مراحل المسار — مبدئية حتى تعتمدها الإدارة المعنية */
const SESS_STAGES = ["تحديد الجهة", "جمع البيانات", "إعداد التقرير", "انعقاد الجلسة", "محضر وتوصيات", "الإغلاق"];
/* حالة اعتماد الاستراتيجية الوطنية — أربع محطات */
const NAT_STEPS = ["طور الإعداد/التحديث", "قيد المراجعة", "معتمدة من اللجنة", "معتمدة من مجلس الوزراء"];
const NAT_WHERE = ["لدى الجهة المالكة", "لدى اللجنة الاستراتيجية", "اللجنة الاستراتيجية", "اعتماد نهائي"];
/* مسار المراجعة الأربع — مسار مستقل عن «حالة الاعتماد»:
   لكل مرحلة حالتها (لم يبدأ · قيد التنفيذ · مكتمل) كما في عرض الإدارة */
const NAT_TRACK = ["استلام الوثيقة", "استلام الحصر", "المراجعة الفنية", "معالجة الملاحظات"];
const TRACK_STATE = ["لم يبدأ", "قيد التنفيذ", "مكتمل"];
/** حالات المراحل الأربع — الافتراضي «لم يبدأ» ولا يُستنتج من غيره */
function natTrack(d: Rec): number[] {
  const raw = Array.isArray(d.track) ? d.track : [];
  return NAT_TRACK.map((_, i) => Math.max(0, Math.min(2, numOf(raw[i], 0))));
}
const INST_STAGES = ["وصلت المركز", "قيد المراجعة", "معالجة الملاحظات", "اعتُمدت", "فُعِّل القياس"];

/* أعمدة متابعة الاستراتيجيات المؤسسية — هي أعمدة ملف المتابعة نفسه
   حتى لا يُنقل بين الإكسل واللوحة. كل خلية تُحرَّر في مكانها. */
type ICol = { k: string; label: string; opts?: string[]; w: number };
const INST_SECTORS = ["المالي والاقتصادي", "البنية التحتية", "الخدمات الاجتماعية", "الشؤون الحكومية"];
/* العرض بالبكسل لأن الجدول يمرّر أفقياً — والقيم مقاسة على أطول
   نص فعلي في كل عمود، فلا يُقتطع اسم جهة ولا بريد */
const INST_COLS: ICol[] = [
  { k: "sector", label: "القطاع", opts: ["", ...INST_SECTORS], w: 140 },
  { k: "owner", label: "الجهة", w: 250 },
  { k: "consultant", label: "الاستشاري", w: 150 },
  { k: "phone", label: "رقم الجوال", w: 110 },
  { k: "email", label: "البريد الإلكتروني", w: 210 },
  { k: "rep", label: "تسمية ممثل", opts: ["", "تمت تسمية ممثل", "لم يُرسل بعد"], w: 150 },
  { k: "meet", label: "الاجتماع التعريفي", opts: ["", "تم", "لم يتم بعد"], w: 125 },
  { k: "meetAt", label: "تاريخ الاجتماع", w: 150 },
  { k: "docs", label: "استلام الوثائق", opts: ["", "✓", "✗"], w: 100 },
  { k: "docsState", label: "حالة الوثائق", opts: ["", "مكتمل", "جزئي", "لايمكن قياسه"], w: 130 },
  { k: "target", label: "تفعيل القياس (مستهدف)", opts: ["", "Q1", "Q2", "Q3", "Q4"], w: 120 },
  { k: "live", label: "حالة التفعيل", opts: ["", "مفعل", "غير مفعل"], w: 115 },
  { k: "phase", label: "Phase", opts: ["", "Phase 1", "Phase 2"], w: 110 },
];
/* تلوين الخلايا التي لها معنى حالة */
function instTone(k: string, v: string): string {
  if (!v) return "";
  if (k === "docs") return v === "✓" ? "ok" : "no";
  if (k === "meet") return v === "تم" ? "ok" : "wt";
  if (k === "rep") return v === "تمت تسمية ممثل" ? "ok" : "wt";
  if (k === "live") return v === "مفعل" ? "ok" : "wt";
  if (k === "docsState") return v === "مكتمل" ? "ok" : v === "جزئي" ? "wt" : "no";
  return "";
}

/* الأرقام كلها لاتينية (1 2 3) بطلب المستخدمة. الدالة تحوّل
   الأرقام الهندية إن وردت في نص مُدخَل، فيتوحّد الشكل مهما
   كُتبت البيانات. */
const lat = (v: string) => v.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
const AR = (n: number | string) => lat(String(n));
const numOf = (v: unknown, dflt = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
};
const txt = (v: unknown) => (v === null || v === undefined ? "" : lat(String(v)));
/* لون نطاق القياس: مرتفعة ≥٩٠ · متوسطة ٧٠–٨٩ · منخفضة أقل من ٧٠ */
const measTone = (v: number) => (v >= 90 ? "hi" : v >= 70 ? "mid" : "low");

/* ---------------- تحميل بنود قسم ---------------- */
export function useItems(section: SectionKey, enabled = true) {
  const [items, setItems] = useState<Item[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!enabled) return;
    const r = await apiFetch(`/api/items?section=${section}`);
    const d = await r.json().catch(() => ({}));
    if (!r.ok) setError(d.error || "تعذّر تحميل البيانات");
    setItems(Array.isArray(d.items) ? d.items : []);
    setLoaded(true);
  }, [section, enabled]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(
    async (id: string, data: Rec, ord: number) => {
      const r = await apiFetch("/api/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ section, id, data, ord }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return d.error || "تعذّر الحفظ";
      await load();
      return null;
    },
    [section, load],
  );

  const remove = useCallback(
    async (id: string) => {
      const r = await apiFetch(`/api/items?section=${section}&id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!r.ok) return "تعذّر الحذف";
      await load();
      return null;
    },
    [section, load],
  );

  return { items, loaded, error, reload: load, save, remove };
}

/* ------------------------------------------------------------
   طيّ الأقسام — الحالة محفوظة في متصفح كل مستخدم وحده،
   فما يطويه أحد لا يؤثر على غيره ولا يُحفظ في القاعدة.
   ------------------------------------------------------------ */
export function useCollapse(key: string) {
  const [open, setOpen] = useState(true);
  useEffect(() => {
    try {
      setOpen(localStorage.getItem(`ovSec:${key}`) !== "0");
    } catch {
      /* ignore */
    }
  }, [key]);
  const toggle = useCallback(() => {
    setOpen((v) => {
      try {
        localStorage.setItem(`ovSec:${key}`, v ? "0" : "1");
      } catch {
        /* ignore */
      }
      return !v;
    });
  }, [key]);
  return { open, toggle };
}

/** سهم الطيّ — يوضع أول العنوان */
export function CollapseBtn({ open, toggle, t }: { open: boolean; toggle: () => void; t: T }) {
  return (
    <button
      className={`sec-tog ${open ? "" : "closed"}`}
      onClick={toggle}
      aria-expanded={open}
      title={open ? t("طيّ القسم", "Collapse") : t("فتح القسم", "Expand")}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 9l7 7 7-7" />
      </svg>
    </button>
  );
}

/* ---------------- قطع مشتركة ---------------- */

/** حلقة نسبة — القوس يتحرّك بالإكمال وحده */
function Ring({ pct, size = 132, tone = "g" }: { pct: number; size?: number; tone?: "g" | "low" | "mid" | "hi" }) {
  const r = size / 2 - 13;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, pct));
  const color = tone === "low" ? "#d34a4a" : tone === "mid" ? "#e0971a" : tone === "hi" ? "#1a9d5c" : "#00584c";
  return (
    <svg className="sx-ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#dceae6" strokeWidth="13" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="13"
        strokeLinecap="round"
        strokeDasharray={`${(c * v) / 100} ${c}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central" className="sx-ring-t" fill={color}>
        {AR(Math.round(v))}٪
      </text>
    </svg>
  );
}

function Flow({ stages, done, dates, sm }: { stages: string[]; done: number; dates?: string[]; sm?: boolean }) {
  return (
    <div className={`sx-flow ${sm ? "sm" : ""}`}>
      {stages.map((s, i) => (
        <div
          key={s + i}
          className={`sx-st ${i < done ? "ok" : i === done ? "now" : ""}`}
          title={dates?.[i] ? `${s} — ${dates[i]}` : s}
        >
          <div className="d">{i < done ? "✓" : AR(i + 1)}</div>
          <div className="t">{s}</div>
        </div>
      ))}
    </div>
  );
}

/* نقاط صغيرة بدل المسار الكامل — تُستعمل داخل جدول */
function Dots({ n, done }: { n: number; done: number }) {
  return (
    <span className="sx-dots">
      {Array.from({ length: n }).map((_, i) => (
        <i key={i} className={i < done ? "ok" : i === done ? "now" : ""} />
      ))}
    </span>
  );
}

function Empty({ title, note }: { title: string; note: string }) {
  return (
    <div className="sx-empty">
      <div className="ic">◻</div>
      <h3>{title}</h3>
      <p>{note}</p>
    </div>
  );
}

function Bar({ v }: { v: number }) {
  return (
    <span className={`sx-meas ${measTone(v)}`}>
      <b>{AR(v)}٪</b>
      <span className="bar">
        <i style={{ width: `${Math.max(0, Math.min(100, v))}%` }} />
      </span>
    </span>
  );
}

function Toolbar({
  q,
  setQ,
  filter,
  setFilter,
  options,
  onExport,
  t,
}: {
  q: string;
  setQ: (v: string) => void;
  filter: string;
  setFilter: (v: string) => void;
  options: string[];
  onExport: () => void;
  t: T;
}) {
  return (
    <div className="sx-tb">
      <input
        className="sx-search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t("بحث بالاسم أو الجهة…", "Search…")}
      />
      <select value={filter} onChange={(e) => setFilter(e.target.value)}>
        <option value="">{t("كل الحالات", "All statuses")}</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
      <button className="btn btn-ghost btn-sm" onClick={onExport}>
        ⬇ Excel
      </button>
    </div>
  );
}

function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* ============================================================
   ١) جلسات مراجعة الأداء
   لوحة جانبية فيها حلقة الإنجاز وتفصيل الحالات، وبجانبها
   بطاقة لكل جهة عليها مسار مراحلها والتاريخ في التلميح.
   ============================================================ */
function sessOf(d: Rec) {
  const raw = Array.isArray(d.stages) ? d.stages : [];
  const names = raw.length ? raw.map((x: Rec) => txt(x.n)) : SESS_STAGES;
  const dates = raw.map((x: Rec) => txt(x.d));
  const done = Math.max(0, Math.min(names.length, numOf(d.done)));
  return { names, dates, done, full: names.length };
}

export function Sessions({ limit, t }: { limit?: number; t: T }) {
  const { items, loaded } = useItems("sessions");
  const [all, setAll] = useState(false);
  const shown = limit && !all ? items.slice(0, limit) : items;

  const stat = useMemo(() => {
    let done = 0;
    let live = 0;
    let idle = 0;
    for (const it of items) {
      const s = sessOf(it.data);
      if (s.done >= s.full && s.full > 0) done++;
      else if (s.done > 0) live++;
      else idle++;
    }
    return { done, live, idle };
  }, [items]);

  if (!loaded) return <div className="empty">{t("جارٍ التحميل...", "Loading...")}</div>;
  if (!items.length)
    return (
      <Empty
        title={t("لا توجد جلسات بعد", "No sessions yet")}
        note={t("تُضاف الجهات ومراحل جلساتها من زر «إضافة».", "Add entities and their session stages.")}
      />
    );

  const pct = items.length ? (stat.done / items.length) * 100 : 0;
  const quarter = txt(items[0]?.data?.quarter);

  return (
    <div className="card sx-sess">
      <div className="sx-side">
        <Ring pct={pct} />
        <div className="ttl">{t("إنجاز جلسات المراجعة", "Sessions completed")}</div>
        <div className="sub">
          {`${AR(stat.done)} ${t("من", "of")} ${AR(items.length)} ${t("جهات", "entities")}`}
          {quarter ? ` · ${quarter}` : ""}
        </div>
        <div className="lgd">
          <span className="rw">
            <em className="dot done" />
            {t("مكتملة", "Done")}
            <b>{AR(stat.done)}</b>
          </span>
          <span className="rw">
            <em className="dot live" />
            {t("جارية", "In progress")}
            <b>{AR(stat.live)}</b>
          </span>
          <span className="rw">
            <em className="dot idle" />
            {t("لم تبدأ", "Not started")}
            <b>{AR(stat.idle)}</b>
          </span>
        </div>
      </div>

      <div className="sx-list">
        {shown.map((it) => {
          const s = sessOf(it.data);
          const cur = s.done >= s.full ? t("مكتملة", "Done") : s.names[s.done] || "";
          return (
            <div className="sx-card" key={it.id}>
              <div className="sx-h">
                <b>{txt(it.data.entity) || "—"}</b>
                <span className="sx-own">{txt(it.data.quarter)}</span>
                <span className="sx-pill">{cur}</span>
              </div>
              <Flow stages={s.names} done={s.done} dates={s.dates} />
            </div>
          );
        })}
        {limit && items.length > limit && (
          <button className="sx-more" onClick={() => setAll(!all)}>
            {all
              ? `${t("عرض أقل", "Show less")} ▴`
              : `${t("عرض الكل", "Show all")} (${AR(items.length - limit)} ${t("أخرى", "more")}) ▾`}
          </button>
        )}
      </div>
    </div>
  );
}

function SessionsPage({ t }: { t: T }) {
  return <Sessions t={t} />;
}

/* ============================================================
   ٢) الاستراتيجيات الوطنية
   ============================================================ */
function natStage(d: Rec) {
  return Math.max(1, Math.min(NAT_STEPS.length, numOf(d.stage, 1)));
}

export function NationalStrategies({ limit, t, onMore }: { limit?: number; t: T; onMore?: () => void }) {
  const { items, loaded } = useItems("natstrat");
  const counts = useMemo(() => {
    const c = [0, 0, 0, 0];
    for (const it of items) c[natStage(it.data) - 1]++;
    return c;
  }, [items]);

  if (!loaded) return <div className="empty">{t("جارٍ التحميل...", "Loading...")}</div>;
  if (!items.length)
    return (
      <Empty
        title={t("لا توجد استراتيجيات بعد", "Nothing yet")}
        note={t("تُضاف الاستراتيجيات وحالتها من زر «إضافة».", "Add strategies and their stage.")}
      />
    );

  const latest = [...items].sort((a, b) => txt(b.data.updated).localeCompare(txt(a.data.updated)));
  const shown = limit ? latest.slice(0, limit) : latest;

  return (
    <>
      <div className="sx-nums five">
        <div className="sx-tot">
          <b>{AR(items.length)}</b>
          <span>{t("إجمالي الاستراتيجيات", "Total")}</span>
        </div>
        {NAT_STEPS.map((s, i) => (
          <div className="sx-nc" key={s}>
            <div className="t">{s}</div>
            <b>{AR(counts[i])}</b>
            <div className="s">{NAT_WHERE[i]}</div>
          </div>
        ))}
      </div>

      <div className="sx-rows tight">
        {shown.map((it) => (
          <div className="sx-line" key={it.id}>
            <span className="n">{txt(it.data.name)}</span>
            <span className="sx-pill">{NAT_STEPS[natStage(it.data) - 1]}</span>
            <span className="sx-up">{txt(it.data.updated)}</span>
            <Bar v={numOf(it.data.meas)} />
          </div>
        ))}
      </div>
      {limit && items.length > limit && onMore && (
        <button className="sx-more" onClick={onMore}>
          {`${t("عرض الكل", "Show all")} (${AR(items.length)})`}
        </button>
      )}
    </>
  );
}

function NationalPage({ t, canEdit }: { t: T; canEdit?: boolean }) {
  const { items, loaded, save } = useItems("natstrat");
  const [q, setQ] = useState("");
  const [f, setF] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  /* الضغط على النقطة يقلّب حالتها: لم يبدأ ← قيد التنفيذ ← مكتمل.
     أسرع من فتح نافذة التحرير لكل مرحلة، ولا يظهر لمن لا يملك التحرير */
  async function cycle(it: Item, i: number) {
    const cur = natTrack(it.data);
    cur[i] = (cur[i] + 1) % 3;
    await save(it.id, { ...it.data, track: cur, demo: false }, it.ord);
  }

  const rows = useMemo(
    () =>
      items.filter((it) => {
        const d = it.data;
        const hay = `${txt(d.name)} ${txt(d.owner)} ${txt(d.domain)}`;
        if (q && !hay.includes(q)) return false;
        if (f && NAT_STEPS[natStage(d) - 1] !== f) return false;
        return true;
      }),
    [items, q, f],
  );

  const groups = useMemo(() => {
    const g: Record<number, Item[]> = { 4: [], 3: [], 12: [] };
    for (const it of items) {
      const st = natStage(it.data);
      if (st === 4) g[4].push(it);
      else if (st === 3) g[3].push(it);
      else g[12].push(it);
    }
    return g;
  }, [items]);

  if (!loaded) return <div className="empty">{t("جارٍ التحميل...", "Loading...")}</div>;
  if (!items.length)
    return (
      <Empty
        title={t("لا توجد استراتيجيات بعد", "Nothing yet")}
        note={t("تُضاف الاستراتيجيات من زر «إضافة».", "Add strategies.")}
      />
    );

  const cur = items.find((x) => x.id === open) || null;

  function chips(list: Item[]) {
    const names = [...new Set(list.map((x) => txt(x.data.domain)).filter(Boolean))];
    const head = names.slice(0, 6);
    return (
      <div className="chips">
        {head.map((n) => (
          <span key={n}>{n}</span>
        ))}
        {names.length > head.length && <span className="more">+{AR(names.length - head.length)}</span>}
      </div>
    );
  }

  function exportXl() {
    const head = ["الاستراتيجية", "الجهة", "النطاق", "حالة الاعتماد", "المراجعة الفنية", "قابلية القياس", "أبرز الملاحظات"];
    const body = rows.map((it) => {
      const d = it.data;
      return [
        txt(d.name),
        txt(d.owner),
        txt(d.domain),
        NAT_STEPS[natStage(d) - 1],
        d.tech ? "مقبولة فنياً" : "غير مقبولة فنياً",
        numOf(d.meas),
        txt(d.note),
      ];
    });
    download("الاستراتيجيات-الوطنية.xlsx", writeXlsx([{ name: "الاستراتيجيات", rows: [head, ...body] }]));
  }

  return (
    <>
      <Toolbar q={q} setQ={setQ} filter={f} setFilter={setF} options={NAT_STEPS} onExport={exportXl} t={t} />

      <div className="sx-groups">
        <div className="sx-grp dark">
          <div className="hd">
            {t("معتمدة من مجلس الوزراء", "Cabinet approved")} <b>{AR(groups[4].length)}</b>
          </div>
          {chips(groups[4])}
        </div>
        <div className="sx-grp dark">
          <div className="hd">
            {t("معتمدة من اللجنة الاستراتيجية", "Committee approved")} <b>{AR(groups[3].length)}</b>
          </div>
          {chips(groups[3])}
        </div>
        <div className="sx-grp">
          <div className="hd">
            {t("تحت المراجعة والتطوير", "Under review")} <b>{AR(groups[12].length)}</b>
          </div>
          {chips(groups[12])}
        </div>
      </div>

      <div className="tbl-wrap">
        <table className="sx-tbl">
          <thead>
            <tr>
              <th>{t("الاستراتيجية", "Strategy")}</th>
              <th>{t("حالة الاعتماد", "Approval")}</th>
              {NAT_TRACK.map((n, i) => (
                <th className={`c stg ${i === 0 ? "st-a" : ""} ${i === NAT_TRACK.length - 1 ? "st-z" : ""}`} key={n}>
                  {n}
                </th>
              ))}
              <th className="c">{t("المراجعة الفنية", "Technical review")}</th>
              <th className="c">{t("قابلية القياس", "Measurability")}</th>
              <th>{t("أبرز الملاحظات", "Notes")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((it) => {
              const d = it.data;
              return (
                <tr key={it.id} className={open === it.id ? "on" : ""} onClick={() => setOpen(open === it.id ? null : it.id)}>
                  <td>
                    <div className="nm">{txt(d.name)}</div>
                    <div className="own">{txt(d.owner)}</div>
                  </td>
                  <td>{NAT_STEPS[natStage(d) - 1]}</td>
                  {natTrack(d).map((st, i) => (
                    <td
                      className={`c stg ${i === 0 ? "st-a" : ""} ${i === NAT_TRACK.length - 1 ? "st-z" : ""}`}
                      key={i}
                      title={`${NAT_TRACK[i]} — ${TRACK_STATE[st]}`}
                      onClick={(e) => {
                        if (!canEdit) return;
                        e.stopPropagation();
                        void cycle(it, i);
                      }}
                    >
                      <i className={`stdot s${st} ${canEdit ? "ed" : ""}`} />
                    </td>
                  ))}
                  <td className="c">
                    <span className={`sx-tag ${d.tech ? "ok" : "no"}`}>
                      {d.tech ? t("مقبولة فنياً", "Accepted") : t("غير مقبولة فنياً", "Not accepted")}
                    </span>
                  </td>
                  <td className="c">
                    <Bar v={numOf(d.meas)} />
                  </td>
                  <td className="note">{txt(d.note)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="stg-lg">
        {TRACK_STATE.map((n, i) => (
          <span key={n}>
            <i className={`stdot s${i}`} />
            {t(n, n)}
          </span>
        ))}
        {canEdit && <em>{t("اضغط على أي نقطة لتغيير حالتها", "Click a dot to change its state")}</em>}
      </div>

      {cur && <NationalDetail it={cur} t={t} />}
    </>
  );
}

function NationalDetail({ it, t }: { it: Item; t: T }) {
  const d = it.data;
  const meas = numOf(d.meas);
  return (
    <div className="sx-det">
      <div className="col">
        <div className="box">
          <div className="k">{t("اسم الاستراتيجية", "Strategy")}</div>
          <div className="v">{txt(d.name)}</div>
        </div>
        <div className="two">
          <div className="box">
            <div className="k">{t("فترة الاستراتيجية", "Period")}</div>
            <div className="v">{txt(d.period) || "—"}</div>
          </div>
          <div className="box">
            <div className="k">{t("تاريخ الاعتماد", "Approved on")}</div>
            <div className="v">{txt(d.approvedAt) || t("لم تُعتمد", "Not approved")}</div>
          </div>
        </div>
        <div className="two">
          <div className="box">
            <div className="k">{t("المؤشرات (ممثلة/إجمالي)", "KPIs")}</div>
            <div className="v">{`${AR(numOf(d.kpisRep))} / ${AR(numOf(d.kpisTot))}`}</div>
          </div>
          <div className="box">
            <div className="k">{t("المبادرات (ممثلة/إجمالي)", "Initiatives")}</div>
            <div className="v">{`${AR(numOf(d.initRep))} / ${AR(numOf(d.initTot))}`}</div>
          </div>
        </div>
        <div className="box ringbox">
          <Ring pct={meas} size={150} tone={measTone(meas)} />
          <div className="k">{t("نسبة قابلية القياس", "Measurability")}</div>
          <div className="lg">
            <span>
              <i className="hi" />
              {t("مرتفعة ≥ 90٪", "High")}
            </span>
            <span>
              <i className="mid" />
              {t("متوسطة 70–89٪", "Medium")}
            </span>
            <span>
              <i className="low" />
              {t("منخفضة أقل من 70٪", "Low")}
            </span>
          </div>
        </div>
      </div>
      <div className="col">
        <div className="sx-note big">
          <b>{t("الوضع الحالي", "Current status")}</b>
          {txt(d.current) || "—"}
        </div>
        <div className="sx-note big">
          <b>{t("التحدي", "Challenge")}</b>
          {txt(d.challenge) || "—"}
        </div>
        <div className="sx-note big">
          <b>{t("الخطوات القادمة", "Next steps")}</b>
          {txt(d.next) || "—"}
        </div>
        <div className="sx-note big">
          <b>{t("الدعم المطلوب", "Support needed")}</b>
          {txt(d.support) || "—"}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------
   بطاقتا «نظرة عامة» — معلومات عامة فقط، والأسماء والتفاصيل
   كلها في صفحة كل قسم. الوطنية يميناً والمؤسسية يساراً.
   ------------------------------------------------------------ */
function KV({ label, n, tot, tone }: { label: string; n: number; tot: number; tone?: string }) {
  return (
    <div className="kv">
      <span className="t">{label}</span>
      <span className="mb">
        <i className={tone || ""} style={{ width: `${tot ? (n / tot) * 100 : 0}%` }} />
      </span>
      <b>{AR(n)}</b>
    </div>
  );
}

function GCell({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="gc">
      <div className="k">{k}</div>
      <div className="v">{children}</div>
    </div>
  );
}

export function StrategyBox({
  section,
  t,
  onOpen,
}: {
  section: "natstrat" | "inststrat";
  t: T;
  onOpen: () => void;
}) {
  const { items, loaded } = useItems(section);
  const title = SECTION_TITLE[section];
  const { open, toggle } = useCollapse(section);

  const box = (body: ReactNode) => (
    <div className={`sx-box ${open ? "" : "closed"}`}>
      <div className="hd">
        <CollapseBtn open={open} toggle={toggle} t={t} />
        <h3>{t(title[0], title[1])}</h3>
        <button className="lnk" onClick={onOpen}>
          {t("التفاصيل", "Details")} ‹
        </button>
      </div>
      {open && <div className="bd">{body}</div>}
    </div>
  );

  if (!loaded) return box(<div className="empty">{t("جارٍ التحميل...", "Loading...")}</div>);
  if (!items.length)
    return box(
      <div className="sx-none">{t("لا توجد بيانات بعد — تُضاف من صفحة القسم.", "No data yet.")}</div>,
    );

  const tot = items.length;
  const last = items.map((x) => txt(x.data.updated)).sort().slice(-1)[0] || "—";

  if (section === "natstrat") {
    const c = [0, 0, 0, 0];
    for (const it of items) c[natStage(it.data) - 1]++;
    const meas = Math.round(items.reduce((a, x) => a + numOf(x.data.meas), 0) / tot);
    const tech = items.filter((x) => x.data.tech).length;
    const rep = items.reduce((a, x) => a + numOf(x.data.kpisRep), 0);
    const all = items.reduce((a, x) => a + numOf(x.data.kpisTot), 0);
    return box(
      <>
        <div className="head-row">
          <div className="big">
            <b>{AR(tot)}</b>
            <span>{t("استراتيجية وطنية", "national")}</span>
          </div>
          <div className="side">
            {NAT_STEPS.map((s, i) => (
              <KV key={s} label={s} n={c[i]} tot={tot} tone={i >= 2 ? "g" : ""} />
            ))}
          </div>
        </div>
        <div className="gen">
          <GCell k={t("متوسط قابلية القياس", "Avg. measurability")}>
            <span className="meas">
              <span className={`n ${measTone(meas)}`}>{AR(meas)}٪</span>
              <span className="bar">
                <i className={measTone(meas)} style={{ width: `${meas}%` }} />
              </span>
            </span>
          </GCell>
          <GCell k={t("مقبولة فنياً", "Technically accepted")}>
            {AR(tech)} <em>{`${t("من", "of")} ${AR(tot)}`}</em>
          </GCell>
          <GCell k={t("المؤشرات الممثَّلة", "Represented KPIs")}>
            {AR(rep)} <em>{`${t("من", "of")} ${AR(all)}`}</em>
          </GCell>
          <GCell k={t("آخر تحديث", "Last update")}>
            <span className="dt">{last}</span>
          </GCell>
        </div>
      </>,
    );
  }

  const cnt = (k: string, v: string) => items.filter((x) => txt(x.data[k]) === v).length;
  const met = cnt("meet", "تم");
  const docs = cnt("docs", "✓");
  const live = cnt("live", "مفعل");
  const pct = Math.round((live / tot) * 100);
  const goals = cnt("phase", "Phase 1");
  const kpis = cnt("phase", "Phase 2");
  return box(
    <>
      <div className="head-row">
        <div className="big">
          <b>{AR(tot)}</b>
          <span>{t("جهة", "entities")}</span>
        </div>
        <div className="side">
          <KV label={t("عُقد الاجتماع التعريفي", "Kickoff held")} n={met} tot={tot} />
          <KV label={t("الوثائق مستلمة", "Docs received")} n={docs} tot={tot} />
          <KV label={t("اكتملت الوثائق", "Docs complete")} n={cnt("docsState", "مكتمل")} tot={tot} />
          <KV label={t("فُعِّل القياس", "Measurement live")} n={live} tot={tot} tone="g" />
        </div>
      </div>
      <div className="gen">
        <GCell k={t("نسبة تفعيل القياس", "Measurement live %")}>
          <span className="meas">
            <span className="n hi">{AR(pct)}٪</span>
            <span className="bar">
              <i className="hi" style={{ width: `${pct}%` }} />
            </span>
          </span>
        </GCell>
        <GCell k={t("لم يُعقد اجتماعها", "Kickoff pending")}>
          {AR(tot - met)} <em>{t("جهة", "entities")}</em>
        </GCell>
        <GCell k="Phase 1 · Phase 2">
          {AR(goals)} <em>· {AR(kpis)}</em>
        </GCell>
        <GCell k={t("آخر تحديث", "Last update")}>
          <span className="dt">{last}</span>
        </GCell>
      </div>
    </>,
  );
}

/* ============================================================
   ٣) الاستراتيجيات المؤسسية — بطاقة لكل جهة
   ============================================================ */
function instStage(d: Rec) {
  return Math.max(0, Math.min(INST_STAGES.length, numOf(d.stage)));
}

export function InstStrategies({ limit, t, onMore }: { limit?: number; t: T; onMore?: () => void }) {
  const { items, loaded } = useItems("inststrat");
  if (!loaded) return <div className="empty">{t("جارٍ التحميل...", "Loading...")}</div>;
  if (!items.length)
    return (
      <Empty
        title={t("لا توجد جهات بعد", "Nothing yet")}
        note={t("تُضاف الجهات من زر «إضافة».", "Add entities.")}
      />
    );

  const g = (k: string, v: string) => items.filter((i) => txt(i.data[k]) === v).length;
  const met = g("meet", "تم");
  const docs = g("docs", "✓");
  const live = g("live", "مفعل");
  const shown = limit ? items.slice(0, limit) : items;

  return (
    <>
      <div className="sx-nums three">
        <div className="sx-tot">
          <b>{AR(items.length)}</b>
          <span>{t("جهة", "entities")}</span>
        </div>
        <div className="sx-nc">
          <div className="t">{t("عُقد الاجتماع التعريفي", "Kickoff held")}</div>
          <b>{AR(met)}</b>
          <div className="s">{`${t("من أصل", "of")} ${AR(items.length)}`}</div>
          <div className="sx-prog">
            <i style={{ width: `${items.length ? (met / items.length) * 100 : 0}%` }} />
          </div>
        </div>
        <div className="sx-nc g">
          <div className="t">{t("فُعِّل القياس", "Measurement live")}</div>
          <b>{AR(live)}</b>
          <div className="s">{`${t("من أصل", "of")} ${AR(items.length)}`}</div>
          <div className="sx-prog">
            <i className="g" style={{ width: `${items.length ? (live / items.length) * 100 : 0}%` }} />
          </div>
        </div>
      </div>

      <div className="sx-mini-row">
        <span>
          {t("الوثائق مستلمة", "Docs received")} <b>{AR(docs)}</b>
        </span>
        <span>
          Phase 1 <b>{AR(g("phase", "Phase 1"))}</b>
        </span>
        <span>
          Phase 2 <b>{AR(g("phase", "Phase 2"))}</b>
        </span>
      </div>

      <div className="sx-cards">
        {shown.map((it) => (
          <InstCard key={it.id} it={it} t={t} />
        ))}
      </div>
      {onMore && limit && items.length > limit && (
        <button className="sx-link mid" onClick={onMore}>
          {`${t("عرض الكل", "Show all")} (${AR(items.length)})`}
        </button>
      )}
    </>
  );
}

function InstCard({ it, t }: { it: Item; t: T }) {
  const d = it.data;
  const step = (k: string, on: boolean, label: string) => (
    <span key={k} className={`ist ${on ? "on" : ""}`}>
      {label}
    </span>
  );
  return (
    <div className="sx-card wide">
      <div className="sx-h">
        <b>{txt(d.owner) || "—"}</b>
        <span className="sx-own">{txt(d.consultant)}</span>
        <span className="sx-mini">{txt(d.sector)}</span>
        <span className="sx-pill">{txt(d.phase) || "—"}</span>
        <span className="sx-up">{txt(d.target) ? `${t("مستهدف", "target")} ${txt(d.target)}` : ""}</span>
      </div>
      <div className="ist-row">
        {step("rep", txt(d.rep) === "تمت تسمية ممثل", t("تسمية ممثل", "Rep named"))}
        {step("meet", txt(d.meet) === "تم", t("الاجتماع التعريفي", "Kickoff"))}
        {step("docs", txt(d.docs) === "✓", t("استلام الوثائق", "Docs"))}
        {step("ds", txt(d.docsState) === "مكتمل", t("اكتمال الوثائق", "Docs complete"))}
        {step("live", txt(d.live) === "مفعل", t("تفعيل القياس", "Measurement live"))}
      </div>
    </div>
  );
}

/* ---------------- بطاقة جهة واحدة ----------------
   أربع محطات، كل محطة باسمها وقيمتها تحتها ونقطة بلون حالتها —
   بدل خلايا جدول عرضها مئة بكسل يُقتطع فيها النص */
function instSteps(d: Rec, t: T) {
  const rep = txt(d.rep);
  const meet = txt(d.meet);
  const docs = txt(d.docs);
  const ds = txt(d.docsState);
  const live = txt(d.live);
  return [
    {
      k: t("تسمية ممثل", "Rep"),
      v: rep === "تمت تسمية ممثل" ? t("تمت", "Named") : rep || "—",
      c: rep === "تمت تسمية ممثل" ? "ok" : rep ? "wt" : "",
    },
    {
      k: t("الاجتماع التعريفي", "Kickoff"),
      v: meet === "تم" ? txt(d.meetAt) || t("تم", "Held") : meet || "—",
      c: meet === "تم" ? "ok" : meet ? "wt" : "",
    },
    {
      k: t("الوثائق", "Documents"),
      v: docs === "✓" ? ds || t("مستلمة", "Received") : docs === "✗" ? t("لم تُستلم", "Not received") : "—",
      c:
        docs === "✓"
          ? ds === "مكتمل" || !ds
            ? "ok"
            : ds === "جزئي"
              ? "wt"
              : "no"
          : docs === "✗"
            ? "no"
            : "",
    },
    { k: t("تفعيل القياس", "Measurement"), v: live || "—", c: live === "مفعل" ? "ok" : live ? "wt" : "" },
  ];
}

function InstEntity({ it, t, onEdit }: { it: Item; t: T; onEdit?: () => void }) {
  const d = it.data;
  const ph = txt(d.phase);
  return (
    <div className="iw">
      <div className="iw-h">
        <b>{txt(d.owner) || "—"}</b>
        <span className={`iw-ph ${ph === "Phase 1" ? "p1" : ""}`}>{ph || "—"}</span>
      </div>
      <div className="iw-who">
        <span>
          {t("الاستشاري", "Consultant")} <b>{txt(d.consultant) || "—"}</b>
        </span>
        {d.phone ? <span>{txt(d.phone)}</span> : null}
        {d.email ? <span>{txt(d.email)}</span> : null}
      </div>
      <div className="iw-steps">
        {instSteps(d, t).map((st) => (
          <div className={`iw-st ${st.c}`} key={st.k}>
            <i />
            <div className="k">{st.k}</div>
            <div className="v">{st.v}</div>
          </div>
        ))}
      </div>
      <div className="iw-f">
        {d.target ? (
          <span className="tg">{`${t("مستهدف التفعيل", "Target")} ${txt(d.target)}`}</span>
        ) : (
          <span>{t("لم يُحدَّد مستهدف التفعيل", "No activation target")}</span>
        )}
        {onEdit && (
          <button className="ed" onClick={onEdit}>
            {t("تعديل", "Edit")}
          </button>
        )}
      </div>
    </div>
  );
}

/* قسم قطاع واحد — بسهم يطويه، والحالة تبقى بين الجلسات */
function InstSector({
  name, rows, t, onEdit,
}: {
  name: string; rows: Item[]; t: T; onEdit?: (it: Item) => void;
}) {
  const { open, toggle } = useCollapse(`inst:${name}`);
  if (!rows.length) return null;
  return (
    <>
      <div className="iw-sec">
        <CollapseBtn open={open} toggle={toggle} t={t} />
        <h3>{name}</h3>
        <span className="n">{`${AR(rows.length)} ${t("جهة", "entities")}`}</span>
        <span className="ln" />
      </div>
      {open && (
        <div className="iw-grid">
          {rows.map((it) => (
            <InstEntity key={it.id} it={it} t={t} onEdit={onEdit ? () => onEdit(it) : undefined} />
          ))}
        </div>
      )}
    </>
  );
}

/* صفحة المتابعة — بطاقات افتراضاً، والجدول الشامل خيار للمقارنة والتصدير */
function InstPage({ t, canEdit }: { t: T; canEdit?: boolean }) {
  const { items, loaded, save, remove, reload } = useItems("inststrat");
  const [q, setQ] = useState("");
  const [f, setF] = useState("");
  const [view, setView] = useState<"cards" | "table">("cards");
  const [edit, setEdit] = useState<Item | null>(null);
  const [draft, setDraft] = useState<Record<string, Rec>>({});

  const val = (it: Item, k: string) => txt(draft[it.id]?.[k] ?? it.data[k]);

  async function put(it: Item, k: string, v: string) {
    const data = { ...it.data, ...(draft[it.id] || {}), [k]: v, demo: false };
    setDraft((old) => ({ ...old, [it.id]: { ...(old[it.id] || {}), [k]: v } }));
    await save(it.id, data, it.ord);
  }

  const rows = useMemo(
    () =>
      items.filter((it) => {
        const d = it.data;
        const hay = `${txt(d.owner)} ${txt(d.consultant)} ${txt(d.sector)} ${txt(d.email)}`;
        if (q && !hay.includes(q)) return false;
        if (f && txt(d.sector) !== f) return false;
        return true;
      }),
    [items, q, f],
  );

  function exportXl() {
    const head = INST_COLS.map((c) => c.label);
    const body = rows.map((it) => INST_COLS.map((c) => txt(it.data[c.k])));
    download("متابعة-الاستراتيجيات-المؤسسية.xlsx", writeXlsx([{ name: "المؤسسية", rows: [head, ...body] }]));
  }

  if (!loaded) return <div className="empty">{t("جارٍ التحميل...", "Loading...")}</div>;

  /* قطاعات الملف أولاً بترتيبها، ثم أي قطاع أُضيف لاحقاً */
  const secs = [...INST_SECTORS, ...Array.from(new Set(rows.map((r) => txt(r.data.sector)))).filter(
    (x) => x && !INST_SECTORS.includes(x),
  )];

  return (
    <>
      <Toolbar q={q} setQ={setQ} filter={f} setFilter={setF} options={INST_SECTORS} onExport={exportXl} t={t} />

      <div className="iw-bar">
        <span className="iw-tog">
          <span className={view === "cards" ? "on" : ""} onClick={() => setView("cards")}>
            ◫ {t("بطاقات", "Cards")}
          </span>
          <span className={view === "table" ? "on" : ""} onClick={() => setView("table")}>
            ▤ {t("جدول", "Table")}
          </span>
        </span>
        <span className="sx-count">
          {`${t("عرض", "Showing")} ${AR(rows.length)} ${t("من", "of")} ${AR(items.length)}`}
        </span>
      </div>

      {view === "cards" ? (
        <>
          {secs.map((sc) => (
            <InstSector
              key={sc}
              name={sc}
              rows={rows.filter((r) => txt(r.data.sector) === sc)}
              t={t}
              onEdit={canEdit ? (it) => setEdit(it) : undefined}
            />
          ))}
          {!rows.length && <div className="pf-none">{t("لا توجد نتائج", "No results")}</div>}
        </>
      ) : (
        <div className="tbl-wrap">
          <table className="sx-tbl inst">
            <thead>
              <tr>
                <th className="c num">#</th>
                {INST_COLS.map((c) => (
                  <th key={c.k} style={{ minWidth: c.w }}>
                    {c.label}
                  </th>
                ))}
                {canEdit && <th className="c" />}
              </tr>
            </thead>
            <tbody>
              {rows.map((it, n) => (
                <tr key={it.id}>
                  <td className="c num">{AR(n + 1)}</td>
                  {INST_COLS.map((c) => {
                    const v = val(it, c.k);
                    const tone = instTone(c.k, v);
                    if (!canEdit)
                      return (
                        <td key={c.k} className={tone ? `cell ${tone}` : "cell"} style={{ minWidth: c.w }}>
                          {v || "—"}
                        </td>
                      );
                    return (
                      <td key={c.k} className={tone ? `cell ${tone}` : "cell"} style={{ minWidth: c.w }}>
                        {c.opts ? (
                          <select value={v} onChange={(e) => void put(it, c.k, e.target.value)}>
                            {c.opts.map((op) => (
                              <option key={op} value={op}>
                                {op || "—"}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            value={v}
                            onChange={(e) =>
                              setDraft((old) => ({ ...old, [it.id]: { ...(old[it.id] || {}), [c.k]: e.target.value } }))
                            }
                            onBlur={(e) => {
                              if (e.target.value !== txt(it.data[c.k])) void put(it, c.k, e.target.value);
                            }}
                          />
                        )}
                      </td>
                    );
                  })}
                  {canEdit && (
                    <td className="c">
                      <button
                        className="rowx"
                        title={t("حذف الصف", "Delete row")}
                        onClick={() => {
                          if (!confirm(t(`حذف «${txt(it.data.owner)}»؟`, "Delete row?"))) return;
                          void remove(it.id);
                        }}
                      >
                        ✕
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {edit && (
        <InstForm
          it={edit}
          t={t}
          onClose={() => setEdit(null)}
          onSaved={() => {
            setEdit(null);
            void reload();
          }}
          save={save}
        />
      )}
    </>
  );
}

/* نافذة تعديل جهة — كل حقل بعنوانه الكامل وقائمته */
function InstForm({
  it, t, onClose, onSaved, save,
}: {
  it: Item;
  t: T;
  onClose: () => void;
  onSaved: () => void;
  save: (id: string, data: Rec, ord: number) => Promise<string | null>;
}) {
  const [d, setD] = useState<Rec>({ ...it.data });
  const [busy, setBusy] = useState("");

  async function submit() {
    setBusy(t("جارٍ الحفظ...", "Saving..."));
    const err = await save(it.id, { ...d, demo: false }, it.ord);
    if (err) {
      setBusy(err);
      return;
    }
    onSaved();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="m-h">
          <h3>{txt(it.data.owner) || t("تعديل جهة", "Edit entity")}</h3>
          <button className="mx" onClick={onClose} aria-label="close">
            ✕
          </button>
        </div>
        <div className="iw-form">
          {INST_COLS.map((c) => (
            <label key={c.k}>
              <span>{c.label}</span>
              {c.opts ? (
                <select value={txt(d[c.k])} onChange={(e) => setD({ ...d, [c.k]: e.target.value })}>
                  {c.opts.map((op) => (
                    <option key={op} value={op}>
                      {op || "—"}
                    </option>
                  ))}
                </select>
              ) : (
                <input value={txt(d[c.k])} onChange={(e) => setD({ ...d, [c.k]: e.target.value })} />
              )}
            </label>
          ))}
          <label className="full">
            <span>{t("ملاحظة", "Note")}</span>
            <textarea rows={2} value={txt(d.note)} onChange={(e) => setD({ ...d, note: e.target.value })} />
          </label>
        </div>
        <div className="m-f">
          {busy && <span className="iw-busy">{busy}</span>}
          <button className="btn btn-ghost" onClick={onClose}>
            {t("إلغاء", "Cancel")}
          </button>
          <button className="btn" onClick={submit}>
            {t("حفظ", "Save")}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   ٥) المشاريع الاستراتيجية
   ============================================================ */
export function Projects({ t }: { t: T }) {
  const { items, loaded } = useItems("projects");
  if (!loaded) return <div className="empty">{t("جارٍ التحميل...", "Loading...")}</div>;
  if (!items.length)
    return (
      <Empty
        title={t("لا توجد مشاريع بعد", "No projects yet")}
        note={t("يُضاف المشروع ونسبتا التقدم من زر «إضافة».", "Add a project and its progress.")}
      />
    );
  return (
    <div className="sx-pjs">
      {items.map((it) => {
        const d = it.data;
        const planned = numOf(d.planned);
        const actual = numOf(d.actual);
        const g = actual - planned;
        // مشروع لم تصل بياناته بعد: لا نعرض «متقدم ٠٪» بل نقول ذلك صراحةً
        const blank = planned === 0 && actual === 0;
        return (
          <div className="sx-pj" key={it.id}>
            <div className="tile">
              <b>{AR(actual)}٪</b>
              <span>{t("الإنجاز الفعلي", "Actual")}</span>
              <em>{`${t("المخطط", "Planned")} ${AR(planned)}٪`}</em>
              {blank ? (
                <span className="sx-gap wait">{t("بانتظار البيانات", "Awaiting data")}</span>
              ) : (
                <span className={`sx-gap ${g < 0 ? "neg" : "pos"}`}>
                  {g < 0 ? `متأخر ${AR(Math.abs(g))}٪` : `متقدم ${AR(g)}٪`}
                </span>
              )}
            </div>
            <div className="bd">
              <h4>{txt(d.name) || "—"}</h4>
              <div className="meta">
                {d.status ? <span className="sx-pill">{txt(d.status)}</span> : null}
                {d.period ? <span className="m">{txt(d.period)}</span> : null}
                {numOf(d.months) > 0 ? (
                  <span className="m">{`· ${t("الشهر", "Month")} ${AR(numOf(d.elapsed))} ${t("من", "of")} ${AR(numOf(d.months))}`}</span>
                ) : null}
              </div>
              <div className="br pl">
                <div className="lb">
                  <span>{t("المخطط", "Planned")}</span>
                  <b>{AR(planned)}٪</b>
                </div>
                <div className="bar">
                  <i style={{ width: `${Math.max(0, Math.min(100, planned))}%` }} />
                </div>
              </div>
              <div className="br ac">
                <div className="lb">
                  <span>{t("الفعلي", "Actual")}</span>
                  <b>{AR(actual)}٪</b>
                </div>
                <div className="bar">
                  <i style={{ width: `${Math.max(0, Math.min(100, actual))}%` }} />
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ============================================================
   ٤) المخرجات الوطنية — فاضية حتى يُعتمد محتواها
   ============================================================ */
export function Outputs({ t }: { t: T }) {
  return (
    <Empty
      title={t("الصفحة قيد الإعداد", "Under preparation")}
      note={t(
        "بانتظار تحديد محتوى المخرجات الوطنية من الإدارة المعنية — وسيُضاف الجدول والتفاصيل بعد اعتماد البيانات.",
        "Awaiting the content of national outputs.",
      )}
    />
  );
}

/* ============================================================
   الصفحات الكاملة
   ============================================================ */
export function SectionPage({ section, canEdit, t }: { section: SectionKey; canEdit: boolean; t: T }) {
  const [editing, setEditing] = useState<Item | "new" | null>(null);
  const [nonce, setNonce] = useState(0);

  if (section === "outputs") return <Outputs t={t} />;

  return (
    <div key={nonce}>
      {canEdit && (
        <div className="sx-tools">
          <button className="btn btn-sm" onClick={() => setEditing("new")}>
            {t("إضافة", "Add")}
          </button>
        </div>
      )}
      {section === "sessions" && <SessionsPage t={t} />}
      {section === "natstrat" && <NationalPage t={t} canEdit={canEdit} />}
      {section === "inststrat" && <InstPage t={t} canEdit={canEdit} />}
      {section === "projects" && <Projects t={t} />}

      {canEdit && <ItemsEditor section={section} t={t} onChanged={() => setNonce((n) => n + 1)} />}

      {editing && (
        <ItemForm
          section={section}
          item={editing === "new" ? null : editing}
          t={t}
          onClose={(changed) => {
            setEditing(null);
            if (changed) setNonce((n) => n + 1);
          }}
        />
      )}
    </div>
  );
}

/* جدول تحرير مبسّط أسفل الصفحة — لمن يملك «تحرير بيانات هذه الأقسام» */
function ItemsEditor({ section, t, onChanged }: { section: SectionKey; t: T; onChanged: () => void }) {
  const { items, loaded, remove, reload } = useItems(section);
  const [edit, setEdit] = useState<Item | null>(null);
  if (!loaded || !items.length) return null;
  return (
    <>
      <h3 className="sx-sub">{t("تحرير البنود", "Edit items")}</h3>
      <div className="sx-edit">
        {items.map((it) => (
          <div className="sx-erow" key={it.id}>
            <span className="n">{txt(it.data.name || it.data.entity || it.id)}</span>
            <button className="btn btn-ghost btn-sm" onClick={() => setEdit(it)}>
              {t("تعديل", "Edit")}
            </button>
            <button
              className="btn btn-danger btn-sm"
              onClick={async () => {
                if (!confirm(t("حذف هذا البند نهائياً؟", "Delete permanently?"))) return;
                await remove(it.id);
                onChanged();
              }}
            >
              {t("حذف", "Delete")}
            </button>
          </div>
        ))}
      </div>
      {edit && (
        <ItemForm
          section={section}
          item={edit}
          t={t}
          onClose={(changed) => {
            setEdit(null);
            if (changed) {
              void reload();
              onChanged();
            }
          }}
        />
      )}
    </>
  );
}

/* ---------------- نافذة إدخال/تعديل بند ---------------- */
type Field = { k: string; label: string; kind?: "num" | "text" | "date" | "bool" | "area" };

const FIELDS: Record<Exclude<SectionKey, "outputs">, Field[]> = {
  sessions: [
    { k: "entity", label: "الجهة" },
    { k: "quarter", label: "الربع" },
    { k: "done", label: "عدد المراحل المكتملة", kind: "num" },
  ],
  natstrat: [
    { k: "name", label: "الاستراتيجية" },
    { k: "owner", label: "الجهة المالكة" },
    { k: "domain", label: "النطاق (التوطين · الحج · الفضاء…)" },
    { k: "stage", label: "حالة الاعتماد (1 إعداد · 2 مراجعة · 3 اللجنة · 4 مجلس الوزراء)", kind: "num" },
    { k: "tech", label: "مقبولة فنياً؟", kind: "bool" },
    { k: "meas", label: "قابلية القياس ٪", kind: "num" },
    { k: "note", label: "أبرز الملاحظات", kind: "area" },
    { k: "period", label: "فترة الاستراتيجية" },
    { k: "approvedAt", label: "تاريخ الاعتماد", kind: "date" },
    { k: "kpisRep", label: "المؤشرات الممثلة", kind: "num" },
    { k: "kpisTot", label: "إجمالي المؤشرات", kind: "num" },
    { k: "initRep", label: "المبادرات الممثلة", kind: "num" },
    { k: "initTot", label: "إجمالي المبادرات", kind: "num" },
    { k: "current", label: "الوضع الحالي", kind: "area" },
    { k: "challenge", label: "التحدي", kind: "area" },
    { k: "next", label: "الخطوات القادمة", kind: "area" },
    { k: "support", label: "الدعم المطلوب", kind: "area" },
    { k: "updated", label: "آخر تحديث", kind: "date" },
  ],
  inststrat: [
    { k: "sector", label: "القطاع" },
    { k: "owner", label: "الجهة" },
    { k: "consultant", label: "الاستشاري" },
    { k: "phone", label: "رقم الجوال" },
    { k: "email", label: "البريد الإلكتروني" },
    { k: "rep", label: "تسمية ممثل (تمت تسمية ممثل · لم يُرسل بعد)" },
    { k: "meet", label: "الاجتماع التعريفي (تم · لم يتم بعد)" },
    { k: "meetAt", label: "تاريخ الاجتماع" },
    { k: "docs", label: "استلام الوثائق (✓ · ✗)" },
    { k: "docsState", label: "حالة الوثائق (مكتمل · جزئي · لايمكن قياسه)" },
    { k: "target", label: "تفعيل القياس المستهدف (Q1..Q4)" },
    { k: "live", label: "حالة التفعيل (مفعل · غير مفعل)" },
    { k: "phase", label: "Phase 1 · Phase 2" },
    { k: "note", label: "ملاحظة", kind: "area" },
  ],
  projects: [
    { k: "name", label: "اسم المشروع" },
    { k: "status", label: "الحالة" },
    { k: "planned", label: "نسبة التقدم المخطط ٪", kind: "num" },
    { k: "actual", label: "نسبة التقدم الفعلي ٪", kind: "num" },
    { k: "period", label: "الفترة" },
    { k: "months", label: "مدة المشروع (شهر)", kind: "num" },
    { k: "elapsed", label: "الشهر الحالي", kind: "num" },
  ],
};

function ItemForm({
  section,
  item,
  t,
  onClose,
}: {
  section: SectionKey;
  item: Item | null;
  t: T;
  onClose: (changed: boolean) => void;
}) {
  const fields = FIELDS[section as Exclude<SectionKey, "outputs">] || [];
  const [form, setForm] = useState<Rec>(() => ({ ...(item?.data || {}) }));
  const [stages, setStages] = useState<{ n: string; d: string }[]>(() => {
    if (section !== "sessions") return [];
    const raw = Array.isArray(item?.data?.stages) ? item!.data.stages : [];
    return raw.length
      ? raw.map((x: Rec) => ({ n: txt(x.n), d: txt(x.d) }))
      : SESS_STAGES.map((n) => ({ n, d: "" }));
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const { save } = useItems(section, false);
  const id = useMemo(() => item?.id || "", [item]);

  async function submit() {
    setBusy(true);
    setErr("");
    const data: Rec = { ...form };
    for (const f of fields) if (f.kind === "num") data[f.k] = numOf(data[f.k]);
    if (section === "sessions") data.stages = stages;
    // علامة صريحة أن الصف صار من إدخال الإدارة، فلا يكتب عليه
    // تحديثُ البيانات المبدئية عند إعادة تشغيل ملف SQL
    data.demo = false;
    const e = await save(id, data, item?.ord ?? 100);
    setBusy(false);
    if (e) {
      setErr(e);
      return;
    }
    onClose(true);
  }

  return (
    <div className="modal-overlay" onClick={() => onClose(false)}>
      <div className="modal sx-modal" onClick={(e) => e.stopPropagation()}>
        <div className="m-h">
          <h3>{item ? t("تعديل بند", "Edit item") : t("بند جديد", "New item")}</h3>
          <button className="mx" onClick={() => onClose(false)} aria-label="close">
            ✕
          </button>
        </div>
        <div className="sx-form">
          {fields.map((f) =>
            f.kind === "bool" ? (
              <label key={f.k} className="ck">
                <input
                  type="checkbox"
                  checked={!!form[f.k]}
                  onChange={(e) => setForm({ ...form, [f.k]: e.target.checked })}
                />
                <span>{f.label}</span>
              </label>
            ) : (
              <label key={f.k}>
                <span>{f.label}</span>
                {f.kind === "area" ? (
                  <textarea
                    rows={2}
                    value={form[f.k] ?? ""}
                    onChange={(e) => setForm({ ...form, [f.k]: e.target.value })}
                  />
                ) : (
                  <input
                    type={f.kind === "num" ? "number" : "text"}
                    value={form[f.k] ?? ""}
                    placeholder={f.kind === "date" ? "YYYY-MM-DD" : ""}
                    onChange={(e) => setForm({ ...form, [f.k]: e.target.value })}
                  />
                )}
              </label>
            ),
          )}
          {section === "sessions" && (
            <div className="sx-stages">
              <div className="hd">{t("المراحل وتواريخها", "Stages & dates")}</div>
              {stages.map((s, i) => (
                <div className="rw" key={i}>
                  <input
                    value={s.n}
                    onChange={(e) => {
                      const next = [...stages];
                      next[i] = { ...next[i], n: e.target.value };
                      setStages(next);
                    }}
                  />
                  <input
                    value={s.d}
                    placeholder="YYYY-MM-DD"
                    onChange={(e) => {
                      const next = [...stages];
                      next[i] = { ...next[i], d: e.target.value };
                      setStages(next);
                    }}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
        {err && <div className="alert alert-error">{err}</div>}
        <div className="m-f">
          <button className="btn btn-ghost" onClick={() => onClose(false)}>
            {t("إلغاء", "Cancel")}
          </button>
          <button className="btn" disabled={busy} onClick={submit}>
            {busy ? t("يُحفظ...", "Saving...") : t("حفظ", "Save")}
          </button>
        </div>
      </div>
    </div>
  );
}
