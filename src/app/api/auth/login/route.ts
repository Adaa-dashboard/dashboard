import { NextResponse } from "next/server";
import { createSession, getUserByUsername, verifyPassword } from "@/lib/db";
import { SESSION_COOKIE, sessionTtl } from "@/lib/session";

export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  const { username, password } = b;
  const u = String(username || "").trim();
  const p = String(password || "");

  const user = await getUserByUsername(u);
  // رسالة واحدة للحالتين: اسم غير موجود أو كلمة مرور خاطئة —
  // حتى لا يُستدلّ من الرد على أسماء المستخدمين الموجودة
  const bad = NextResponse.json(
    { error: "اسم المستخدم أو كلمة المرور غير صحيحة" },
    { status: 401 }
  );
  if (!user || !user.active) return bad;
  if (!user.passwordHash) {
    return NextResponse.json(
      { error: "لم تُفعَّل كلمة مرور هذا الحساب بعد", needsActivation: true },
      { status: 409 }
    );
  }
  if (!verifyPassword(p, user.passwordHash)) return bad;

  const ttl = sessionTtl(b.remember);
  const token = await createSession(user.id, ttl);
  const res = NextResponse.json({ ok: true, role: user.role });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE === "true",
    path: "/",
    maxAge: ttl / 1000,
  });
  return res;
}
