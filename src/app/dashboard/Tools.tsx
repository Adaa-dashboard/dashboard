"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import Notes from "./Notes";

/* ============================================================
   أدوات سريعة في زاوية الترويسة: حاسبة · تقويم · ملاحظات.
   تُفتح فوق الصفحة بلا مغادرتها، وتُغلق بالضغط خارجها أو Esc.
   ============================================================ */

const MONTHS_AR = [
  "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
  "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
];
const DAYS_AR = ["أحد", "اثنين", "ثلاثاء", "أربعاء", "خميس", "جمعة", "سبت"];

/* ---------------- الحاسبة ---------------- */
function Calc({ t }: { t: (ar: string, en: string) => string }) {
  const [disp, setDisp] = useState("0");
  const [acc, setAcc] = useState<number | null>(null);
  const [op, setOp] = useState<string | null>(null);
  const [fresh, setFresh] = useState(true);
  const [tape, setTape] = useState("");

  const apply = useCallback((a: number, b: number, o: string): number => {
    if (o === "+") return a + b;
    if (o === "−") return a - b;
    if (o === "×") return a * b;
    if (o === "÷") return b === 0 ? NaN : a / b;
    return b;
  }, []);

  const show = (n: number) => {
    if (!Number.isFinite(n)) return "لا يمكن القسمة على صفر";
    const r = Math.round(n * 1e10) / 1e10;
    return String(r);
  };

  const digit = useCallback(
    (d: string) => {
      setDisp((cur) => {
        if (fresh) return d === "." ? "0." : d;
        if (d === "." && cur.includes(".")) return cur;
        if (cur === "0" && d !== ".") return d;
        return cur + d;
      });
      setFresh(false);
    },
    [fresh]
  );

  const operate = useCallback(
    (next: string) => {
      const cur = Number(disp);
      if (op !== null && acc !== null && !fresh) {
        const r = apply(acc, cur, op);
        setAcc(r);
        setDisp(show(r));
        setTape(`${show(r)} ${next}`);
      } else {
        setAcc(cur);
        setTape(`${disp} ${next}`);
      }
      setOp(next);
      setFresh(true);
    },
    [acc, op, disp, fresh, apply]
  );

  const equals = useCallback(() => {
    if (op === null || acc === null) return;
    const r = apply(acc, Number(disp), op);
    setTape(`${show(acc)} ${op} ${disp} =`);
    setDisp(show(r));
    setAcc(null);
    setOp(null);
    setFresh(true);
  }, [acc, op, disp, apply]);

  const clear = () => {
    setDisp("0");
    setAcc(null);
    setOp(null);
    setFresh(true);
    setTape("");
  };
  const back = () =>
    setDisp((c) => (c.length <= 1 || fresh ? "0" : c.slice(0, -1)));

  // لوحة المفاتيح تعمل كما تعمل الأزرار
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const k = e.key;
      if (/^[0-9.]$/.test(k)) return digit(k);
      if (k === "+") return operate("+");
      if (k === "-") return operate("−");
      if (k === "*") return operate("×");
      if (k === "/") {
        e.preventDefault();
        return operate("÷");
      }
      if (k === "Enter" || k === "=") return equals();
      if (k === "Backspace") return back();
      if (k === "Escape") return clear();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [digit, operate, equals]);

  const KEYS: { k: string; cls?: string; fn: () => void }[] = [
    { k: "C", cls: "fn", fn: clear },
    { k: "⌫", cls: "fn", fn: back },
    { k: "%", cls: "fn", fn: () => { setDisp((c) => show(Number(c) / 100)); setFresh(true); } },
    { k: "÷", cls: "op", fn: () => operate("÷") },
    { k: "7", fn: () => digit("7") },
    { k: "8", fn: () => digit("8") },
    { k: "9", fn: () => digit("9") },
    { k: "×", cls: "op", fn: () => operate("×") },
    { k: "4", fn: () => digit("4") },
    { k: "5", fn: () => digit("5") },
    { k: "6", fn: () => digit("6") },
    { k: "−", cls: "op", fn: () => operate("−") },
    { k: "1", fn: () => digit("1") },
    { k: "2", fn: () => digit("2") },
    { k: "3", fn: () => digit("3") },
    { k: "+", cls: "op", fn: () => operate("+") },
    { k: "±", cls: "fn", fn: () => setDisp((c) => show(-Number(c))) },
    { k: "0", fn: () => digit("0") },
    { k: ".", fn: () => digit(".") },
    { k: "=", cls: "eq", fn: equals },
  ];

  return (
    <div className="tl-calc">
      <div className="tl-disp">
        <span className="tape">{tape}</span>
        <b dir="ltr">{disp}</b>
      </div>
      <div className="tl-keys">
        {KEYS.map((b, i) => (
          <button key={i} className={`tl-k ${b.cls || ""}`} onClick={b.fn} type="button">
            {b.k}
          </button>
        ))}
      </div>
      <div className="tl-hint">{t("لوحة المفاتيح تعمل أيضاً", "Keyboard works too")}</div>
    </div>
  );
}

/* ---------------- التقويم ---------------- */
type Due = { id: string; title: string; dueDate: string; kind?: string; state: string };

export function Cal({ t, meId }: { t: (ar: string, en: string) => string; meId: string }) {
  const today = new Date();
  const [y, setY] = useState(today.getFullYear());
  const [m, setM] = useState(today.getMonth());
  const [items, setItems] = useState<Due[]>([]);
  const [pick, setPick] = useState<string | null>(null);

  useEffect(() => {
    apiFetch("/api/tasks")
      .then((r) => r.json())
      .then((d) => {
        const all = (d.tasks || []) as (Due & { assigneeId: string; createdById: string })[];
        setItems(all.filter((x) => x.assigneeId === meId || x.createdById === meId));
      })
      .catch(() => setItems([]));
  }, [meId]);

  const byDay = useMemo(() => {
    const map = new Map<string, Due[]>();
    for (const x of items) {
      if (!x.dueDate) continue;
      const arr = map.get(x.dueDate) || [];
      arr.push(x);
      map.set(x.dueDate, arr);
    }
    return map;
  }, [items]);

  const first = new Date(y, m, 1);
  const lead = first.getDay();
  const days = new Date(y, m + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(lead).fill(null),
    ...Array.from({ length: days }, (_, i) => i + 1),
  ];
  while (cells.length % 7) cells.push(null);

  const iso = (d: number) =>
    `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const isToday = (d: number) =>
    y === today.getFullYear() && m === today.getMonth() && d === today.getDate();

  function step(n: number) {
    const d = new Date(y, m + n, 1);
    setY(d.getFullYear());
    setM(d.getMonth());
    setPick(null);
  }

  const picked = pick ? byDay.get(pick) || [] : [];

  return (
    <div className="tl-cal">
      <div className="tl-calh">
        <button onClick={() => step(-1)} type="button" aria-label="prev">
          ›
        </button>
        <b>
          {MONTHS_AR[m]} {y}
        </b>
        <button onClick={() => step(1)} type="button" aria-label="next">
          ‹
        </button>
      </div>
      <div className="tl-grid">
        {DAYS_AR.map((d) => (
          <span className="tl-dn" key={d}>
            {d}
          </span>
        ))}
        {cells.map((d, i) =>
          d === null ? (
            <span key={i} />
          ) : (
            <button
              key={i}
              type="button"
              className={`tl-d ${isToday(d) ? "now" : ""} ${byDay.has(iso(d)) ? "has" : ""} ${
                pick === iso(d) ? "on" : ""
              }`}
              onClick={() => setPick(pick === iso(d) ? null : iso(d))}
            >
              {d}
              {byDay.has(iso(d)) && <i />}
            </button>
          )
        )}
      </div>
      <div className="tl-cal-b">
        {pick ? (
          picked.length ? (
            <ul>
              {picked.map((x) => (
                <li key={x.id}>
                  <i className={x.state === "done" ? "done" : ""} />
                  {x.title}
                  <span>{x.kind === "assignment" ? t("تكليف", "Assignment") : t("مهمة", "Task")}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p>{t("لا شيء في هذا اليوم.", "Nothing on this day.")}</p>
          )
        ) : (
          <p>
            {items.length
              ? t("النقاط أيام تنتهي فيها مهامك — اضغطي يوماً لعرضها.", "Dots mark your due dates.")
              : t("لا مهام مسندة إليك بمواعيد.", "No dated tasks assigned to you.")}
          </p>
        )}
      </div>
    </div>
  );
}

/* ---------------- الشريط ---------------- */
export default function Tools({ t, meId }: { t: (ar: string, en: string) => string; meId: string }) {
  const [open, setOpen] = useState<"" | "calc" | "cal">("");
  const [notes, setNotes] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen("");
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen("");
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
  }, []);

  return (
    <div className="tools" ref={wrap}>
      <button
        className={`tl-b ${open === "calc" ? "on" : ""}`}
        onClick={() => setOpen(open === "calc" ? "" : "calc")}
        title={t("حاسبة", "Calculator")}
        aria-label={t("حاسبة", "Calculator")}
      >
        🧮
      </button>
      <button
        className={`tl-b ${open === "cal" ? "on" : ""}`}
        onClick={() => setOpen(open === "cal" ? "" : "cal")}
        title={t("تقويم", "Calendar")}
        aria-label={t("تقويم", "Calendar")}
      >
        📅
      </button>
      <button
        className="tl-b"
        onClick={() => {
          setOpen("");
          setNotes(true);
        }}
        title={t("ملاحظات", "Notes")}
        aria-label={t("ملاحظات", "Notes")}
      >
        📝
      </button>

      {open && (
        <div className="tl-pop">
          {open === "calc" ? <Calc t={t} /> : <Cal t={t} meId={meId} />}
        </div>
      )}

      {notes && <Notes t={t} onClose={() => setNotes(false)} />}
    </div>
  );
}
