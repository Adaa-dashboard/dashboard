"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import { loadUserData, saveUserData } from "@/lib/userdata";
import { EMPTY_NOTES, firstLine, whenAr, type NotesData } from "./Notes";
import { Cal } from "./Tools";
import Activity from "./Activity";
import { bandOf, evaluate, type Band } from "@/lib/calc";
import { can as hasScope } from "@/lib/scopes";

/* ============================================================
   «صفحتي» — لوحة يركّبها كل مستخدم لنفسه.
   يختار البطاقات التي تهمّه ويرتّبها، ويُحفظ الاختيار في مخزنه
   الشخصي فيتبعه على أي جهاز. البطاقات لا تعرض إلا ما يراه أصلاً.
   ============================================================ */

type Me = { id: string; name: string; role: string; sectorIds: string[]; scopes: string[] };
type RefLike = {
  sectors: { id: string; name: string }[];
  indicators: { id: string; name: string; unit: "percent" | "number" }[];
  statuses: Band[];
  targets: Record<string, number | number[]>;
};
type M = { sectorId: string; indicatorId: string; target: number | null; actual: number | null; updatedAt: string };
type Task = {
  id: string; title: string; assigneeId: string; createdById: string;
  dueDate: string; state: string; kind?: string; priority: string;
};
type Change = { code: string; itemName: string; owner: string; sla: number | null; workDays: number | null; status: string };

export type WidgetKey =
  | "summary" | "kpis" | "tasks" | "assignments" | "changes" | "activity" | "notes" | "calendar";

type Cfg = { title: string; widgets: WidgetKey[] };
const DEFAULT_CFG: Cfg = { title: "صفحتي", widgets: ["summary", "tasks", "notes", "calendar"] };

const CATALOG: { key: WidgetKey; label: string; note: string; needs?: string }[] = [
  { key: "summary", label: "ملخص سريع", note: "أرقام مهامك ومؤشراتك في سطر" },
  { key: "kpis", label: "مؤشرات قطاعاتي", note: "المستهدف مقابل المنجز", needs: "overview" },
  { key: "tasks", label: "مهامي", note: "المفتوحة والأقرب موعداً", needs: "tasks" },
  { key: "assignments", label: "تكليفاتي", note: "الواردة من جهة أعلى", needs: "assignments" },
  { key: "changes", label: "طلبات التغيير المتأخرة", note: "ما تجاوز مدّته", needs: "changes" },
  { key: "activity", label: "آخر التحديثات", note: "ما استجدّ في اللوحة" },
  { key: "notes", label: "ملاحظاتي", note: "آخر ما كتبته" },
  { key: "calendar", label: "تقويم الشهر", note: "مواعيد مهامك" },
];

function annualTarget(targets: RefLike["targets"], key: string): number | null {
  const v = targets[key];
  if (v == null) return null;
  return Array.isArray(v) ? v.reduce((a, b) => a + (Number(b) || 0), 0) : Number(v);
}
const todayISO = () => new Date().toISOString().slice(0, 10);
const daysTo = (d: string) => Math.round((new Date(d).getTime() - new Date(todayISO()).getTime()) / 86400000);

export default function MyPage({
  me,
  refData,
  t,
}: {
  me: Me;
  refData: RefLike;
  t: (ar: string, en: string) => string;
}) {
  const [cfg, setCfg] = useState<Cfg>(DEFAULT_CFG);
  const [loaded, setLoaded] = useState(false);
  const [edit, setEdit] = useState(false);
  const [ms, setMs] = useState<M[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [changes, setChanges] = useState<Change[]>([]);
  const [notes, setNotes] = useState<NotesData>(EMPTY_NOTES);

  const seesChanges = hasScope(me.scopes, "changes");
  const allowed = useMemo(
    () => CATALOG.filter((c) => !c.needs || hasScope(me.scopes, c.needs as never)),
    [me.scopes]
  );

  useEffect(() => {
    loadUserData<Cfg>("mypage", DEFAULT_CFG).then((d) => {
      setCfg({
        title: d.title || DEFAULT_CFG.title,
        widgets: Array.isArray(d.widgets) ? d.widgets : DEFAULT_CFG.widgets,
      });
      setLoaded(true);
    });
    loadUserData<NotesData>("notes", EMPTY_NOTES).then((d) =>
      setNotes({ folders: d.folders || [], notes: d.notes || [] })
    );
  }, []);

  const load = useCallback(async () => {
    const [m, tk, ch] = await Promise.all([
      apiFetch("/api/measurements").then((r) => r.json()),
      apiFetch("/api/tasks").then((r) => r.json()),
      seesChanges ? apiFetch("/api/changes").then((r) => r.json()) : Promise.resolve({ changes: [] }),
    ]);
    const mine = (sid: string) => hasScope(me.scopes, "details:all") || me.sectorIds.includes(sid);
    setMs(((m.measurements || []) as M[]).filter((x) => mine(x.sectorId)));
    setTasks(
      ((tk.tasks || []) as Task[]).filter((x) => x.assigneeId === me.id || x.createdById === me.id)
    );
    setChanges((ch.changes || []) as Change[]);
  }, [me.id, me.sectorIds, me.scopes, seesChanges]);

  useEffect(() => {
    load();
  }, [load]);

  function save(next: Cfg) {
    setCfg(next);
    saveUserData("mypage", next);
  }
  function toggle(k: WidgetKey) {
    save({
      ...cfg,
      widgets: cfg.widgets.includes(k) ? cfg.widgets.filter((x) => x !== k) : [...cfg.widgets, k],
    });
  }
  function move(k: WidgetKey, dir: -1 | 1) {
    const i = cfg.widgets.indexOf(k);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= cfg.widgets.length) return;
    const w = [...cfg.widgets];
    [w[i], w[j]] = [w[j], w[i]];
    save({ ...cfg, widgets: w });
  }

  /* ---------- محتوى البطاقات ---------- */
  const myTasks = tasks.filter((x) => (x.kind === "assignment" ? "assignment" : "task") === "task");
  const myAsg = tasks.filter((x) => x.kind === "assignment");
  const lateChanges = changes.filter(
    (c) => c.status === "open" && c.sla != null && c.workDays != null && c.workDays >= c.sla
  );

  const kpiRows = ms
    .map((m) => {
      const ind = refData.indicators.find((i) => i.id === m.indicatorId);
      const sec = refData.sectors.find((s) => s.id === m.sectorId);
      const tgt = m.target ?? annualTarget(refData.targets, `${m.sectorId}|${m.indicatorId}`);
      const r = evaluate(m.actual, tgt, refData.statuses);
      return {
        key: `${m.sectorId}|${m.indicatorId}`,
        name: ind?.name || "",
        sector: sec?.name || "",
        actual: m.actual,
        target: tgt,
        pct: r.achievement == null ? null : Math.round(r.achievement),
        color: bandOf(r.achievement, refData.statuses)?.color || "#8a9a95",
      };
    })
    .sort((a, b) => (a.pct ?? 999) - (b.pct ?? 999));

  function TaskList({ list, empty }: { list: Task[]; empty: string }) {
    const open = list
      .filter((x) => x.state !== "done")
      .sort((a, b) => (a.dueDate || "").localeCompare(b.dueDate || ""))
      .slice(0, 6);
    if (!open.length) return <div className="mp-empty">{empty}</div>;
    return (
      <ul className="mp-list">
        {open.map((x) => {
          const d = x.dueDate ? daysTo(x.dueDate) : null;
          const late = d != null && d < 0;
          return (
            <li key={x.id}>
              <i style={{ background: late ? "#d34a4a" : x.state === "risk" ? "#e0971a" : "#1a9d5c" }} />
              <span className="n">{x.title}</span>
              <span className={`d ${late ? "late" : ""}`}>
                {d == null
                  ? "—"
                  : late
                    ? t(`متأخرة ${-d} يوم`, `${-d}d late`)
                    : d === 0
                      ? t("تنتهي اليوم", "due today")
                      : t(`باقٍ ${d} يوم`, `${d}d left`)}
              </span>
            </li>
          );
        })}
      </ul>
    );
  }

  function widget(k: WidgetKey) {
    switch (k) {
      case "summary":
        return (
          <div className="card mp-w" key={k}>
            <h3>{t("ملخص سريع", "At a glance")}</h3>
            <div className="mp-nums">
              <span>
                <b>{myTasks.filter((x) => x.state !== "done").length}</b>
                {t("مهام مفتوحة", "open tasks")}
              </span>
              <span className="bad">
                <b>{myTasks.filter((x) => x.state !== "done" && x.dueDate && daysTo(x.dueDate) < 0).length}</b>
                {t("متأخرة", "overdue")}
              </span>
              <span>
                <b>{myAsg.filter((x) => x.state !== "done").length}</b>
                {t("تكليفات", "assignments")}
              </span>
              {seesChanges && (
                <span className="bad">
                  <b>{lateChanges.length}</b>
                  {t("طلبات متأخرة", "late requests")}
                </span>
              )}
              <span>
                <b>{notes.notes.length}</b>
                {t("ملاحظات", "notes")}
              </span>
            </div>
          </div>
        );
      case "kpis":
        return (
          <div className="card mp-w" key={k}>
            <h3>{t("مؤشرات قطاعاتي", "My KPIs")}</h3>
            {kpiRows.length === 0 ? (
              <div className="mp-empty">{t("لا قياسات بعد.", "No measurements yet.")}</div>
            ) : (
              <ul className="mp-kpis">
                {kpiRows.slice(0, 8).map((r) => (
                  <li key={r.key}>
                    <span className="n" title={r.name}>
                      {r.name}
                    </span>
                    <span className="bar">
                      <i style={{ width: `${Math.min(100, r.pct ?? 0)}%`, background: r.color }} />
                    </span>
                    <b style={{ color: r.color }}>{r.pct == null ? "—" : `${r.pct}%`}</b>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      case "tasks":
        return (
          <div className="card mp-w" key={k}>
            <h3>{t("مهامي", "My tasks")}</h3>
            <TaskList list={myTasks} empty={t("لا مهام مفتوحة عليك.", "Nothing open.")} />
          </div>
        );
      case "assignments":
        return (
          <div className="card mp-w" key={k}>
            <h3>{t("تكليفاتي", "My assignments")}</h3>
            <TaskList list={myAsg} empty={t("لا تكليفات عليك.", "No assignments.")} />
          </div>
        );
      case "changes":
        return (
          <div className="card mp-w" key={k}>
            <h3>{t("طلبات التغيير المتأخرة", "Overdue change requests")}</h3>
            {lateChanges.length === 0 ? (
              <div className="mp-empty">{t("لا طلبات متأخرة.", "None overdue.")}</div>
            ) : (
              <ul className="mp-list">
                {lateChanges.slice(0, 6).map((c) => (
                  <li key={c.code}>
                    <i style={{ background: "#d34a4a" }} />
                    <span className="n">{c.itemName || c.code}</span>
                    <span className="d late">{c.owner}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      case "activity":
        return (
          <div className="mp-w" key={k}>
            <Activity t={t} />
          </div>
        );
      case "notes":
        return (
          <div className="card mp-w" key={k}>
            <h3>{t("ملاحظاتي", "My notes")}</h3>
            {notes.notes.length === 0 ? (
              <div className="mp-empty">
                {t("لا ملاحظات — افتحي 📝 من أعلى الصفحة.", "No notes yet — open 📝 above.")}
              </div>
            ) : (
              <ul className="mp-notes">
                {[...notes.notes]
                  .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""))
                  .slice(0, 5)
                  .map((n) => (
                    <li key={n.id}>
                      <b>{firstLine(n)}</b>
                      <span>{whenAr(n.updatedAt)}</span>
                    </li>
                  ))}
              </ul>
            )}
          </div>
        );
      case "calendar":
        return (
          <div className="card mp-w mp-cal" key={k}>
            <h3>{t("تقويم الشهر", "This month")}</h3>
            <Cal t={t} meId={me.id} />
          </div>
        );
      default:
        return null;
    }
  }

  const active = cfg.widgets.filter((k) => allowed.some((a) => a.key === k));

  return (
    <div>
      <div className="toolbar">
        <div>
          <label style={{ marginBottom: 4 }}>{t("اسم الصفحة", "Page name")}</label>
          <input
            value={cfg.title}
            onChange={(e) => setCfg({ ...cfg, title: e.target.value })}
            onBlur={() => save(cfg)}
            style={{ maxWidth: 240 }}
          />
        </div>
        <div style={{ flex: 1 }} />
        <button className="btn btn-ghost btn-sm" onClick={load}>
          {t("تحديث", "Refresh")}
        </button>
        <button className={`btn btn-sm ${edit ? "btn-ghost" : ""}`} onClick={() => setEdit(!edit)}>
          {edit ? t("تمّ", "Done") : t("⚙ تخصيص الصفحة", "⚙ Customise")}
        </button>
      </div>

      {edit && (
        <div className="card mp-pick">
          <h3>{t("اختاري ما يظهر في صفحتك", "Pick what appears")}</h3>
          <div className="mp-cat">
            {allowed.map((c) => {
              const on = cfg.widgets.includes(c.key);
              return (
                <div key={c.key} className={`mp-opt ${on ? "on" : ""}`}>
                  <label>
                    <input type="checkbox" checked={on} onChange={() => toggle(c.key)} />
                    <span>
                      <b>{c.label}</b>
                      <i>{c.note}</i>
                    </span>
                  </label>
                  {on && (
                    <span className="mp-ord">
                      <button onClick={() => move(c.key, -1)} title={t("لأعلى", "Up")}>
                        ↑
                      </button>
                      <button onClick={() => move(c.key, 1)} title={t("لأسفل", "Down")}>
                        ↓
                      </button>
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          <p className="mp-hint">
            {t(
              "الاختيار يُحفظ لك وحدك ويتبعك على أي جهاز. ولا تظهر إلا البطاقات التي تملك صلاحيتها.",
              "Saved to your account only. Cards you lack permission for never appear."
            )}
          </p>
        </div>
      )}

      {!loaded ? (
        <div className="empty">{t("جارٍ التحميل...", "Loading...")}</div>
      ) : active.length === 0 ? (
        <div className="soon">
          <b>{t("صفحتك فارغة", "Your page is empty")}</b>
          {t("اضغطي «تخصيص الصفحة» واختاري ما يهمّك.", "Press Customise and pick what matters to you.")}
        </div>
      ) : (
        <div className="mp-grid">{active.map((k) => widget(k))}</div>
      )}
    </div>
  );
}
