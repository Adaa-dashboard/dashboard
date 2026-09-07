"use client";

import { apiFetch } from "@/lib/api";

import { useCallback, useEffect, useState } from "react";

export type Item = {
  id: string;
  kind: string;
  tone: "bad" | "warn" | "good" | "info";
  title: string;
  sub: string;
  at: string;
  unread: boolean;
  sectorId?: string;
  indicatorId?: string;
  taskId?: string;
  /** قسم من العناوين الأساسية — زرّ «عرض» يفتح صفحته */
  section?: string;
};

/** إعلان من المطوّر — كتلة مستقلة تحت عنوانها */
export type Notice = { id: string; title: string; body: string; at: string; unread: boolean };

const TONE: Record<string, string> = {
  bad: "#d34a4a",
  warn: "#e0971a",
  good: "#1a9d5c",
  info: "#8a9a95",
};

const AR_COUNT = ["", "تنبيه واحد", "تنبيهان", "ثلاثة تنبيهات", "أربعة تنبيهات", "خمسة تنبيهات", "ستة تنبيهات"];

function when(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const today = new Date();
  const same = d.toDateString() === today.toDateString();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  if (same) return `اليوم ${hh}:${mm}`;
  const y = new Date(today.getTime() - 86400000);
  if (d.toDateString() === y.toDateString()) return `أمس ${hh}:${mm}`;
  return d.toISOString().slice(0, 10);
}

export default function Activity({
  t,
  onOpen,
}: {
  t: (ar: string, en: string) => string;
  /** فتح مصدر التحديث: المؤشر أو الملاحظة أو المهمة */
  onOpen?: (item: Item) => void;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [openN, setOpenN] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const r = await apiFetch("/api/activity").then((x) => x.json());
    setItems(r.activity || []);
    setNotices(r.notices || []);
    setUnread(r.unread || 0);
    setLoaded(true);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && unread > 0) {
      await apiFetch("/api/activity", { method: "POST" });
      setUnread(0);
    }
  }

  const SHOW = 4;
  const shown = open ? items : items.slice(0, SHOW);
  const rest = Math.max(0, items.length - SHOW);

  return (
    <div className={`card upcard ${open ? "open" : ""}`}>
      <button className="up-h" onClick={toggle}>
        <h3>{t("آخر التحديثات", "Latest updates")}</h3>
        {unread > 0 && (
          <span className="unread">
            {t(
              `${AR_COUNT[Math.min(unread, 6)] || unread + " تنبيهات"} لم يتم الاطلاع عليها`,
              `${unread} unread`
            )}
          </span>
        )}
        <span className="cv">▾</span>
      </button>

      {notices.length > 0 && (
        <div className="dev">
          <div className="dev-h">{t("تحديثات إضافية من المطوّر", "From the developer")}</div>
          {notices.map((n) => (
            <div className={`dev-i ${openN === n.id ? "on" : ""}`} key={n.id}>
              <button onClick={() => setOpenN(openN === n.id ? null : n.id)}>
                <span className="dev-d" />
                <b>{n.title}</b>
                {n.unread && <span className="tg">{t("جديد", "new")}</span>}
                <span className="cv">▾</span>
              </button>
              {openN === n.id && <p>{n.body}</p>}
            </div>
          ))}
        </div>
      )}

      {!loaded ? (
        <div className="empty">{t("جارٍ التحميل...", "Loading...")}</div>
      ) : items.length === 0 ? (
        <div className="empty">{t("لا توجد تحديثات بعد.", "No updates yet.")}</div>
      ) : (
        <>
          <div className="feed">
            {shown.map((x) => (
              <div key={x.id} className={`up ${x.unread ? "new" : ""}`} style={{ ["--c" as string]: TONE[x.tone] }}>
                <span className="dot" />
                <span className="txt">
                  <span className={`t ${x.tone === "bad" ? "bad" : ""}`}>
                    {x.title}
                    {x.unread && <span className="tg">{t("جديد", "new")}</span>}
                  </span>
                  <span className="s">
                    {x.sub}
                    {x.sub ? " · " : ""}
                    {when(x.at)}
                  </span>
                </span>
                {onOpen && (x.indicatorId || x.taskId || x.section) && (
                  <button
                    className="up-go"
                    onClick={() => onOpen(x)}
                    title={t("فتح مصدر التحديث", "Open source")}
                  >
                    {t("عرض", "Open")}
                  </button>
                )}
              </div>
            ))}
          </div>
          {!open && rest > 0 && (
            <div className="up-more" onClick={toggle}>
              {t(
                rest === 1 ? "عرض تحديث آخر ▾" : rest === 2 ? "عرض تحديثين آخرين ▾" : `عرض ${rest} تحديثات أخرى ▾`,
                `Show ${rest} more ▾`
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
