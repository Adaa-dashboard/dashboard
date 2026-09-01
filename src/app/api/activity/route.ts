import { NextResponse } from "next/server";
import {
  Indicator,
  Sector,
  User,
  getLastSeen,
  listIndicators,
  listMeasurements,
  listNotes,
  listSectors,
  listTasks,
  listUsers,
  markSeen,
} from "@/lib/db";
import { getCurrentUser } from "@/lib/session";

export type Activity = {
  id: string;
  kind: "measurement" | "note" | "task" | "task-update";
  tone: "bad" | "warn" | "good" | "info";
  title: string;
  sub: string;
  at: string;
  unread: boolean;
};

function nameOf<T extends { id: string; name: string }>(list: T[], id: string): string {
  return list.find((x) => x.id === id)?.name || "";
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });

  const [measurements, notes, tasks, sectors, indicators, users, lastSeen] = await Promise.all([
    listMeasurements(user.role === "admin" ? undefined : { sectorIds: user.sectorIds }),
    listNotes(),
    listTasks(),
    listSectors(),
    listIndicators(true),
    listUsers(),
    getLastSeen(user.id),
  ]);

  const items: Activity[] = [];
  const visibleSector = (id: string) => user.role === "admin" || user.sectorIds.includes(id);

  for (const m of measurements) {
    if (!m.updatedAt) continue;
    const ind = nameOf(indicators as Indicator[], m.indicatorId);
    const sec = nameOf(sectors as Sector[], m.sectorId);
    const who = nameOf(users as User[], m.updatedBy) || m.updatedBy;
    items.push({
      id: "m-" + m.id,
      kind: "measurement",
      tone: "info",
      title: `${who ? who + " حدّث" : "تحديث"} الفعلي لـ «${ind}»${
        m.actual != null ? ` إلى ${m.actual}` : ""
      }`,
      sub: sec,
      at: m.updatedAt,
      unread: !!lastSeen && m.updatedAt > lastSeen,
    });
  }

  for (const n of notes) {
    if (!visibleSector(n.sectorId)) continue;
    items.push({
      id: "n-" + n.id,
      kind: "note",
      tone: "info",
      title: `ملاحظة جديدة من ${n.byName} على «${nameOf(indicators as Indicator[], n.indicatorId)}»`,
      sub: `«${n.text.slice(0, 90)}»`,
      at: n.at,
      unread: !!lastSeen && n.at > lastSeen,
    });
  }

  const today = new Date().toISOString().slice(0, 10);
  for (const t of tasks) {
    const mine = user.role === "admin" || t.assigneeId === user.id || t.createdById === user.id;
    if (!mine) continue;
    const who = nameOf(users as User[], t.assigneeId);
    const late = t.state !== "done" && t.dueDate < today;
    items.push({
      id: "t-" + t.id,
      kind: "task",
      tone: late ? "bad" : t.state === "risk" ? "warn" : t.state === "done" ? "good" : "info",
      title: late
        ? `مهمة متأخرة: ${t.title}`
        : t.state === "done"
          ? `اكتملت المهمة: ${t.title}`
          : `مهمة: ${t.title}`,
      sub: `${who} · تنتهي ${t.dueDate}`,
      at: t.completedAt || t.createdAt,
      unread: !!lastSeen && (t.completedAt || t.createdAt) > lastSeen,
    });
    const last = t.updates[t.updates.length - 1];
    if (last) {
      items.push({
        id: "tu-" + last.id,
        kind: "task-update",
        tone: "info",
        title: `${last.byName} حدّث «${t.title}»`,
        sub: last.text.slice(0, 90),
        at: last.at,
        unread: !!lastSeen && last.at > lastSeen,
      });
    }
  }

  items.sort((a, b) => b.at.localeCompare(a.at));
  const top = items.slice(0, 6);
  return NextResponse.json({
    activity: top,
    unread: lastSeen ? top.filter((x) => x.unread).length : top.length,
  });
}

export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  await markSeen(user.id);
  return NextResponse.json({ ok: true });
}
