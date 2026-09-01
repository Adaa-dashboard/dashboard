"use client";

import { createContext, useContext, useCallback, useEffect, useMemo, useState } from "react";
import Activity from "./Activity";
import Tasks from "./Tasks";
import WeeklyPanel from "./WeeklyPanel";
import Details from "./Details";
import { LineChart, Line as ChartLine, SECTOR_STYLES } from "./Charts";
import { latestYear, quarterlySeries, sectorSeries, yearlySeries } from "@/lib/analytics";
import { useRouter } from "next/navigation";
import { evaluate, fmtValue, fmtNum, bandOf, tint, Band, DEFAULT_BANDS } from "@/lib/calc";

/* ============ اللغة (عربي / English) ============ */
type Lang = "ar" | "en";
const LangCtx = createContext<{ lang: Lang; t: (ar: string, en: string) => string }>({
  lang: "ar",
  t: (ar) => ar,
});
function useT() {
  return useContext(LangCtx);
}

type Role = "admin" | "manager";
type Unit = "percent" | "number";

interface Me {
  id: string;
  name: string;
  phone: string;
  username?: string;
  hasPassword?: boolean;
  role: Role;
  sectorIds: string[];
}
interface Sector {
  id: string;
  name: string;
  order: number;
}
interface Indicator {
  id: string;
  name: string;
  unit: Unit;
  active: boolean;
  order: number;
}
interface Period {
  id: string;
  label: string;
  order: number;
  weekStart?: string;
}

interface Measurement {
  id: string;
  sectorId: string;
  indicatorId: string;
  periodId: string;
  target: number | null;
  actual: number | null;
  updatedAt: string;
}
interface RefData {
  sectors: Sector[];
  indicators: Indicator[];
  periods: Period[];
  statuses: Band[]; // حالات الأداء القابلة للتخصيص
  targets: Record<string, number | number[]>; // سنوي: رقم · ربعي: [ر1..ر4]
  targetMode: "annual" | "quarterly";
}

const EMPTY_REF: RefData = {
  sectors: [],
  indicators: [],
  periods: [],
  statuses: DEFAULT_BANDS,
  targets: {},
  targetMode: "annual",
};

function tkey(sectorId: string, indicatorId: string) {
  return `${sectorId}|${indicatorId}`;
}
// المستهدف السنوي (مجموع الأرباع في الوضع الربعي)
function tgtAnnual(refData: RefData, key: string): number | null {
  const t = refData.targets[key];
  if (t == null) return null;
  return Array.isArray(t) ? t.reduce((a, b) => a + (Number(b) || 0), 0) : Number(t);
}
// مستهدف ربع معيّن (1..4)
function tgtQuarter(refData: RefData, key: string, q: number): number | null {
  const t = refData.targets[key];
  if (t == null) return null;
  if (Array.isArray(t)) {
    const v = Number(t[q - 1]);
    return Number.isFinite(v) ? v : 0;
  }
  return Number(t);
}
// المستهدف المطبّق حسب الوضع (ربعي → مستهدف الربع · سنوي → السنوي)
function tgtEff(refData: RefData, key: string, q: number): number | null {
  return refData.targetMode === "quarterly" ? tgtQuarter(refData, key, q) : tgtAnnual(refData, key);
}
const GAUGE_TRACK = "#e9f1ef";

export default function Dashboard({ me }: { me: Me }) {
  const router = useRouter();
  const isAdmin = me.role === "admin";
  const [tab, setTab] = useState<string>("overview");
  const [refData, setRefData] = useState<RefData>(EMPTY_REF);
  const [loaded, setLoaded] = useState(false);
  const [lang, setLang] = useState<Lang>("ar");
  const [setOpen, setSetOpen] = useState(false);
  const t = useCallback((ar: string, en: string) => (lang === "en" ? en : ar), [lang]);
  const [pwOpen, setPwOpen] = useState(false);
  const [sheet, setSheet] = useState(false); // ورقة الإعدادات على الجوال

  useEffect(() => {
    const savedLang = typeof window !== "undefined" ? localStorage.getItem("lang") : null;
    if (savedLang === "en" || savedLang === "ar") setLang(savedLang);
    // الثيمات الداكنة القديمة أُزيلت لصالح هوية أداء — نظّف أي بقية محفوظة
    try {
      localStorage.removeItem("theme");
    } catch {
      /* ignore */
    }
    document.documentElement.removeAttribute("data-theme");
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("lang", lang);
    document.documentElement.setAttribute("dir", lang === "en" ? "ltr" : "rtl");
    try {
      localStorage.setItem("lang", lang);
    } catch {
      /* ignore */
    }
  }, [lang]);

  const loadRef = useCallback(async () => {
    const [s, i, p, st, tg] = await Promise.all([
      fetch("/api/sectors").then((r) => r.json()),
      fetch(`/api/indicators${isAdmin ? "?all=1" : ""}`).then((r) => r.json()),
      fetch("/api/periods").then((r) => r.json()),
      fetch("/api/settings").then((r) => r.json()),
      fetch("/api/targets").then((r) => r.json()),
    ]);
    setRefData({
      sectors: s.sectors || [],
      indicators: i.indicators || [],
      periods: p.periods || [],
      statuses: st.settings?.statuses?.length ? st.settings.statuses : DEFAULT_BANDS,
      targetMode: st.settings?.targetMode === "quarterly" ? "quarterly" : "annual",
      targets: tg.targets || {},
    });
    setLoaded(true);
  }, [isAdmin]);

  useEffect(() => {
    loadRef();
  }, [loadRef]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  const TITLES: Record<string, [string, string]> = {
    overview: ["نظرة عامة", "Overview"],
    details: ["المؤشرات التفصيلية", "KPI Details"],
    entry: ["المؤشرات والمستهدفات", "KPIs & Targets"],
    tasks: ["المهام والتكليفات", "Tasks"],
    report: ["الإنجاز الأسبوعي", "Weekly Achievement"],
    structure: ["القطاعات والإدارات", "Sectors"],
    users: ["المستخدمون والصلاحيات", "Users & Roles"],
  };
  const title = TITLES[tab] ?? TITLES.overview;

  function NavItem({ id, icon, label }: { id: string; icon: string; label: [string, string] }) {
    return (
      <button className={`nav-item ${tab === id ? "active" : ""}`} onClick={() => setTab(id)}>
        <span className="ic">{icon}</span> {t(label[0], label[1])}
      </button>
    );
  }
  function TabBtn({ id, icon, label }: { id: string; icon: string; label: [string, string] }) {
    return (
      <button className={`tab-btn ${tab === id ? "active" : ""}`} onClick={() => setTab(id)}>
        <span className="ic">{icon}</span>
        <span className="lb">{t(label[0], label[1])}</span>
      </button>
    );
  }
  function SheetItem({ id, label }: { id: string; label: [string, string] }) {
    return (
      <button
        className={`sheet-item ${tab === id ? "active" : ""}`}
        onClick={() => {
          setTab(id);
          setSheet(false);
        }}
      >
        {t(label[0], label[1])}
      </button>
    );
  }
  function SubItem({ id, label }: { id: string; label: [string, string] }) {
    return (
      <button className={`sub-item ${tab === id ? "active" : ""}`} onClick={() => setTab(id)}>
        {t(label[0], label[1])}
      </button>
    );
  }

  return (
    <LangCtx.Provider value={{ lang, t }}>
      <div className="shell">
        <aside className="rail">
          <div className="rail-brand">
            <div className="nm">{t("إدارة عمليات الأداء", "Performance Operations")}</div>
            <div className="sb">{t("مركز أداء", "Adaa")}</div>
          </div>

          <NavItem id="overview" icon="◱" label={["نظرة عامة", "Overview"]} />
          <NavItem id="details" icon="◎" label={["المؤشرات التفصيلية", "KPI Details"]} />
          <NavItem id="tasks" icon="✓" label={["المهام والتكليفات", "Tasks"]} />
          <NavItem id="report" icon="▤" label={["الإنجاز الأسبوعي", "Weekly Achievement"]} />

          <div className="rail-gap" />

          <button className={`nav-item ${setOpen ? "open" : ""}`} onClick={() => setSetOpen(!setOpen)}>
            <span className="ic">⚙</span> {t("الإعدادات", "Settings")} <span className="cv">▾</span>
          </button>
          <div className={`subnav ${setOpen ? "show" : ""}`}>
            {isAdmin && <SubItem id="entry" label={["المؤشرات والمستهدفات", "KPIs & Targets"]} />}
            {isAdmin && <SubItem id="users" label={["المستخدمون والصلاحيات", "Users & Roles"]} />}
            {isAdmin && <SubItem id="structure" label={["القطاعات والإدارات", "Sectors"]} />}
            {isAdmin && (
              <a className="sub-item" href="/api/export" download>
                {t("نسخة احتياطية من البيانات", "Download backup")}
              </a>
            )}
            <button className="sub-item" onClick={() => setPwOpen(true)}>
              {t("تغيير كلمة المرور", "Change password")}
            </button>
            <button className="sub-item" onClick={() => setLang(lang === "ar" ? "en" : "ar")}>
              {t("اللغة", "Language")}
              <span className="lang-chip">{lang === "ar" ? "EN" : "AR"}</span>
            </button>
          </div>

          <div className="whoami">
            <div className="av">{(me.name || "?").trim().charAt(0)}</div>
            <div>
              <div className="nm">{me.name}</div>
              <div className="rl">{isAdmin ? t("مدير الإدارة", "Admin") : t("مدير قطاع", "Sector Manager")}</div>
            </div>
            <button className="out" onClick={logout} title={t("خروج", "Logout")} aria-label="logout">
              ⏻
            </button>
          </div>
        </aside>

        <main className="main-area">
          <div className="page-head">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="hlogo" src="/adaa-logo.png" alt="أداء — المركز الوطني لقياس أداء الأجهزة العامة" />
            <div className="hsep" />
            <h1>{t(title[0], title[1])}</h1>
            <div className="grow" />
          </div>

          {!loaded ? (
            <div className="empty">{t("جارٍ التحميل...", "Loading...")}</div>
          ) : (
            <>
              {tab === "overview" && <Overview me={me} refData={refData} />}
              {tab === "details" && (
                <Details
                  isAdmin={isAdmin}
                  mySectorIds={me.sectorIds}
                  sectors={visibleSectors(me, refData)}
                  indicators={activeIndicators(refData)}
                  periods={refData.periods}
                  statuses={refData.statuses}
                  targetOf={(sid, iid, q) => tgtForScope(refData, tkey(sid, iid), q)}
                  t={t}
                  reload={loadRef}
                />
              )}
              {tab === "entry" && isAdmin && <EntrySection me={me} refData={refData} reload={loadRef} />}
              {tab === "tasks" && (
                <Tasks
                  meId={me.id}
                  isAdmin={isAdmin}
                  indicators={refData.indicators.map((i) => ({ id: i.id, name: i.name }))}
                  t={t}
                />
              )}
              {tab === "report" && <WeeklyPanel t={t} />}
              {tab === "structure" && isAdmin && <SectorsManager refData={refData} reload={loadRef} />}
              {tab === "users" && isAdmin && <UsersManager refData={refData} />}
            </>
          )}
        </main>

        {/* شريط التنقّل السفلي — يظهر على الجوال وحده بدل القائمة الجانبية */}
        <nav className="tabbar" aria-label={t("التنقل", "Navigation")}>
          <TabBtn id="overview" icon="◱" label={["الرئيسية", "Home"]} />
          <TabBtn id="details" icon="◎" label={["مؤشرات", "KPIs"]} />
          <TabBtn id="tasks" icon="✓" label={["المهام", "Tasks"]} />
          <TabBtn id="report" icon="▤" label={["الأسبوعي", "Weekly"]} />
          <button
            className={`tab-btn ${sheet ? "active" : ""}`}
            onClick={() => setSheet(true)}
            aria-label={t("الإعدادات", "Settings")}
          >
            <span className="ic">⚙</span>
            <span className="lb">{t("الإعدادات", "Settings")}</span>
          </button>
        </nav>
      </div>

      {sheet && (
        <div className="sheet-wrap" onClick={() => setSheet(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-grip" />
            <div className="sheet-me">
              <div className="av">{(me.name || "?").trim().charAt(0)}</div>
              <div>
                <div className="nm">{me.name}</div>
                <div className="rl">{isAdmin ? t("مدير الإدارة", "Admin") : t("مدير قطاع", "Sector Manager")}</div>
              </div>
            </div>
            {isAdmin && <SheetItem id="entry" label={["المؤشرات والمستهدفات", "KPIs & Targets"]} />}
            {isAdmin && <SheetItem id="users" label={["المستخدمون والصلاحيات", "Users & Roles"]} />}
            {isAdmin && <SheetItem id="structure" label={["القطاعات والإدارات", "Sectors"]} />}
            {isAdmin && (
              <a className="sheet-item" href="/api/export" download onClick={() => setSheet(false)}>
                {t("نسخة احتياطية من البيانات", "Download backup")}
              </a>
            )}
            <button
              className="sheet-item"
              onClick={() => {
                setSheet(false);
                setPwOpen(true);
              }}
            >
              {t("تغيير كلمة المرور", "Change password")}
            </button>
            <button className="sheet-item" onClick={() => setLang(lang === "ar" ? "en" : "ar")}>
              {t("اللغة", "Language")}
              <span className="lang-chip">{lang === "ar" ? "EN" : "AR"}</span>
            </button>
            <button className="sheet-item danger" onClick={logout}>
              {t("تسجيل الخروج", "Sign out")}
            </button>
          </div>
        </div>
      )}

      {pwOpen && <PasswordModal onClose={() => setPwOpen(false)} t={t} />}
    </LangCtx.Provider>
  );
}

/* ============ تغيير كلمة المرور ============ */
function PasswordModal({
  onClose,
  t,
}: {
  onClose: () => void;
  t: (ar: string, en: string) => string;
}) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    setErr("");
    setMsg("");
    if (next !== again) return setErr(t("الكلمتان غير متطابقتين", "Passwords do not match"));
    setBusy(true);
    const res = await fetch("/api/me/password", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ current, next }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setErr(d.error || t("تعذّر التغيير", "Could not change"));
    setMsg(t("تم تغيير كلمة المرور ✓", "Password changed ✓"));
    setCurrent("");
    setNext("");
    setAgain("");
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal task-modal" onClick={(e) => e.stopPropagation()}>
        <div className="m-h">
          <h3>{t("تغيير كلمة المرور", "Change password")}</h3>
          <button className="mx" onClick={onClose} aria-label="close">
            ✕
          </button>
        </div>
        <div className="m-b">
          {err && <div className="alert alert-error">{err}</div>}
          {msg && <div className="alert alert-success">{msg}</div>}
          <label>{t("كلمة المرور الحالية", "Current password")}</label>
          <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} dir="ltr" />
          <label>{t("كلمة المرور الجديدة", "New password")}</label>
          <input type="password" value={next} onChange={(e) => setNext(e.target.value)} dir="ltr" minLength={6} />
          <label>{t("تأكيد الجديدة", "Confirm new password")}</label>
          <input type="password" value={again} onChange={(e) => setAgain(e.target.value)} dir="ltr" minLength={6} />
        </div>
        <div className="m-f">
          <button className="btn" onClick={save} disabled={busy || !current || !next}>
            {busy ? t("جارٍ...", "Saving...") : t("حفظ", "Save")}
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            {t("إغلاق", "Close")}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ============ أدوات مساعدة ============ */
function visibleSectors(me: Me, refData: RefData): Sector[] {
  if (me.role === "admin") return refData.sectors;
  return refData.sectors.filter((s) => me.sectorIds.includes(s.id));
}
function activeIndicators(refData: RefData): Indicator[] {
  return refData.indicators.filter((i) => i.active);
}
// أحدث قياس لكل (قطاع×مؤشر) — القيمة التي أدخلها المستخدم آخر مرة (بغضّ النظر عن الفترة)
function latestByCell(measurements: Measurement[]): Map<string, Measurement> {
  const m = new Map<string, Measurement>();
  for (const x of measurements) {
    const k = tkey(x.sectorId, x.indicatorId);
    const prev = m.get(k);
    if (!prev || (x.updatedAt || "") > (prev.updatedAt || "")) m.set(k, x);
  }
  return m;
}
// المستهدف حسب النطاق: السنة → السنوي · ربع → مستهدف الربع
function tgtForScope(refData: RefData, key: string, scopeQ: number | null): number | null {
  return scopeQ == null ? tgtAnnual(refData, key) : tgtEff(refData, key, scopeQ);
}
// تنسيق تاريخ آخر تحديث
function fmtDate(iso: string | undefined, lang: Lang): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString(lang === "en" ? "en-US" : "ar-SA-u-nu-latn", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
// أحدث تاريخ تحديث عبر كل القياسات
function lastUpdatedOf(measurements: Measurement[]): string {
  let max = "";
  for (const x of measurements) if ((x.updatedAt || "") > max) max = x.updatedAt || "";
  return max;
}

/* ============ عدّاد نصف دائري (Gauge) ============ */
function polar(cx: number, cy: number, r: number, angleDeg: number): [number, number] {
  const a = (angleDeg * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy - r * Math.sin(a)];
}
function arc(cx: number, cy: number, r: number, v0: number, v1: number, max: number) {
  const a0 = 180 - (Math.min(v0, max) / max) * 180;
  const a1 = 180 - (Math.min(v1, max) / max) * 180;
  const [x0, y0] = polar(cx, cy, r, a0);
  const [x1, y1] = polar(cx, cy, r, a1);
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

function Gauge({
  value,
  bands,
  max = 100,
}: {
  value: number | null;
  bands: Band[];
  max?: number;
}) {
  // قوس نصف دائري: مسار رمادي، وفوقه قوس بلون الحالة بمقدار الإنجاز
  const cx = 100;
  const cy = 95;
  const r = 72;
  const sw = 15;
  const v = value == null ? 0 : Math.max(0, Math.min(value, max));
  const color = bandOf(value, bands)?.color ?? "#8a9a95";

  return (
    <div style={{ position: "relative" }}>
      <svg viewBox="0 0 200 118" width="100%" style={{ display: "block" }}>
        <path d={arc(cx, cy, r, 0, max, max)} stroke={GAUGE_TRACK} strokeWidth={sw} fill="none" strokeLinecap="round" />
        {value != null && v > 0 && (
          <path d={arc(cx, cy, r, 0, v, max)} stroke={color} strokeWidth={sw} fill="none" strokeLinecap="round" />
        )}
        <text
          x={cx}
          y={cy - 4}
          textAnchor="middle"
          fill="var(--g-900)"
          style={{ font: "800 30px 'Noto Kufi Arabic', sans-serif", direction: "ltr" }}
        >
          {value == null ? "—" : `${Math.round(value)}%`}
        </text>
      </svg>
    </div>
  );
}

/* ============ النظرة العامة ============ */
const SCOPES: { key: string; label: string; en: string; q: number | null }[] = [
  { key: "year", label: "السنة كاملة", en: "Full Year", q: null },
  { key: "q1", label: "الربع الأول", en: "Q1", q: 1 },
  { key: "q2", label: "الربع الثاني", en: "Q2", q: 2 },
  { key: "q3", label: "الربع الثالث", en: "Q3", q: 3 },
  { key: "q4", label: "الربع الرابع", en: "Q4", q: 4 },
];
function Overview({ me, refData }: { me: Me; refData: RefData }) {
  const { t, lang } = useT();
  const sectors = visibleSectors(me, refData);
  const indicators = activeIndicators(refData);
  const bands = refData.statuses;
  const [scope, setScope] = useState("year");
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [loading, setLoading] = useState(true);
  const [openSector, setOpenSector] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string | null>(null); // اسم الحالة
  const [openIndicator, setOpenIndicator] = useState<(Indicator & { num: number }) | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const d = await fetch("/api/measurements").then((r) => r.json());
    setMeasurements(d.measurements || []);
    setLoading(false);
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, [load]);

  const latest = useMemo(() => latestByCell(measurements), [measurements]);

  const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

  const scopeQ = SCOPES.find((x) => x.key === scope)?.q ?? null;
  // نسبة إنجاز (قطاع×مؤشر) = المنجز (آخر قيمة مُدخلة) ÷ المستهدف المطبّق
  const achOf = useCallback(
    (sectorId: string, indId: string): number | null => {
      const key = tkey(sectorId, indId);
      const target = tgtForScope(refData, key, scopeQ);
      if (!target || target <= 0) return null;
      const a = latest.get(key)?.actual;
      return a != null ? (a / target) * 100 : null;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [latest, refData.targets, refData.targetMode, scopeQ]
  );

  const indData = useMemo(
    () =>
      indicators.map((ind, i) => {
        const vals = sectors.map((s) => achOf(s.id, ind.id)).filter((v): v is number => v != null);
        const a = avg(vals);
        const value = a == null ? null : Math.round(a);
        const band = bandOf(a, bands);
        return { ...ind, num: i + 1, value, band, bandLabel: band?.label ?? null };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [indicators, sectors, achOf, bands]
  );

  const bandCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const b of bands) map[b.label] = 0;
    for (const d of indData) if (d.bandLabel) map[d.bandLabel] = (map[d.bandLabel] || 0) + 1;
    return map;
  }, [indData, bands]);

  const overall = useMemo(() => {
    const vals = indData.filter((d) => d.value != null).map((d) => d.value as number);
    return vals.length ? Math.round(avg(vals)!) : null;
  }, [indData]);

  const shownInd = statusFilter ? indData.filter((d) => d.bandLabel === statusFilter) : indData;

  function sectorAch(sectorId: string): number | null {
    const vals = indicators.map((ind) => achOf(sectorId, ind.id)).filter((v): v is number => v != null);
    return avg(vals) == null ? null : Math.round(avg(vals)!);
  }

  function exportCsv() {
    const header = ["القطاع", "المؤشر", "الوحدة", "المستهدف", "المنجز", "نسبة الإنجاز %", "آخر تحديث"];
    const rows: string[][] = [];
    for (const s of sectors)
      for (const ind of indicators) {
        const key = tkey(s.id, ind.id);
        const m = latest.get(key);
        const tgt = tgtForScope(refData, key, scopeQ);
        const rr = evaluate(m?.actual, tgt, bands);
        rows.push([
          s.name,
          ind.name,
          ind.unit === "percent" ? "نسبة" : "عدد",
          tgt != null ? String(tgt) : "",
          m?.actual != null ? String(m.actual) : "",
          rr.achievement != null ? String(Math.round(rr.achievement)) : "",
          fmtDate(m?.updatedAt, lang),
        ]);
      }
    const csv = [header, ...rows]
      .map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(","))
      .join("\r\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "الأداء.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  // ===== السلاسل الزمنية للأداء العام وللقطاعات =====
  const year = useMemo(() => latestYear(measurements, refData.periods), [measurements, refData.periods]);
  const [range, setRange] = useState<"quarter" | "year">("quarter");
  const targetOf = useCallback(
    (sectorId: string, indicatorId: string) => tgtAnnual(refData, tkey(sectorId, indicatorId)),
    [refData]
  );

  const overallSeries = useMemo(
    () =>
      range === "quarter"
        ? quarterlySeries(measurements, refData.periods, year, targetOf)
        : yearlySeries(measurements, refData.periods, targetOf),
    [measurements, refData.periods, year, targetOf, range]
  );

  const sectorLines: ChartLine[] = useMemo(
    () =>
      sectors.map((s, i) => ({
        name: s.name,
        color: SECTOR_STYLES[i % SECTOR_STYLES.length].color,
        dash: SECTOR_STYLES[i % SECTOR_STYLES.length].dash,
        points: sectorSeries(measurements, refData.periods, s.id, range, year, targetOf),
      })),
    [sectors, measurements, refData.periods, range, year, targetOf]
  );

  const rangeTabs = (
    <span className="vtabs">
      <button className={`vtab ${range === "quarter" ? "on" : ""}`} onClick={() => setRange("quarter")}>
        {year}
      </button>
      <button className={`vtab ${range === "year" ? "on" : ""}`} onClick={() => setRange("year")}>
        {t("كل السنوات", "All years")}
      </button>
    </span>
  );

  return (
    <div>
      <div className="toolbar">
        <div>
          <label style={{ marginBottom: 4 }}>{t("النطاق", "Scope")}</label>
          <select value={scope} onChange={(e) => setScope(e.target.value)}>
            {SCOPES.map((s) => (
              <option key={s.key} value={s.key}>
                {t(s.label, s.en)}
              </option>
            ))}
          </select>
        </div>
        <div style={{ flex: 1 }} />
        <button className="btn btn-ghost btn-sm" onClick={load}>
          {t("تحديث", "Refresh")}
        </button>
        <button className="btn btn-sm" onClick={exportCsv}>
          ⬇ {t("تصدير Excel", "Export Excel")}
        </button>
      </div>

      <div className="ov-top">
        <div className="card">
          <div className="card-top">
            <h3>{t("الأداء العام", "Overall performance")}</h3>
            {rangeTabs}
          </div>
          <LineChart
            lines={[
              {
                name: t("الأداء العام", "Overall"),
                color: "#00584c",
                dash: "",
                points: overallSeries,
              },
            ]}
            labels={overallSeries.map((p) => p.label)}
            emptyText={t("لا توجد قياسات كافية لرسم المسار بعد.", "Not enough measurements yet.")}
          />
        </div>

        <Activity t={t} />
      </div>

      <h2 className="section-title with-chips">
        {t("حالة المؤشرات", "KPI status")}
        <span className="pills">
          {bands.map((b) => (
            <button
              key={b.label}
              className={`pill ${statusFilter === b.label ? "on" : ""}`}
              style={{ ["--c" as string]: b.color }}
              onClick={() => setStatusFilter(statusFilter === b.label ? null : b.label)}
            >
              <i />
              {b.label}
              <b>{bandCounts[b.label] || 0}</b>
            </button>
          ))}
        </span>
      </h2>

      {statusFilter && (
        <div className="filter-note">
          {t("عرض حالة:", "Showing status:")} <strong>{statusFilter}</strong> {t("فقط", "only")}
          <button className="btn btn-ghost btn-sm" style={{ marginInlineStart: 10 }} onClick={() => setStatusFilter(null)}>
            {t("إظهار الكل", "Show all")}
          </button>
        </div>
      )}

      {loading ? (
        <div className="empty">{t("جارٍ التحميل...", "Loading...")}</div>
      ) : shownInd.length === 0 ? (
        <div className="empty">{t("لا توجد مؤشرات مطابقة.", "No matching KPIs.")}</div>
      ) : (
        <div className="gauge-grid">
          {shownInd.map((ind) => (
            <div
              key={ind.id}
              className="gauge-box clickable"
              style={{ borderTopColor: ind.band?.color ?? "var(--border)" }}
              onClick={() => setOpenIndicator(ind)}
            >
              <div className="gauge-head">
                
              </div>
              <div className="gauge-name" title={ind.name}>
                {ind.name}
              </div>
              <Gauge value={ind.value} bands={bands} />
              <div className="gauge-status" style={{ color: ind.band?.color ?? "#8a9a95" }}>
                {ind.bandLabel ?? "—"}
              </div>
            </div>
          ))}
        </div>
      )}

      {openIndicator && (
        <IndicatorModal
          indicator={openIndicator}
          sectors={sectors}
          latest={latest}
          scopeQ={scopeQ}
          bands={bands}
          refData={refData}
          onClose={() => setOpenIndicator(null)}
        />
      )}

      <h2 className="section-title with-chips" style={{ marginTop: 28 }}>
        {t("الأداء العام للقطاعات", "Sector performance")}
        {rangeTabs}
      </h2>
      <div className="card" style={{ marginBottom: 22 }}>
        <LineChart
          lines={sectorLines}
          labels={(sectorLines[0]?.points || []).map((p) => p.label)}
          emptyText={t("لا توجد قياسات كافية لرسم مسارات القطاعات بعد.", "Not enough measurements yet.")}
        />
      </div>

      <h2 className="section-title" style={{ marginTop: 28 }}>
        {t("تفاصيل القطاعات", "Sector Details")}
      </h2>
      <div className="sector-list">
        {sectors.map((s) => {
          const ach = sectorAch(s.id);
          const band = bandOf(ach, bands);
          const isOpen = openSector === s.id;
          return (
            <div key={s.id} className="sector-panel">
              <button className="sector-head" onClick={() => setOpenSector(isOpen ? null : s.id)}>
                <span className="sector-arrow">{isOpen ? "▼" : "◀"}</span>
                <span className="sector-name">{s.name}</span>
                <span
                  className="sector-pct"
                  style={{ background: band ? tint(band.color) : "var(--bg2)", color: band?.color ?? "#8a9a95" }}
                >
                  {ach != null ? `${ach}%` : "—"}
                </span>
              </button>
              {isOpen && (
                <SectorDetail
                  sector={s}
                  indicators={indicators}
                  latest={latest}
                  scopeQ={scopeQ}
                  bands={bands}
                  refData={refData}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DetailHead() {
  const { t } = useT();
  return (
    <>
      <th className="mini">{t("مستهدف", "Target")}</th>
      <th className="mini">{t("منجز", "Done")}</th>
      <th className="mini">{t("الإنجاز", "%")}</th>
      <th className="mini">{t("آخر تحديث", "Last update")}</th>
    </>
  );
}

function DetailCells({
  target,
  actual,
  pct,
  updated,
  bg,
  color,
}: {
  target: string;
  actual: string;
  pct: string;
  updated: string;
  bg: string;
  color: string;
}) {
  return (
    <>
      <td className="mini">{target}</td>
      <td className="mini">{actual}</td>
      <td className="mini" style={{ background: bg, color, fontWeight: 700 }}>
        {pct}
      </td>
      <td className="mini muted">{updated || "—"}</td>
    </>
  );
}

function SectorDetail({
  sector,
  indicators,
  latest,
  scopeQ,
  bands,
  refData,
}: {
  sector: Sector;
  indicators: Indicator[];
  latest: Map<string, Measurement>;
  scopeQ: number | null;
  bands: Band[];
  refData: RefData;
}) {
  const { t, lang } = useT();
  return (
    <div className="sector-detail" style={{ overflowX: "auto" }}>
      <table className="detail-table">
        <thead>
          <tr className="sub-head">
            <th className="ind-col">{t("المؤشر", "KPI")}</th>
            <DetailHead />
          </tr>
        </thead>
        <tbody>
          {indicators.map((ind, i) => {
            const key = tkey(sector.id, ind.id);
            const m = latest.get(key);
            const tgt = tgtForScope(refData, key, scopeQ);
            const r = evaluate(m?.actual, tgt, bands);
            return (
              <tr key={ind.id}>
                <td className="ind-col">
                  <strong>KPI {i + 1}</strong> · {ind.name}{" "}
                  <span className="muted">({ind.unit === "percent" ? "%" : t("عدد", "num")})</span>
                </td>
                <DetailCells
                  target={fmtValue(tgt, ind.unit)}
                  actual={fmtValue(m?.actual, ind.unit)}
                  pct={r.achievement != null ? `${Math.round(r.achievement)}%` : "—"}
                  updated={fmtDate(m?.updatedAt, lang)}
                  bg={r.bg}
                  color={r.color}
                />
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function IndicatorModal({
  indicator,
  sectors,
  latest,
  scopeQ,
  bands,
  refData,
  onClose,
}: {
  indicator: Indicator & { num: number };
  sectors: Sector[];
  latest: Map<string, Measurement>;
  scopeQ: number | null;
  bands: Band[];
  refData: RefData;
  onClose: () => void;
}) {
  const { t, lang } = useT();
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 920 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>KPI {indicator.num}</div>
            <h3 style={{ margin: "4px 0 0" }}>{indicator.name}</h3>
            <div className="muted" style={{ fontSize: 13 }}>
              {t("المنجز مقابل المستهدف لكل قطاع", "Done vs target per sector")} ·{" "}
              {indicator.unit === "percent" ? t("نسبة %", "percent %") : t("عدد", "number")}
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>
            {t("إغلاق", "Close")}
          </button>
        </div>

        <div className="sector-detail" style={{ overflowX: "auto", marginTop: 16, padding: 0 }}>
          <table className="detail-table">
            <thead>
              <tr className="sub-head">
                <th className="ind-col">{t("القطاع", "Sector")}</th>
                <DetailHead />
              </tr>
            </thead>
            <tbody>
              {sectors.map((s) => {
                const key = tkey(s.id, indicator.id);
                const m = latest.get(key);
                const tgt = tgtForScope(refData, key, scopeQ);
                const r = evaluate(m?.actual, tgt, bands);
                return (
                  <tr key={s.id}>
                    <td className="ind-col">{s.name}</td>
                    <DetailCells
                      target={fmtValue(tgt, indicator.unit)}
                      actual={fmtValue(m?.actual, indicator.unit)}
                      pct={r.achievement != null ? `${Math.round(r.achievement)}%` : "—"}
                      updated={fmtDate(m?.updatedAt, lang)}
                      bg={r.bg}
                      color={r.color}
                    />
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ============ إدخال البيانات ============ */
function DataEntry({ me, refData, reload }: { me: Me; refData: RefData; reload: () => void }) {
  const { t, lang } = useT();
  const sectors = visibleSectors(me, refData);
  const indicators = activeIndicators(refData);
  const bands = refData.statuses;
  const [sectorId, setSectorId] = useState(sectors[0]?.id || "");
  const [vals, setVals] = useState<Record<string, string>>({}); // المنجز فقط
  const [updated, setUpdated] = useState<Record<string, string>>({}); // آخر تحديث لكل مؤشر
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const targetOf = (indId: string): number | null => tgtAnnual(refData, tkey(sectorId, indId));

  const loadVals = useCallback(async () => {
    if (!sectorId) {
      setVals({});
      setUpdated({});
      return;
    }
    const d = await fetch(`/api/measurements?sectorId=${sectorId}`).then((r) => r.json());
    // أحدث قيمة لكل مؤشر (بغضّ النظر عن الفترة)
    const byInd = new Map<string, Measurement>();
    for (const m of (d.measurements || []) as Measurement[]) {
      const prev = byInd.get(m.indicatorId);
      if (!prev || (m.updatedAt || "") > (prev.updatedAt || "")) byInd.set(m.indicatorId, m);
    }
    const map: Record<string, string> = {};
    const upd: Record<string, string> = {};
    for (const [iid, m] of byInd) {
      map[iid] = m.actual != null ? String(m.actual) : "";
      upd[iid] = m.updatedAt || "";
    }
    setVals(map);
    setUpdated(upd);
  }, [sectorId]);

  useEffect(() => {
    loadVals();
  }, [loadVals]);

  function setVal(indId: string, v: string) {
    setVals((s) => ({ ...s, [indId]: v }));
  }

  // فترة واحدة ثابتة تُخزَّن فيها القيم الحالية (تُنشأ مرة واحدة إن لم توجد)
  async function ensureCurrentPeriodId(): Promise<string> {
    if (refData.periods.length > 0) return refData.periods[0].id;
    const res = await fetch("/api/periods", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "التحديث" }),
    });
    const d = await res.json();
    if (!res.ok || !d.period) throw new Error(d.error || "تعذّر التهيئة");
    return d.period.id as string;
  }

  async function save() {
    setErr("");
    setMsg("");
    setLoading(true);
    try {
      const pid = await ensureCurrentPeriodId();
      // المنجز = القيمة المُدخَلة مباشرةً (المستهدف ثابت من شاشة المستهدفات)
      const items = indicators.map((ind) => ({
        sectorId,
        indicatorId: ind.id,
        periodId: pid,
        target: targetOf(ind.id) ?? "",
        actual: vals[ind.id] ?? "",
      }));
      const res = await fetch("/api/measurements", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const data = await res.json();
      if (!res.ok) setErr(data.error || "تعذّر الحفظ");
      else {
        setMsg("تم الحفظ بنجاح ✓");
        reload();
        loadVals();
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "تعذّر الحفظ");
    } finally {
      setLoading(false);
    }
  }

  if (sectors.length === 0) {
    return (
      <div className="empty">
        {t(
          "لم تُسنَد إليك أي قطاعات حتى الآن. يُرجى التواصل مع مدير الإدارة لإسناد القطاعات.",
          "No sectors have been assigned to you yet. Please contact the administrator."
        )}
      </div>
    );
  }

  return (
    <div className="card">
      <h2 className="section-title">{t("إدخال المنجَز", "Data Entry")}</h2>
      <p className="muted" style={{ marginTop: -8, marginBottom: 14 }}>
        {t(
          "يُرجى تحديد القطاع، ثم إدخال القيمة الإجمالية المنجَزة لكل مؤشر (القيمة التراكمية الحالية تُدخَل كرقم مباشر). علمًا بأن المستهدف يُضبط من تبويب «المستهدفات» ويبقى ثابتًا.",
          "Select the sector, then enter the total achieved value for each KPI (enter the current cumulative value directly as a number). The target is set in the Targets tab and remains fixed."
        )}
      </p>
      <div className="row" style={{ marginBottom: 18 }}>
        <div>
          <label>{t("القطاع", "Sector")}</label>
          <select value={sectorId} onChange={(e) => setSectorId(e.target.value)}>
            {sectors.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {err && <div className="alert alert-error">{err}</div>}
      {msg && <div className="alert alert-success">{msg}</div>}

      <div className="entry-cards">
        {indicators.map((ind, i) => {
          const tgt = targetOf(ind.id);
          const av = vals[ind.id] ?? "";
          const r = evaluate(av === "" ? null : Number(av), tgt, bands);
          return (
            <div className="entry-card" key={ind.id}>
              <div className="ec-title">
                <span className="ec-num">KPI {i + 1}</span>
                {ind.name}
              </div>
              <div className="ec-boxes">
                <div className="ec-box">
                  <label>{t("المستهدف (ثابت)", "Target (fixed)")}</label>
                  <input
                    type="number"
                    value={tgt != null ? String(tgt) : ""}
                    placeholder="—"
                    disabled
                    title={t("يُضبط من تبويب المستهدفات", "Set from the Targets tab")}
                    readOnly
                  />
                </div>
                <div className="ec-box">
                  <label>{t("المنجز (القيمة التراكمية)", "Done (cumulative value)")}</label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    placeholder="—"
                    value={av}
                    onChange={(e) => setVal(ind.id, e.target.value)}
                  />
                </div>
              </div>
              <div className="ec-status">
                <span className="badge" style={{ background: r.bg, color: r.color }}>
                  {r.achievement != null ? `${Math.round(r.achievement)}% · ${r.label}` : t("لم يُعبّأ", "Not filled")}
                </span>
                {updated[ind.id] && (
                  <span className="muted" style={{ fontSize: 11, marginInlineStart: 8 }}>
                    {t("آخر تحديث:", "Last update:")} {fmtDate(updated[ind.id], lang)}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 18 }}>
        <button className="btn" onClick={save} disabled={loading}>
          {loading ? t("جارٍ الحفظ...", "Saving...") : t("حفظ", "Save")}
        </button>
      </div>
    </div>
  );
}

/* ============ قسم إدخال البيانات (مع تبويبات الإدارة) ============ */
function EntrySection({ me, refData, reload }: { me: Me; refData: RefData; reload: () => void }) {
  const { t } = useT();
  const isAdmin = me.role === "admin";
  const [sub, setSub] = useState<"entry" | "indicators" | "targets" | "thresholds">("entry");
  return (
    <div>
      {isAdmin && (
        <div className="tabs" style={{ marginBottom: 16 }}>
          <button className={`tab ${sub === "entry" ? "active" : ""}`} onClick={() => setSub("entry")}>
            {t("الإدخال", "Entry")}
          </button>
          <button className={`tab ${sub === "indicators" ? "active" : ""}`} onClick={() => setSub("indicators")}>
            {t("المؤشرات", "KPIs")}
          </button>
          <button className={`tab ${sub === "targets" ? "active" : ""}`} onClick={() => setSub("targets")}>
            {t("المستهدفات", "Targets")}
          </button>
          <button className={`tab ${sub === "thresholds" ? "active" : ""}`} onClick={() => setSub("thresholds")}>
            {t("عتبات الحالة", "Status Bands")}
          </button>
        </div>
      )}
      {sub === "entry" && <DataEntry me={me} refData={refData} reload={reload} />}
      {sub === "indicators" && isAdmin && <IndicatorsManager refData={refData} reload={reload} />}
      {sub === "targets" && isAdmin && <TargetsManager refData={refData} reload={reload} />}
      {sub === "thresholds" && isAdmin && <StatusBandsManager refData={refData} reload={reload} />}
    </div>
  );
}

/* ============ المستهدفات (سنوي / ربعي) ============ */
const QUARTER_LABELS = ["Q1", "Q2", "Q3", "Q4"];
function TargetsManager({ refData, reload }: { refData: RefData; reload: () => void }) {
  const { t } = useT();
  const sectors = refData.sectors;
  const indicators = refData.indicators;
  const [mode, setMode] = useState<"annual" | "quarterly">(refData.targetMode);
  // القيم السنوية
  const [aVals, setAVals] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const [k, v] of Object.entries(refData.targets || {})) {
      init[k] = Array.isArray(v) ? String(v.reduce((a, b) => a + (Number(b) || 0), 0)) : String(v);
    }
    return init;
  });
  // القيم الربعية [ر1..ر4]
  const [qVals, setQVals] = useState<Record<string, string[]>>(() => {
    const init: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(refData.targets || {})) {
      init[k] = Array.isArray(v) ? v.map((x) => String(x)) : [String(v), "", "", ""];
    }
    return init;
  });
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const setA = (key: string, v: string) => setAVals((s) => ({ ...s, [key]: v }));
  const setQ = (key: string, qi: number, v: string) =>
    setQVals((s) => {
      const cur = s[key] ? [...s[key]] : ["", "", "", ""];
      cur[qi] = v;
      return { ...s, [key]: cur };
    });

  async function save() {
    setMsg("");
    setErr("");
    setLoading(true);
    try {
      const targets: Record<string, number | number[]> = {};
      for (const s of sectors)
        for (const ind of indicators) {
          const key = tkey(s.id, ind.id);
          if (mode === "annual") {
            const n = Number(aVals[key]);
            if (aVals[key] && Number.isFinite(n) && n > 0) targets[key] = n;
          } else {
            const arr = (qVals[key] || ["", "", "", ""]).map((x) => Number(x) || 0);
            if (arr.some((x) => x > 0)) targets[key] = arr;
          }
        }
      await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetMode: mode }),
      });
      const res = await fetch("/api/targets", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targets }),
      });
      const d = await res.json();
      if (!res.ok) setErr(d.error || "تعذّر الحفظ");
      else {
        setMsg("تم حفظ المستهدفات ✓");
        reload();
      }
    } finally {
      setLoading(false);
    }
  }

  if (sectors.length === 0 || indicators.length === 0) {
    return (
      <div className="empty">
        {t("يُرجى إضافة القطاعات والمؤشرات أولًا، ثم ضبط المستهدفات.", "Please add sectors and KPIs first, then set targets.")}
      </div>
    );
  }

  return (
    <div className="card">
      <h2 className="section-title">{t("المستهدفات (عدد الجهات لكل قطاع × مؤشر)", "Targets (entities per sector × KPI)")}</h2>
      <p className="muted" style={{ marginTop: -8, marginBottom: 12 }}>
        {t(
          "يُرجى تحديد نوع المستهدف: سنوي (قيمة واحدة للسنة كاملة) أو ربعي (قيمة مستقلة لكل ربع).",
          "Choose the target type: Annual (one value for the whole year) or Quarterly (a separate value per quarter)."
        )}
      </p>
      <div className="mode-toggle" style={{ marginBottom: 14 }}>
        <button className={mode === "annual" ? "on" : ""} onClick={() => setMode("annual")}>
          {t("سنوي", "Annual")}
        </button>
        <button className={mode === "quarterly" ? "on" : ""} onClick={() => setMode("quarterly")}>
          {t("ربعي", "Quarterly")}
        </button>
      </div>
      {err && <div className="alert alert-error">{err}</div>}
      {msg && <div className="alert alert-success">{msg}</div>}

      {mode === "annual" ? (
        <div style={{ overflowX: "auto" }}>
          <table className="matrix">
            <thead>
              <tr>
                <th style={{ textAlign: "right", minWidth: 200 }}>{t("المؤشر", "KPI")}</th>
                {sectors.map((s) => (
                  <th key={s.id}>{s.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {indicators.map((ind, i) => (
                <tr key={ind.id}>
                  <td style={{ textAlign: "right" }}>
                    <span className="muted">KPI {i + 1}</span> · {ind.name}
                  </td>
                  {sectors.map((s) => (
                    <td key={s.id}>
                      <input
                        type="number"
                        min="0"
                        style={{ width: 80, textAlign: "center" }}
                        value={aVals[tkey(s.id, ind.id)] ?? ""}
                        onChange={(e) => setA(tkey(s.id, ind.id), e.target.value)}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="q-cards">
          {indicators.map((ind, i) => (
            <div className="card" key={ind.id} style={{ overflowX: "auto", marginBottom: 12 }}>
              <div className="ec-title" style={{ minHeight: "auto", marginBottom: 8 }}>
                <span className="ec-num">KPI {i + 1}</span>
                {ind.name}
              </div>
              <table className="matrix">
                <thead>
                  <tr>
                    <th style={{ textAlign: "right", minWidth: 140 }}>{t("القطاع", "Sector")}</th>
                    {QUARTER_LABELS.map((q) => (
                      <th key={q}>{q}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sectors.map((s) => (
                    <tr key={s.id}>
                      <td style={{ textAlign: "right" }}>{s.name}</td>
                      {QUARTER_LABELS.map((_, qi) => (
                        <td key={qi}>
                          <input
                            type="number"
                            min="0"
                            style={{ width: 64, textAlign: "center" }}
                            value={(qVals[tkey(s.id, ind.id)] || [])[qi] ?? ""}
                            onChange={(e) => setQ(tkey(s.id, ind.id), qi, e.target.value)}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        <button className="btn" onClick={save} disabled={loading}>
          {loading ? t("جارٍ الحفظ...", "Saving...") : t("حفظ المستهدفات", "Save Targets")}
        </button>
      </div>
    </div>
  );
}

function StatusBandsManager({ refData, reload }: { refData: RefData; reload: () => void }) {
  const { t } = useT();
  const [list, setList] = useState<Band[]>(() =>
    (refData.statuses.length ? refData.statuses : DEFAULT_BANDS).map((b) => ({ ...b }))
  );
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  function upd(i: number, patch: Partial<Band>) {
    setList((s) => s.map((b, idx) => (idx === i ? { ...b, ...patch } : b)));
  }
  function add() {
    const last = list[list.length - 1];
    setList((s) => [...s, { label: "حالة جديدة", color: "#3b82f6", from: last ? last.from + 10 : 0 }]);
  }
  function remove(i: number) {
    setList((s) => s.filter((_, idx) => idx !== i));
  }

  async function save() {
    setMsg("");
    setErr("");
    const statuses = list
      .filter((b) => b.label.trim())
      .map((b) => ({ label: b.label.trim(), color: b.color, from: Number(b.from) || 0 }));
    if (statuses.length === 0) {
      setErr("أضف حالة واحدة على الأقل");
      return;
    }
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ statuses }),
    });
    const d = await res.json();
    if (!res.ok) setErr(d.error || "تعذّر الحفظ");
    else {
      setMsg("تم حفظ الحالات ✓");
      reload();
    }
  }

  const sorted = [...list].sort((a, b) => a.from - b.from);

  return (
    <div className="card">
      <h2 className="section-title">{t("حالات الأداء (الألوان والنِّسَب)", "Performance Statuses (colors & thresholds)")}</h2>
      <p className="muted" style={{ marginTop: -8, marginBottom: 16 }}>
        {t(
          "تُحدَّد لكل حالة تسمية ولون ونسبة البداية. ويُصنَّف كل مؤشر ضمن أعلى حالة تكون نسبة بدايتها مساويةً لنسبة الإنجاز المحقَّقة أو أقل منها.",
          "Each status has a label, color, and starting percentage. Every KPI is classified under the highest status whose starting percentage is less than or equal to the achieved percentage."
        )}
      </p>
      {err && <div className="alert alert-error">{err}</div>}
      {msg && <div className="alert alert-success">{msg}</div>}

      {list.map((b, i) => (
        <div key={i} className="band-row">
          <input
            type="color"
            className="band-color"
            value={/^#[0-9a-fA-F]{6}$/.test(b.color) ? b.color : "#3b82f6"}
            onChange={(e) => upd(i, { color: e.target.value })}
            title={t("اللون", "Color")}
          />
          <input
            className="band-label"
            placeholder={t("اسم الحالة", "Status name")}
            value={b.label}
            onChange={(e) => upd(i, { label: e.target.value })}
          />
          <div className="band-from">
            <span className="muted">{t("من %", "from %")}</span>
            <input
              type="number"
              min="0"
              value={String(b.from)}
              onChange={(e) => upd(i, { from: Number(e.target.value) })}
            />
          </div>
          <button className="btn btn-danger btn-sm" onClick={() => remove(i)}>
            {t("حذف", "Delete")}
          </button>
        </div>
      ))}

      <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
        <button className="btn btn-ghost" onClick={add}>
          + {t("إضافة حالة", "Add status")}
        </button>
        <button className="btn" onClick={save}>
          {t("حفظ الحالات", "Save Statuses")}
        </button>
      </div>

      <div className="muted" style={{ marginTop: 14, fontSize: 12 }}>
        {t("معاينة:", "Preview:")}{" "}
        {sorted.map((b, i) => (
          <span
            key={i}
            style={{
              background: tint(b.color),
              color: b.color,
              padding: "3px 10px",
              borderRadius: 8,
              fontWeight: 700,
              marginInlineEnd: 6,
              display: "inline-block",
            }}
          >
            {b.label} ≥ {b.from}%
          </span>
        ))}
      </div>
    </div>
  );
}

function SectorsManager({ refData, reload }: { refData: RefData; reload: () => void }) {
  const { t } = useT();
  const [name, setName] = useState("");
  const [err, setErr] = useState("");
  async function add() {
    setErr("");
    const res = await fetch("/api/sectors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const d = await res.json();
    if (!res.ok) setErr(d.error || "خطأ");
    else {
      setName("");
      reload();
    }
  }
  async function rename(id: string, current: string) {
    const v = prompt("اسم القطاع الجديد:", current);
    if (v && v.trim()) {
      await fetch(`/api/sectors/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: v }),
      });
      reload();
    }
  }
  async function remove(id: string) {
    if (!confirm("حذف القطاع سيحذف قياساته. متابعة؟")) return;
    await fetch(`/api/sectors/${id}`, { method: "DELETE" });
    reload();
  }
  return (
    <div className="card">
      <h2 className="section-title">{t("القطاعات", "Sectors")} ({refData.sectors.length}/7)</h2>
      {err && <div className="alert alert-error">{err}</div>}
      <div className="row" style={{ marginBottom: 16 }}>
        <input placeholder={t("اسم القطاع", "Sector name")} value={name} onChange={(e) => setName(e.target.value)} />
        <div style={{ flex: "0 0 auto" }}>
          <button className="btn" onClick={add} disabled={refData.sectors.length >= 7}>
            {t("إضافة قطاع", "Add sector")}
          </button>
        </div>
      </div>
      <table>
        <thead>
          <tr>
            <th>{t("القطاع", "Sector")}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {refData.sectors.map((s) => (
            <tr key={s.id}>
              <td>{s.name}</td>
              <td>
                <div style={{ display: "flex", gap: 6 }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => rename(s.id, s.name)}>
                    {t("تعديل", "Edit")}
                  </button>
                  <button className="btn btn-danger btn-sm" onClick={() => remove(s.id)}>
                    {t("حذف", "Delete")}
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface EditableInd {
  id: string;
  name: string;
  unit: Unit;
  active: boolean;
}
function IndicatorsManager({ refData, reload }: { refData: RefData; reload: () => void }) {
  const { t } = useT();
  const [list, setList] = useState<EditableInd[]>(
    refData.indicators.map((i) => ({ id: i.id, name: i.name, unit: i.unit, active: i.active }))
  );
  const [msg, setMsg] = useState("");

  function upd(i: number, patch: Partial<EditableInd>) {
    setList((s) => s.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  }
  function addInd() {
    setList((s) => [...s, { id: "", name: "", unit: "percent", active: true }]);
  }
  function removeInd(i: number) {
    setList((s) => s.filter((_, idx) => idx !== i));
  }
  async function save() {
    setMsg("");
    const res = await fetch("/api/indicators", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ indicators: list.filter((x) => x.name.trim()) }),
    });
    if (res.ok) {
      setMsg("تم حفظ المؤشرات ✓");
      reload();
    }
  }
  return (
    <div className="card">
      <h2 className="section-title">{t("المؤشرات", "KPIs")} ({list.length})</h2>
      <p className="muted" style={{ marginTop: -8, marginBottom: 16 }}>
        {t(
          'يمكن إضافة المؤشرات أو تعديلها أو حذفها. تُختار "عدد" للمؤشرات الرقمية و"نسبة" للمؤشرات المئوية.',
          'You can add, edit, or delete KPIs. Choose "number" for numeric KPIs and "percent" for percentage KPIs.'
        )}
      </p>
      {msg && <div className="alert alert-success">{msg}</div>}
      {list.map((ind, i) => (
        <div key={i} className="field-row">
          <span className="muted" style={{ flex: "0 0 46px" }}>
            KPI {i + 1}
          </span>
          <input placeholder={t("اسم المؤشر", "KPI name")} value={ind.name} onChange={(e) => upd(i, { name: e.target.value })} />
          <select
            value={ind.unit}
            onChange={(e) => upd(i, { unit: e.target.value as Unit })}
            style={{ flex: "0 0 110px" }}
          >
            <option value="percent">{t("نسبة %", "percent %")}</option>
            <option value="number">{t("عدد", "number")}</option>
          </select>
          <label className="checkbox-inline">
            <input type="checkbox" checked={ind.active} onChange={(e) => upd(i, { active: e.target.checked })} />
            {t("مُفعّل", "Active")}
          </label>
          <button className="btn btn-danger btn-sm" style={{ flex: "0 0 auto" }} onClick={() => removeInd(i)}>
            {t("حذف", "Delete")}
          </button>
        </div>
      ))}
      <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
        <button className="btn btn-ghost" onClick={addInd}>
          + {t("إضافة مؤشر", "Add KPI")}
        </button>
        <button className="btn" onClick={save}>
          {t("حفظ المؤشرات", "Save KPIs")}
        </button>
      </div>
    </div>
  );
}

/* ============ المدراء والصلاحيات ============ */
interface UserRow {
  id: string;
  phone: string;
  username?: string;
  hasPassword?: boolean;
  name: string;
  role: Role;
  active: boolean;
  sectorIds: string[];
}
function UsersManager({ refData }: { refData: RefData }) {
  const { t } = useT();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("manager");
  const [sectorIds, setSectorIds] = useState<string[]>([]);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    const d = await fetch("/api/users").then((r) => r.json());
    setUsers(d.users || []);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  function toggleSector(id: string) {
    setSectorIds((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setMsg("");
    const res = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phone,
        name,
        username,
        password,
        role,
        sectorIds: role === "manager" ? sectorIds : [],
      }),
    });
    const d = await res.json();
    if (!res.ok) setErr(d.error || "خطأ");
    else {
      setMsg(`تمت إضافة ${d.user.name} ✓`);
      setPhone("");
      setName("");
      setUsername("");
      setPassword("");
      setRole("manager");
      setSectorIds([]);
      load();
    }
  }

  async function patch(id: string, body: object) {
    setErr("");
    setMsg("");
    const res = await fetch(`/api/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) setErr(d.error || "تعذّر الحفظ");
    load();
  }

  async function remove(u: UserRow) {
    if (!confirm(`حذف ${u.name}؟`)) return;
    const res = await fetch(`/api/users/${u.id}`, { method: "DELETE" });
    const d = await res.json();
    if (!res.ok) alert(d.error || "تعذّر الحذف");
    else load();
  }

  const term = q.trim().toLowerCase();
  const shown = term
    ? users.filter(
        (u) =>
          u.name.toLowerCase().includes(term) ||
          (u.username || "").toLowerCase().includes(term) ||
          u.phone.includes(term)
      )
    : users;

  const sectorNames = (ids: string[]) =>
    ids.map((id) => refData.sectors.find((s) => s.id === id)?.name).filter(Boolean).join("، ") || "—";

  return (
    <div>
      <div className="card" style={{ marginBottom: 24 }}>
        <h2 className="section-title">{t("إضافة مستخدم", "Add User")}</h2>
        <p className="muted" style={{ marginTop: -8, marginBottom: 16 }}>
          {t(
            "مدير القطاع = يدخل بيانات قطاعاته فقط. مدير الإدارة = صلاحيات كاملة على كل القطاعات. اترك كلمة المرور فارغة وأعطِه اسم المستخدم فقط — يختار كلمته بنفسه عند أول دخول.",
            "Sector Manager = assigned sectors only. Admin = full access. Leave the password blank and hand over the username only — the owner picks their password at first sign-in."
          )}
        </p>
        {err && <div className="alert alert-error">{err}</div>}
        {msg && <div className="alert alert-success">{msg}</div>}
        <form onSubmit={add}>
          <div className="row">
            <div>
              <label>{t("رقم الجوال", "Phone number")}</label>
              <input
                type="tel"
                inputMode="tel"
                placeholder="05XXXXXXXX"
                value={phone}
                dir="ltr"
                style={{ textAlign: "left" }}
                onChange={(e) => setPhone(e.target.value)}
                required
              />
            </div>
            <div>
              <label>{t("الاسم", "Name")}</label>
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <label>{t("اسم المستخدم", "Username")}</label>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                dir="ltr"
                style={{ textAlign: "left" }}
                autoComplete="off"
              />
            </div>
            <div>
              <label>
                {t("كلمة المرور", "Password")}{" "}
                <span className="opt">{t("(اختيارية)", "(optional)")}</span>
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                dir="ltr"
                style={{ textAlign: "left" }}
                autoComplete="new-password"
                minLength={6}
                placeholder={t("اتركها فارغة ليختارها هو", "Leave blank — the owner sets it")}
              />
            </div>
            <div style={{ flex: "0 0 170px" }}>
              <label>{t("الصلاحية", "Role")}</label>
              <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
                <option value="manager">{t("مدير قطاع", "Sector Manager")}</option>
                <option value="admin">{t("مدير الإدارة", "Admin")}</option>
              </select>
            </div>
          </div>
          {role === "manager" && (
            <div className="field" style={{ marginTop: 12 }}>
              <label>{t("القطاعات المسؤول عنها", "Assigned sectors")}</label>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                {refData.sectors.map((s) => (
                  <label key={s.id} className="checkbox-inline">
                    <input type="checkbox" checked={sectorIds.includes(s.id)} onChange={() => toggleSector(s.id)} />
                    {s.name}
                  </label>
                ))}
              </div>
            </div>
          )}
          <button className="btn" style={{ marginTop: 12 }}>
            {t("إضافة", "Add")}
          </button>
        </form>
      </div>

      <div className="users-bar">
        <h2 className="section-title" style={{ margin: 0 }}>
          {t("المستخدمون", "Users")} ({shown.length}
          {shown.length !== users.length ? ` / ${users.length}` : ""})
        </h2>
        <input
          className="users-q"
          placeholder={t("بحث بالاسم أو اسم المستخدم…", "Search by name or username…")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <table className="users-tbl">
        <thead>
          <tr>
            <th>{t("الاسم", "Name")}</th>
            <th>{t("اسم المستخدم", "Username")}</th>
            <th>{t("الحساب", "Account")}</th>
            <th>{t("رقم الجوال", "Phone")}</th>
            <th>{t("الصلاحية", "Role")}</th>
            <th>{t("القطاعات", "Sectors")}</th>
            <th>{t("الحالة", "Status")}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {shown.map((u) => (
            <tr key={u.id}>
              <td className="u-name">{u.name}</td>
              <td dir="ltr" style={{ textAlign: "right" }} data-l={t("اسم المستخدم", "Username")}>
                {u.username || <span className="muted">—</span>}
              </td>
              <td data-l={t("الحساب", "Account")}>
                {u.hasPassword ? (
                  <span className="badge badge-manager">{t("مفعّل", "Active")}</span>
                ) : (
                  <span className="badge badge-off">{t("بانتظار التفعيل", "Awaiting setup")}</span>
                )}
              </td>
              <td dir="ltr" style={{ textAlign: "right" }} data-l={t("رقم الجوال", "Phone")}>
                {u.phone}
              </td>
              <td data-l={t("الصلاحية", "Role")}>
                <span className={`badge ${u.role === "admin" ? "badge-admin" : "badge-manager"}`}>
                  {u.role === "admin" ? t("مدير الإدارة", "Admin") : t("مدير قطاع", "Sector Manager")}
                </span>
              </td>
              <td data-l={t("القطاعات", "Sectors")}>
                {u.role === "manager" ? sectorNames(u.sectorIds) : t("الكل", "All")}
              </td>
              <td data-l={t("الحالة", "Status")}>
                {u.active ? (
                  <span className="badge badge-manager">{t("نشط", "Active")}</span>
                ) : (
                  <span className="badge badge-off">{t("موقوف", "Disabled")}</span>
                )}
              </td>
              <td>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <button className="btn btn-sm" onClick={() => setEditing(u)}>
                    {t("تعديل الصلاحيات", "Edit access")}
                  </button>
                  <button className="btn btn-danger btn-sm" onClick={() => remove(u)}>
                    {t("حذف", "Delete")}
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {editing && (
        <EditUserModal
          user={editing}
          sectors={refData.sectors}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}

/* ============ تعديل صلاحيات مستخدم ============ */
function EditUserModal({
  user,
  sectors,
  onClose,
  onSaved,
}: {
  user: UserRow;
  sectors: Sector[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useT();
  const [name, setName] = useState(user.name);
  const [username, setUsername] = useState(user.username || "");
  const [role, setRole] = useState<Role>(user.role);
  const [ids, setIds] = useState<string[]>(user.sectorIds || []);
  const [active, setActive] = useState(user.active);
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  function toggle(id: string) {
    setIds((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  async function send(body: object, okMsg: string): Promise<boolean> {
    setBusy(true);
    setErr("");
    setMsg("");
    const res = await fetch(`/api/users/${user.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setErr(d.error || t("تعذّر الحفظ", "Could not save"));
      return false;
    }
    setMsg(okMsg);
    return true;
  }

  async function save() {
    const ok = await send(
      {
        name,
        username,
        role,
        sectorIds: role === "manager" ? ids : [],
        active,
        password: pw || undefined,
      },
      t("حُفظ ✓", "Saved ✓")
    );
    if (ok) onSaved();
  }

  // إعادة التعيين تمسح كلمة المرور فيعود الحساب «بانتظار التفعيل»،
  // ويختار صاحبه كلمة جديدة بنفسه من شاشة الدخول — فلا تمرّ كلمة مرور بأحد غيره.
  async function resetPassword() {
    if (
      !window.confirm(
        t(
          "إعادة تعيين كلمة المرور؟ سيختار صاحب الحساب كلمة جديدة بنفسه عند أول دخول.",
          "Reset the password? The account owner will choose a new one at next sign-in."
        )
      )
    )
      return;
    if (await send({ clearPassword: true }, t("أُعيد التعيين ✓", "Reset ✓"))) onSaved();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal task-modal" onClick={(e) => e.stopPropagation()}>
        <div className="m-h">
          <h3>
            {t("تعديل الصلاحيات", "Edit access")} — {user.name}
          </h3>
          <button className="mx" onClick={onClose} aria-label="close">
            ✕
          </button>
        </div>
        <div className="m-b">
          {err && <div className="alert alert-error">{err}</div>}
          {msg && <div className="alert alert-success">{msg}</div>}

          <label>{t("الاسم الظاهر في الحساب", "Display name")}</label>
          <input value={name} onChange={(e) => setName(e.target.value)} />

          <label>{t("اسم المستخدم", "Username")}</label>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            dir="ltr"
            style={{ textAlign: "left" }}
            autoComplete="off"
          />

          <label>{t("الصلاحية", "Role")}</label>
          <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="manager">{t("مدير قطاع", "Sector Manager")}</option>
            <option value="admin">{t("مدير الإدارة — صلاحية كاملة", "Admin — full access")}</option>
          </select>

          {role === "manager" && (
            <>
              <label>{t("القطاعات المسؤول عنها", "Assigned sectors")}</label>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 4 }}>
                {sectors.map((sc) => (
                  <label key={sc.id} className="checkbox-inline">
                    <input type="checkbox" checked={ids.includes(sc.id)} onChange={() => toggle(sc.id)} />
                    {sc.name}
                  </label>
                ))}
              </div>
            </>
          )}

          <label style={{ marginTop: 14 }}>{t("حالة الحساب", "Account status")}</label>
          <label className="checkbox-inline">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            {t("نشط (يستطيع الدخول)", "Active (can sign in)")}
          </label>

          <label style={{ marginTop: 14 }}>
            {t("كلمة المرور", "Password")}{" "}
            <span className="opt">
              {user.hasPassword
                ? t("(مفعّلة — اتركها فارغة لتبقى كما هي)", "(set — leave blank to keep)")
                : t("(بانتظار التفعيل — يختارها صاحب الحساب)", "(awaiting setup — the owner chooses it)")}
            </span>
          </label>
          <input
            type="password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            placeholder={t("اتركها فارغة إن لم ترد تغييرها", "Leave blank to keep")}
            dir="ltr"
            style={{ textAlign: "left" }}
            autoComplete="new-password"
          />
          {user.hasPassword && (
            <button
              className="btn btn-ghost btn-sm"
              style={{ marginTop: 10, alignSelf: "flex-start" }}
              onClick={resetPassword}
              disabled={busy}
            >
              {t("إعادة تعيين كلمة المرور", "Reset password")}
            </button>
          )}
        </div>
        <div className="m-f">
          <button className="btn" onClick={save} disabled={busy}>
            {busy ? t("جارٍ الحفظ...", "Saving...") : t("حفظ", "Save")}
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            {t("إغلاق", "Close")}
          </button>
        </div>
      </div>
    </div>
  );
}
