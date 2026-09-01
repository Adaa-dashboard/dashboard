import { NextResponse } from "next/server";
import { createUser, listUsers } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";

export async function GET() {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "غير مصرّح" }, { status: 403 });
  }
  // كلمة المرور المُجزّأة لا تخرج من الخادم أبداً — يخرج فقط هل ضُبطت أم لا
  const users = (await listUsers()).map(({ passwordHash, ...u }) => ({
    ...u,
    hasPassword: !!passwordHash,
  }));
  return NextResponse.json({ users });
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "غير مصرّح" }, { status: 403 });
  }
  const { phone, name, role, sectorIds, username, password } = await req.json().catch(() => ({}));
  if (!phone || String(phone).replace(/\D/g, "").length < 9) {
    return NextResponse.json({ error: "أدخل رقم جوال صحيح" }, { status: 400 });
  }
  if (typeof password === "string" && password && password.length < 6) {
    return NextResponse.json({ error: "كلمة المرور لا تقل عن ٦ أحرف" }, { status: 400 });
  }
  try {
    const created = await createUser({
      phone,
      name: name || "",
      role: role === "admin" ? "admin" : "manager",
      sectorIds: Array.isArray(sectorIds) ? sectorIds : [],
      username: typeof username === "string" ? username : undefined,
      password: typeof password === "string" && password ? password : undefined,
    });
    // لا تُعِد كلمة المرور المُجزّأة في رد الإنشاء
    const { passwordHash, ...safe } = created;
    void passwordHash;
    return NextResponse.json({ ok: true, user: { ...safe, hasPassword: !!passwordHash } });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "خطأ" },
      { status: 400 }
    );
  }
}
