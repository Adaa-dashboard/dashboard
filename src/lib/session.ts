import { cookies } from "next/headers";
import { getSessionUser, User } from "./db";

export const SESSION_COOKIE = "session_token";
export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 أيام
// «تذكّر هذا الجهاز»: الجلسة تبقى ثلاثة أشهر فلا يُطلب الرمز في كل مرة
// من الجهاز نفسه. أي جهاز آخر يبدأ بلا جلسة فيُطلب منه الرمز.
export const REMEMBER_TTL_MS = 1000 * 60 * 60 * 24 * 90;
export function sessionTtl(remember: unknown): number {
  return remember === false ? SESSION_TTL_MS : REMEMBER_TTL_MS;
}

export async function getCurrentUser(): Promise<User | undefined> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  return await getSessionUser(token);
}

export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) throw new Error("UNAUTHORIZED");
  return user;
}

export async function requireAdmin(): Promise<User> {
  const user = await requireUser();
  if (user.role !== "admin") throw new Error("FORBIDDEN");
  return user;
}
