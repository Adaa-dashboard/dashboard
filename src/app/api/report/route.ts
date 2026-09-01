import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { buildWeekly, weekStartOf } from "@/lib/weekly";

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });

  const url = new URL(req.url);
  const asked = url.searchParams.get("week") || "";
  const week = /^\d{4}-\d{2}-\d{2}$/.test(asked)
    ? weekStartOf(asked)
    : weekStartOf(new Date().toISOString().slice(0, 10));

  const report = await buildWeekly(week, user);
  return NextResponse.json({ report, canShare: user.role === "admin" });
}
