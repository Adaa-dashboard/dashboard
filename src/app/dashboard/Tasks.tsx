"use client";

import { apiFetch } from "@/lib/api";

import { useCallback, useEffect, useMemo, useState } from "react";

type State = "ok" | "risk" | "done";
type Priority = "high" | "mid";

type Update = { id: string; text: string; byName: string; at: string };
type Task = {
  id: string;
  title: string;
  description?: string;
  assigneeId: string;
  priority: Priority;
  dueDate: string;
  indicatorId?: string;
  state: State;
  updates: Update[];
  createdById: string;
  createdAt: string;
  completedAt?: string;
};
type Person = { id: string; name: string; role: string };
type Indicator = { id: string; name: string };

const STATE_COLOR: Record<State | "late", string> = {
  ok: "#1a9d5c",
  risk: "#e0971a",
  done: "#8a9a95",
  late: "#d34a4a",
};

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
function daysBetween(a: string, b: string) {
  return Math.round((new Date(a).getTime() - new Date(b).getTime()) / 86400000);
}
function arDays(n: number) {
  if (n === 1) return "يوم";
  if (n === 2) return "يومان";
  if (n <= 10) return `${n} أيام`;
  return `${n} يومًا`;
}

/** العمود الذي تقع فيه المهمة: مكتملة · متأخرة · هذا الأسبوع · بقية المهام. */
function columnOf(t: Task): "done" | "late" | "week" | "main" {
  if (t.state === "done") return "done";
  const d = daysBetween(t.dueDate, todayISO());
  if (d < 0) return "late";
  if (d <= 7) return "week";
  return "main";
}

function leftText(t: Task): string {
  if (t.state === "done") return "اكتملت";
  const d = daysBetween(t.dueDate, todayISO());
  if (d < 0) return `متأخرة ${arDays(-d)}`;
  if (d === 0) return "تنتهي اليوم";
  return `باقٍ ${arDays(d)}`;
}

export default function Tasks({
  meId,
  isAdmin,
  indicators,
  t,
}: {
  meId: string;
  isAdmin: boolean;
  indicators: Indicator[];
  t: (ar: string, en: string) => string;
}) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [onlyDone, setOnlyDone] = useState(false);
  const [open, setOpen] = useState<Task | null>(null);
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    const r = await apiFetch("/api/tasks").then((x) => x.json());
    setTasks(r.tasks || []);
    setPeople(r.people || []);
    setLoaded(true);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const nameOf = useCallback(
    (id: string) => people.find((p) => p.id === id)?.name || "—",
    [people]
  );

  const cols = useMemo(() => {
    const src = onlyDone ? tasks.filter((x) => x.state === "done") : tasks;
    const g: Record<string, Task[]> = { main: [], week: [], late: [], done: [] };
    for (const x of src) g[columnOf(x)].push(x);
    g.main.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    g.week.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    g.late.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    g.done.sort((a, b) => (b.completedAt || "").localeCompare(a.completedAt || ""));
    return g;
  }, [tasks, onlyDone]);

  async function saveState(task: Task, state: State, text: string) {
    const r = await apiFetch(`/api/tasks/${task.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state, text }),
    }).then((x) => x.json());
    if (r.error) {
      setErr(r.error);
      return;
    }
    setOpen(null);
    load();
  }

  const COLS: { key: "main" | "week" | "late" | "done"; title: string; hint: string; color: string }[] = [
    { key: "main", title: t("المهام", "Tasks"), hint: t("الأحدث أولاً", "Newest first"), color: "#016b5f" },
    {
      key: "week",
      title: t("المتوقع تسليمها هذا الأسبوع", "Due this week"),
      hint: t("خلال 7 أيام", "Within 7 days"),
      color: "#e0971a",
    },
    { key: "late", title: t("المتأخرة", "Overdue"), hint: t("تجاوزت موعدها", "Past due"), color: "#d34a4a" },
    { key: "done", title: t("المكتملة", "Completed"), hint: t("أُغلقت", "Closed"), color: "#5aaba2" },
  ];

  return (
    <div>
      <div className="toolbar">
        <div className="chips">
          <button className={`chip ${!onlyDone ? "on" : ""}`} onClick={() => setOnlyDone(false)}>
            {t("الكل", "All")} · {tasks.length}
          </button>
          <button className={`chip ${onlyDone ? "on" : ""}`} onClick={() => setOnlyDone(true)}>
            {t("المكتملة", "Completed")} · {tasks.filter((x) => x.state === "done").length}
          </button>
        </div>
        <div style={{ flex: 1 }} />
        <button className="btn btn-sm" onClick={() => setCreating(true)}>
          ＋ {t("مهمة جديدة", "New task")}
        </button>
      </div>

      {err && <div className="alert alert-error">{err}</div>}

      {!loaded ? (
        <div className="empty">{t("جارٍ التحميل...", "Loading...")}</div>
      ) : tasks.length === 0 ? (
        <div className="soon">
          <b>{t("لا توجد مهام بعد", "No tasks yet")}</b>
          {t("أنشئي أول مهمة وأسنديها لأحد المدراء.", "Create the first task and assign it.")}
        </div>
      ) : (
        <div className="tboard">
          {COLS.map((c) => (
            <div className="tcol" key={c.key}>
              <div className="tcol-h">
                <i className="gd" style={{ background: c.color }} />
                {c.title}
                <b className="cnt">{cols[c.key].length}</b>
              </div>
              <div className="tcol-s">{c.hint}</div>
              {cols[c.key].map((x) => {
                const late = columnOf(x) === "late";
                const col = late ? STATE_COLOR.late : STATE_COLOR[x.state];
                return (
                  <button key={x.id} className={`tk ${x.assigneeId === meId ? "mine" : ""}`} onClick={() => setOpen(x)}>
                    <span className="tk-t">{x.title}</span>
                    <span className="tk-m">
                      <span className="av s">{(nameOf(x.assigneeId) || "?").trim().charAt(0)}</span>
                      {nameOf(x.assigneeId)}
                      <span className={`pr ${x.priority === "high" ? "hi" : ""}`}>
                        {x.priority === "high" ? t("مهمة جداً", "High") : t("متوسطة", "Medium")}
                      </span>
                      {x.assigneeId === meId && <span className="mineflag">{t("مسندة لك", "Yours")}</span>}
                    </span>
                    <span className="tk-f">
                      <span className="dt ltr">{x.dueDate}</span>
                      <span className="lf">{leftText(x)}</span>
                      <span className="stt">
                        <i style={{ background: col }} />
                        {late
                          ? t("متأخرة", "Overdue")
                          : x.state === "done"
                            ? t("مكتملة", "Done")
                            : x.state === "risk"
                              ? t("فيها تحدٍ", "At risk")
                              : t("على المسار", "On track")}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {open && (
        <TaskDetail
          task={open}
          who={nameOf(open.assigneeId)}
          indicatorName={indicators.find((i) => i.id === open.indicatorId)?.name}
          canEdit={isAdmin || open.assigneeId === meId || open.createdById === meId}
          onClose={() => setOpen(null)}
          onSave={saveState}
          t={t}
        />
      )}

      {creating && (
        <NewTask
          people={people}
          indicators={indicators}
          onClose={() => setCreating(false)}
          onDone={() => {
            setCreating(false);
            load();
          }}
          t={t}
        />
      )}
    </div>
  );
}

/* ============ تفاصيل المهمة ============ */
function TaskDetail({
  task,
  who,
  indicatorName,
  canEdit,
  onClose,
  onSave,
  t,
}: {
  task: Task;
  who: string;
  indicatorName?: string;
  canEdit: boolean;
  onClose: () => void;
  onSave: (task: Task, state: State, text: string) => void;
  t: (ar: string, en: string) => string;
}) {
  const [state, setState] = useState<State>(task.state);
  const [text, setText] = useState("");
  const late = columnOf(task) === "late";

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal task-modal" onClick={(e) => e.stopPropagation()}>
        <div className="m-h">
          <h3>{task.title}</h3>
          <button className="mx" onClick={onClose} aria-label="close">
            ✕
          </button>
        </div>
        <div className="m-b">
          <div className="dmeta">
            <span>
              <span className="av s">{(who || "?").trim().charAt(0)}</span>
              {who}
            </span>
            <span className={`pr ${task.priority === "high" ? "hi" : ""}`}>
              {task.priority === "high" ? t("مهمة جداً", "High") : t("متوسطة", "Medium")}
            </span>
            <span className="ltr">📅 {task.dueDate}</span>
            <span style={{ fontWeight: 700, color: late ? "#b13636" : "var(--ink-2)" }}>{leftText(task)}</span>
          </div>
          {task.description && <div className="dind">{task.description}</div>}
          <div className="dind">
            ◎ {indicatorName ? t(`مرتبطة بـ «${indicatorName}»`, indicatorName) : t("غير مرتبطة بمؤشر", "No linked KPI")}
          </div>

          {canEdit && (
            <>
              <label>{t("الحالة", "Status")}</label>
              <div className="segs">
                {(["ok", "risk", "done"] as State[]).map((s) => (
                  <button key={s} className={`sg ${state === s ? "on" : ""}`} onClick={() => setState(s)}>
                    {s === "ok" ? t("على المسار", "On track") : s === "risk" ? t("فيها تحدٍ", "At risk") : t("مكتملة", "Done")}
                  </button>
                ))}
              </div>
            </>
          )}

          <label>{t("التحديثات", "Updates")}</label>
          {task.updates.length === 0 ? (
            <div className="empty" style={{ padding: 14 }}>
              {t("لا توجد تحديثات بعد.", "No updates yet.")}
            </div>
          ) : (
            <div className="upl">
              {[...task.updates].reverse().map((u) => (
                <div className="ui" key={u.id}>
                  <span className="av s">{(u.byName || "?").trim().charAt(0)}</span>
                  <div>
                    <b>{u.byName}</b>
                    <span className="dt ltr">{u.at.slice(0, 16).replace("T", " ")}</span>
                    <p>{u.text}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {canEdit && (
            <>
              <label>{t("إضافة تحديث", "Add update")}</label>
              <textarea
                rows={3}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={t("اكتبي ما استجدّ…", "What changed?")}
              />
            </>
          )}
        </div>
        <div className="m-f">
          <button className="btn btn-ghost btn-sm" onClick={onClose}>
            {t("إغلاق", "Close")}
          </button>
          {canEdit && (
            <button className="btn btn-sm" onClick={() => onSave(task, state, text)}>
              {t("حفظ التحديث", "Save update")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ============ مهمة جديدة ============ */
function NewTask({
  people,
  indicators,
  onClose,
  onDone,
  t,
}: {
  people: Person[];
  indicators: Indicator[];
  onClose: () => void;
  onDone: () => void;
  t: (ar: string, en: string) => string;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assigneeId, setAssigneeId] = useState(people[0]?.id || "");
  const [dueDate, setDueDate] = useState(todayISO());
  const [priority, setPriority] = useState<Priority>("mid");
  const [indicatorId, setIndicatorId] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setErr("");
    const r = await apiFetch("/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title, description, assigneeId, dueDate, priority, indicatorId }),
    }).then((x) => x.json());
    setBusy(false);
    if (r.error) {
      setErr(r.error);
      return;
    }
    onDone();
  }

  const who = people.find((p) => p.id === assigneeId)?.name || "";

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal task-modal" onClick={(e) => e.stopPropagation()}>
        <div className="m-h">
          <h3>{t("مهمة جديدة", "New task")}</h3>
          <button className="mx" onClick={onClose} aria-label="close">
            ✕
          </button>
        </div>
        <div className="m-b">
          {err && <div className="alert alert-error">{err}</div>}

          <label>{t("عنوان المهمة", "Title")}</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} />

          <label>
            {t("الوصف", "Description")} <span className="opt">{t("اختياري", "optional")}</span>
          </label>
          <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />

          <div className="m2">
            <div>
              <label>{t("المسؤول", "Assignee")}</label>
              <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label>{t("تاريخ النهاية", "Due date")}</label>
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          </div>

          <label>{t("الأهمية", "Priority")}</label>
          <div className="segs">
            <button className={`sg ${priority === "high" ? "on hi" : ""}`} onClick={() => setPriority("high")}>
              {t("مهمة جداً", "High")}
            </button>
            <button className={`sg ${priority === "mid" ? "on" : ""}`} onClick={() => setPriority("mid")}>
              {t("متوسطة", "Medium")}
            </button>
          </div>

          <label>
            {t("مرتبطة بمؤشر", "Linked KPI")} <span className="opt">{t("اختياري", "optional")}</span>
          </label>
          <select value={indicatorId} onChange={(e) => setIndicatorId(e.target.value)}>
            <option value="">{t("بلا ربط", "None")}</option>
            {indicators.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>

          {who && (
            <div className="note-i">
              🔔 {t(`يصل إشعار لـ ${who} فور الإنشاء، وتظهر المهمة عنده.`, `${who} will be notified.`)}
            </div>
          )}
        </div>
        <div className="m-f">
          <button className="btn btn-ghost btn-sm" onClick={onClose}>
            {t("إلغاء", "Cancel")}
          </button>
          <button className="btn btn-sm" onClick={submit} disabled={busy || !title.trim() || !assigneeId}>
            {t("إنشاء المهمة", "Create task")}
          </button>
        </div>
      </div>
    </div>
  );
}
