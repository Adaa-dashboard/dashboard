import { NextResponse } from "next/server";
import { listSectors } from "@/lib/db";

/* أسماء القطاعات وحدها، بلا تسجيل دخول — تحتاجها شاشة «مستخدم جديد»
   ليختار المسجِّل قطاعه قبل أن تكون له جلسة. لا تكشف أي بيانات أداء. */
export async function GET() {
  const sectors = await listSectors();
  return NextResponse.json({
    sectors: sectors.map((s) => ({ id: s.id, name: s.name })),
  });
}
