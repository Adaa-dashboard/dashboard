"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { sb, whoAmI, type Me } from "@/lib/supa";
import { ALL_SCOPES, DEFAULT_SCOPES } from "@/lib/scopes";
import Dashboard from "./Dashboard";

export default function DashboardPage() {
  const router = useRouter();
  const [me, setMe] = useState<(Me & { scopes?: string[]; jobTitle?: string }) | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    whoAmI().then(async (u) => {
      if (!u) {
        router.replace("/login");
      } else {
        // الصلاحيات تُقرأ حيّة من القاعدة لا من الجلسة، فتغييرها يسري فوراً.
        // ولو لم تكن الدالة منصّبة بعد (قبل تشغيل ملف الترقية) نرجع للسلوك
        // القديم بحسب الدور، فلا تُقفل اللوحة على الجميع.
        const { data, error } = await sb().rpc("perf_me");
        const card = Array.isArray(data) ? data[0] : data;
        const scopes = error
          ? u.role === "admin"
            ? [...ALL_SCOPES]
            : [...DEFAULT_SCOPES]
          : Array.isArray(card?.scopes)
            ? card.scopes
            : [];
        setMe({ ...u, scopes, jobTitle: card?.job_title || "" });
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
        scopes: me.scopes || [],
        jobTitle: me.jobTitle || "",
      }}
    />
  );
}
