// بناء تقرير الإنجاز الأسبوعي من بيانات اللوحة نفسها.
// كل قسم يُشتق من مصدره: المؤشرات من القياسات، والمنجزات من المهام
// المكتملة هذا الأسبوع، والتحديات من المتعثرة، والخطة من المستحقة القادمة.

import { computeAchievement } from "@/lib/calc";
import {
  Indicator,
  Measurement,
  Sector,
  Task,
  User,
  getSettings,
  listIndicators,
  listMeasurements,
  listSectors,
  listTasks,
  listUsers,
  getTargets,
  targetKey,
} from "@/lib/db";

export interface WeeklySector {
  id: string;
  name: string;
  target: number | null;
  actual: number | null;
  achievement: number | null;
  color: string;
}

export interface WeeklyKpi {
  id: string;
  name: string;
  unit: "percent" | "number";
  target: number | null;
  actual: number | null;
  achievement: number | null;
  delta: number | null; // الفرق عن الأسبوع الماضي بالنقاط
  color: string;
  sectors: WeeklySector[];
  history: (number | null)[]; // ست نقاط: آخر ستة أسابيع حتى نهاية هذا الأسبوع
}

export interface WeeklyTaskRow {
  id: string;
  title: string;
  who: string;
  due: string;
  state: "ok" | "risk" | "done" | "late";
  lastUpdate: string;
}

export interface WeeklyReport {
  weekStart: string;
  weekEnd: string;
  overall: number | null;
  overallDelta: number | null;
  overallColor: string;
  overallHistory: (number | null)[];
  kpis: WeeklyKpi[];
  tasks: WeeklyTaskRow[];
  achievements: string[];
  challenges: { title: string; plan: string; who: string }[];
  nextWeek: string[];
  generatedAt: string;
}

/** بداية الأسبوع (الأحد) لتاريخ معيّن. */
export function weekStartOf(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  const day = d.getUTCDay(); // 0 = الأحد
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}
export function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function latestUpTo(list: Measurement[], cutoff: string): Map<string, Measurement> {
  const map = new Map<string, Measurement>();
  for (const m of list) {
    const at = (m.updatedAt || "").slice(0, 10);
    if (at && at > cutoff) continue;
    const k = `${m.sectorId}|${m.indicatorId}`;
    const cur = map.get(k);
    if (!cur || (m.updatedAt || "") > (cur.updatedAt || "")) map.set(k, m);
  }
  return map;
}

function avg(vals: number[]): number | null {
  if (!vals.length) return null;
  return Math.round(vals.reduce((s, v) => s + v, 0) / vals.length);
}

/** الحالة اللونية لنسبة إنجاز حسب نطاقات الإعدادات. */
function colorFor(achievement: number | null, bands: { from: number; color: string }[]): string {
  if (achievement == null) return "#8a9a95";
  const sorted = [...bands].sort((a, b) => a.from - b.from);
  let match = sorted[0];
  for (const b of sorted) if (achievement >= b.from) match = b;
  return match?.color || "#8a9a95";
}

export async function buildWeekly(weekStart: string, forUser?: User): Promise<WeeklyReport> {
  const weekEnd = addDays(weekStart, 6);
  const prevEnd = addDays(weekStart, -1);

  const [measurements, sectors, indicators, tasks, users, settings] = await Promise.all([
    listMeasurements(),
    listSectors(),
    listIndicators(),
    listTasks(),
    listUsers(),
    getSettings(),
  ]);

  const scoped: Measurement[] =
    forUser && forUser.role !== "admin"
      ? measurements.filter((m) => forUser.sectorIds.includes(m.sectorId))
      : measurements;
  const visibleSectors: Sector[] =
    forUser && forUser.role !== "admin"
      ? sectors.filter((s) => forUser.sectorIds.includes(s.id))
      : sectors;

  // المستهدفات من قاعدة البيانات مباشرة عبر مفتاح (قطاع|مؤشر)
  const tg = await getTargets();
  const targetOf = (sectorId: string, indicatorId: string): number | null => {
    const raw = tg[targetKey(sectorId, indicatorId)];
    if (raw == null) return null;
    return Array.isArray(raw) ? (raw.length ? raw[raw.length - 1] : null) : raw;
  };

  const now = latestUpTo(scoped, weekEnd);
  const before = latestUpTo(scoped, prevEnd);

  const HISTORY_WEEKS = 6;
  const cutoffs = Array.from({ length: HISTORY_WEEKS }, (_, i) =>
    addDays(weekEnd, -7 * (HISTORY_WEEKS - 1 - i))
  );
  const snapshots = cutoffs.map((c) => latestUpTo(scoped, c));
  const band = [...settings.statuses].sort((x, y) => x.from - y.from);

  /** متوسط الإنجاز لمؤشر واحد عبر القطاعات المرئية في لقطة معيّنة. */
  const indAchievement = (snap: Map<string, Measurement>, indId: string): number | null => {
    const vals: number[] = [];
    for (const s of visibleSectors) {
      const a = computeAchievement(snap.get(`${s.id}|${indId}`)?.actual ?? null, targetOf(s.id, indId));
      if (a != null) vals.push(a);
    }
    return avg(vals);
  };

  const kpis: WeeklyKpi[] = (indicators as Indicator[]).map((ind) => {
    let sumTarget = 0;
    let sumActual = 0;
    let anyTarget = false;

    const sectorRows: WeeklySector[] = visibleSectors.map((s) => {
      const t = targetOf(s.id, ind.id);
      const a = now.get(`${s.id}|${ind.id}`)?.actual ?? null;
      const ac = computeAchievement(a, t);
      if (t != null) {
        anyTarget = true;
        sumTarget += t;
        sumActual += a ?? 0;
      }
      return {
        id: s.id,
        name: s.name,
        target: t,
        actual: a,
        achievement: ac == null ? null : Math.round(ac),
        color: colorFor(ac, band),
      };
    });

    const achievement = indAchievement(now, ind.id);
    const prevAch = indAchievement(before, ind.id);

    return {
      id: ind.id,
      name: ind.name,
      unit: ind.unit,
      target: anyTarget ? sumTarget : null,
      actual: anyTarget ? sumActual : null,
      achievement,
      delta: achievement != null && prevAch != null ? achievement - prevAch : null,
      color: colorFor(achievement, band),
      sectors: sectorRows,
      history: snapshots.map((snap) => indAchievement(snap, ind.id)),
    };
  });

  const overallOf = (snap: Map<string, Measurement>): number | null =>
    avg(
      (indicators as Indicator[])
        .map((ind) => indAchievement(snap, ind.id))
        .filter((v): v is number => v != null)
    );

  const overall = overallOf(now);
  const prevOverall = overallOf(before);
  const overallHistory = snapshots.map(overallOf);

  const nameOf = (id: string) => (users as User[]).find((u) => u.id === id)?.name || "—";
  const mine = (tk: Task) =>
    !forUser || forUser.role === "admin" || tk.assigneeId === forUser.id || tk.createdById === forUser.id;
  const visibleTasks = (tasks as Task[]).filter(mine);

  const taskRows: WeeklyTaskRow[] = visibleTasks
    .filter((tk) => tk.state !== "done")
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .slice(0, 8)
    .map((tk) => ({
      id: tk.id,
      title: tk.title,
      who: nameOf(tk.assigneeId),
      due: tk.dueDate,
      state: tk.dueDate < weekEnd && tk.state !== "done" && tk.dueDate < new Date().toISOString().slice(0, 10)
        ? "late"
        : tk.state,
      lastUpdate: tk.updates[tk.updates.length - 1]?.text || "—",
    }));

  const achievements = visibleTasks
    .filter((tk) => tk.state === "done" && (tk.completedAt || "").slice(0, 10) >= weekStart)
    .map((tk) => tk.title)
    .slice(0, 6);

  const challenges = visibleTasks
    .filter((tk) => tk.state === "risk" || (tk.state !== "done" && tk.dueDate < new Date().toISOString().slice(0, 10)))
    .slice(0, 5)
    .map((tk) => ({
      title: tk.title,
      plan: tk.updates[tk.updates.length - 1]?.text || "—",
      who: nameOf(tk.assigneeId),
    }));

  const nextStart = addDays(weekStart, 7);
  const nextEnd = addDays(weekStart, 13);
  const nextWeek = visibleTasks
    .filter((tk) => tk.state !== "done" && tk.dueDate >= nextStart && tk.dueDate <= nextEnd)
    .map((tk) => tk.title)
    .slice(0, 6);

  return {
    weekStart,
    weekEnd,
    overall,
    overallDelta: overall != null && prevOverall != null ? overall - prevOverall : null,
    overallColor: colorFor(overall, band),
    overallHistory,
    kpis,
    tasks: taskRows,
    achievements,
    challenges,
    nextWeek,
    generatedAt: new Date().toISOString(),
  };
}
