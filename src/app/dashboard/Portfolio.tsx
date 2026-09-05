"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { apiFetch } from "@/lib/api";
import { loadUserData, saveUserData } from "@/lib/userdata";
import { sb } from "@/lib/supa";
import { Cal } from "./Tools";
import { EMPTY_NOTES, firstLine, preview, whenAr, type NotesData } from "./Notes";
import { PIcon, IconPicker } from "./pickicons";
import { IconGear } from "./icons";

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

/* صياغة العدد بالعربية: يوم · يومان · أيام · يوماً */
function arCount(n: number, w: [string, string, string, string]) {
  if (n === 1) return w[0];
  if (n === 2) return w[1];
  if (n >= 3 && n <= 10) return `${n} ${w[2]}`;
  return `${n} ${w[3]}`;
}
/** الفرق بالسنوات والأشهر والأيام — بحساب أطوال الأشهر الحقيقية */
function since(iso: string): { y: number; m: number; d: number } | null {
  if (!iso) return null;
  const a = new Date(iso);
  if (isNaN(a.getTime())) return null;
  const b = new Date();
  if (a > b) return null;
  let y = b.getFullYear() - a.getFullYear();
  let m = b.getMonth() - a.getMonth();
  let d = b.getDate() - a.getDate();
  if (d < 0) {
    m--;
    d += new Date(b.getFullYear(), b.getMonth(), 0).getDate();
  }
  if (m < 0) {
    y--;
    m += 12;
  }
  return { y, m, d };
}
function sinceLabel(iso: string): string {
  const s = since(iso);
  if (!s) return "";
  const parts: string[] = [];
  if (s.y) parts.push(arCount(s.y, ["سنة", "سنتان", "سنوات", "سنة"]));
  if (s.m) parts.push(arCount(s.m, ["شهر", "شهران", "أشهر", "شهراً"]));
  if (s.d) parts.push(arCount(s.d, ["يوم", "يومان", "أيام", "يوماً"]));
  return parts.length ? parts.join(" و") : "اليوم";
}

/* ---------------- الويدجت المتاحة ---------------- */
export type WKey = string;

type WDef = {
  key: WKey;
  label: string;
  group: string;
  icon: string;
  color: string;
  section?: string; // قسم البيانات في perf_portfolio
};

export const WIDGETS: WDef[] = [
  /* الصف الأول: التقويم يميناً والملاحظات يساراً بارتفاع واحد،
     وتحتهما «مهامي» بعرض الصفحة كاملاً */
  { key: "calendar", label: "التقويم", group: "top", icon: "calendar", color: "#1a9d5c" },
  { key: "notes", label: "ملاحظاتي", group: "top", icon: "note", color: "#c9a020" },
  { key: "tasks", label: "مهامي", group: "top", icon: "clipboard", color: "#016b5f" },
  { key: "projects", label: "المشاريع الاستراتيجية", group: "projects", icon: "rocket", color: "#0f8a8a", section: "projects" },
  { key: "strategies", label: "البرامج والاستراتيجيات", group: "ops", icon: "map", color: "#016b5f", section: "entities" },
  { key: "quarterly", label: "التقارير الربعية", group: "ops", icon: "calendar-check", color: "#1a9d5c", section: "entities" },
  { key: "contrib", label: "المساهمات في الخطة التشغيلية", group: "ops", icon: "puzzle", color: "#7a5cd1", section: "contrib" },
  { key: "changes", label: "طلبات التغيير", group: "ops", icon: "exchange", color: "#c9a020", section: "changes" },
  { key: "reverse", label: "طلبات العكس", group: "ops", icon: "undo", color: "#e07a3a", section: "reverse" },
  { key: "workflow", label: "طلبات تحديث سير العمل", group: "ops", icon: "workflow", color: "#a24160", section: "workflow" },
];
const BASE_MAP: Record<string, WDef> = Object.fromEntries(WIDGETS.map((w) => [w.key, w]));

const CCOLORS = ["#016b5f", "#1a9d5c", "#2f7fd1", "#7a5cd1", "#a24160", "#c9a020", "#e07a3a", "#0f8a8a"];

/* ---------------- تفضيلات الصفحة ---------------- */
/** بند يضيفه المستخدم بنفسه — مفتاحه يبدأ بـ cw- وبياناته في قسم بالاسم نفسه */
export type CustomW = { key: string; label: string; icon: string; color: string; group: string };
/** قسم يضيفه المستخدم فوق «الأعمال التشغيلية» أو تحته */
export type CustomSec = { id: string; label: string };

type Prefs = {
  mode: "tiles" | "table";
  layout: "two" | "one" | "three" | "main";
  order: string[];
  hidden: string[];
  color: string;
  bg: string;
  bgDim: number;
  custom: CustomW[];
  sections: CustomSec[];
  /** تاريخ الانضمام لأداء — يظهر في رأس الصفحة */
  joined: string;
  /** تغيير اسم أو أيقونة أو لون أي بند — بما فيه الأصلية */
  look: Record<string, { label?: string; icon?: string; color?: string }>;
  /** علامة ترحيل الترتيب الافتراضي الجديد */
  v2?: boolean;
};
const DEFAULT_PREFS: Prefs = {
  mode: "tiles",
  layout: "two",
  order: WIDGETS.map((w) => w.key),
  hidden: [],
  color: "#00584c",
  bg: "",
  bgDim: 35,
  custom: [],
  sections: [],
  joined: "",
  look: {},
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
  custom: [
    { k: "name", label: "البند", w: 3 },
    { k: "status", label: "الحالة", kind: "sel", opts: ["قيد العمل", "بانتظار", "مكتمل"] },
    { k: "pct", label: "نسبة الإنجاز ٪", kind: "num" },
    { k: "note", label: "ملاحظة", w: 2 },
    { k: "date", label: "التاريخ", kind: "date" },
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
  const [filter, setFilter] = useState<"all" | "boss" | "self">("all");
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [newT, setNewT] = useState({ title: "", dueDate: "" });
  /* حدّ العرض خمسة، وما زاد خلف زر — في الأعمدة وفي تحديثات المهمة */
  const [moreCol, setMoreCol] = useState<Record<string, boolean>>({});
  const [moreUpd, setMoreUpd] = useState<Record<string, boolean>>({});
  const LIMIT = 5;

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

  /* ثلاثة أعمدة: المهام (مفتوحة وموعدها لم يمضِ) · المتأخرة · المكتملة.
     التقسيم بالحالة، والشرائح فوقه تقسّم بالمصدر — فلا يتكرر المعنى. */
  const colOf = (x: Task): "open" | "late" | "done" => {
    if (x.state === "done") return "done";
    const d = x.dueDate
      ? Math.round((new Date(x.dueDate).getTime() - new Date(new Date().toISOString().slice(0, 10)).getTime()) / 86400000)
      : 99;
    return d < 0 ? "late" : "open";
  };

  const shown = tasks.filter((x) => (filter === "boss" ? isBoss(x) : filter === "self" ? !isBoss(x) : true));

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

  const COLS: { key: "open" | "late" | "done"; title: string; color: string }[] = [
    { key: "open", title: t("المهام", "Tasks"), color: "#016b5f" },
    { key: "late", title: t("المتأخرة", "Overdue"), color: "#d34a4a" },
    { key: "done", title: t("المكتملة", "Completed"), color: "#5aaba2" },
  ];

  function TaskCard({ x }: { x: Task }) {
    const boss = isBoss(x);
    const ups = Array.isArray(x.updates) ? x.updates : [];
    return (
      <div className={`tk2c ${boss ? "boss" : ""}`}>
        <div className="ttl">{x.title}</div>
        <div className="mt">
          <span className="from">{boss ? t("من مديري", "From manager") : t("ذاتية", "Self")}</span>
          <span className="due">{dueLabel(x.dueDate, t)}</span>
        </div>
        <div className="acts">
          <span className="ac2" onClick={() => setOpen(open === x.id ? null : x.id)}>
            {ups.length ? `${ups.length} ${t("تحديثات", "updates")}` : `+ ${t("تحديث", "Update")}`}
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
        </div>
        {open === x.id && (
          <div className="upd">
            {(moreUpd[x.id] ? ups : ups.slice(-LIMIT)).map((u, i) => (
              <div className="u" key={i}>
                <b>{u.byName || ""}:</b>
                <span>{u.text}</span>
                <span className="d">{txt(u.at).slice(0, 10)}</span>
              </div>
            ))}
            {ups.length > LIMIT && (
              <button className="moreln" onClick={() => setMoreUpd({ ...moreUpd, [x.id]: !moreUpd[x.id] })}>
                {moreUpd[x.id]
                  ? t("عرض أقل", "Show less")
                  : `${t("عرض تحديثات أخرى", "More updates")} (${ups.length - LIMIT})`}
              </button>
            )}
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
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="tfil">
        {chip("all", t("الكل", "All"), tasks.length)}
        {chip("boss", t("مهام موكلة لي", "Assigned to me"), tasks.filter(isBoss).length)}
        {chip("self", t("مهامي", "My own"), tasks.filter((x) => !isBoss(x)).length)}
      </div>

      <div className="tkboard">
        {COLS.map((c) => {
          const list = shown.filter((x) => colOf(x) === c.key);
          const vis = moreCol[c.key] ? list : list.slice(0, LIMIT);
          return (
            <div className="tkcol" key={c.key}>
              <div className="h" style={{ ["--c" as string]: c.color }}>
                {c.title}
                <b>{list.length}</b>
              </div>
              {vis.map((x) => (
                <TaskCard key={x.id} x={x} />
              ))}
              {list.length > LIMIT && (
                <button className="moreln" onClick={() => setMoreCol({ ...moreCol, [c.key]: !moreCol[c.key] })}>
                  {moreCol[c.key]
                    ? t("عرض أقل", "Show less")
                    : `${t("عرض مهام أخرى", "More tasks")} (${list.length - LIMIT})`}
                </button>
              )}
              {!list.length && <div className="pf-none sm">—</div>}
            </div>
          );
        })}
      </div>

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
  const [all, setAll] = useState(false);
  useEffect(() => {
    void loadUserData<NotesData>("notes", EMPTY_NOTES).then((d) => setData(d || EMPTY_NOTES));
  }, []);
  const sorted = [...(data.notes || [])].sort((a, b) => txt(b.updatedAt).localeCompare(txt(a.updatedAt)));
  const list = all ? sorted : sorted.slice(0, 5);
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
      {sorted.length > 5 && (
        <button className="moreln" onClick={() => setAll(!all)}>
          {all ? t("عرض أقل", "Show less") : `${t("عرض ملاحظات أخرى", "More notes")} (${sorted.length - 5})`}
        </button>
      )}
      <div className="addrow" onClick={onOpen}>
        + {t("ملاحظة جديدة", "New note")}
      </div>
    </>
  );
}

/* ---------------- جدول قسم ---------------- */
function SectionTable({
  section,
  sectionKey,
  rows,
  t,
  onSave,
  onDelete,
  onImport,
}: {
  section: string;
  sectionKey?: string;
  rows: Row[];
  t: T;
  onSave: (id: string, data: Rec) => void;
  onDelete: (id: string) => void;
  onImport: () => void;
}) {
  const cols = COLS[section] || COLS.custom;
  void sectionKey;
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
  onEdit,
  dragProps,
}: {
  w: WDef;
  count: number;
  sub: string;
  pct: number;
  warn?: string;
  onOpen: () => void;
  onHide: () => void;
  onEdit: () => void;
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
        className="edit"
        title="تغيير الاسم والأيقونة"
        onClick={(e) => {
          e.stopPropagation();
          onEdit();
        }}
      >
        ✎
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
        <PIcon id={w.icon} size={19} />
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

/* ---------------- من يرى محفظتي ----------------
   المحفظة خاصة بصاحبها: لا يراها مديره ولا أي أحد إلا بمنحٍ منه.
   المنح للاطّلاع فقط — لا يكتب الممنوح له شيئاً، والحراسة في RLS. */
type Grant = { userId: string; name: string; jobTitle?: string; scopes: string[]; at?: string };

/* خيارات المنح بأقسام perf_portfolio لا بالويدجت:
   «البرامج والاستراتيجيات» و«التقارير الربعية» يقرآن قسم entities
   نفسه، فلا يمكن فصلهما — جُمعا في خيار واحد صراحةً بدل إيهام
   المستخدم بأنه فصلهما وهو لم يفعل. */
const SHARE_OPTS: { k: string; label: string }[] = [
  { k: "tasks", label: "مهامي" },
  { k: "entities", label: "الجهات — البرامج والاستراتيجيات والتقارير الربعية" },
  { k: "projects", label: "المشاريع الاستراتيجية" },
  { k: "contrib", label: "المساهمات في الخطة التشغيلية" },
  { k: "changes", label: "طلبات التغيير" },
  { k: "reverse", label: "طلبات العكس" },
  { k: "workflow", label: "طلبات تحديث سير العمل" },
];

function GrantsBox({ prefs, meId, t }: { prefs: Prefs; meId: string; t: T }) {
  const [grants, setGrants] = useState<Grant[]>([]);
  const [people, setPeople] = useState<{ id: string; name: string }[]>([]);
  const [who, setWho] = useState("");
  const [sel, setSel] = useState<string[]>(["*"]);
  const [msg, setMsg] = useState("");

  const opts = useMemo(
    () => [...SHARE_OPTS, ...prefs.custom.map((c) => ({ k: c.key, label: c.label }))],
    [prefs.custom],
  );

  const load = useCallback(async () => {
    const [g, ppl] = await Promise.all([
      apiFetch("/api/portfolio/grants").then((r) => r.json()).catch(() => ({})),
      apiFetch("/api/people").then((r) => r.json()).catch(() => ({})),
    ]);
    setGrants(Array.isArray(g.grants) ? g.grants : []);
    setPeople((ppl.people || []).filter((x: Rec) => String(x.id) !== meId));
  }, [meId]);
  useEffect(() => {
    void load();
  }, [load]);

  const all = sel.includes("*");
  const toggle = (k: string) =>
    setSel((old) => (old.includes(k) ? old.filter((x) => x !== k) : [...old.filter((x) => x !== "*"), k]));

  async function give() {
    if (!who) {
      setMsg(t("اختر الشخص أولاً", "Pick a person"));
      return;
    }
    const scopes = all ? ["*"] : sel;
    if (!scopes.length) {
      setMsg(t("اختر ما تريد مشاركته", "Pick what to share"));
      return;
    }
    const r = await apiFetch("/api/portfolio/grants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: who, scopes }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      setMsg(d.error || t("تعذّر الحفظ", "Failed"));
      return;
    }
    setWho("");
    setSel(["*"]);
    setMsg("");
    await load();
  }

  async function drop(id: string, name: string) {
    if (!confirm(t(`سحب صلاحية ${name} على محفظتك؟`, `Revoke ${name}?`))) return;
    await apiFetch(`/api/portfolio/grants?user=${encodeURIComponent(id)}`, { method: "DELETE" });
    await load();
  }

  const label = (g: Grant) =>
    g.scopes.includes("*")
      ? t("كل المحفظة", "Everything")
      : g.scopes.map((k) => opts.find((o) => o.k === k)?.label || k).join(" · ");

  return (
    <>
      <div className="sec3">{t("من يرى محفظتي", "Who can see my portfolio")}</div>
      <p className="gr-hint">
        {t(
          "محفظتك خاصة بك — لا يراها مديرك ولا أي أحد. امنح من تختاره اطّلاعاً عليها (بديلك أثناء الإجازة مثلاً)، وحدّد ما يراه، واسحبه متى شئت. المنح للاطّلاع فقط: لا يعدّل أحد في محفظتك.",
          "Your portfolio is private. Grant read access to whoever you choose.",
        )}
      </p>

      {grants.length > 0 && (
        <div className="gr-list">
          {grants.map((g) => (
            <div className="gr-row" key={g.userId}>
              <b>{g.name}</b>
              <span>{label(g)}</span>
              <button onClick={() => drop(g.userId, g.name)} title={t("سحب الصلاحية", "Revoke")}>
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="gr-add">
        <select value={who} onChange={(e) => setWho(e.target.value)}>
          <option value="">{t("— اختر شخصاً —", "— Pick a person —")}</option>
          {people.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
        <div className="gr-scopes">
          <label className={all ? "on" : ""}>
            <input type="checkbox" checked={all} onChange={() => setSel(all ? [] : ["*"])} />
            {t("كل المحفظة", "Everything")}
          </label>
          {opts.map((o) => (
            <label key={o.k} className={!all && sel.includes(o.k) ? "on" : ""}>
              <input
                type="checkbox"
                disabled={all}
                checked={all || sel.includes(o.k)}
                onChange={() => toggle(o.k)}
              />
              {o.label}
            </label>
          ))}
        </div>
        <button className="btn btn-sm" onClick={give}>
          {t("منح الصلاحية", "Grant")}
        </button>
        {msg && <div className="gr-msg">{msg}</div>}
      </div>
      <p className="gr-hint sm">
        {t(
          "ملاحظاتك وتقويمك يبقيان خاصين بك دائماً ولا يشملهما المنح.",
          "Your notes and calendar are never shared.",
        )}
      </p>
    </>
  );
}

/* ---------------- محفظة شورِكت معي (اطّلاع فقط) ---------------- */
function SharedView({ owner, t, onBack }: { owner: Grant; t: T; onBack: () => void }) {
  const pf = usePortfolio(owner.userId);
  const bySection = useMemo(() => {
    const m: Record<string, Row[]> = {};
    for (const r of pf.rows) (m[r.section] = m[r.section] || []).push(r);
    return m;
  }, [pf.rows]);

  const secLabel = (k: string) => SHARE_OPTS.find((o) => o.k === k)?.label || k;

  return (
    <div className="pf shared">
      <div className="sh-head">
        <button className="btn2" onClick={onBack}>
          ← {t("رجوع لمحفظتي", "Back")}
        </button>
        <div>
          <b>{owner.name}</b>
          {owner.jobTitle && <em>{owner.jobTitle}</em>}
        </div>
        <span className="sh-tag">{t("اطّلاع فقط", "Read only")}</span>
      </div>

      {!pf.loaded ? (
        <div className="pf-none">{t("جارٍ التحميل...", "Loading...")}</div>
      ) : !Object.keys(bySection).length ? (
        <div className="pf-none">{t("لا يوجد ما يُعرض في الأقسام المشتركة معك.", "Nothing shared yet.")}</div>
      ) : (
        Object.entries(bySection).map(([sec, rows]) => {
          const cols = COLS[sec] || [{ k: "name", label: "البند" }];
          return (
            <div className="sh-sec" key={sec}>
              <h3>
                {secLabel(sec)} <b>{rows.length}</b>
              </h3>
              <div className="tblwrap">
                <table>
                  <thead>
                    <tr>
                      {cols.map((c) => (
                        <th key={c.k}>{c.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id}>
                        {cols.map((c) => (
                          <td key={c.k}>{txt(r.data?.[c.k]) || "—"}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })
      )}
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
          <h3>{t("تخصيص محفظتي", "Customize")}</h3>
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

        <GrantsBox prefs={prefs} meId={meId} t={t} />

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
  const [addW, setAddW] = useState<string | null>(null);
  const [addSec, setAddSec] = useState(false);
  const [editJoin, setEditJoin] = useState(false);
  const [editLook, setEditLook] = useState<string | null>(null);
  /* محافظ منحني أصحابها الاطّلاع عليها */
  const [shared, setShared] = useState<Grant[]>([]);
  const [viewing, setViewing] = useState<Grant | null>(null);

  useEffect(() => {
    void apiFetch("/api/portfolio/grants")
      .then((r) => r.json())
      .then((d) => setShared(Array.isArray(d.shared) ? d.shared : []))
      .catch(() => setShared([]));
  }, []);

  useEffect(() => {
    void loadUserData<Partial<Prefs>>("portfolio", {}).then((d) => {
      const p = { ...DEFAULT_PREFS, ...(d || {}) } as Prefs & { v2?: boolean };
      /* ترحيل مرة واحدة: كان «مهامي» أول الصف، وصار التقويم
         والملاحظات فوقه — نصلح الترتيب المحفوظ ولا نمسّ بقيته */
      if (!p.v2) {
        const top = ["calendar", "notes", "tasks"];
        p.order = [...top.filter((k) => !p.hidden.includes(k)), ...p.order.filter((k) => !top.includes(k))];
        p.v2 = true;
        void saveUserData("portfolio", p);
      }
      setPrefs(p);
      setReady(true);
    });
  }, []);

  /* أمر «رتّب صفحتي حسب الأهمية» من المساعد */
  useEffect(() => {
    const h = (e: Event) => {
      const list = (e as CustomEvent).detail as string[];
      if (!Array.isArray(list) || !list.length) return;
      setPrefs((old) => {
        const rest = old.order.filter((k) => !list.includes(k));
        const next = { ...old, order: [...list.filter((k) => old.order.includes(k) || true), ...rest] };
        void saveUserData("portfolio", next);
        return next;
      });
    };
    window.addEventListener("pf-reorder", h);
    return () => window.removeEventListener("pf-reorder", h);
  }, []);

  const patch = useCallback((p: Partial<Prefs>) => {
    setPrefs((old) => {
      const next = { ...old, ...p };
      void saveUserData("portfolio", next);
      return next;
    });
  }, []);

  /* الترتيب: ما في الإعدادات أولاً ثم أي ويدجت جديدة */
  const allKeys = useMemo(
    () => [...WIDGETS.map((w) => w.key), ...prefs.custom.map((c) => c.key)],
    [prefs.custom],
  );
  const order = useMemo(() => {
    const known = prefs.order.filter((k) => allKeys.includes(k));
    const rest = allKeys.filter((k) => !known.includes(k));
    return [...known, ...rest].filter((k) => !prefs.hidden.includes(k));
  }, [prefs.order, prefs.hidden, allKeys]);

  const WMAP: Record<string, WDef> = useMemo(() => {
    const m: Record<string, WDef> = { ...BASE_MAP };
    for (const c of prefs.custom) m[c.key] = { key: c.key, label: c.label, group: c.group, icon: c.icon, color: c.color, section: c.key };
    for (const [k, v] of Object.entries(prefs.look || {})) {
      if (m[k]) m[k] = { ...m[k], ...(v.label ? { label: v.label } : {}), ...(v.icon ? { icon: v.icon } : {}), ...(v.color ? { color: v.color } : {}) };
    }
    return m;
  }, [prefs.custom, prefs.look]);

  const entities = pf.of("entities");
  const contrib = pf.of("contrib");
  const changes = pf.of("changes");
  const reverse = pf.of("reverse");
  const workflow = pf.of("workflow");
  const projects = pf.of("projects");

  const dataOf = (k: WKey): Row[] =>
    k.startsWith("cw-")
      ? pf.of(k)
      : k === "strategies" || k === "quarterly"
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
    if (!w) return null;
    const rows = dataOf(k);
    const sec = w.section || "";
    void sec;
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
        section={k.startsWith("cw-") ? "custom" : sec}
        sectionKey={sec}
        rows={rows}
        t={t}
        onSave={save}
        onDelete={del}
        onImport={() => setImp(sec)}
      />
    );
  }

  /* بطاقة كاملة */
  function Card({ k, wide }: { k: WKey; wide?: boolean }) {
    const w = WMAP[k];
    const st = stat(k);
    return (
      <div
        className={`card2 ${wide ? "wide" : ""}`}
        draggable={arrange}
        onDragStart={() => setDrag(k)}
        onDragOver={(e) => arrange && e.preventDefault()}
        onDrop={() => dropOn(k)}
      >
        <div className="ch">
          {arrange && <span className="grip">⋮⋮</span>}
          <span className="dot" style={{ background: w.color }}>
            <PIcon id={w.icon} size={13} />
          </span>
          <h3>{w.label}</h3>
          {["tasks", "calendar", "notes"].includes(k) ? null : <span className="n">{st.count}</span>}
          {arrange && (
            <>
              <span className="edit" title={t("تغيير الاسم والأيقونة", "Rename / icon")} onClick={() => setEditLook(k)}>
                ✎
              </span>
              <span className="hide" onClick={() => patch({ hidden: [...prefs.hidden, k] })}>
                ✕
              </span>
            </>
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

  const group = (g: string) => order.filter((k) => WMAP[k]?.group === g);

  function renderGroup(keys: WKey[], addTo?: string) {
    if (!keys.length && !addTo) return null;
    if (prefs.mode === "table" || prefs.layout === "one") {
      return (
        <div className="pf-one">
          {keys.map((k) => (
            <Card key={k} k={k} />
          ))}
          {addTo && (
            <button className="tile add wide" onClick={() => setAddW(addTo)}>
              <span className="pl">+</span>
              {t("إضافة بند", "Add item")}
            </button>
          )}
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
              onEdit={() => setEditLook(k)}
              dragProps={{
                draggable: arrange,
                onDragStart: () => setDrag(k),
                onDragOver: (e: React.DragEvent) => arrange && e.preventDefault(),
                onDrop: () => dropOn(k),
              }}
            />
          );
        })}
        {addTo && (
          <button className="tile add" onClick={() => setAddW(addTo)}>
            <span className="pl">+</span>
            {t("إضافة بند", "Add item")}
          </button>
        )}
      </div>
    );
  }

  if (viewing) return <SharedView owner={viewing} t={t} onBack={() => setViewing(null)} />;

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

      {shared.length > 0 && (
        <div className="pf-shared">
          <b>{t("محافظ شورِكت معي", "Shared with me")}</b>
          {shared.map((g) => (
            <button key={g.userId} onClick={() => setViewing(g)}>
              {g.name}
            </button>
          ))}
        </div>
      )}

      <div className="pf-hero">
        <div className="av">{(me.name || "?").trim().charAt(0)}</div>
        <div className="who">
          <h1>{me.name}</h1>
          <div className="sb">{me.jobTitle || t("عضو فريق إدارة عمليات الأداء", "Team member")}</div>
          {editJoin ? (
            <div className="joinedit">
              <input
                type="date"
                autoFocus
                defaultValue={prefs.joined}
                onChange={(e) => patch({ joined: e.target.value })}
                onBlur={() => setEditJoin(false)}
              />
              <button className="btn2" onClick={() => setEditJoin(false)}>
                {t("تم", "Done")}
              </button>
            </div>
          ) : (
            <button className="joined" onClick={() => setEditJoin(true)}>
              {prefs.joined ? (
                <>
                  {t("أدائي منذ", "At Adaa since")} <b>{prefs.joined}</b>
                  <em>{sinceLabel(prefs.joined)}</em>
                </>
              ) : (
                <>+ {t("أضف تاريخ انضمامك لأداء", "Add your join date")}</>
              )}
            </button>
          )}
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
          <button className="btn2 solid" onClick={() => setCustom(true)}>
            <IconGear size={15} /> {t("تخصيص", "Customize")}
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

      <div className={`pf-top ${prefs.mode === "table" || prefs.layout === "one" ? "one" : ""}`}>
        {group("top").map((k) => (
          <Card key={k} k={k} wide={k === "tasks"} />
        ))}
      </div>

      <div className="sect">
        <h2>{t("المشاريع الاستراتيجية", "Strategic projects")}</h2>
        <span className="ln" />
      </div>
      {renderGroup(group("projects"), "projects")}

      <div className="sect">
        <h2>{t("الأعمال التشغيلية", "Operational work")}</h2>
        <span className="ln" />
      </div>
      {renderGroup(group("ops"), "ops")}

      {prefs.sections.map((sc) => (
        <div key={sc.id}>
          <div className="sect">
            <h2>{sc.label}</h2>
            <span className="ln" />
            <button
              className="secx"
              title={t("حذف القسم", "Delete section")}
              onClick={() => {
                if (!confirm(t("حذف هذا القسم؟ بنوده تنتقل للأعمال التشغيلية.", "Delete section?"))) return;
                patch({
                  sections: prefs.sections.filter((x) => x.id !== sc.id),
                  custom: prefs.custom.map((c) => (c.group === sc.id ? { ...c, group: "ops" } : c)),
                });
              }}
            >
              ✕
            </button>
          </div>
          {renderGroup(group(sc.id), sc.id)}
        </div>
      ))}

      <button className="pf-addsec" onClick={() => setAddSec(true)}>
        + {t("إضافة قسم جديد", "Add a section")}
      </button>

      {openW && (
        <div className="modal-overlay" onClick={() => setOpen(null)}>
          <div className="modal wide" onClick={(e) => e.stopPropagation()}>
            <div className="m-h">
              <span className="dot" style={{ background: openW.color }}>
                <PIcon id={openW.icon} size={13} />
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

      {addW && (
        <AddWidget
          t={t}
          onClose={() => setAddW(null)}
          onAdd={(label, icon, color) => {
            const key = "cw-" + newId();
            patch({
              custom: [...prefs.custom, { key, label, icon, color, group: addW }],
              order: [...order, key, ...prefs.hidden],
            });
            setAddW(null);
          }}
        />
      )}

      {editLook && WMAP[editLook] && (
        <EditLook
          t={t}
          w={WMAP[editLook]}
          custom={editLook.startsWith("cw-")}
          onClose={() => setEditLook(null)}
          onSave={(label, icon, color) => {
            if (editLook.startsWith("cw-")) {
              patch({
                custom: prefs.custom.map((c) => (c.key === editLook ? { ...c, label, icon, color } : c)),
              });
            } else {
              patch({ look: { ...prefs.look, [editLook]: { label, icon, color } } });
            }
            setEditLook(null);
          }}
          onReset={() => {
            const nx = { ...prefs.look };
            delete nx[editLook];
            patch({ look: nx });
            setEditLook(null);
          }}
          onDelete={
            editLook.startsWith("cw-")
              ? () => {
                  if (!confirm(t("حذف هذا البند وبياناته؟", "Delete item and its data?"))) return;
                  patch({
                    custom: prefs.custom.filter((c) => c.key !== editLook),
                    order: prefs.order.filter((k) => k !== editLook),
                  });
                  setEditLook(null);
                }
              : undefined
          }
        />
      )}

      {addSec && (
        <AddSection
          t={t}
          onClose={() => setAddSec(false)}
          onAdd={(label) => {
            patch({ sections: [...prefs.sections, { id: "sec-" + newId(), label }] });
            setAddSec(false);
          }}
        />
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
  const cols = COLS[section] || COLS.custom;
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

/* ---------------- إضافة بند تشغيلي جديد ---------------- */
function AddWidget({
  t,
  onClose,
  onAdd,
}: {
  t: T;
  onClose: () => void;
  onAdd: (label: string, icon: string, color: string) => void;
}) {
  const [label, setLabel] = useState("");
  const [icon, setIcon] = useState("target");
  const [color, setColor] = useState(CCOLORS[0]);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="m-h">
          <h3>{t("بند جديد", "New item")}</h3>
          <button className="mx" onClick={onClose} aria-label="close">
            ✕
          </button>
        </div>
        <div className="sx-form">
          <label>
            <span>{t("اسم البند", "Name")}</span>
            <input autoFocus value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t("مثال: طلبات الدعم", "e.g. Support requests")} />
          </label>
        </div>
        <div className="sec3">{t("الأيقونة", "Icon")}</div>
        <IconPicker value={icon} onPick={setIcon} t={t} />
        <div className="sec3">{t("اللون", "Color")}</div>
        <div className="sws">
          {CCOLORS.map((c) => (
            <span key={c} className={`sw2 ${color === c ? "on" : ""}`} style={{ background: c }} onClick={() => setColor(c)} />
          ))}
        </div>
        <div className="pf-hint">
          {t("يُنشأ له جدول بأعمدة: البند · الحالة · النسبة · ملاحظة · التاريخ.", "A table is created for it.")}
        </div>
        <div className="m-f">
          <button className="btn btn-ghost" onClick={onClose}>
            {t("إلغاء", "Cancel")}
          </button>
          <button className="btn" disabled={!label.trim()} onClick={() => onAdd(label.trim(), icon, color)}>
            {t("إضافة", "Add")}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- إضافة قسم ---------------- */
function AddSection({ t, onClose, onAdd }: { t: T; onClose: () => void; onAdd: (label: string) => void }) {
  const [label, setLabel] = useState("");
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="m-h">
          <h3>{t("قسم جديد", "New section")}</h3>
          <button className="mx" onClick={onClose} aria-label="close">
            ✕
          </button>
        </div>
        <div className="sx-form">
          <label>
            <span>{t("اسم القسم", "Section name")}</span>
            <input autoFocus value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t("مثال: أعمال المبادرات", "e.g. Initiatives")} />
          </label>
        </div>
        <div className="pf-hint">{t("يظهر تحت الأعمال التشغيلية، وتضيف بنوده من زر «+» داخله.", "Appears below operational work.")}</div>
        <div className="m-f">
          <button className="btn btn-ghost" onClick={onClose}>
            {t("إلغاء", "Cancel")}
          </button>
          <button className="btn" disabled={!label.trim()} onClick={() => onAdd(label.trim())}>
            {t("إضافة", "Add")}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- تغيير اسم البند وأيقونته ولونه ---------------- */
function EditLook({
  t,
  w,
  custom,
  onClose,
  onSave,
  onReset,
  onDelete,
}: {
  t: T;
  w: WDef;
  custom: boolean;
  onClose: () => void;
  onSave: (label: string, icon: string, color: string) => void;
  onReset: () => void;
  onDelete?: () => void;
}) {
  const [label, setLabel] = useState(w.label);
  const [icon, setIcon] = useState(w.icon);
  const [color, setColor] = useState(w.color);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="m-h">
          <h3>{t("تعديل البند", "Edit item")}</h3>
          <button className="mx" onClick={onClose} aria-label="close">
            ✕
          </button>
        </div>
        <div className="sx-form">
          <label>
            <span>{t("الاسم", "Name")}</span>
            <input value={label} onChange={(e) => setLabel(e.target.value)} />
          </label>
        </div>
        <div className="sec3">{t("الأيقونة", "Icon")}</div>
        <IconPicker value={icon} onPick={setIcon} t={t} />
        <div className="sec3">{t("اللون", "Color")}</div>
        <div className="sws">
          {CCOLORS.map((c) => (
            <span key={c} className={`sw2 ${color === c ? "on" : ""}`} style={{ background: c }} onClick={() => setColor(c)} />
          ))}
          <label className="more3">
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
          </label>
        </div>
        <div className="m-f">
          {onDelete && (
            <button className="btn btn-danger" onClick={onDelete}>
              {t("حذف البند", "Delete")}
            </button>
          )}
          {!custom && (
            <button className="btn btn-ghost" onClick={onReset}>
              {t("الافتراضي", "Reset")}
            </button>
          )}
          <button className="btn" onClick={() => onSave(label.trim() || w.label, icon, color)}>
            {t("حفظ", "Save")}
          </button>
        </div>
      </div>
    </div>
  );
}
