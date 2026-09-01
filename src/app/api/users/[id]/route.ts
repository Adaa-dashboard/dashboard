import { NextResponse } from "next/server";
import { deleteUser, getUserById, updateUser } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "غير مصرّح" }, { status: 403 });
  }
  const { id } = await ctx.params;
  const { active, sectorIds, name, role, username, password, clearPassword } = await req
    .json()
    .catch(() => ({}));

  if (!(await getUserById(id))) {
    return NextResponse.json({ error: "المستخدم غير موجود" }, { status: 404 });
  }

  // لا يسحب مدير الإدارة الصلاحية من نفسه ولا يوقف حسابه — وإلا أُقفلت اللوحة
  if (id === user.id) {
    if (role === "manager") {
      return NextResponse.json({ error: "لا يمكنك سحب صلاحيتك من نفسك" }, { status: 400 });
    }
    if (active === false) {
      return NextResponse.json({ error: "لا يمكنك إيقاف حسابك الخاص" }, { status: 400 });
    }
  }
  if (typeof password === "string" && password && password.length < 6) {
    return NextResponse.json({ error: "كلمة المرور لا تقل عن ٦ أحرف" }, { status: 400 });
  }

  try {
    await updateUser(id, {
      active: typeof active === "boolean" ? active : undefined,
      sectorIds: Array.isArray(sectorIds) ? sectorIds : undefined,
      name: typeof name === "string" ? name : undefined,
      role: role === "admin" || role === "manager" ? role : undefined,
      username: typeof username === "string" ? username : undefined,
      password: typeof password === "string" && password ? password : undefined,
      clearPassword: clearPassword === true,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "تعذّر الحفظ" },
      { status: 400 }
    );
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "غير مصرّح" }, { status: 403 });
  }
  const { id } = await ctx.params;
  if (id === user.id) {
    return NextResponse.json(
      { error: "لا يمكنك حذف حسابك الخاص" },
      { status: 400 }
    );
  }
  if (!(await getUserById(id))) {
    return NextResponse.json({ error: "المستخدم غير موجود" }, { status: 404 });
  }
  await deleteUser(id);
  return NextResponse.json({ ok: true });
}
