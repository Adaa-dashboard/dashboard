"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadUserData, saveUserData } from "@/lib/userdata";
import { parseWhen, whenLabel } from "@/lib/whenar";

/* ============================================================
   ملاحظات شخصية — مجلدات وملاحظات، تُحفظ في المخزن الشخصي
   فتتبع صاحبها على أي جهاز، ولا يقرأها غيره (RLS).
   الحفظ مؤجَّل ثانية بعد آخر حرف حتى لا نكتب مع كل ضغطة.
   ============================================================ */

export type Note = {
  id: string;
  folderId: string;
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  /** موعد يظهر في التقويم — يُلتقط من النص أو يُضبط يدوياً */
  due?: string;
  dueTime?: string;
  /** true = مأخوذ من النص، فيتغيّر معه. false = ضبطه المستخدم بنفسه */
  dueAuto?: boolean;
};
export type Folder = { id: string; name: string };
export type NotesData = { folders: Folder[]; notes: Note[] };

export const EMPTY_NOTES: NotesData = { folders: [], notes: [] };
const ALL = "__all__";
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

export function firstLine(n: Note): string {
  const s = (n.title || n.body || "").split("\n")[0].trim();
  return s || "بلا عنوان";
}
export function preview(n: Note): string {
  const rest = (n.title ? n.body : n.body.split("\n").slice(1).join(" ")).trim();
  return rest.replace(/\s+/g, " ").slice(0, 70) || "لا يوجد نص إضافي";
}
export function whenAr(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const today = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  if (d.toDateString() === today.toDateString()) return `اليوم ${hh}:${mm}`;
  const y = new Date(today.getTime() - 86400000);
  if (d.toDateString() === y.toDateString()) return `أمس ${hh}:${mm}`;
  return d.toISOString().slice(0, 10);
}

export default function Notes({
  t,
  onClose,
}: {
  t: (ar: string, en: string) => string;
  onClose: () => void;
}) {
  const [data, setData] = useState<NotesData>(EMPTY_NOTES);
  const [loaded, setLoaded] = useState(false);
  const [folder, setFolder] = useState<string>(ALL);
  const [openId, setOpenId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [saving, setSaving] = useState<"" | "busy" | "ok" | "err">("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef(false);

  useEffect(() => {
    loadUserData<NotesData>("notes", EMPTY_NOTES).then((d) => {
      setData({ folders: d.folders || [], notes: d.notes || [] });
      setLoaded(true);
    });
  }, []);

  const flush = useCallback(async (next: NotesData) => {
    setSaving("busy");
    const e = await saveUserData("notes", next);
    dirty.current = false;
    setSaving(e ? "err" : "ok");
    if (!e) setTimeout(() => setSaving(""), 1400);
  }, []);

  /** كل تغيير يمرّ من هنا: يحدّث الحالة ويؤجّل الحفظ ثانية واحدة */
  const change = useCallback(
    (fn: (d: NotesData) => NotesData, immediate = false) => {
      setData((cur) => {
        const next = fn(cur);
        dirty.current = true;
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => flush(next), immediate ? 0 : 1000);
        return next;
      });
    },
    [flush]
  );

  // إغلاق النافذة وفيها تعديل لم يُحفظ بعد ⇒ احفظه الآن
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    return data.notes
      .filter((n) => folder === ALL || n.folderId === folder)
      .filter((n) => !term || (n.title + " " + n.body).toLowerCase().includes(term))
      .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  }, [data.notes, folder, q]);

  const open = data.notes.find((n) => n.id === openId) || null;

  function addNote() {
    const id = newId();
    const now = new Date().toISOString();
    const fid = folder === ALL ? data.folders[0]?.id || "" : folder;
    change(
      (d) => ({
        ...d,
        notes: [{ id, folderId: fid, title: "", body: "", createdAt: now, updatedAt: now }, ...d.notes],
      }),
      true
    );
    setOpenId(id);
  }

  function editNote(id: string, patch: Partial<Note>) {
    change((d) => ({
      ...d,
      notes: d.notes.map((n) => {
        if (n.id !== id) return n;
        const next = { ...n, ...patch, updatedAt: new Date().toISOString() };
        // النص تغيّر والموعد لم يُضبط يدوياً ⇒ أعِد قراءته من النص
        const textChanged = "title" in patch || "body" in patch;
        if (textChanged && next.dueAuto !== false) {
          const w = parseWhen(`${next.title} ${next.body}`);
          if (w) {
            next.due = w.date;
            next.dueTime = w.time;
            next.dueAuto = true;
          } else if (next.dueAuto) {
            next.due = undefined;
            next.dueTime = undefined;
            next.dueAuto = undefined;
          }
        }
        return next;
      }),
    }));
  }

  function delNote(id: string) {
    if (!window.confirm(t("حذف هذه الملاحظة؟", "Delete this note?"))) return;
    change((d) => ({ ...d, notes: d.notes.filter((n) => n.id !== id) }), true);
    setOpenId(null);
  }

  function addFolder() {
    const name = window.prompt(t("اسم المجلد", "Folder name"));
    if (!name || !name.trim()) return;
    const id = newId();
    change((d) => ({ ...d, folders: [...d.folders, { id, name: name.trim() }] }), true);
    setFolder(id);
  }

  function renameFolder(f: Folder) {
    const name = window.prompt(t("اسم المجلد", "Folder name"), f.name);
    if (!name || !name.trim()) return;
    change((d) => ({
      ...d,
      folders: d.folders.map((x) => (x.id === f.id ? { ...x, name: name.trim() } : x)),
    }), true);
  }

  function delFolder(f: Folder) {
    const n = data.notes.filter((x) => x.folderId === f.id).length;
    if (
      !window.confirm(
        n
          ? t(
              `حذف مجلد «${f.name}»؟ ملاحظاته (${n}) تنتقل إلى «كل الملاحظات» ولا تُحذف.`,
              `Delete folder "${f.name}"? Its ${n} notes move to All Notes.`
            )
          : t(`حذف مجلد «${f.name}»؟`, `Delete folder "${f.name}"?`)
      )
    )
      return;
    change(
      (d) => ({
        folders: d.folders.filter((x) => x.id !== f.id),
        notes: d.notes.map((x) => (x.folderId === f.id ? { ...x, folderId: "" } : x)),
      }),
      true
    );
    setFolder(ALL);
  }

  function countIn(fid: string) {
    return fid === ALL ? data.notes.length : data.notes.filter((n) => n.folderId === fid).length;
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal notes-modal" onClick={(e) => e.stopPropagation()}>
        <div className="m-h">
          <h3>{t("ملاحظاتي", "My notes")}</h3>
          <span className={`nb-save ${saving}`}>
            {saving === "busy"
              ? t("يحفظ…", "Saving…")
              : saving === "ok"
                ? t("حُفظ ✓", "Saved ✓")
                : saving === "err"
                  ? t("تعذّر الحفظ", "Save failed")
                  : ""}
          </span>
          <button className="mx" onClick={onClose} aria-label="close">
            ✕
          </button>
        </div>

        {!loaded ? (
          <div className="empty">{t("جارٍ التحميل...", "Loading...")}</div>
        ) : (
          <div className="nb">
            <aside className="nb-folders">
              <button
                className={`nb-f ${folder === ALL ? "on" : ""}`}
                onClick={() => setFolder(ALL)}
              >
                <span>📒 {t("كل الملاحظات", "All notes")}</span>
                <b>{countIn(ALL)}</b>
              </button>
              {data.folders.map((f) => (
                <div key={f.id} className={`nb-frow ${folder === f.id ? "on" : ""}`}>
                  <button className="nb-f" onClick={() => setFolder(f.id)}>
                    <span>📁 {f.name}</span>
                    <b>{countIn(f.id)}</b>
                  </button>
                  <span className="nb-fx">
                    <button onClick={() => renameFolder(f)} title={t("إعادة تسمية", "Rename")}>
                      ✎
                    </button>
                    <button onClick={() => delFolder(f)} title={t("حذف", "Delete")}>
                      🗑
                    </button>
                  </span>
                </div>
              ))}
              <button className="nb-add-f" onClick={addFolder}>
                ＋ {t("مجلد جديد", "New folder")}
              </button>
            </aside>

            <section className="nb-list">
              <input
                className="nb-q"
                placeholder={t("بحث…", "Search…")}
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              <button className="btn btn-sm nb-new" onClick={addNote}>
                ＋ {t("ملاحظة جديدة", "New note")}
              </button>
              <div className="nb-items">
                {shown.length === 0 ? (
                  <div className="empty" style={{ padding: 20, fontSize: 13 }}>
                    {t("لا ملاحظات هنا بعد.", "No notes here yet.")}
                  </div>
                ) : (
                  shown.map((n) => (
                    <button
                      key={n.id}
                      className={`nb-item ${openId === n.id ? "on" : ""}`}
                      onClick={() => setOpenId(n.id)}
                    >
                      <b>{firstLine(n)}</b>
                      <span className="s">
                        {n.due && (
                          <em className="due">{whenLabel({ date: n.due, time: n.dueTime })}</em>
                        )}
                        <i>{whenAr(n.updatedAt)}</i> {preview(n)}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </section>

            <section className="nb-editor">
              {!open ? (
                <div className="empty" style={{ padding: 30 }}>
                  {t("اختاري ملاحظة أو أنشئي واحدة جديدة.", "Pick a note or create one.")}
                </div>
              ) : (
                <>
                  <div className="nb-etop">
                    <input
                      className="nb-title"
                      value={open.title}
                      placeholder={t("العنوان", "Title")}
                      onChange={(e) => editNote(open.id, { title: e.target.value })}
                    />
                    <select
                      value={open.folderId}
                      onChange={(e) => editNote(open.id, { folderId: e.target.value })}
                    >
                      <option value="">{t("بلا مجلد", "No folder")}</option>
                      {data.folders.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name}
                        </option>
                      ))}
                    </select>
                    <button className="btn btn-danger btn-sm" onClick={() => delNote(open.id)}>
                      {t("حذف", "Delete")}
                    </button>
                  </div>
                  <textarea
                    className="nb-body"
                    value={open.body}
                    placeholder={t("اكتبي هنا…", "Write here…")}
                    onChange={(e) => editNote(open.id, { body: e.target.value })}
                  />

                  <div className="nb-due">
                    <span className="lb">{t("في التقويم", "On calendar")}</span>
                    <input
                      type="date"
                      value={open.due || ""}
                      onChange={(e) =>
                        editNote(open.id, {
                          due: e.target.value || undefined,
                          dueAuto: false,
                          dueTime: e.target.value ? open.dueTime : undefined,
                        })
                      }
                    />
                    <input
                      type="time"
                      value={open.dueTime || ""}
                      disabled={!open.due}
                      onChange={(e) =>
                        editNote(open.id, { dueTime: e.target.value || undefined, dueAuto: false })
                      }
                    />
                    {open.due && (
                      <>
                        <span className="tag">
                          {whenLabel({ date: open.due, time: open.dueTime })}
                          {open.dueAuto && ` · ${t("من النص", "from text")}`}
                        </span>
                        <button
                          className="clr"
                          title={t("إزالة من التقويم", "Remove")}
                          onClick={() =>
                            editNote(open.id, { due: undefined, dueTime: undefined, dueAuto: false })
                          }
                        >
                          ✕
                        </button>
                      </>
                    )}
                    {!open.due && (
                      <span className="hint">
                        {t("اكتبي «بكرة» أو «الأحد الساعة ٩» ويلتقطه بنفسه", "Write a date and it is picked up")}
                      </span>
                    )}
                  </div>

                  <div className="nb-foot">{whenAr(open.updatedAt)}</div>
                </>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
