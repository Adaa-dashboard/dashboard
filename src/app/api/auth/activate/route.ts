import {
  createSession,
  getUserByUsername,
  pwBlockedFor,
  pwClearFailures,
  pwNoteFailure,
  updateUser,
} from "@/lib/db";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, sessionTtl } from "@/lib/session";

/* ضبط كلمة المرور بلا وسيط: يخدم حالتين بنفس المنطق —
   «مستخدم جديد» (حساب بلا كلمة مرور) و«نسيت كلمة المرور» (له كلمة ويريد غيرها).
   في الحالتين المفتاح: اسم المستخدم + آخر أربعة أرقام من جواله المسجَّل.
   الجوال لا يُطلب في الدخول العادي إطلاقاً — هنا فقط. */
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  const username = String(b.username || "").trim();
  const last4 = String(b.last4 || "").replace(/\D/g, "");
  const password = String(b.password || "");

  const bad = NextResponse.json(
    { error: "اسم المستخدم أو أرقام الجوال غير صحيحة" },
    { status: 401 }
  );

  // أربعة أرقام تُخمَّن بعشرة آلاف محاولة — التقييد هو ما يجعلها كافية
  const blocked = await pwBlockedFor(username);
  if (blocked > 0) {
    return NextResponse.json(
      { error: `محاولات كثيرة خاطئة — انتظر ${Math.ceil(blocked / 60)} دقيقة ثم أعد المحاولة` },
      { status: 429 }
    );
  }

  const user = await getUserByUsername(username);
  if (!user || !user.active || last4.length !== 4 || !user.phone.endsWith(last4)) {
    await pwNoteFailure(username);
    return bad;
  }
  if (password.length < 6) {
    return NextResponse.json({ error: "كلمة المرور لا تقل عن ٦ أحرف" }, { status: 400 });
  }

  await updateUser(user.id, { password });
  await pwClearFailures(username);

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
