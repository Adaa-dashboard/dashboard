import { NextResponse } from "next/server";
import { createPeriod, listPeriods } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  return NextResponse.json({ periods: await listPeriods() });
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  const { label, weekStart } = await req.json().catch(() => ({}));
  if (!label || !String(label).trim()) {
    return NextResponse.json({ error: "أدخل اسمًا" }, { status: 400 });
  }
  const period = await createPeriod(String(label), weekStart ? String(weekStart) : undefined);
  return NextResponse.json({ ok: true, period });
}
