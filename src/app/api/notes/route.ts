import { NextResponse } from "next/server";
import { createNote, listNotes, listUsers } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });

  const sp = new URL(req.url).searchParams;
  const sectorId = sp.get("sectorId") || undefined;
  const indicatorId = sp.get("indicatorId") || undefined;

  let notes = await listNotes({ sectorId, indicatorId });
  if (user.role !== "admin") {
    notes = notes.filter((n) => user.sectorIds.includes(n.sectorId));
  }

  const users = await listUsers();
  return NextResponse.json({
    notes,
    people: users.filter((u) => u.active).map((u) => ({ id: u.id, name: u.name })),
  });
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });

  const b = await req.json().catch(() => ({}));
  const sectorId = String(b.sectorId || "");
  const indicatorId = String(b.indicatorId || "");
  const text = String(b.text || "").trim();

  if (!sectorId || !indicatorId) {
    return NextResponse.json({ error: "المؤشر أو القطاع غير محدّد" }, { status: 400 });
  }
  if (!text) return NextResponse.json({ error: "الملاحظة فارغة" }, { status: 400 });
  if (user.role !== "admin" && !user.sectorIds.includes(sectorId)) {
    return NextResponse.json({ error: "غير مصرّح" }, { status: 403 });
  }

  const note = await createNote({
    sectorId,
    indicatorId,
    text,
    mentions: Array.isArray(b.mentions) ? b.mentions.map(String) : [],
    byId: user.id,
    byName: user.name,
  });
  return NextResponse.json({ note });
}
