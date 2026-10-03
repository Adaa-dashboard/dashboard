"use client";

/* ============================================================
   الملاحظات اللاصقة — ورقة صفراء تُوضع حيث يُشار إليه.

   القلم في زاوية الصفحة: يُضغط فيصير المؤشر علامةَ تصويب، ثم
   يُنقر المكان المقصود فتُفتح ورقة هناك. الموضع يُحفظ بالنسبة
   المئوية لا بالبكسل، فيبقى على مكانه مهما اختلف حجم الشاشة.

   المدة: تُختار عند الكتابة، وتنتهي الملاحظة بانتهائها من نفسها.
   والرؤية والكتابة يحرسهما RLS على الصفحة نفسها.
   ============================================================ */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  /** من يراها: all للجميع · leads لمدراء القطاعات · users للمذكورين */
  audience?: string;
  mentionIds?: string[];
};

export type Person = { id: string; name: string; username: string; isLead?: boolean };

/* ------------------------------------------------------------
   المنشن — من يرى الملاحظة
   ------------------------------------------------------------
   الجمهور يُقرأ من نصّ الملاحظة نفسه لا من حالةٍ جانبية: ما يراه
   الكاتب هو ما يُحفظ، وحذفُ المنشن من النص يُلغيه فعلاً.
   الأولوية: @all ثم @sector managers ثم الأسماء.
   ------------------------------------------------------------ */
const MEN_ALL = ["@all", "@الكل"];
const MEN_LEADS = ["@sector managers", "@sectormanagers", "@مدراء القطاعات", "@مدراء القطاع"];

const menNorm = (v: string) =>
  v.replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/\s+/g, " ").trim().toLowerCase();

export function readAudience(body: string, people: Person[]): { audience: string; ids: string[] } {
  const b = menNorm(body);
  if (MEN_ALL.some((x) => b.includes(menNorm(x)))) return { audience: "all", ids: [] };
  if (MEN_LEADS.some((x) => b.includes(menNorm(x)))) return { audience: "leads", ids: [] };

  /* الأطول أولاً: «عمر العتيق» قبل «عمر»، وما طوبق يُزال من النص
     حتى لا يُحسب الاسم القصير داخل الطويل فتتّسع الدائرة بالخطأ */
  let rest = b;
  const ids: string[] = [];
  const sorted = [...people].sort((a, b2) => b2.name.length - a.name.length);
  for (const pr of sorted) {
    const tok = menNorm("@" + pr.name);
    const usr = pr.username ? menNorm("@" + pr.username) : "";
    if (tok.length > 1 && rest.includes(tok)) {
      ids.push(pr.id);
      rest = rest.split(tok).join(" ");
    } else if (usr.length > 1 && rest.includes(usr)) {
      ids.push(pr.id);
      rest = rest.split(usr).join(" ");
    }
  }
  return ids.length ? { audience: "users", ids } : { audience: "all", ids: [] };
}

/** عبارةٌ تقول من يرى الملاحظة */
function audienceText(n: StickyRow, people: Person[], t: T): string {
  const a = n.audience || "all";
  if (a === "leads") return t("مدراء القطاعات", "Sector managers");
  if (a === "users") {
    const names = (n.mentionIds || [])
      .map((id) => people.find((p) => p.id === id)?.name || "")
      .filter(Boolean);
    return names.length ? names.join(" · ") : t("المذكورون", "Mentioned");
  }
  return "";
}

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

/** أقرب بطاقة ذات عنوان تحوي هذه النقطة */
function cardAt(el: Element | null): HTMLElement | null {
  let cur = el as HTMLElement | null;
  while (cur && cur !== document.body) {
    if (cur.matches?.(CARDS) && headOf(cur)) return cur;
    cur = cur.parentElement;
  }
  return null;
}

/** عنوان البطاقة كما يقرؤه المستخدم */
function headOf(card: HTMLElement): string {
  const h = card.querySelector(HEADS);
  return (h?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 120);
}

/** إيجاد البطاقة صاحبة هذا العنوان الآن */
function findAnchor(host: HTMLElement, anchor: string): HTMLElement | null {
  if (!anchor) return null;
  const want = anchor.replace(/\s+/g, " ").trim();
  const root = host.parentElement || document.body;
  for (const c of Array.from(root.querySelectorAll<HTMLElement>(CARDS))) {
    if (headOf(c) === want) return c;
  }
  return null;
}

const clamp = (v: number, hi = 100) => Math.max(0, Math.min(hi, v));

/* الموضع الذي تُحفظ به ملاحظةٌ أُفلتت عند نقطة بعينها.
   إن وقعت داخل بطاقة، فالنسبة **من البطاقة نفسها** لا من الصفحة:
   هكذا يعني الموضعُ الشيءَ ذاته على الجوال وعلى الحاسوب مهما
   اختلف عرض البطاقة وموقعها. وإن وقعت خارج كل بطاقة فالنسبة من
   الصفحة كما كانت. */
function spotAt(host: HTMLElement, cx: number, cy: number) {
  // الطبقة تعلو المحتوى، فنُخفيها لحظةً لنقرأ ما تحتها
  host.style.pointerEvents = "none";
  const under = document.elementFromPoint(cx, cy);
  host.style.pointerEvents = "";
  const card = cardAt(under);
  if (card) {
    const r = card.getBoundingClientRect();
    return {
      anchor: headOf(card),
      x: clamp(((cx - r.left) / r.width) * 100, 96),
      y: clamp(((cy - r.top) / r.height) * 100, 96),
    };
  }
  const hr = host.getBoundingClientRect();
  return {
    anchor: "",
    x: clamp(((cx - hr.left) / hr.width) * 100, 78),
    y: clamp(((cy - hr.top) / hr.height) * 100, 96),
  };
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
  [inDays(3), "3 أيام"],
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
  onDrop,
  onSave,
  onDone,
  onDelete,
  people,
}: {
  n: StickyRow;
  mine: boolean;
  canClose: boolean;
  t: T;
  onMove: (id: string, x: number, y: number) => void;
  onDrop: (id: string, cx: number, cy: number) => void;
  onSave: (id: string, body: string, until: string | null) => void;
  onDone: (id: string) => void;
  onDelete: (id: string) => void;
  people: Person[];
}) {
  const [open, setOpen] = useState(!n.body);
  const [edit, setEdit] = useState(!n.body);
  const [text, setText] = useState(n.body);
  /* قائمة المنشن: تُفتح عند كتابة @ وتُغلق بالاختيار أو بمسافة */
  const [men, setMen] = useState<{ at: number; q: string } | null>(null);
  const ta = useRef<HTMLTextAreaElement | null>(null);

  const opts = useMemo(() => {
    const base = [
      { id: "", token: "@all", label: "all", note: t("الكل", "Everyone") },
      { id: "", token: "@sector managers", label: "sector managers", note: t("مدراء القطاعات", "Sector managers") },
    ];
    const list = people.map((pr) => ({
      id: pr.id,
      token: "@" + pr.name,
      label: pr.name,
      note: pr.username || "",
    }));
    const q = menNorm(men?.q || "");
    const all = [...base, ...list];
    if (!q) return all.slice(0, 8);
    return all
      .filter((o) => menNorm(o.label).includes(q) || menNorm(o.note).includes(q))
      .slice(0, 8);
  }, [people, men, t]);

  function typed(v: string, pos: number) {
    setText(v);
    const m = /@([^\s@]{0,30})$/.exec(v.slice(0, pos));
    setMen(m ? { at: pos - m[0].length, q: m[1] } : null);
  }

  function choose(token: string) {
    if (!men) return;
    const before = text.slice(0, men.at);
    const after = text.slice(men.at + 1 + men.q.length);
    const next = `${before}${token} ${after.replace(/^\s/, "")}`;
    setText(next);
    setMen(null);
    requestAnimationFrame(() => {
      const el = ta.current;
      if (!el) return;
      el.focus();
      const at = before.length + token.length + 1;
      el.setSelectionRange(at, at);
    });
  }

  const aud = readAudience(text, people);
  const [until, setUntil] = useState<string>(n.pinnedUntil || "");
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const dragged = useRef(false);

  /* السحب بالرأس وحده — فالنقر داخل النص لا يحرّك الورقة.
     أحداث المؤشر لا الفأرة: نفس الشيفرة تخدم الإصبع والفأرة،
     فالسحب صار يعمل على الجوال أيضاً. */
  function down(e: React.PointerEvent, after?: (moved: boolean) => void) {
    if (!mine) return;
    const host = (e.currentTarget as HTMLElement).closest(".stk-layer") as HTMLElement | null;
    if (!host) return;
    const r = host.getBoundingClientRect();
    /* الفارق بين الإصبع وزاوية الورقة — يُحسب مرّة ويُستعمل في
       التحريك وفي الإفلات معاً، فالورقة لا تقفز تحت الإصبع */
    const dx = e.clientX - (r.left + (n.x / 100) * r.width);
    const dy = e.clientY - (r.top + (n.y / 100) * r.height);
    drag.current = { dx, dy };
    let moved = false;
    const move = (ev: PointerEvent) => {
      /* عتبة صغيرة: الإصبع لا يثبت تماماً على الشاشة، فبلا عتبة
         تصير كل ضغطة «سحباً» ولا يُفتح الدبّوس أبداً */
      if (!moved && Math.abs(ev.clientX - e.clientX) < 5 && Math.abs(ev.clientY - e.clientY) < 5) return;
      moved = true;
      const x = ((ev.clientX - dx - r.left) / r.width) * 100;
      const y = ((ev.clientY - dy - r.top) / r.height) * 100;
      onMove(n.id, Math.max(0, Math.min(78, x)), Math.max(0, Math.min(96, y)));
    };
    const up = (ev: PointerEvent) => {
      drag.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      /* بلا حركة لا حفظ — الضغطة وحدها ليست نقلاً.
         والبند يُقرأ من زاوية الورقة لا من موضع الإصبع: الزاوية
         هي ما يراه المستخدم مستقرّاً على البطاقة */
      if (moved) onDrop(n.id, ev.clientX - dx + 8, ev.clientY - dy + 8);
      after?.(moved);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  return (
    <div className={`stk ${open ? "open" : ""}`} style={{ left: `${n.x}%`, top: `${n.y}%` }}>
      {!open ? (
        /* الدبّوس نفسه يُسحب: النقر يفتحه والجرّ ينقله — فلا حاجة
           لفتح الملاحظة لتغيير مكانها. dragged يمنع الفتح بعد الجرّ،
           لأن المتصفح يُطلق click في نهاية السحب أيضاً. */
        <button
          className={`stk-pin ${mine ? "grab" : ""}`}
          onPointerDown={(e) => down(e, (moved) => { dragged.current = moved; })}
          onClick={() => {
            if (dragged.current) { dragged.current = false; return; }
            setOpen(true);
          }}
          title={mine ? t("اضغط للفتح · اسحب لنقله", "Tap to open · drag to move") : n.body.slice(0, 80)}
        >
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
              <div className="stk-ta">
                <textarea
                  autoFocus
                  ref={ta}
                  rows={4}
                  value={text}
                  placeholder={t("اكتب الملاحظة… واكتب @ لتخصّها بأحد", "Write the note… type @ to mention")}
                  onChange={(e) => typed(e.target.value, e.target.selectionStart ?? e.target.value.length)}
                  onKeyDown={(e) => { if (e.key === "Escape" && men) { e.stopPropagation(); setMen(null); } }}
                />
                {men && opts.length > 0 && (
                  <div className="stk-men">
                    {opts.map((o) => (
                      <button key={o.token} type="button" onMouseDown={(e) => { e.preventDefault(); choose(o.token); }}>
                        <b>{o.label}</b>
                        {o.note && <em>{o.note}</em>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="stk-aud">
                {aud.audience === "all"
                  ? t("يراها كل من يفتح الصفحة", "Everyone on this page will see it")
                  : aud.audience === "leads"
                    ? t("يراها مدراء القطاعات وحدهم", "Only sector managers will see it")
                    : `${t("يراها", "Seen only by")}: ${aud.ids
                        .map((id) => people.find((p2) => p2.id === id)?.name || "")
                        .filter(Boolean)
                        .join(" · ")}`}
              </div>
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
              {(n.audience || "all") !== "all" && (
                <div className="stk-only">🔒 {audienceText(n, people, t)}</div>
              )}
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
  onAnnounce,
}: {
  /** مفتاح الصفحة — هو نفسه مفتاح صلاحيتها */
  page: string;
  /** الكتابة لمدير الإدارة ومدراء القطاعات — والقراءة لمن يفتح الصفحة */
  canWrite: boolean;
  /** من يحرّر الصفحة يقدر يغلق ملاحظات غيره بعد معالجتها */
  canClose: boolean;
  t: T;
  /** فتح نافذة نشر إعلان — القلم يجمع الكتابتين */
  onAnnounce: () => void;
}) {
  const [rows, setRows] = useState<StickyRow[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [meId, setMeId] = useState("");
  const [placing, setPlacing] = useState(false);
  /* قائمة القلم: ملاحظة أو إعلان */
  const [menu, setMenu] = useState(false);
  const [err, setErr] = useState("");
  const host = useRef<HTMLDivElement | null>(null);

  /* الأسماء تُجلب مرة واحدة — يحتاجها المنشن ويُعرض بها من تعنيه */
  useEffect(() => {
    let live = true;
    apiFetch("/api/people")
      .then((r) => r.json())
      .then((d) => { if (live) setPeople(Array.isArray(d.people) ? d.people : []); })
      .catch(() => setPeople([]));
    return () => { live = false; };
  }, []);

  /* صفحةٌ بلا ملاحظات لاصقة (`page` فارغ): القلم يبقى للإعلان،
     ولا تُطلب أوراقٌ لصفحةٍ لا تحملها */
  const load = useCallback(async () => {
    if (!page) {
      setRows([]);
      return;
    }
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

  /* قائمة القلم تُغلق بالضغط خارجها وبـEsc — وإلا بقيت معلّقة */
  useEffect(() => {
    if (!menu) return;
    const shut = () => setMenu(false);
    const k = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    window.addEventListener("click", shut);
    window.addEventListener("keydown", k);
    return () => {
      window.removeEventListener("click", shut);
      window.removeEventListener("keydown", k);
    };
  }, [menu]);

  async function place(e: React.MouseEvent) {
    if (!placing || !canWrite || !host.current) return;
    const { anchor, x, y } = spotAt(host.current, e.clientX, e.clientY);
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

  /* أثناء السحب: تحريك مؤقّت للعرض وحده — لا يُحفظ ولا يمسّ الرسوّ.
     الموضع النهائي يُحسب عند الإفلات في drop() أدناه. */
  const [dragPos, setDragPos] = useState<Record<string, { x: number; y: number }>>({});
  const move = (id: string, x: number, y: number) =>
    setDragPos((v) => ({ ...v, [id]: { x, y } }));

  /* الإفلات: تُعاد الملاحظة إلى البطاقة التي أُفلتت عندها.
     مسحُ الرسوّ عند كل سحب كان يجعل الموضع نسبةً من شاشة الجهاز
     الذي سُحبت فيه، فيقع على غير محلّه في الجهاز الآخر. */
  async function drop(id: string, cx: number, cy: number) {
    const h = host.current;
    if (!h) return;
    const spot = spotAt(h, cx, cy);
    setDragPos((v) => {
      const n = { ...v };
      delete n[id];
      return n;
    });
    setRows((v) => v.map((r) => (r.id === id ? { ...r, ...spot } : r)));
    const cur = rows.find((r) => r.id === id);
    const res = await apiFetch("/api/stickies", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, x: spot.x, y: spot.y, anchor: spot.anchor, body: cur?.body ?? "", pinnedUntil: cur?.pinnedUntil ?? null }),
    }).then((r) => r.json()).catch(() => ({ error: "تعذّر الاتصال" }));
    /* الفشل الصامت هنا مكلف: الورقة تتحرّك أمام العين ولا يُحفظ
       شيء، فتعود لمكانها عند إعادة الفتح ويبدو الأمر عطلاً غامضاً */
    if (res?.error) setErr(String(res.error));
  }

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
      // x و y نسبةٌ من البطاقة حين يكون لها رسوّ — تُترجَم هنا إلى نسبة من الصفحة
      next[n.id] = {
        x: clamp((((r.left - hr.left) + (n.x / 100) * r.width) / hr.width) * 100, 90),
        y: clamp((((r.top - hr.top) + (n.y / 100) * r.height) / hr.height) * 100, 96),
      };
    }
    setFix((cur) => {
      const same = Object.keys(next).length === Object.keys(cur).length &&
        Object.keys(next).every((k) => cur[k] && Math.abs(cur[k].x - next[k].x) < 0.2 && Math.abs(cur[k].y - next[k].y) < 0.2);
      return same ? cur : next;
    });
  }, [rows]);

  /* البطاقات تصل بعد جلبها من القاعدة، وأطوالها تتغيّر مع الصور
     والخطوط. فمرّةٌ واحدة عند التركيب لا تكفي: نراقب تغيّر مقاس
     الصفحة وتغيّر شجرتها، ونعيد المحاولة بضع مرات في أول ثوانٍ.
     بلا هذا يُحسب الموضع قبل وجود البطاقة، فتقع الورقة على
     الاحتياطي (نسبة الصفحة) وتبدو في مكان غير مكانها. */
  useEffect(() => {
    relayout();
    const timers = [120, 400, 900, 1800, 3000].map((ms) => window.setTimeout(relayout, ms));
    const host2 = host.current?.parentElement || null;
    let raf = 0;
    const soon = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => { raf = 0; relayout(); });
    };
    const ro = host2 && "ResizeObserver" in window ? new ResizeObserver(soon) : null;
    ro?.observe(host2!);
    const mo = host2 ? new MutationObserver(soon) : null;
    mo?.observe(host2!, { childList: true, subtree: true, characterData: true });
    window.addEventListener("resize", relayout);
    return () => {
      timers.forEach((h) => window.clearTimeout(h));
      if (raf) window.cancelAnimationFrame(raf);
      ro?.disconnect();
      mo?.disconnect();
      window.removeEventListener("resize", relayout);
    };
  }, [relayout]);

  /* ورقةٌ لها رسوّ ولم تُوجد بطاقتها بعد: تُخفى ولا تُعرض على
     الاحتياطي — إظهارها في غير موضعها أسوأ من تأخّرها لحظة.
     فإن لم تظهر البطاقة خلال ثلاث ثوانٍ (عنوان تغيّر مثلاً)
     تُعرض على الاحتياطي حتى لا تضيع. */
  const [late, setLate] = useState(false);
  useEffect(() => {
    const h = window.setTimeout(() => setLate(true), 3000);
    return () => window.clearTimeout(h);
  }, []);

  async function save(id: string, body: string, until: string | null) {
    /* الجمهور يُقرأ من النص عند الحفظ، فما يراه الكاتب هو ما يُحفظ */
    const aud = readAudience(body, people);
    const cur = rows.find((r) => r.id === id);
    await apiFetch("/api/stickies", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id, body, pinnedUntil: until, x: cur?.x, y: cur?.y, anchor: cur?.anchor ?? "",
        audience: aud.audience, mentionIds: aud.ids,
      }),
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
        {rows.filter((n) => !n.anchor || fix[n.id] || dragPos[n.id] || late).map((n) => (
          <Note
            key={n.id}
            n={
              dragPos[n.id]
                ? { ...n, x: dragPos[n.id].x, y: dragPos[n.id].y }
                : fix[n.id]
                  ? { ...n, x: fix[n.id].x, y: fix[n.id].y }
                  : n
            }
            mine={String(n.byId) === String(meId)}
            canClose={canClose && String(n.byId) !== String(meId)}
            t={t}
            onMove={move}
            onDrop={drop}
            onSave={save}
            onDone={done}
            onDelete={del}
            people={people}
          />
        ))}
      </div>

      {/* الرصيف: يلتصق بأسفل الشاشة ويبقى داخل عرض الصفحة البيضاء،
          فلا يعلو الشريط الجانبي ولا يغيب مع التمرير */}
      <div className="stk-dock">
        {/* القلم يجمع الكتابتين: ملاحظةٌ على هذه الصفحة، أو إعلانٌ
            يمرّ على المنصة كلها. وهو مكان الكتابة المعروف فيها،
            فلا يحتاج الإعلان زرّاً ثانياً في شريطه. */}
        <div className="stk-pw">
        {menu && (
          <div className="stk-menu" onClick={(e) => e.stopPropagation()}>
            {canWrite && (
              <button
                onClick={() => {
                  setMenu(false);
                  setPlacing(true);
                }}
              >
                <i>✎</i>
                <b>{t("اكتب ملاحظة", "Write a note")}</b>
                <em>{t("ورقة على هذه الصفحة", "A note on this page")}</em>
              </button>
            )}
            <button
              onClick={() => {
                setMenu(false);
                onAnnounce();
              }}
            >
              <i>📣</i>
              <b>{t("نشر إعلان", "Announce")}</b>
              <em>{t("شريط يراه الجميع بمدّة تنتهي وحدها", "Seen by everyone")}</em>
            </button>
          </div>
        )}
        <button
          className={`stk-pen ${placing || menu ? "on" : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            if (placing) {
              setPlacing(false);
              return;
            }
            setMenu((v) => !v);
          }}
          title={t("اكتب ملاحظة أو انشر إعلاناً", "Write a note or announce")}
        >
          ✎
          {rows.length > 0 && <span>{rows.length}</span>}
        </button>
        </div>
        {err && (
          <div className="stk-hint err no-print" onClick={() => setErr("")}>
            {t("تعذّر حفظ الموضع", "Could not save")}: {err}
          </div>
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