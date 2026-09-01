"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { whoAmI } from "@/lib/supa";

export default function Home() {
  const router = useRouter();
  useEffect(() => {
    whoAmI().then((me) => router.replace(me ? "/dashboard" : "/login"));
  }, [router]);
  return <div className="empty">جارٍ التحميل...</div>;
}
