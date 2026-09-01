import { NextResponse } from "next/server";
import { deleteTask, listTasks, updateTask } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });

  const { id } = await ctx.params;
  const task = (await listTasks()).find((t) => t.id === id);
  if (!task) return NextResponse.json({ error: "المهمة غير موجودة" }, { status: 404 });

  // يعدّلها صاحبها أو من أنشأها أو مدير الإدارة
  const allowed = user.role === "admin" || task.assigneeId === user.id || task.createdById === user.id;
  if (!allowed) return NextResponse.json({ error: "غير مصرّح" }, { status: 403 });

  const b = await req.json().catch(() => ({}));
  const text = String(b.text || "").trim();
  const updated = await updateTask(id, {
    state: b.state,
    update: text ? { text, byId: user.id, byName: user.name } : undefined,
  });
  return NextResponse.json({ task: updated });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "غير مصرّح" }, { status: 403 });

  const { id } = await ctx.params;
  await deleteTask(id);
  return NextResponse.json({ ok: true });
}
