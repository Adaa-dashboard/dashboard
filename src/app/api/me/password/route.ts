import { NextResponse } from "next/server";
import { updateUser, verifyPassword } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";

// تغيير المستخدم كلمة مرور نفسه — يتطلّب كلمة المرور الحالية
export async function PATCH(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });

  const b = await req.json().catch(() => ({}));
  const current = String(b.current || "");
  const next = String(b.next || "");

  if (!user.passwordHash) {
    return NextResponse.json(
      { error: "لم تُضبط كلمة مرور لحسابك بعد — راجع مدير الإدارة" },
      { status: 409 }
    );
  }
  if (!verifyPassword(current, user.passwordHash)) {
    return NextResponse.json({ error: "كلمة المرور الحالية غير صحيحة" }, { status: 400 });
  }
  if (next.length < 6) {
    return NextResponse.json({ error: "كلمة المرور الجديدة لا تقل عن ٦ أحرف" }, { status: 400 });
  }
  if (next === current) {
    return NextResponse.json({ error: "كلمة المرور الجديدة مطابقة للحالية" }, { status: 400 });
  }

  await updateUser(user.id, { password: next });
  return NextResponse.json({ ok: true });
}
