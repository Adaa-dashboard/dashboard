import { NextResponse } from "next/server";
import { createShare, listShares, revokeShare } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { weekStartOf } from "@/lib/weekly";

// المشاركة صلاحية مدير الإدارة وحده — الرابط يفتح التقرير لمن لا حساب له
export async function GET() {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "غير مصرّح" }, { status: 403 });
  }
  const shares = await listShares();
  return NextResponse.json({
    shares: shares
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((s) => ({
        token: s.token,
        weekStart: s.weekStart,
        createdAt: s.createdAt,
        expiresAt: s.expiresAt || null,
        views: s.views.length,
        lastView: s.views.length ? s.views[s.views.length - 1].at : null,
      })),
  });
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "غير مصرّح" }, { status: 403 });
  }
  const b = await req.json().catch(() => ({}));
  const asked = String(b.weekStart || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asked)) {
    return NextResponse.json({ error: "أسبوع غير صالح" }, { status: 400 });
  }
  const days = b.days === null || b.days === "" ? null : Number(b.days);
  const share = await createShare({
    weekStart: weekStartOf(asked),
    createdById: user.id,
    days: days && days > 0 ? days : null,
  });
  return NextResponse.json({ token: share.token, expiresAt: share.expiresAt || null });
}

export async function DELETE(req: Request) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "غير مصرّح" }, { status: 403 });
  }
  const token = new URL(req.url).searchParams.get("token") || "";
  if (!token) return NextResponse.json({ error: "الرمز مطلوب" }, { status: 400 });
  await revokeShare(token);
  return NextResponse.json({ ok: true });
}
