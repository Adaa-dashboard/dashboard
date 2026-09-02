"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import Tasks from "./Tasks";

/* ============================================================
   التكاليف في «نظرة عامة» — شريط صغير بالأرقام لا لوحة كاملة،
   حتى لا يأخذ نصف الصفحة. الضغط عليه يفتح التفاصيل في نافذة.
   ============================================================ */

type Task = {
  id: string;
  assigneeId: string;
  createdById: string;
  dueDate: string;
  state: string;
  kind?: string;
};

const todayISO = () => new Date().toISOString().slice(0, 10);
const daysTo = (d: string) =>
  Math.round((new Date(d).getTime() - new Date(todayISO()).getTime()) / 86400000);

export default function AssignmentsBar({
  meId,
  isAdmin,
  indicators,
  onlyMine,
  focusId,
  onFocusDone,
  t,
}: {
  meId: string;
  isAdmin: boolean;
  indicators: { id: string; name: string }[];
  onlyMine: boolean;
  focusId?: string | null;
  onFocusDone?: () => void;
  t: (ar: string, en: string) => string;
}) {
  const [items, setItems] = useState<Task[]>([]);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    const r = await apiFetch("/api/tasks").then((x) => x.json());
    const all: Task[] = r.tasks || [];
    setItems(
      all
        .filter((x) => x.kind === "assignment")
        .filter((x) => !onlyMine || x.assigneeId === meId || x.createdById === meId)
    );
  }, [meId, onlyMine]);

  useEffect(() => {
    load();
  }, [load, open]);

  // طلب فتح تكليف بعينه من «آخر التحديثات» ⇒ تُفتح النافذة به
  useEffect(() => {
    if (focusId) setOpen(true);
  }, [focusId]);

  const n = useMemo(() => {
    const openItems = items.filter((x) => x.state !== "done");
    return {
      all: items.length,
      open: openItems.length,
      late: openItems.filter((x) => x.dueDate && daysTo(x.dueDate) < 0).length,
      soon: openItems.filter((x) => x.dueDate && daysTo(x.dueDate) >= 0 && daysTo(x.dueDate) <= 3).length,
      done: items.filter((x) => x.state === "done").length,
    };
  }, [items]);

  return (
    <>
      <button className="asg-bar" id="ov-asg" onClick={() => setOpen(true)}>
        <span className="ttl">
          <b>{t("التكاليف", "Assignments")}</b>
          <i>{t("الواردة من الديوان أو جهة أعلى", "From higher authority")}</i>
        </span>
        <span className="nums">
          <span>
            <b>{n.open}</b>
            {t("مفتوحة", "open")}
          </span>
          {n.late > 0 && (
            <span className="bad">
              <b>{n.late}</b>
              {t("متأخرة", "late")}
            </span>
          )}
          {n.soon > 0 && (
            <span className="warn">
              <b>{n.soon}</b>
              {t("تقترب", "due soon")}
            </span>
          )}
          <span className="muted">
            <b>{n.done}</b>
            {t("مكتملة", "done")}
          </span>
        </span>
        <span className="go">{t("التفاصيل ‹", "Details ‹")}</span>
      </button>

      {open && (
        <div className="modal-overlay" onClick={() => setOpen(false)}>
          <div className="modal asg-modal" onClick={(e) => e.stopPropagation()}>
            <div className="m-h">
              <h3>{t("التكاليف", "Assignments")}</h3>
              <button className="mx" onClick={() => setOpen(false)} aria-label="close">
                ✕
              </button>
            </div>
            <div className="m-b">
              <Tasks
                meId={meId}
                isAdmin={isAdmin}
                indicators={indicators}
                t={t}
                kind="assignment"
                onlyMine={onlyMine}
                focusId={focusId}
                onFocusDone={onFocusDone}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
