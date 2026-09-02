"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { sb, whoAmI, type Me } from "@/lib/supa";
import Dashboard from "./Dashboard";

export default function DashboardPage() {
  const router = useRouter();
  const [me, setMe] = useState<(Me & { canChanges?: boolean }) | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    whoAmI().then(async (u) => {
      if (!u) {
        router.replace("/login");
      } else {
        // صلاحية رفع طلبات التغيير تُقرأ حيّة من القاعدة لا من الجلسة،
        // فتغييرها يسري فوراً. وإن لم تكن الدالة منصّبة بعد رجعت false.
        const { data } = await sb().rpc("perf_can_changes");
        setMe({ ...u, canChanges: data === true });
      }
      setChecked(true);
    });
  }, [router]);

  if (!checked || !me) return <div className="empty">جارٍ التحميل...</div>;
  return (
    <Dashboard
      me={{
        id: me.id,
        name: me.name,
        phone: "",
        role: me.role,
        sectorIds: me.sectorIds,
        canChanges: me.canChanges,
      }}
    />
  );
}
