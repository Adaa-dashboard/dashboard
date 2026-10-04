"use client";

/* ============================================================
   جرس التنبيهات — ما يخصّني ويحتاج تصرّفاً
   ------------------------------------------------------------
   الصندوق في زاوية الترويسة مع الحاسبة والتقويم. يجمع من مصادر
   المنصة ما يعني صاحب الحساب وحده:

     · مهمةٌ أو تكليفٌ أُسند إليه — متأخرٌ أو قاربت مدّته
     · موعدٌ في تقويمه خلال أيام
     · طلبات تغيير على جهاته — جديدةٌ أو تجاوزت مدّتها
     · مراجعةُ جهات التواصل المستحقّة عليه هذا الربع
     · إعلانٌ نُشر ولم يره بعد

   **الأولوية بالفعل لا بالمصدر**: المتأخر أولاً ثم المستحقّ اليوم
   ثم ما يقترب. والعدّاد الأحمر لا يحمل إلا ما استحقّ التصرّف —
   فالعدد الذي لا ينقص لا يُقرأ.

   وما رآه يُعلَّم مقروءاً في متصفحه وحده (`localStorage`): تنبيهٌ
   مشتقٌّ من حالةٍ قائمة لا «رسالةٌ» تُحفظ، فلا محلّ له في القاعدة.
   ============================================================ */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { nrm } from "@/lib/commit";

type T = (ar: string, en: string) => string;

export type Alert = {
  id: string;
  /** late متأخر · today اليوم · soon يقترب · info خبرٌ يُعلم به */
  kind: "late" | "today" | "soon" | "info";
  group: string;
  title: string;
  sub: string;
  /** عدد الأيام: سالبٌ للمتأخر */
  days: number | null;
  /** التبويب الذي يفتحه الضغط */
  tab?: string;
};

const SEEN_KEY = "adaa_bell_seen";

const todayStr = () => new Date().toISOString().slice(0, 10);
function dayDiff(a: string, b: string): number {
  const x = new Date(a + "T00:00:00").getTime();
  const y = new Date(b + "T00:00:00").getTime();
  if (!Number.isFinite(x) || !Number.isFinite(y)) return 0;
  return Math.round((x - y) / 86400000);
}
function arDays(n: number): string {
  const d = Math.abs(n);
  if (d === 0) return "اليوم";
  if (d === 1) return "يوم واحد";
  if (d === 2) return "يومان";
  if (d <= 10) return `${d} أيام`;
  return `${d} يوماً`;
}
/** نصّ المدّة: متأخرٌ بكذا، أو باقٍ كذا */
const whenTxt = (days: number | null): string =>
  days === null ? "" : days < 0 ? `متأخر ${arDays(days)}` : days === 0 ? "اليوم" : `خلال ${arDays(days)}`;

const RANK: Record<Alert["kind"], number> = { late: 0, today: 1, soon: 2, info: 3 };

type TaskRow = {
  id: string; title: string; dueDate?: string; state?: string; kind?: string;
  assigneeId?: string; createdById?: string;
};
type ChangeRow = { code?: string; owner?: string; item?: string; sla?: number | null; workDays?: number | null };
type Tick = { id: string; body: string; tone: string; byName: string };

export function useBell(meId: string, meName: string, extra: Alert[] = []) {
  const [base, setBase] = useState<Alert[]>([]);
  const [seen, setSeen] = useState<string[]>([]);

  /* مواعيد التقويم تُمرَّر من الشريط وتُدمج هنا — لا تُعدّ خارج
     الجرس: العدّاد الذي يُحسب في مكانٍ و«المقروء» في مكانٍ آخر
     لا ينقص أبداً مهما فُتحت اللوحة */
  const alerts = useMemo(
    () => [...extra, ...base].sort((a, b) => RANK[a.kind] - RANK[b.kind] || (a.days ?? 99) - (b.days ?? 99)),
    [extra, base],
  );

  useEffect(() => {
    try {
      const v = JSON.parse(localStorage.getItem(SEEN_KEY) || "[]");
      if (Array.isArray(v)) setSeen(v.map(String));
    } catch {
      /* متصفّحٌ يمنع التخزين — تظهر التنبيهات كلها جديدة، ولا ضرر */
    }
  }, []);

  const load = useCallback(async () => {
    const now = todayStr();
    const out: Alert[] = [];
    const get = (p: string) =>
      apiFetch(p).then((r) => r.json()).catch(() => ({} as Record<string, unknown>));

    const [tk, ch, rv, an, ents] = await Promise.all([
      get("/api/tasks"),
      get("/api/changes"),
      get("/api/entities/review"),
      get("/api/ticker"),
      get("/api/entities/mine"),
    ]);

    /* جهاتي: ما أنا نقطةُ تواصلها الأساسية — فطلبات غيري لا
       تُحتسب عليّ ولا تُنبّهني */
    const mineNames = new Set(
      ((Array.isArray(ents.mine) ? ents.mine : []) as { name?: string; myRole?: string }[])
        .filter((e) => (e.myRole || "أساسي") !== "بديل")
        .map((e) => nrm(e.name || ""))
        .filter(Boolean),
    );

    /* ١) مهامي وتكاليفي — المسندة إليّ وغير المنتهية */
    for (const x of (Array.isArray(tk.tasks) ? tk.tasks : []) as TaskRow[]) {
      if (String(x.assigneeId || "") !== String(meId)) continue;
      if (x.state === "done") continue;
      const isAsg = x.kind === "assignment";
      const d = x.dueDate ? dayDiff(x.dueDate, now) : null;
      if (d !== null && d > 7) continue;
      out.push({
        id: "t" + x.id,
        kind: d === null ? "info" : d < 0 ? "late" : d === 0 ? "today" : "soon",
        group: isAsg ? "تكاليف أُسندت إليك" : "مهام أُسندت إليك",
        title: x.title,
        sub: x.dueDate ? `تنتهي ${x.dueDate} · ${whenTxt(d)}` : "بلا موعد",
        days: d,
        tab: "tasks",
      });
    }

    /* ٢) طلبات التغيير على جهاتي — ما تجاوز مدّته وما قارب */
    const crs = ((Array.isArray(ch.changes) ? ch.changes : []) as (ChangeRow & { status?: string })[])
      .filter((c) => c.status === "open" && mineNames.has(nrm(c.owner || "")));
    const late = crs.filter((c) => c.sla != null && c.workDays != null && Number(c.workDays) >= Number(c.sla));
    const near = crs.filter(
      (c) => c.sla != null && c.workDays != null &&
        Number(c.workDays) < Number(c.sla) && Number(c.sla) - Number(c.workDays) <= 2,
    );
    if (late.length)
      out.push({
        id: "cr-late",
        kind: "late",
        group: "طلبات التغيير",
        title: `${late.length} طلباً تجاوز مدّته`,
        sub: [...new Set(late.map((c) => String(c.owner || "")))].slice(0, 3).join(" · ") || "جهاتك",
        days: -1,
        tab: "changes",
      });
    if (near.length)
      out.push({
        id: "cr-near",
        kind: "soon",
        group: "طلبات التغيير",
        title: `${near.length} طلباً تقترب مدّته`,
        sub: [...new Set(near.map((c) => String(c.owner || "")))].slice(0, 3).join(" · ") || "جهاتك",
        days: 2,
        tab: "changes",
      });

    /* ٣) مراجعة جهات التواصل المستحقّة عليّ هذا الربع */
    const due = (Array.isArray(rv.due) ? rv.due : []) as { entity?: string }[];
    if (due.length)
      out.push({
        id: "rev-" + due.length,
        kind: "today",
        group: "جهات التواصل",
        title: `${due.length} جهة تحتاج مراجعة بياناتها`,
        sub: due.slice(0, 3).map((x) => String(x.entity || "")).filter(Boolean).join(" · "),
        days: 0,
        tab: "entities",
      });

    /* ٤) إعلانٌ نُشر — خبرٌ يُعلم به، والعاجل منه يستحقّ التصرّف */
    for (const a of (Array.isArray(an.ticker) ? an.ticker : []) as Tick[]) {
      out.push({
        id: "a" + a.id,
        kind: a.tone === "red" ? "today" : "info",
        group: "إعلانات",
        title: a.body,
        sub: a.byName,
        days: null,
      });
    }

    setBase(out);
  }, [meId]);

  useEffect(() => {
    void load();
    const id = setInterval(() => {
      if (!document.hidden) void load();
    }, 120000);
    return () => clearInterval(id);
  }, [load]);

  /* العدّاد: ما يستحقّ التصرّف ولم يُرَ بعد — الخبر المحض لا يُعدّ */
  const unread = useMemo(
    () => alerts.filter((a) => a.kind !== "info" && !seen.includes(a.id)).length,
    [alerts, seen],
  );

  const markSeen = useCallback(() => {
    const ids = alerts.map((a) => a.id);
    setSeen(ids);
    try {
      localStorage.setItem(SEEN_KEY, JSON.stringify(ids));
    } catch {
      /* لا يُخزَّن — تُعاد القراءة في الزيارة القادمة */
    }
  }, [alerts]);

  return { alerts, unread, markSeen, reload: load, meName };
}

/* ---------------- الزرّ واللوحة ---------------- */
export default function Bell({
  alerts,
  unread,
  markSeen,
  t,
  onGo,
}: {
  alerts: Alert[];
  unread: number;
  markSeen: () => void;
  t: T;
  /** فتح التبويب الذي يعالج التنبيه */
  onGo?: (tab: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement | null>(null);
  const btn = useRef<HTMLButtonElement | null>(null);

  /* موضع اللوحة يُقاس ولا يُفترض: الزرّ قد يكون في طرف الشاشة
     يميناً أو يساراً حسب عرض الترويسة وما فيها، فمحاذاتُه بجهةٍ
     ثابتة تُخرج نصف اللوحة عن الحافة وتُقصّ. تُحاذى طرفَ الزرّ ثم
     تُحبس داخل النافذة بثماني بكسلات من كل جانب. */
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const el = btn.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const w = Math.min(360, window.innerWidth * 0.86);
      const want = document.dir === "rtl" ? r.right - w : r.left;
      const left = Math.max(8, Math.min(want, window.innerWidth - w - 8));
      setPos({ top: r.bottom + 8, left });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const shut = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", shut);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", shut);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  /* يُعلَّم مقروءاً بعد ثانيتين على الشاشة لا بمجرّد الفتح —
     فما مرّت عليه العين فعلاً هو المقروء */
  useEffect(() => {
    if (!open || !unread) return;
    const id = setTimeout(markSeen, 2000);
    return () => clearTimeout(id);
  }, [open, unread, markSeen]);

  /* المجموعات بترتيب أول تنبيهٍ فيها — فالمتأخر يصدّر مجموعته */
  const groups = useMemo(() => {
    const m = new Map<string, Alert[]>();
    for (const a of alerts) m.set(a.group, [...(m.get(a.group) || []), a]);
    return [...m.entries()];
  }, [alerts]);

  return (
    <div className="bell" ref={wrap}>
      <button
        ref={btn}
        className={`tl-b bell-b ${open ? "on" : ""}`}
        onClick={() => setOpen((v) => !v)}
        title={t("التنبيهات", "Alerts")}
        aria-label={t("التنبيهات", "Alerts")}
      >
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unread > 0 && <b className="tl-badge">{unread}</b>}
      </button>

      {open && (
        <div className="bell-p" style={pos ? { top: pos.top, left: pos.left } : { visibility: "hidden" }}>
          <div className="bell-h">
            <b>{t("التنبيهات", "Alerts")}</b>
            <span>{t(`${alerts.length} بنداً`, `${alerts.length} items`)}</span>
          </div>
          {!alerts.length ? (
            <div className="bell-none">{t("لا شيء يحتاج تصرّفاً الآن.", "Nothing needs you right now.")}</div>
          ) : (
            <div className="bell-list">
              {groups.map(([g, list]) => (
                <div className="bell-g" key={g}>
                  <div className="gh">{g}</div>
                  {list.map((a) => (
                    <button
                      className={`bell-i ${a.kind}`}
                      key={a.id}
                      onClick={() => {
                        if (a.tab && onGo) {
                          onGo(a.tab);
                          setOpen(false);
                        }
                      }}
                    >
                      <i />
                      <span className="n">{a.title}</span>
                      {a.sub && <em>{a.sub}</em>}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
