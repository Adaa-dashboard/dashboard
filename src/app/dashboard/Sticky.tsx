"use client";

/* ============================================================
   الملاحظات اللاصقة — ورقة صفراء تُوضع حيث يُشار إليه.

   القلم في زاوية الصفحة: يُضغط فيصير المؤشر علامةَ تصويب، ثم
   يُنقر المكان المقصود فتُفتح ورقة هناك. الموضع يُحفظ بالنسبة
   المئوية لا بالبكسل، فيبقى على مكانه مهما اختلف حجم الشاشة.

   المدة: تُختار عند الكتابة، وتنتهي الملاحظة بانتهائها من نفسها.
   والرؤية والكتابة يحرسهما RLS على الصفحة نفسها.
   ============================================================ */

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";

type T = (ar: string, en: string) => string;

export type StickyRow = {
  id: string;
  page: string;
  x: number;
  y: number;
  body: string;
  byId: string;
  byName: string;
  at: string;
  pinnedUntil: string | null;
  /** عنوان البطاقة التي وُضعت عندها — يُردّها لمكانها في أي تخطيط */
  anchor?: string;
};

/* ------------------------------------------------------------
   الرسوّ على بند بعينه
   ------------------------------------------------------------
   النسبة المئوية تصمد أمام اختلاف حجم الشاشة، ولا تصمد أمام
   اختلاف التخطيط: ثلاثة أعمدة على الحاسوب تصير عموداً واحداً على
   الجوال، فالنقطة نفسها تقع عند بندٍ آخر. لذلك نحفظ مع الموضع
   عنوانَ البطاقة، ونعود إليها حيثما وقعت.
   ------------------------------------------------------------ */
const CARDS = ".card, .widget, .sx-card, .sx-box, .sx-grp, .pf-w, .tcol, .kp, section";
const HEADS = "h1, h2, h3, h4, .sec-h, .sx-h, .wg-h, .tcol-h, .k";

/** عنوان أقرب بطاقة تحوي هذه النقطة */
function anchorAt(el: Element | null): string {
  let cur = el as HTMLElement | null;
  while (cur && cur !== document.body) {
    if (cur.matches?.(CARDS)) {
      const h = cur.querySelector(HEADS);
      const txt = (h?.textContent || "").replace(/\s+/g, " ").trim();
      if (txt) return txt.slice(0, 120);
    }
    cur = cur.parentElement;
  }
  return "";
}

/** إيجاد البطاقة صاحبة هذا العنوان الآن */
function findAnchor(host: HTMLElement, anchor: string): HTMLElement | null {
  if (!anchor) return null;
  const want = anchor.replace(/\s+/g, " ").trim();
  const root = host.parentElement || document.body;
  for (const c of Array.from(root.querySelectorAll<HTMLElement>(CARDS))) {
    const h = c.querySelector(HEADS);
    const txt = (h?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 120);
    if (txt && txt === want) return c;
  }
  return null;
}

const AR_MONTHS = [
  "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
  "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
];
function shortWhen(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return `اليوم ${hh}:${mm}`;
  return `${d.getDate()} ${AR_MONTHS[d.getMonth()]}`;
}
function untilText(v: string | null): string {
  if (!v) return "بلا مدة";
  const [y, m, d] = v.slice(0, 10).split("-").map(Number);
  const left = Math.ceil((new Date(v).getTime() - Date.now()) / 86400000);
  const date = `${d} ${AR_MONTHS[m - 1]}`;
  if (left <= 0) return `حتى ${date}`;
  if (left === 1) return `يوم واحد — حتى ${date}`;
  if (left === 2) return `يومان — حتى ${date}`;
  return `${left} ${left <= 10 ? "أيام" : "يومًا"} — حتى ${date}`;
}
const inDays = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

const DURS: [string, string][] = [
  [inDays(3), "٣ أيام"],
  [inDays(7), "أسبوع"],
  [inDays(30), "شهر"],
  ["", "بلا مدة"],
];

/* ورقة واحدة — تُطوى إلى دبّوس حتى لا تحجب ما تحتها */
function Note({
  n,
  mine,
  canClose,
  t,
  onMove,
  onSave,
  onDone,
  onDelete,
}: {
  n: StickyRow;
  mine: boolean;
  canClose: boolean;
  t: T;
  onMove: (id: string, x: number, y: number) => void;
  onSave: (id: string, body: string, until: string | null) => void;
  onDone: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState(!n.body);
  const [edit, setEdit] = useState(!n.body);
  const [text, setText] = useState(n.body);
  const [until, setUntil] = useState<string>(n.pinnedUntil || "");
  const drag = useRef<{ dx: number; dy: number } | null>(null);

  /* السحب بالرأس وحده — فالنقر داخل النص لا يحرّك الورقة.
     أحداث المؤشر لا الفأرة: نفس الشيفرة تخدم الإصبع والفأرة،
     فالسحب صار يعمل على الجوال أيضاً. */
  function down(e: React.PointerEvent) {
    if (!mine) return;
    const host = (e.currentTarget as HTMLElement).closest(".stk-layer") as HTMLElement | null;
    if (!host) return;
    const r = host.getBoundingClientRect();
    drag.current = {
      dx: e.clientX - (r.left + (n.x / 100) * r.width),
      dy: e.clientY - (r.top + (n.y / 100) * r.height),
    };
    let moved = false;
    const move = (ev: PointerEvent) => {
      moved = true;
      const x = ((ev.clientX - (drag.current?.dx || 0) - r.left) / r.width) * 100;
      const y = ((ev.clientY - (drag.current?.dy || 0) - r.top) / r.height) * 100;
      onMove(n.id, Math.max(0, Math.min(78, x)), Math.max(0, Math.min(96, y)));
    };
    const up = () => {
      drag.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      // بلا حركة لا حفظ — الضغطة وحدها ليست نقلاً
      if (moved) onSave(n.id, text, until || null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  return (
    <div className={`stk ${open ? "open" : ""}`} style={{ left: `${n.x}%`, top: `${n.y}%` }}>
      {!open ? (
        <button className="stk-pin" onClick={() => setOpen(true)} title={n.body.slice(0, 80)}>
          📌
        </button>
      ) : (
        <div className="stk-card">
          <div className={`stk-h ${mine ? "grab" : ""}`} onPointerDown={down}>
            <b>{n.byName}</b>
            <span>{shortWhen(n.at)}</span>
            <button className="stk-x" onClick={() => setOpen(false)} title={t("طيّ", "Collapse")}>
              −
            </button>
          </div>

          {edit ? (
            <>
              <textarea
                autoFocus
                rows={4}
                value={text}
                placeholder={t("اكتب الملاحظة أو السؤال…", "Write the note…")}
                onChange={(e) => setText(e.target.value)}
              />
              <div className="stk-dur">
                {DURS.map(([v, lb]) => (
                  <button key={lb} className={until === v ? "on" : ""} onClick={() => setUntil(v)}>
                    {lb}
                  </button>
                ))}
              </div>
              <div className="stk-act">
                <button
                  className="stk-ok"
                  disabled={!text.trim()}
                  onClick={() => {
                    onSave(n.id, text.trim(), until || null);
                    setEdit(false);
                  }}
                >
                  {t("حفظ", "Save")}
                </button>
                <button className="stk-c" onClick={() => (n.body ? setEdit(false) : onDelete(n.id))}>
                  {t("إلغاء", "Cancel")}
                </button>
              </div>
            </>
          ) : (
            <>
              <p>{n.body}</p>
              <div className="stk-f">
                <span className="stk-u">📌 {untilText(n.pinnedUntil)}</span>
                {mine && (
                  <button onClick={() => setEdit(true)}>{t("تعديل", "Edit")}</button>
                )}
                {canClose && (
                  <button className="stk-done" onClick={() => onDone(n.id)}>
                    {t("تمّت المعالجة", "Resolve")}
                  </button>
                )}
                {mine && (
                  <button className="stk-del" onClick={() => onDelete(n.id)}>
                    {t("حذف", "Delete")}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function StickyLayer({
  page,
  canWrite,
  canClose,
  t,
}: {
  /** مفتاح الصفحة — هو نفسه مفتاح صلاحيتها */
  page: string;
  /** الكتابة لمدير الإدارة ومدراء القطاعات — والقراءة لمن يفتح الصفحة */
  canWrite: boolean;
  /** من يحرّر الصفحة يقدر يغلق ملاحظات غيره بعد معالجتها */
  canClose: boolean;
  t: T;
}) {
  const [rows, setRows] = useState<StickyRow[]>([]);
  const [meId, setMeId] = useState("");
  const [placing, setPlacing] = useState(false);
  const host = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    const r = await apiFetch(`/api/stickies?page=${page}`).then((x) => x.json()).catch(() => ({}));
    setRows(r.stickies || []);
    setMeId(String(r.meId || ""));
  }, [page]);

  useEffect(() => {
    void load();
  }, [load]);

  /* Esc يلغي وضع الوضع — فلا يعلق المؤشر على علامة التصويب */
  useEffect(() => {
    if (!placing) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && setPlacing(false);
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [placing]);

  async function place(e: React.MouseEvent) {
    if (!placing || !canWrite || !host.current) return;
    const r = host.current.getBoundingClientRect();
    /* الإحداثي من الحافة اليسرى الفيزيائية — لا من «بداية السطر»،
       فلا ينقلب المعنى بين العربية والإنجليزية */
    const x = Math.max(0, Math.min(78, ((e.clientX - r.left) / r.width) * 100));
    const y = Math.max(0, Math.min(96, ((e.clientY - r.top) / r.height) * 100));
    /* ما البند تحت الإصبع؟ الطبقة نفسها تلتقط الضغطة، فنُخفيها
       لحظةً لنقرأ ما تحتها */
    host.current.style.pointerEvents = "none";
    const under = document.elementFromPoint(e.clientX, e.clientY);
    host.current.style.pointerEvents = "";
    const anchor = anchorAt(under);
    setPlacing(false);
    const res = await apiFetch("/api/stickies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ page, x, y, anchor, body: "", pinnedUntil: inDays(7) }),
    }).then((x2) => x2.json()).catch(() => ({}));
    if (res.id)
      setRows((v) => [
        ...v,
        { id: res.id, page, x, y, anchor, body: "", byId: meId, byName: t("أنا", "Me"), at: new Date().toISOString(), pinnedUntil: inDays(7) },
      ]);
  }

  const move = (id: string, x: number, y: number) =>
    setRows((v) => v.map((r) => (r.id === id ? { ...r, x, y, anchor: "" } : r)));

  /* ملاحظةٌ لها رسوّ توضع عند بطاقتها لا عند نسبتها المحفوظة.
     يُعاد الحساب مع كل تغيّر في المقاس أو المحتوى. */
  const [fix, setFix] = useState<Record<string, { x: number; y: number }>>({});
  const relayout = useCallback(() => {
    const h = host.current;
    if (!h) return;
    const hr = h.getBoundingClientRect();
    if (!hr.width || !hr.height) return;
    const next: Record<string, { x: number; y: number }> = {};
    for (const n of rows) {
      if (!n.anchor) continue;
      const el = findAnchor(h, n.anchor);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      next[n.id] = {
        x: Math.max(0, Math.min(78, ((r.left - hr.left + 10) / hr.width) * 100)),
        y: Math.max(0, Math.min(96, ((r.top - hr.top + 10) / hr.height) * 100)),
      };
    }
    setFix((cur) => {
      const same = Object.keys(next).length === Object.keys(cur).length &&
        Object.keys(next).every((k) => cur[k] && Math.abs(cur[k].x - next[k].x) < 0.2 && Math.abs(cur[k].y - next[k].y) < 0.2);
      return same ? cur : next;
    });
  }, [rows]);

  useEffect(() => {
    relayout();
    const h = window.setTimeout(relayout, 400); // بعد اكتمال رسم البطاقات
    window.addEventListener("resize", relayout);
    return () => { window.clearTimeout(h); window.removeEventListener("resize", relayout); };
  }, [relayout]);

  async function save(id: string, body: string, until: string | null) {
    const cur = rows.find((r) => r.id === id);
    await apiFetch("/api/stickies", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      // من سحبها بيده اختار موضعاً صريحاً، فيُمحى رسوّها على البند
      body: JSON.stringify({ id, body, pinnedUntil: until, x: cur?.x, y: cur?.y, anchor: cur?.anchor ?? "" }),
    });
    setRows((v) => v.map((r) => (r.id === id ? { ...r, body, pinnedUntil: until } : r)));
  }
  async function done(id: string) {
    if (!confirm(t("إغلاق هذه الملاحظة؟ تختفي عن الجميع.", "Resolve this note?"))) return;
    await apiFetch("/api/stickies", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, done: true }),
    });
    setRows((v) => v.filter((r) => r.id !== id));
  }
  async function del(id: string) {
    await apiFetch(`/api/stickies?id=${id}`, { method: "DELETE" });
    setRows((v) => v.filter((r) => r.id !== id));
  }

  return (
    <>
      <div
        ref={host}
        className={`stk-layer ${placing ? "placing" : ""}`}
        onClick={place}
      >
        {rows.map((n) => (
          <Note
            key={n.id}
            n={fix[n.id] ? { ...n, x: fix[n.id].x, y: fix[n.id].y } : n}
            mine={String(n.byId) === String(meId)}
            canClose={canClose && String(n.byId) !== String(meId)}
            t={t}
            onMove={move}
            onSave={save}
            onDone={done}
            onDelete={del}
          />
        ))}
      </div>

      {/* الرصيف: يلتصق بأسفل الشاشة ويبقى داخل عرض الصفحة البيضاء،
          فلا يعلو الشريط الجانبي ولا يغيب مع التمرير */}
      <div className="stk-dock">
        {(canWrite || rows.length > 0) && (
          <button
            className={`stk-pen ${placing ? "on" : ""} ${canWrite ? "" : "ro"}`}
            onClick={() => canWrite && setPlacing((v) => !v)}
            title={
              canWrite
                ? t("ملاحظة على هذه الصفحة", "Note on this page")
                : t("ملاحظات على هذه الصفحة", "Notes on this page")
            }
          >
            {canWrite ? "✎" : "📌"}
            {rows.length > 0 && <span>{rows.length}</span>}
          </button>
        )}
        {placing && (
          <div className="stk-hint no-print">
            {t("اضغط المكان الذي تريد الملاحظة عنده · Esc للإلغاء", "Click where the note belongs · Esc to cancel")}
          </div>
        )}
      </div>

    </>
  );
}