import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ user: null }, { status: 200 });
  return NextResponse.json({
    user: {
      id: user.id,
      name: user.name,
      phone: user.phone,
      username: user.username || "",
      hasPassword: !!user.passwordHash,
      role: user.role,
      sectorIds: user.sectorIds || [],
    },
  });
}
