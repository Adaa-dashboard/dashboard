import { NextResponse } from "next/server";
import {
  getSettings,
  getTargets,
  listIndicators,
  listMeasurements,
  listNotes,
  listPeriods,
  listSectors,
  listShares,
  listTasks,
  listUsers,
} from "@/lib/db";
import { getCurrentUser } from "@/lib/session";

/* تصدير كامل لبيانات اللوحة — للنقل إلى Supabase وللنسخ الاحتياطي.
   للقراءة فقط: لا يعدّل ولا يحذف شيئاً. كلمات المرور المُجزّأة تخرج هنا
   عمداً حتى ينتقل المستخدمون بكلماتهم كما هي، فلا يعيد أحد التسجيل. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "غير مصرّح" }, { status: 403 });
  }

  const [users, sectors, indicators, periods, measurements, targets, settings, tasks, notes, shares] =
    await Promise.all([
      listUsers(),
      listSectors(),
      listIndicators(),
      listPeriods(),
      listMeasurements(),
      getTargets(),
      getSettings(),
      listTasks(),
      listNotes({}),
      listShares(),
    ]);

  const dump = {
    exportedAt: new Date().toISOString(),
    exportedBy: user.name,
    counts: {
      users: users.length,
      sectors: sectors.length,
      indicators: indicators.length,
      periods: periods.length,
      measurements: measurements.length,
      targets: Object.keys(targets).length,
      tasks: tasks.length,
      notes: notes.length,
      shares: shares.length,
    },
    users,
    sectors,
    indicators,
    periods,
    measurements,
    targets,
    settings,
    tasks,
    notes,
    shares,
  };

  return new NextResponse(JSON.stringify(dump, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="adaa-perf-backup-${new Date()
        .toISOString()
        .slice(0, 10)}.json"`,
    },
  });
}
