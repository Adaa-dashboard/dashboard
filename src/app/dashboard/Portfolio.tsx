"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { apiFetch } from "@/lib/api";
import { loadUserData, saveUserData } from "@/lib/userdata";
import { sb } from "@/lib/supa";
import { Cal } from "./Tools";
import { EMPTY_NOTES, firstLine, preview, whenAr, type NotesData } from "./Notes";

/* ============================================================
   محفظتي — الصفحة الشخصية لكل موظف.
   مهامه (المسندة من مديره وما يضيفه لنفسه) وتقويمه وملاحظاته،
   ثم مشاريعه الاستراتيجية وأعماله التشغيلية.
   كل بند بطاقة تُضغط فتفتح جدولها، أو جدولاً مفروداً — حسب
   اختياره. الترتيب والقالب واللون والخلفية تخصّه وحده.
   ============================================================ */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Rec = Record<string, any>;
type T = (ar: string, en: string) => string;
type Me = { id: string; name: string; role: string; jobTitle?: string; scopes: string[] };

export type Row = { section: string; id: string; ord: number; data: Rec; updatedAt?: string };

const num = (v: unknown, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const txt = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/* ---------------- الويدجت المتاحة ---------------- */
export type WKey =
  | "tasks" | "calendar" | "notes"
  | "projects" | "strategies" | "quarterly" | "contrib"
  | "changes" | "reverse" | "workflow";

type WDef = {
  key: WKey;
  label: string;
  group: "top" | "projects" | "ops";
  icon: string;
  color: string;
  section?: string; // قسم البيانات في perf_portfolio
};

export const WIDGETS: WDef[] = [
  { key: "tasks", label: "مهامي", group: "top", icon: "✓", color: "#016b5f" },
  { key: "calendar", label: "التقويم", group: "top", icon: "◷", color: "#1a9d5c" },
  { key: "notes", label: "ملاحظاتي", group: "top", icon: "✎", color: "#c9a020" },
  { key: "projects", label: "المشاريع الاستراتيجية", group: "projects", icon: "★", color: "#0f8a8a", section: "projects" },
  { key: "strategies", label: "البرامج والاستراتيجيات", group: "ops", icon: "▤", color: "#016b5f", section: "entities" },
  { key: "quarterly", label: "التقارير الربعية", group: "ops", icon: "◷", color: "#1a9d5c", section: "entities" },
  { key: "contrib", label: "المساهمات في الخطة التشغيلية", group: "ops", icon: "◈", color: "#7a5cd1", section: "contrib" },
  { key: "changes", label: "طلبات التغيير", group: "ops", icon: "⇄", color: "#c9a020", section: "changes" },
  { key: "reverse", label: "طلبات العكس", group: "ops", icon: "↺", color: "#e07a3a", section: "reverse" },
  { key: "workflow", label: "طلبات تحديث سير العمل", group: "ops", icon: "⚙", color: "#a24160", section: "workflow" },
];
const WMAP: Record<string, WDef> = Object.fromEntries(WIDGETS.map((w) => [w.key, w])) as Record<string, WDef>;

/* ---------------- تفضيلات الصفحة ---------------- */
type Prefs = {
  mode: "tiles" | "table";
  layout: "two" | "one" | "three" | "main";
  order: WKey[];
  hidden: WKey[];
  color: string;
  bg: string;
  bgDim: number;
};
const DEFAULT_PREFS: Prefs = {
  mode: "tiles",
  layout: "two",
  order: WIDGETS.map((w) => w.key),
  hidden: [],
  color: "#00584c",
  bg: "",
  bgDim: 35,
};

/* أعمدة كل قسم — تُستعمل في الجداول وفي نافذة الإدخال */
type Col = { k: string; label: string; kind?: "num" | "text" | "date" | "sel"; opts?: string[]; w?: number };
const COLS: Record<string, Col[]> = {
  entities: [
    { k: "name", label: "اسم الجهة أو الاستراتيجية", w: 3 },
    { k: "type", label: "النوع", kind: "sel", opts: ["مؤسسية", "وطنية", "مناطقية", "برنامج"] },
    { k: "initiatives", label: "عدد المبادرات", kind: "num" },
    { k: "kpis", label: "عدد المؤشرات", kind: "num" },
    { k: "note", label: "آخر تحديث", w: 3 },
  ],
  contrib: [
    { k: "kind", label: "النوع", kind: "sel", opts: ["مؤشر", "مبادرة", "مكاسب سريعة"] },
    { k: "name", label: "البند", w: 3 },
    { k: "status", label: "الحالة", kind: "sel", opts: ["قيد العمل", "بانتظار بيانات", "مكتمل"] },
    { k: "pct", label: "نسبة الإنجاز ٪", kind: "num" },
    { k: "closed", label: "تاريخ الإغلاق", kind: "date" },
  ],
  changes: [
    { k: "code", label: "رمز المؤشر", w: 2 },
    { k: "entity", label: "الجهة", w: 2 },
    { k: "status", label: "الحالة", kind: "sel", opts: ["قيد العمل", "متأخر", "مغلقة"] },
    { k: "days", label: "الأيام", kind: "num" },
  ],
  reverse: [
    { k: "code", label: "رقم الطلب", w: 2 },
    { k: "status", label: "الحالة", kind: "sel", opts: ["قيد العمل", "مغلقة"] },
  ],
  workflow: [
    { k: "code", label: "رقم الطلب", w: 2 },
    { k: "status", label: "الحالة", kind: "sel", opts: ["قيد العمل", "مغلقة"] },
  ],
  projects: [
    { k: "name", label: "اسم المشروع", w: 2 },
    { k: "desc", label: "الوصف", w: 3 },
    { k: "status", label: "الحالة" },
    { k: "mine", label: "مهامي", w: 2 },
  ],
};

/* ---------------- تحميل صفوف المحفظة ---------------- */
function usePortfolio(userId?: string) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const r = await apiFetch(`/api/portfolio${userId ? `?user=${userId}` : ""}`);
    const d = await r.json().catch(() => ({}));
    setRows(Array.isArray(d.items) ? d.items : []);
    setLoaded(true);
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(
    async (section: string, id: string, data: Rec, ord = 100) => {
      await apiFetch("/api/portfolio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ section, id: id || "pf-" + newId(), data, ord }),
      });
      await load();
    },
    [load],
  );

  const saveMany = useCallback(
    async (items: { section: string; id?: string; data: Rec; ord?: number }[]) => {
      if (!items.length) return;
      await apiFetch("/api/portfolio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      await load();
    },
    [load],
  );

  const remove = useCallback(
    async (section: string, id: string) => {
      await apiFetch(`/api/portfolio?section=${section}&id=${encodeURIComponent(id)}`, { method: "DELETE" });
      await load();
    },
    [load],
  );

  const of = useCallback((section: string) => rows.filter((r) => r.section === section), [rows]);
  return { rows, of, loaded, reload: load, save, saveMany, remove };
}

/* ---------------- مهامي ---------------- */
type Task = {
  id: string; title: string; description?: string; assigneeId: string; createdById: string;
  dueDate: string; state: string; kind?: string; priority: string;
  updates?: { by?: string; byName?: string; text: string; at: string }[];
};

function dueTone(d: string, state: string) {
  if (state === "done") return "";
  if (!d) return "";
  const days = Math.round((new Date(d).getTime() - Date.now()) / 86400000);
  return days < 0 ? "r" : days <= 2 ? "a" : "";
}
function dueLabel(d: string, t: T) {
  if (!d) return t("بلا موعد", "No due date");
  const days = Math.round((new Date(d).getTime() - new Date(new Date().toISOString().slice(0, 10)).getTime()) / 86400000);
  if (days === 0) return t("اليوم", "Today");
  if (days === 1) return t("غداً", "Tomorrow");
  if (days === 2) return t("بعد يومين", "In 2 days");
  if (days < 0) return `${t("متأخرة", "Late")} ${Math.abs(days)} ${t("يوم", "d")}`;
  return d;
}

function TasksWidget({ me, t, onCount }: { me: Me; t: T; onCount?: (n: number) => void }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [filter, setFilter] = useState<"all" | "boss" | "self" | "done">("all");
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [newT, setNewT] = useState({ title: "", dueDate: "" });

  const load = useCallback(async () => {
    const d = await apiFetch("/api/tasks").then((r) => r.json()).catch(() => ({}));
    const mine: Task[] = (d.tasks || []).filter((x: Task) => x.assigneeId === me.id);
    setTasks(mine);
    onCount?.(mine.filter((x) => x.state !== "done").length);
  }, [me.id, onCount]);
  useEffect(() => {
    void load();
  }, [load]);

  const isBoss = (x: Task) => x.createdById !== me.id;
  const openTasks = tasks.filter((x) => x.state !== "done");
  const shown = tasks.filter((x) => {
    if (filter === "done") return x.state === "done";
    if (x.state === "done") return false;
    if (filter === "boss") return isBoss(x);
    if (filter === "self") return !isBoss(x);
    return true;
  });

  async function addUpdate(id: string) {
    const text = draft.trim();
    if (!text) return;
    await apiFetch(`/api/tasks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    setDraft("");
    setOpen(null);
    await load();
  }
  async function done(id: string) {
    await apiFetch(`/api/tasks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: "done" }),
    });
    await load();
  }
  async function del(id: string) {
    if (!confirm(t("حذف المهمة؟", "Delete task?"))) return;
    await apiFetch(`/api/tasks/${id}`, { method: "DELETE" });
    await load();
  }
  async function create() {
    const title = newT.title.trim();
    if (!title) return;
    await apiFetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, assigneeId: me.id, dueDate: newT.dueDate || null, priority: "normal" }),
    });
    setNewT({ title: "", dueDate: "" });
    setAdding(false);
    await load();
  }

  const chip = (k: typeof filter, label: string, n: number) => (
    <span className={filter === k ? "on" : ""} onClick={() => setFilter(k)}>
      {label} ({n})
    </span>
  );

  return (
    <>
      <div className="tfil">
        {chip("all", t("الكل", "All"), openTasks.length)}
        {chip("boss", t("من مديري", "From my manager"), openTasks.filter(isBoss).length)}
        {chip("self", t("مهامي الذاتية", "My own"), openTasks.filter((x) => !isBoss(x)).length)}
        {chip("done", t("المكتملة", "Done"), tasks.filter((x) => x.state === "done").length)}
      </div>

      {!shown.length && <div className="pf-none">{t("لا توجد مهام هنا.", "Nothing here.")}</div>}

      {shown.map((x) => {
        const boss = isBoss(x);
        const ups = Array.isArray(x.updates) ? x.updates : [];
        return (
          <div className={`tcard ${boss ? "boss" : ""}`} key={x.id}>
            <div className="r1">
              <span className="ttl2">{x.title}</span>
              <span className={`from ${boss ? "" : "self"}`}>
                {boss ? t("من مديري", "From manager") : t("مهمة ذاتية", "Self")}
              </span>
            </div>
            <div className="r2">
              <i className={dueTone(x.dueDate, x.state)} />
              {dueLabel(x.dueDate, t)}
              <span className="acts2">
                {ups.length > 0 && (
                  <span className="ac2" onClick={() => setOpen(open === x.id ? null : x.id)}>
                    {ups.length} {t("تحديثات", "updates")}
                  </span>
                )}
                <span className="ac2" onClick={() => setOpen(open === x.id ? null : x.id)}>
                  + {t("تحديث", "Update")}
                </span>
                {x.state !== "done" && (
                  <span className="ac2" onClick={() => done(x.id)}>
                    ✓ {t("إنهاء", "Done")}
                  </span>
                )}
                {boss ? (
                  <span className="lock" title={t("مسندة من مديرك — لا يمكن حذفها", "Assigned by your manager")}>
                    🔒
                  </span>
                ) : (
                  <span className="ac2 del2" onClick={() => del(x.id)}>
                    ✕
                  </span>
                )}
              </span>
            </div>
            {(open === x.id || ups.length > 0) && (
              <div className="upd">
                {ups.map((u, i) => (
                  <div className="u" key={i}>
                    <b>{u.byName || ""}:</b>
                    <span>{u.text}</span>
                    <span className="d">{txt(u.at).slice(0, 10)}</span>
                  </div>
                ))}
                {open === x.id && (
                  <div className="updbox">
                    <input
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      placeholder={t("اكتب تحديثاً يظهر لمديرك…", "Write an update…")}
                      onKeyDown={(e) => e.key === "Enter" && addUpdate(x.id)}
                    />
                    <button className="btn btn-sm" onClick={() => addUpdate(x.id)}>
                      {t("إرسال", "Send")}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {adding ? (
        <div className="updbox" style={{ marginTop: 8 }}>
          <input
            autoFocus
            value={newT.title}
            onChange={(e) => setNewT({ ...newT, title: e.target.value })}
            placeholder={t("عنوان المهمة", "Task title")}
          />
          <input
            type="date"
            value={newT.dueDate}
            onChange={(e) => setNewT({ ...newT, dueDate: e.target.value })}
            style={{ maxWidth: 150 }}
          />
          <button className="btn btn-sm" onClick={create}>
            {t("إضافة", "Add")}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => setAdding(false)}>
            {t("إلغاء", "Cancel")}
          </button>
        </div>
      ) : (
        <div className="addrow" onClick={() => setAdding(true)}>
          + {t("مهمة جديدة لنفسي", "New task for me")}
        </div>
      )}
    </>
  );
}

/* ---------------- ملاحظاتي ---------------- */
function NotesWidget({ t, onOpen }: { t: T; onOpen: () => void }) {
  const [data, setData] = useState<NotesData>(EMPTY_NOTES);
  useEffect(() => {
    void loadUserData<NotesData>("notes", EMPTY_NOTES).then((d) => setData(d || EMPTY_NOTES));
  }, []);
  const list = [...(data.notes || [])]
    .sort((a, b) => txt(b.updatedAt).localeCompare(txt(a.updatedAt)))
    .slice(0, 4);
  return (
    <>
      <div className="nts">
        {list.map((n) => (
          <div className="nt2" key={n.id}>
            <div className="t">{firstLine(n)}</div>
            <div className="x">{preview(n)}</div>
            <div className="m">{whenAr(n.updatedAt)}</div>
          </div>
        ))}
        {!list.length && <div className="pf-none">{t("لا توجد ملاحظات بعد.", "No notes yet.")}</div>}
      </div>
      <div className="addrow" onClick={onOpen}>
        + {t("ملاحظة جديدة", "New note")}
      </div>
    </>
  );
}

/* ---------------- جدول قسم ---------------- */
function SectionTable({
  section,
  rows,
  t,
  onSave,
  onDelete,
  onImport,
}: {
  section: string;
  rows: Row[];
  t: T;
  onSave: (id: string, data: Rec) => void;
  onDelete: (id: string) => void;
  onImport: () => void;
}) {
  const cols = COLS[section] || [];
  const [edit, setEdit] = useState<Row | "new" | null>(null);
  return (
    <>
      <div className="pf-tb">
        <button className="b" onClick={onImport}>
          ⬆ {t("رفع إكسل / لصق", "Import")}
        </button>
        <button className="b" onClick={() => setEdit("new")}>
          + {t("إضافة", "Add")}
        </button>
        <span className="cnt">
          {t("إجمالي", "Total")}: {rows.length}
        </span>
      </div>
      <div className="pf-tw">
        <table className="pf-t">
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c.k}>{c.label}</th>
              ))}
              <th style={{ width: 70 }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                {cols.map((c, i) => (
                  <td key={c.k} className={i === 0 ? "nm" : ""}>
                    {c.kind === "sel" && r.data[c.k] ? (
                      <span className="chip">{txt(r.data[c.k])}</span>
                    ) : (
                      txt(r.data[c.k]) || "—"
                    )}
                  </td>
                ))}
                <td className="acts3">
                  <span onClick={() => setEdit(r)}>{t("تعديل", "Edit")}</span>
                  <span className="del" onClick={() => onDelete(r.id)}>
                    {t("حذف", "Delete")}
                  </span>
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={cols.length + 1} className="pf-none">
                  {t("لا توجد بيانات — أضف بنداً أو ارفع ملفاً.", "No data yet.")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {edit && (
        <RowForm
          cols={cols}
          row={edit === "new" ? null : edit}
          t={t}
          onClose={(data) => {
            if (data) onSave(edit === "new" ? "" : edit.id, data);
            setEdit(null);
          }}
        />
      )}
    </>
  );
}

function RowForm({
  cols,
  row,
  t,
  onClose,
}: {
  cols: Col[];
  row: Row | null;
  t: T;
  onClose: (data: Rec | null) => void;
}) {
  const [form, setForm] = useState<Rec>(() => ({ ...(row?.data || {}) }));
  return (
    <div className="modal-overlay" onClick={() => onClose(null)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="m-h">
          <h3>{row ? t("تعديل بند", "Edit") : t("بند جديد", "New item")}</h3>
          <button className="mx" onClick={() => onClose(null)} aria-label="close">
            ✕
          </button>
        </div>
        <div className="sx-form">
          {cols.map((c) => (
            <label key={c.k}>
              <span>{c.label}</span>
              {c.kind === "sel" ? (
                <select value={form[c.k] ?? ""} onChange={(e) => setForm({ ...form, [c.k]: e.target.value })}>
                  <option value="">—</option>
                  {(c.opts || []).map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type={c.kind === "num" ? "number" : "text"}
                  placeholder={c.kind === "date" ? "YYYY-MM-DD" : ""}
                  value={form[c.k] ?? ""}
                  onChange={(e) => setForm({ ...form, [c.k]: e.target.value })}
                />
              )}
            </label>
          ))}
        </div>
        <div className="m-f">
          <button className="btn btn-ghost" onClick={() => onClose(null)}>
            {t("إلغاء", "Cancel")}
          </button>
          <button className="btn" onClick={() => onClose(form)}>
            {t("حفظ", "Save")}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- التقارير الربعية ---------------- */
function Quarterly({ rows, t, onToggle }: { rows: Row[]; t: T; onToggle: (r: Row, q: number) => void }) {
  const curQ = Math.floor(new Date().getMonth() / 3) + 1;
  if (!rows.length) return <div className="pf-none">{t("أضف جهاتك أولاً من مربع «جهاتي».", "Add your entities first.")}</div>;
  return (
    <div className="qg">
      {rows.map((r) => {
        const q: number[] = Array.isArray(r.data.q) ? r.data.q : [0, 0, 0, 0];
        return (
          <div className="qt" key={r.id}>
            <div className="nm">{txt(r.data.name)}</div>
            <div className="qs">
              {[0, 1, 2, 3].map((i) => (
                <button
                  key={i}
                  className={`qq ${q[i] ? "ok" : i + 1 === curQ ? "now" : ""}`}
                  onClick={() => onToggle(r, i)}
                  title={`${t("الربع", "Q")} ${i + 1}`}
                >
                  <span>ر{i + 1}</span>
                  <b>{q[i] ? "✓" : i + 1 === curQ ? "•" : ""}</b>
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------------- المساهمات: ثلاثة أعمدة ---------------- */
const KINDS = ["مؤشر", "مبادرة", "مكاسب سريعة"];
function Contrib({ rows, t }: { rows: Row[]; t: T }) {
  if (!rows.length) return <div className="pf-none">{t("لا توجد مساهمات بعد.", "Nothing yet.")}</div>;
  return (
    <div className="c3">
      {KINDS.map((k) => {
        const list = rows.filter((r) => txt(r.data.kind) === k);
        return (
          <div className="col2" key={k}>
            <div className="h">
              {k === "مؤشر" ? "مؤشرات" : k === "مبادرة" ? "مبادرات" : "مكاسب سريعة"}
              <b>{list.length}</b>
            </div>
            {list.map((r) => (
              <div className="li" key={r.id}>
                {txt(r.data.name)}
                <span className="chip">{txt(r.data.status) || `${num(r.data.pct)}٪`}</span>
              </div>
            ))}
            {!list.length && <div className="pf-none sm">—</div>}
          </div>
        );
      })}
    </div>
  );
}

/* ---------------- بطاقة مختصرة ---------------- */
function Tile({
  w,
  count,
  sub,
  pct,
  warn,
  onOpen,
  onHide,
  dragProps,
}: {
  w: WDef;
  count: number;
  sub: string;
  pct: number;
  warn?: string;
  onOpen: () => void;
  onHide: () => void;
  dragProps: Rec;
}) {
  const r = 18;
  const c = 2 * Math.PI * r;
  return (
    <div className="tile" onClick={onOpen} {...dragProps}>
      <span className="grip" title="اسحب" onClick={(e) => e.stopPropagation()}>
        ⋮⋮
      </span>
      <span
        className="hide"
        title="إخفاء"
        onClick={(e) => {
          e.stopPropagation();
          onHide();
        }}
      >
        ✕
      </span>
      <div className="num">
        <svg width="46" height="46" viewBox="0 0 46 46">
          <circle cx="23" cy="23" r={r} fill="none" stroke="#eef2f1" strokeWidth="5" />
          <circle
            cx="23"
            cy="23"
            r={r}
            fill="none"
            stroke={w.color}
            strokeWidth="5"
            strokeLinecap="round"
            strokeDasharray={`${(c * pct) / 100} ${c}`}
            transform="rotate(-90 23 23)"
          />
          <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central" className="tnum" fill={w.color}>
            {count}
          </text>
        </svg>
      </div>
      {warn ? <span className="warn">{warn}</span> : null}
      <div className="ic3" style={{ background: w.color }}>
        {w.icon}
      </div>
      <h4>{w.label}</h4>
      <div className="sb2">{sub}</div>
      <div className="ft2">
        <span className="bar4">
          <i style={{ width: `${pct}%`, background: w.color }} />
        </span>
        <span className="pc" style={{ color: w.color }}>
          {pct}%
        </span>
      </div>
      <span className="go">↩ اضغط للتفاصيل</span>
    </div>
  );
}

/* ---------------- نافذة جهاتي ---------------- */
function EntitiesModal({
  rows,
  t,
  onClose,
  onSave,
  onDelete,
}: {
  rows: Row[];
  t: T;
  onClose: () => void;
  onSave: (id: string, data: Rec) => void;
  onDelete: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState("مؤسسية");
  const [edit, setEdit] = useState<Row | null>(null);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="m-h">
          <h3>{t("جهاتي", "My entities")}</h3>
          <span className="cnt2">
            {rows.length} {t("جهة", "entities")}
          </span>
          <button className="mx" onClick={onClose} aria-label="close">
            ✕
          </button>
        </div>
        <div>
          {rows.map((r) => (
            <div className="erow2" key={r.id}>
              {edit?.id === r.id ? (
                <>
                  <input
                    className="grow"
                    value={txt(edit.data.name)}
                    onChange={(e) => setEdit({ ...edit, data: { ...edit.data, name: e.target.value } })}
                  />
                  <select
                    value={txt(edit.data.type)}
                    onChange={(e) => setEdit({ ...edit, data: { ...edit.data, type: e.target.value } })}
                  >
                    {["مؤسسية", "وطنية", "مناطقية", "برنامج"].map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                  </select>
                  <span
                    className="ac"
                    onClick={() => {
                      onSave(r.id, edit.data);
                      setEdit(null);
                    }}
                  >
                    {t("حفظ", "Save")}
                  </span>
                </>
              ) : (
                <>
                  <span className="n">
                    {txt(r.data.name)}
                    <em>
                      {txt(r.data.type)}
                      {num(r.data.initiatives) ? ` · ${num(r.data.initiatives)} مبادرة` : ""}
                      {num(r.data.kpis) ? ` · ${num(r.data.kpis)} مؤشراً` : ""}
                    </em>
                  </span>
                  <span className="ac" onClick={() => setEdit(r)}>
                    {t("تعديل", "Edit")}
                  </span>
                  <span className="ac del" onClick={() => onDelete(r.id)}>
                    {t("حذف", "Delete")}
                  </span>
                </>
              )}
            </div>
          ))}
          {!rows.length && <div className="pf-none">{t("لا توجد جهات بعد.", "No entities yet.")}</div>}
          <div className="addent">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("اسم الجهة أو الاستراتيجية", "Entity or strategy")}
            />
            <select value={type} onChange={(e) => setType(e.target.value)}>
              {["مؤسسية", "وطنية", "مناطقية", "برنامج"].map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
            <button
              className="go2"
              onClick={() => {
                if (!name.trim()) return;
                onSave("", { name: name.trim(), type, q: [0, 0, 0, 0] });
                setName("");
              }}
            >
              + {t("إضافة", "Add")}
            </button>
          </div>
          <div className="pf-hint">
            {t(
              "ما تضيفينه هنا يظهر في «البرامج والاستراتيجيات» و«التقارير الربعية» تلقائياً.",
              "Added entities appear in your strategies and quarterly widgets.",
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------- نافذة التخصيص ---------------- */
const SWATCHES = [
  "#00584c", "#016b5f", "#1a9d5c", "#0f8a8a", "#2f7fd1", "#123a6b",
  "#7a5cd1", "#a24160", "#c9a020", "#e07a3a", "#4e615c", "#12211d",
];

function CustomModal({
  prefs,
  t,
  meId,
  onClose,
  onChange,
}: {
  prefs: Prefs;
  t: T;
  meId: string;
  onClose: () => void;
  onChange: (p: Partial<Prefs>) => void;
}) {
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState("");

  async function upload(f: File) {
    if (f.size > 3 * 1024 * 1024) {
      setBusy(t("الصورة أكبر من 3 ميغابايت", "Image larger than 3MB"));
      return;
    }
    setBusy(t("جارٍ الرفع...", "Uploading..."));
    const ext = (f.name.split(".").pop() || "jpg").toLowerCase();
    const path = `${meId}/bg-${Date.now()}.${ext}`;
    const { error } = await sb().storage.from("portfolio").upload(path, f, { upsert: true });
    if (error) {
      setBusy(t("تعذّر الرفع — تأكد من تفعيل مساحة التخزين", "Upload failed"));
      return;
    }
    const { data } = sb().storage.from("portfolio").getPublicUrl(path);
    onChange({ bg: data.publicUrl });
    setBusy("");
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="m-h">
          <h3>🎨 {t("تخصيص محفظتي", "Customize")}</h3>
          <button className="mx" onClick={onClose} aria-label="close">
            ✕
          </button>
        </div>

        <div className="sec3">{t("لون الصفحة", "Page color")}</div>
        <div className="sws">
          {SWATCHES.map((c) => (
            <span
              key={c}
              className={`sw2 ${prefs.color.toLowerCase() === c ? "on" : ""}`}
              style={{ background: c }}
              onClick={() => onChange({ color: c })}
            />
          ))}
          <label className="more3" title={t("جميع الألوان", "All colors")}>
            <input type="color" value={prefs.color} onChange={(e) => onChange({ color: e.target.value })} />
          </label>
        </div>
        <div className="hexrow">
          <span>{t("أو اكتب الكود", "Or type the code")}</span>
          <input
            value={prefs.color}
            onChange={(e) => onChange({ color: e.target.value })}
            spellCheck={false}
          />
          <span className="sw2 sm" style={{ background: prefs.color }} />
        </div>

        <div className="sec3">{t("خلفية الصفحة", "Background")}</div>
        <div className="drop" onClick={() => file.current?.click()}>
          <b>{t("اضغط لاختيار صورة من جهازك", "Choose an image")}</b>
          {t("PNG · JPG — الحد 3 ميغابايت", "PNG · JPG — max 3MB")}
        </div>
        <input
          ref={file}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
          }}
        />
        {busy && <div className="pf-hint">{busy}</div>}
        {prefs.bg && (
          <>
            <div className="bgprev">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={prefs.bg} alt="" className="p on" />
              <span className="p none" onClick={() => onChange({ bg: "" })}>
                {t("بلا خلفية", "None")}
              </span>
            </div>
            <div className="rng">
              <span>{t("تعتيم الخلفية", "Dim")}</span>
              <input
                type="range"
                min={0}
                max={80}
                value={prefs.bgDim}
                onChange={(e) => onChange({ bgDim: Number(e.target.value) })}
              />
              <b>{prefs.bgDim}%</b>
            </div>
          </>
        )}

        <div className="sec3">{t("قالب الترتيب", "Layout")}</div>
        <div className="lays">
          {(
            [
              ["two", "عمودان مضغوطان", "الأكثر توازناً — بلا فراغات"],
              ["one", "عمود واحد عريض", "أوضح للقراءة والطباعة"],
              ["three", "ثلاثة أعمدة", "للشاشات العريضة"],
              ["main", "رئيسي وجانبي", "مهامك كبيرة وشريط جانبي"],
            ] as const
          ).map(([k, n, d]) => (
            <div key={k} className={`lay ${prefs.layout === k ? "on" : ""}`} onClick={() => onChange({ layout: k })}>
              <div className={`wf wf-${k}`}>
                <i />
                <i />
                <i />
              </div>
              <div className="nm2">{n}</div>
              <div className="ds">{d}</div>
            </div>
          ))}
        </div>

        <div className="m-f">
          <button
            className="btn btn-ghost"
            onClick={() =>
              onChange({ color: DEFAULT_PREFS.color, bg: "", bgDim: DEFAULT_PREFS.bgDim, layout: DEFAULT_PREFS.layout })
            }
          >
            {t("إعادة الافتراضي", "Reset")}
          </button>
          <button className="btn" onClick={onClose}>
            {t("تم", "Done")}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   الصفحة
   ============================================================ */
export default function Portfolio({
  me,
  t,
  onOpenNotes,
}: {
  me: Me;
  t: T;
  onOpenNotes: () => void;
}) {
  const pf = usePortfolio();
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [ready, setReady] = useState(false);
  const [custom, setCustom] = useState(false);
  const [arrange, setArrange] = useState(false);
  const [ents, setEnts] = useState(false);
  const [open, setOpen] = useState<WKey | null>(null);
  const [drag, setDrag] = useState<WKey | null>(null);
  const [imp, setImp] = useState<string | null>(null);
  const [taskCount, setTaskCount] = useState<number | null>(null);

  useEffect(() => {
    void loadUserData<Partial<Prefs>>("portfolio", {}).then((d) => {
      setPrefs({ ...DEFAULT_PREFS, ...(d || {}) });
      setReady(true);
    });
  }, []);

  const patch = useCallback((p: Partial<Prefs>) => {
    setPrefs((old) => {
      const next = { ...old, ...p };
      void saveUserData("portfolio", next);
      return next;
    });
  }, []);

  /* الترتيب: ما في الإعدادات أولاً ثم أي ويدجت جديدة */
  const order = useMemo(() => {
    const known = prefs.order.filter((k) => WMAP[k]);
    const rest = WIDGETS.map((w) => w.key).filter((k) => !known.includes(k));
    return [...known, ...rest].filter((k) => !prefs.hidden.includes(k));
  }, [prefs.order, prefs.hidden]);

  const entities = pf.of("entities");
  const contrib = pf.of("contrib");
  const changes = pf.of("changes");
  const reverse = pf.of("reverse");
  const workflow = pf.of("workflow");
  const projects = pf.of("projects");

  const dataOf = (k: WKey): Row[] =>
    k === "strategies" || k === "quarterly"
      ? entities
      : k === "contrib"
        ? contrib
        : k === "changes"
          ? changes
          : k === "reverse"
            ? reverse
            : k === "workflow"
              ? workflow
              : k === "projects"
                ? projects
                : [];

  const doneOf = (rows: Row[]) =>
    rows.filter((r) => ["مغلقة", "مكتمل", "مكتملة", "منجز"].includes(txt(r.data.status))).length;

  const lateChanges = changes.filter((r) => txt(r.data.status) === "متأخر").length;
  const commit = changes.length ? Math.round(((changes.length - lateChanges) / changes.length) * 100) : 0;
  const curQ = Math.floor(new Date().getMonth() / 3) + 1;
  const qLate = entities.filter((r) => {
    const q: number[] = Array.isArray(r.data.q) ? r.data.q : [];
    return !q[curQ - 1];
  }).length;

  function stat(k: WKey): { count: number; pct: number; sub: string; warn?: string } {
    const rows = dataOf(k);
    switch (k) {
      case "strategies":
        return {
          count: entities.length,
          pct: entities.length ? 100 : 0,
          sub: `${entities.length} ${t("جهة", "entities")}`,
        };
      case "quarterly": {
        const total = entities.length * 4 || 1;
        const done = entities.reduce(
          (a, r) => a + (Array.isArray(r.data.q) ? r.data.q.filter(Boolean).length : 0),
          0,
        );
        return {
          count: entities.length,
          pct: Math.round((done / total) * 100),
          sub: `${t("الربع", "Q")} ${curQ}`,
          warn: qLate ? `${qLate} ${t("متأخرة", "late")}` : undefined,
        };
      }
      case "changes":
        return {
          count: changes.length,
          pct: commit,
          sub: `${t("التزام", "On time")} ${commit}%`,
          warn: lateChanges ? `${lateChanges} ${t("متأخرة", "late")}` : undefined,
        };
      case "contrib": {
        const p = rows.length
          ? Math.round(rows.reduce((a, r) => a + num(r.data.pct), 0) / rows.length)
          : 0;
        return { count: rows.length, pct: p, sub: KINDS.map((x) => rows.filter((r) => txt(r.data.kind) === x).length).join(" · ") };
      }
      default: {
        const d = doneOf(rows);
        return {
          count: rows.length,
          pct: rows.length ? Math.round((d / rows.length) * 100) : 0,
          sub: rows.length ? `${d} ${t("مكتملة", "done")}` : t("لا توجد بيانات", "No data"),
        };
      }
    }
  }

  /* جسم كل ويدجت */
  function bodyOf(k: WKey): ReactNode {
    const w = WMAP[k];
    const rows = dataOf(k);
    const sec = w.section || "";
    const save = (id: string, data: Rec) => void pf.save(sec, id, data, rows.length + 1);
    const del = (id: string) => {
      if (confirm(t("حذف هذا البند؟", "Delete?"))) void pf.remove(sec, id);
    };
    if (k === "tasks") return <TasksWidget me={me} t={t} onCount={setTaskCount} />;
    if (k === "calendar") return <Cal t={t} meId={me.id} />;
    if (k === "notes") return <NotesWidget t={t} onOpen={onOpenNotes} />;
    if (k === "quarterly")
      return (
        <Quarterly
          rows={entities}
          t={t}
          onToggle={(r, i) => {
            const q: number[] = Array.isArray(r.data.q) ? [...r.data.q] : [0, 0, 0, 0];
            q[i] = q[i] ? 0 : 1;
            void pf.save("entities", r.id, { ...r.data, q }, r.ord);
          }}
        />
      );
    if (k === "contrib" && prefs.mode === "tiles" && open !== k) return <Contrib rows={contrib} t={t} />;
    return (
      <SectionTable
        section={sec}
        rows={rows}
        t={t}
        onSave={save}
        onDelete={del}
        onImport={() => setImp(sec)}
      />
    );
  }

  /* بطاقة كاملة */
  function Card({ k }: { k: WKey }) {
    const w = WMAP[k];
    const st = stat(k);
    return (
      <div
        className="card2"
        draggable={arrange}
        onDragStart={() => setDrag(k)}
        onDragOver={(e) => arrange && e.preventDefault()}
        onDrop={() => dropOn(k)}
      >
        <div className="ch">
          {arrange && <span className="grip">⋮⋮</span>}
          <span className="dot" style={{ background: w.color }}>
            {w.icon}
          </span>
          <h3>{w.label}</h3>
          {["tasks", "calendar", "notes"].includes(k) ? null : <span className="n">{st.count}</span>}
          {arrange && (
            <span className="hide" onClick={() => patch({ hidden: [...prefs.hidden, k] })}>
              ✕
            </span>
          )}
        </div>
        <div className="cb">{bodyOf(k)}</div>
      </div>
    );
  }

  function dropOn(target: WKey) {
    if (!drag || drag === target) return;
    const cur = [...order];
    const from = cur.indexOf(drag);
    const to = cur.indexOf(target);
    if (from < 0 || to < 0) return;
    cur.splice(to, 0, cur.splice(from, 1)[0]);
    patch({ order: [...cur, ...prefs.hidden] });
    setDrag(null);
  }

  const group = (g: WDef["group"]) => order.filter((k) => WMAP[k].group === g);

  function renderGroup(keys: WKey[]) {
    if (!keys.length) return null;
    if (prefs.mode === "table" || prefs.layout === "one") {
      return (
        <div className="pf-one">
          {keys.map((k) => (
            <Card key={k} k={k} />
          ))}
        </div>
      );
    }
    return (
      <div className="tiles">
        {keys.map((k) => {
          const w = WMAP[k];
          const st = stat(k);
          return (
            <Tile
              key={k}
              w={w}
              count={st.count}
              sub={st.sub}
              pct={st.pct}
              warn={st.warn}
              onOpen={() => setOpen(k)}
              onHide={() => patch({ hidden: [...prefs.hidden, k] })}
              dragProps={{
                draggable: arrange,
                onDragStart: () => setDrag(k),
                onDragOver: (e: React.DragEvent) => arrange && e.preventDefault(),
                onDrop: () => dropOn(k),
              }}
            />
          );
        })}
      </div>
    );
  }

  if (!ready || !pf.loaded) return <div className="empty">{t("جارٍ التحميل...", "Loading...")}</div>;

  const openW = open ? WMAP[open] : null;
  const style = { ["--pf" as string]: prefs.color } as React.CSSProperties;

  return (
    <div className={`pf ${prefs.bg ? "hasbg" : ""}`} style={style}>
      {prefs.bg && (
        <div
          className="pf-bg"
          style={{ backgroundImage: `url(${prefs.bg})`, ["--dim" as string]: `${prefs.bgDim / 100}` } as React.CSSProperties}
        />
      )}

      <div className="pf-hero">
        <div className="av">{(me.name || "?").trim().charAt(0)}</div>
        <div>
          <h1>{t("محفظتي", "My portfolio")}</h1>
          <div className="sb">
            {me.name}
            {me.jobTitle ? ` · ${me.jobTitle}` : ""}
          </div>
        </div>
        <div className="acts">
          <span className="viewtog">
            <span className={prefs.mode === "tiles" ? "on" : ""} onClick={() => patch({ mode: "tiles" })}>
              ◫ {t("بطاقات", "Tiles")}
            </span>
            <span className={prefs.mode === "table" ? "on" : ""} onClick={() => patch({ mode: "table" })}>
              ▤ {t("جداول", "Tables")}
            </span>
          </span>
          <button className="btn2" onClick={() => setCustom(true)}>
            🎨 {t("تخصيص", "Customize")}
          </button>
          <button className={`btn2 ${arrange ? "solid" : ""}`} onClick={() => setArrange(!arrange)}>
            {arrange ? `✓ ${t("تم الترتيب", "Done")}` : `⋮⋮ ${t("ترتيب", "Arrange")}`}
          </button>
        </div>
      </div>

      <div className="kpis">
        <div className="kp">
          <div className="k">{t("مهامي المفتوحة", "Open tasks")}</div>
          <div className="v">{taskCount === null ? "—" : taskCount}</div>
          <div className="s">{t("المسندة لي والذاتية", "Assigned & self")}</div>
        </div>
        <div className="kp clickable" onClick={() => setEnts(true)}>
          <div className="k">{t("جهاتي", "My entities")}</div>
          <div className="v">{entities.length}</div>
          <div className="s">{t("اضغط لإدارة القائمة", "Manage list")}</div>
        </div>
        <div className="kp">
          <div className="k">{t("نسبة التزامي", "On-time rate")}</div>
          <div className="v">{changes.length ? `${commit}%` : "—"}</div>
          <div className="s">{t("طلبات التغيير", "Change requests")}</div>
        </div>
      </div>

      {arrange && (
        <div className="pf-arr">
          <b>{t("الويدجت", "Widgets")}</b>
          {WIDGETS.map((w) => {
            const on = !prefs.hidden.includes(w.key);
            return (
              <span
                key={w.key}
                className={`b ${on ? "on" : ""}`}
                onClick={() =>
                  patch({
                    hidden: on ? [...prefs.hidden, w.key] : prefs.hidden.filter((x) => x !== w.key),
                  })
                }
              >
                {w.label} {on ? "✓" : "+"}
              </span>
            );
          })}
          <span className="b" onClick={() => patch({ order: DEFAULT_PREFS.order, hidden: [] })}>
            ↺ {t("الترتيب الافتراضي", "Reset order")}
          </span>
        </div>
      )}

      <div className={`pf-body lay-${prefs.mode === "table" ? "one" : prefs.layout}`}>
        {group("top").map((k) => (
          <Card key={k} k={k} />
        ))}
      </div>

      {group("projects").length > 0 && (
        <>
          <div className="sect">
            <h2>{t("المشاريع الاستراتيجية", "Strategic projects")}</h2>
            <span className="ln" />
          </div>
          {renderGroup(group("projects"))}
        </>
      )}

      {group("ops").length > 0 && (
        <>
          <div className="sect">
            <h2>{t("الأعمال التشغيلية", "Operational work")}</h2>
            <span className="ln" />
          </div>
          {renderGroup(group("ops"))}
        </>
      )}

      {openW && (
        <div className="modal-overlay" onClick={() => setOpen(null)}>
          <div className="modal wide" onClick={(e) => e.stopPropagation()}>
            <div className="m-h">
              <span className="dot" style={{ background: openW.color }}>
                {openW.icon}
              </span>
              <h3>{openW.label}</h3>
              <button className="mx" onClick={() => setOpen(null)} aria-label="close">
                ✕
              </button>
            </div>
            <div>{bodyOf(openW.key)}</div>
          </div>
        </div>
      )}

      {ents && (
        <EntitiesModal
          rows={entities}
          t={t}
          onClose={() => setEnts(false)}
          onSave={(id, data) => void pf.save("entities", id, data, entities.length + 1)}
          onDelete={(id) => {
            if (confirm(t("حذف الجهة وكل ما يتعلق بها في محفظتك؟", "Delete entity?"))) void pf.remove("entities", id);
          }}
        />
      )}

      {custom && (
        <CustomModal prefs={prefs} t={t} meId={me.id} onClose={() => setCustom(false)} onChange={patch} />
      )}

      {imp && (
        <ImportModal
          section={imp}
          t={t}
          onClose={() => setImp(null)}
          onRows={async (items) => {
            await pf.saveMany(items.map((d, i) => ({ section: imp, data: d, ord: 100 + i })));
            setImp(null);
          }}
        />
      )}
    </div>
  );
}

/* ---------------- رفع إكسل / لصق ---------------- */
function ImportModal({
  section,
  t,
  onClose,
  onRows,
}: {
  section: string;
  t: T;
  onClose: () => void;
  onRows: (rows: Rec[]) => void;
}) {
  const cols = COLS[section] || [];
  const [aoa, setAoa] = useState<string[][]>([]);
  const [map, setMap] = useState<Record<string, number>>({});
  const [head, setHead] = useState(true);
  const [err, setErr] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const [paste, setPaste] = useState("");

  function useAoa(rows: string[][]) {
    const clean = rows.filter((r) => r.some((c) => txt(c).trim()));
    setAoa(clean);
    const first = clean[0] || [];
    const m: Record<string, number> = {};
    cols.forEach((c) => {
      const i = first.findIndex((h) => txt(h).trim() === c.label);
      m[c.k] = i;
    });
    setMap(m);
  }

  async function onFile(f: File) {
    try {
      const { readXlsx } = await import("@/lib/sheet");
      const rows = await readXlsx(await f.arrayBuffer());
      useAoa(rows.map((r) => r.map((c) => txt(c))));
    } catch {
      setErr(t("تعذّرت قراءة الملف", "Could not read the file"));
    }
  }

  const body = head ? aoa.slice(1) : aoa;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="m-h">
          <h3>{t("رفع بيانات", "Import data")}</h3>
          <button className="mx" onClick={onClose} aria-label="close">
            ✕
          </button>
        </div>

        {!aoa.length ? (
          <>
            <div className="drop" onClick={() => file.current?.click()}>
              <b>{t("اختر ملف إكسل", "Choose an Excel file")}</b>
              {t("xlsx — تُقرأ آخر ورقة", "xlsx")}
            </div>
            <input
              ref={file}
              type="file"
              accept=".xlsx"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onFile(f);
              }}
            />
            <div className="sec3">{t("أو الصق الجدول هنا", "Or paste a table")}</div>
            <textarea
              rows={5}
              className="pf-paste"
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              placeholder={t("انسخ من إكسل والصق هنا…", "Paste from Excel…")}
            />
            <div className="m-f">
              <button className="btn btn-ghost" onClick={onClose}>
                {t("إلغاء", "Cancel")}
              </button>
              <button
                className="btn"
                onClick={() => useAoa(paste.split(/\r?\n/).map((l) => l.split("\t")))}
                disabled={!paste.trim()}
              >
                {t("متابعة", "Continue")}
              </button>
            </div>
          </>
        ) : (
          <>
            <label className="pf-ck">
              <input type="checkbox" checked={head} onChange={(e) => setHead(e.target.checked)} />
              <span>{t("الصف الأول عناوين", "First row is a header")}</span>
            </label>
            <div className="sec3">{t("طابق الأعمدة", "Map the columns")}</div>
            <div className="pf-map">
              {cols.map((c) => (
                <label key={c.k}>
                  <span>{c.label}</span>
                  <select
                    value={map[c.k] ?? -1}
                    onChange={(e) => setMap({ ...map, [c.k]: Number(e.target.value) })}
                  >
                    <option value={-1}>{t("— تجاهل —", "— skip —")}</option>
                    {(aoa[0] || []).map((h, i) => (
                      <option key={i} value={i}>
                        {head ? txt(h) || `عمود ${i + 1}` : `عمود ${i + 1}`}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <div className="pf-hint">
              {body.length} {t("صف سيُضاف", "rows will be added")}
            </div>
            {err && <div className="alert alert-error">{err}</div>}
            <div className="m-f">
              <button className="btn btn-ghost" onClick={() => setAoa([])}>
                {t("رجوع", "Back")}
              </button>
              <button
                className="btn"
                onClick={() =>
                  onRows(
                    body.map((r) => {
                      const o: Rec = {};
                      cols.forEach((c) => {
                        const i = map[c.k];
                        if (i >= 0) o[c.k] = txt(r[i]).trim();
                      });
                      return o;
                    }),
                  )
                }
              >
                {t("إضافة الصفوف", "Add rows")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
