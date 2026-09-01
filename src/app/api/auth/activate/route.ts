import { NextResponse } from "next/server";
import { createSession, getUserByUsername, updateUser } from "@/lib/db";
import { SESSION_COOKIE, SESSION_TTL_MS } from "@/lib/session";

/* تفعيل الحساب: يختار صاحبه كلمة مروره بنفسه أول مرة.
   المفتاح اسم المستخدم + آخر أربعة أرقام من جواله المسجَّل — فلا يستطيع
   زميل يعرف اسم المستخدم وحده أن يستولي على حساب لم يُفعَّل بعد. */
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  const username = String(b.username || "").trim();
  const last4 = String(b.last4 || "").replace(/\D/g, "");
  const password = String(b.password || "");

  const bad = NextResponse.json(
    { error: "اسم المستخدم أو أرقام الجوال غير صحيحة" },
    { status: 401 }
  );

  const user = await getUserByUsername(username);
  if (!user || !user.active) return bad;
  if (user.passwordHash) {
    return NextResponse.json(
      { error: "هذا الحساب مفعّل بالفعل — سجّل الدخول بكلمة مرورك، أو راجع مدير الإدارة لإعادة تعيينها" },
      { status: 409 }
    );
  }
  if (last4.length !== 4 || !user.phone.endsWith(last4)) return bad;
  if (password.length < 6) {
    return NextResponse.json({ error: "كلمة المرور لا تقل عن ٦ أحرف" }, { status: 400 });
  }

  await updateUser(user.id, { password });

  const token = await createSession(user.id, SESSION_TTL_MS);
  const res = NextResponse.json({ ok: true, role: user.role });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE === "true",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
  return res;
}
