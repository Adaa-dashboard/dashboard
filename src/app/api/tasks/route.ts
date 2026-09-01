import { NextResponse } from "next/server";
import { createTask, listTasks, listUsers, TaskPriority } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });

  const [tasks, users] = await Promise.all([listTasks(), listUsers()]);
  // مدير الإدارة يرى الكل · مدير القطاع يرى ما أُسند إليه أو ما أنشأه
  const visible =
    user.role === "admin"
      ? tasks
      : tasks.filter((t) => t.assigneeId === user.id || t.createdById === user.id);

  return NextResponse.json({
    tasks: visible,
    people: users
      .filter((u) => u.active)
      .map((u) => ({ id: u.id, name: u.name, role: u.role })),
  });
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });

  const b = await req.json().catch(() => ({}));
  const title = String(b.title || "").trim();
  const assigneeId = String(b.assigneeId || "").trim();
  const dueDate = String(b.dueDate || "").trim();

  if (!title) return NextResponse.json({ error: "عنوان المهمة مطلوب" }, { status: 400 });
  if (!assigneeId) return NextResponse.json({ error: "لا بد من اختيار المسؤول" }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    return NextResponse.json({ error: "تاريخ النهاية غير صالح" }, { status: 400 });
  }

  const task = await createTask({
    title,
    description: String(b.description || ""),
    assigneeId,
    priority: (b.priority === "high" ? "high" : "mid") as TaskPriority,
    dueDate,
    indicatorId: b.indicatorId ? String(b.indicatorId) : undefined,
    createdById: user.id,
  });
  return NextResponse.json({ task });
}
