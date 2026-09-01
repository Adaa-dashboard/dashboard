"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { whoAmI, type Me } from "@/lib/supa";
import Dashboard from "./Dashboard";

export default function DashboardPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    whoAmI().then((u) => {
      if (!u) router.replace("/login");
      else setMe(u);
      setChecked(true);
    });
  }, [router]);

  if (!checked || !me) return <div className="empty">جارٍ التحميل...</div>;
  return (
    <Dashboard
      me={{ id: me.id, name: me.name, phone: "", role: me.role, sectorIds: me.sectorIds }}
    />
  );
}
