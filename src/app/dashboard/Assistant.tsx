"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { loadUserData, saveUserData } from "@/lib/userdata";
import { PIcon } from "./pickicons";

/* ============================================================
   المساعد — يجيب من بيانات اللوحة نفسها، بلا أي خدمة خارجية:
   لا يخرج من المتصفح شيء، ولا يحتاج مفتاحاً ولا موافقة أمنية.
   مبنيّ ليصير مصدر الجواب نموذجاً لاحقاً بلا تغيير الواجهة:
   يكفي استبدال answer() بنداء الخادم.
   ============================================================ */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Rec = Record<string, any>;
type T = (ar: string, en: string) => string;
type Me = { id: string; name: string; scopes: string[] };

export type Pin = { id: string; title: string; icon: string; lines: string[]; at: string };
export type Ans = { title: string; icon: string; lines: string[]; chips?: { k: string; v: string; tone?: string }[]; note?: string };

const txt = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const num = (v: unknown, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const today = () => new Date().toISOString().slice(0, 10);
const daysTo = (d: string) => Math.round((new Date(d).getTime() - new Date(today()).getTime()) / 86400000);
const AR_MONTHS = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];

/* ---------------- المثبَّتات ---------------- */
export function usePins() {
  const [pins, setPins] = useState<Pin[]>([]);
  useEffect(() => {
    void loadUserData<Pin[]>("pins", []).then((d) => setPins(Array.isArray(d) ? d : []));
  }, []);
  const add = useCallback((p: Pin) => {
    setPins((old) => {
      const next = [p, ...old.filter((x) => x.id !== p.id)].slice(0, 8);
      void saveUserData("pins", next);
      return next;
    });
  }, []);
  const remove = useCallback((id: string) => {
    setPins((old) => {
      const next = old.filter((x) => x.id !== id);
      void saveUserData("pins", next);
      return next;
    });
  }, []);
  return { pins, add, remove };
}

/** شريط المثبَّتات — مربعات صغيرة أعلى كل صفحة */
export function PinnedBar({ pins, onRemove, t }: { pins: Pin[]; onRemove: (id: string) => void; t: T }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!pins.length) return null;
  return (
    <div className="pinbar">
      {pins.map((p) => (
        <div className={`pin ${open === p.id ? "open" : ""}`} key={p.id}>
          <button className="pin-h" onClick={() => setOpen(open === p.id ? null : p.id)}>
            <span className="ic">
              <PIcon id={p.icon} size={14} />
            </span>
            <b>{p.title}</b>
            <em>{p.lines.length}</em>
          </button>
          <button className="pin-x" onClick={() => onRemove(p.id)} title={t("إزالة", "Unpin")}>
            ✕
          </button>
          {open === p.id && (
            <div className="pin-b">
              {p.lines.map((l, i) => (
                <div key={i}>{l}</div>
              ))}
              <span className="at">{t("ثُبِّتت", "Pinned")} {p.at}</span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* ---------------- فهم السؤال ---------------- */
const has = (q: string, ...w: string[]) => w.some((x) => q.includes(x));

/** فترة مذكورة في السؤال: «من ٢٠٢٦-٠٧-٠١ إلى …» أو «هذا الشهر» أو «آخر ٣٠ يوم» */
function period(q: string): { from: string; to: string; label: string } | null {
  const iso = q.match(/(\d{4}-\d{2}-\d{2})/g);
  if (iso && iso.length >= 2) return { from: iso[0], to: iso[1], label: `${iso[0]} → ${iso[1]}` };
  const n = q.match(/(?:آخر|اخر)\s*(\d+)\s*(يوم|أيام|ايام)/);
  if (n) {
    const d = Number(n[1]);
    const from = new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
    return { from, to: today(), label: `آخر ${d} يوماً` };
  }
  if (has(q, "هذا الأسبوع", "هذا الاسبوع", "الأسبوع", "الاسبوع")) {
    const from = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    return { from, to: today(), label: "آخر أسبوع" };
  }
  if (has(q, "هذا الشهر", "الشهر")) {
    const d = new Date();
    const from = new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
    return { from, to: today(), label: `${AR_MONTHS[d.getMonth()]} ${d.getFullYear()}` };
  }
  if (has(q, "الربع")) {
    const d = new Date();
    const qs = Math.floor(d.getMonth() / 3) * 3;
    const from = new Date(d.getFullYear(), qs, 1).toISOString().slice(0, 10);
    return { from, to: today(), label: `الربع ${Math.floor(d.getMonth() / 3) + 1}` };
  }
  return null;
}

type Ctx = {
  me: Me;
  tasks: Rec[];
  rows: Rec[];
  changes: Rec[];
};

const DONE = ["مغلقة", "مكتمل", "مكتملة", "منجز", "معتمدة"];

function answer(q0: string, c: Ctx): Ans {
  const q = q0.trim();
  const mine = c.tasks.filter((x) => x.assigneeId === c.me.id);
  const open = mine.filter((x) => x.state !== "done");
  const late = open.filter((x) => x.dueDate && daysTo(x.dueDate) < 0);
  const soon = open.filter((x) => x.dueDate && daysTo(x.dueDate) >= 0 && daysTo(x.dueDate) <= 3);
  const ents = c.rows.filter((r) => r.section === "entities");
  const curQ = Math.floor(new Date().getMonth() / 3) + 1;
  const qLate = ents.filter((r) => !(Array.isArray(r.data?.q) ? r.data.q : [])[curQ - 1]);
  const chRows = c.rows.filter((r) => r.section === "changes");
  const chLate = chRows.filter((r) => txt(r.data?.status) === "متأخر");
  const commit = chRows.length ? Math.round(((chRows.length - chLate.length) / chRows.length) * 100) : null;

  /* مساعدة */
  if (!q || has(q, "مساعدة", "وش تقدر", "ماذا تستطيع", "الأوامر"))
    return {
      title: "وش أقدر أسوي؟",
      icon: "idea",
      lines: [
        "«أهم شي عندي الآن» — المتأخر والقريب موعده",
        "«أبرز أعمالي هذا الشهر» أو «من 2026-07-01 إلى 2026-08-31»",
        "«رتّب صفحتي حسب الأهمية»",
        "«كم نسبة التزامي؟»",
        "«كم جهة ما سويت لها اجتماع ربعي؟»",
        "«ملخص الأسبوع»",
      ],
      note: "الإجابات تُحسب من بياناتك داخل متصفحك — لا يخرج منها شيء.",
    };

  /* ترتيب الصفحة */
  if (has(q, "رتب", "رتّب", "ترتيب") && has(q, "صفحتي", "المحفظة", "محفظتي", "الأهمية", "الاهمية")) {
    const orderNow = [
      ...(late.length || soon.length ? ["tasks"] : []),
      ...(chLate.length ? ["changes"] : []),
      ...(qLate.length ? ["quarterly"] : []),
      "calendar",
      "strategies",
      "contrib",
      "projects",
      "reverse",
      "workflow",
      "notes",
    ];
    void saveUserData("portfolio_order_hint", orderNow);
    window.dispatchEvent(new CustomEvent("pf-reorder", { detail: orderNow }));
    return {
      title: "رُتِّبت محفظتك حسب الأهمية",
      icon: "stack-rank",
      lines: [
        late.length ? `مهامك المتأخرة (${late.length}) في الأعلى` : "لا توجد مهام متأخرة",
        chLate.length ? `طلبات التغيير المتأخرة (${chLate.length}) بعدها` : "طلبات التغيير ضمن مدّتها",
        qLate.length ? `الجهات التي لم تُعقد جلستها هذا الربع (${qLate.length})` : "التقارير الربعية مكتملة لهذا الربع",
      ],
      note: "افتحي «محفظتي» لتشوفي الترتيب الجديد — وتقدرين ترجعينه من «ترتيب ← الترتيب الافتراضي».",
    };
  }

  /* الالتزام */
  if (has(q, "التزام", "الالتزام", "طلبات التغيير", "طلب تغيير", "SLA"))
    return {
      title: "التزامي بطلبات التغيير",
      icon: "shield",
      lines: chRows.length
        ? [
            `إجمالي طلباتي: ${chRows.length}`,
            `منجزة في الوقت: ${chRows.length - chLate.length}`,
            `متأخرة الآن: ${chLate.length}`,
            ...chLate.slice(0, 5).map((r) => `متأخر: ${txt(r.data?.code)} — ${txt(r.data?.entity)}`),
          ]
        : ["لا توجد طلبات تغيير مسجّلة في محفظتك بعد."],
      chips: commit === null ? [] : [{ k: "نسبة الالتزام", v: `${commit}%`, tone: commit >= 90 ? "g" : commit >= 70 ? "a" : "r" }],
    };

  /* التقارير الربعية */
  if (has(q, "ربع", "الربعية", "جلسات", "جلسة", "جلست", "عقدت", "تعقد", "اجتماع", "اجتماعات", "لقاء", "لقاءات"))
    return {
      title: `التقارير الربعية — الربع ${curQ}`,
      icon: "calendar-check",
      lines: ents.length
        ? qLate.length
          ? [
              `${qLate.length} من ${ents.length} جهة لم تُعقد جلستها هذا الربع:`,
              ...qLate.map((r) => `• ${txt(r.data?.name)}`),
            ]
          : ["كل جهاتك عُقدت جلستها هذا الربع 👌"]
        : ["أضيفي جهاتك أولاً من مربع «جهاتي» في محفظتك."],
      chips: [
        { k: "جهاتي", v: String(ents.length) },
        { k: "مكتملة هذا الربع", v: String(ents.length - qLate.length), tone: "g" },
        { k: "متبقية", v: String(qLate.length), tone: qLate.length ? "a" : "g" },
      ],
    };

  /* أبرز الأعمال خلال فترة */
  const per = period(q);
  if (per || has(q, "أبرز", "ابرز", "ملخص", "تقرير", "إنجاز", "انجاز", "أعمالي", "اعمالي")) {
    const p = per || { from: new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10), to: today(), label: "آخر 30 يوماً" };
    const inRange = (d: string) => !!d && d.slice(0, 10) >= p.from && d.slice(0, 10) <= p.to;
    const doneT = mine.filter((x) => x.state === "done" && inRange(txt(x.completedAt || x.updatedAt)));
    const closed = c.rows.filter(
      (r) => DONE.includes(txt(r.data?.status)) && inRange(txt(r.updatedAt)),
    );
    const touched = c.rows.filter((r) => inRange(txt(r.updatedAt)));
    return {
      title: `أبرز أعمالي — ${p.label}`,
      icon: "award",
      chips: [
        { k: "مهام أنجزتها", v: String(doneT.length), tone: "g" },
        { k: "بنود أُغلقت", v: String(closed.length), tone: "g" },
        { k: "بنود حدّثتها", v: String(touched.length) },
      ],
      lines: [
        ...doneT.slice(0, 5).map((x) => `أنجزت: ${txt(x.title)}`),
        ...closed.slice(0, 5).map((r) => `أُغلق: ${txt(r.data?.name || r.data?.code)}`),
        ...(doneT.length + closed.length === 0 ? ["لا توجد أعمال مكتملة في هذه الفترة."] : []),
      ],
    };
  }

  /* المهام */
  if (has(q, "مهام", "مهمة", "مهامي", "تكاليف", "تكليف", "مسند"))
    return {
      title: "مهامي",
      icon: "clipboard",
      chips: [
        { k: "مفتوحة", v: String(open.length) },
        { k: "متأخرة", v: String(late.length), tone: late.length ? "r" : "g" },
        { k: "خلال 3 أيام", v: String(soon.length), tone: soon.length ? "a" : "g" },
      ],
      lines: [
        ...late.map((x) => `متأخرة ${Math.abs(daysTo(x.dueDate))} يوم: ${txt(x.title)}`),
        ...soon.map((x) => `${daysTo(x.dueDate) === 0 ? "اليوم" : `بعد ${daysTo(x.dueDate)} يوم`}: ${txt(x.title)}`),
        ...(late.length + soon.length === 0 ? ["لا يوجد شيء مستحق قريباً."] : []),
      ],
    };

  /* الجهات */
  if (has(q, "جهات", "جهاتي", "جهة", "استراتيجيات", "الاستراتيجيات", "برامج", "برنامج"))
    return {
      title: "جهاتي واستراتيجياتي",
      icon: "building",
      chips: [{ k: "العدد", v: String(ents.length) }],
      lines: ents.length
        ? ents.map(
            (r) =>
              `${txt(r.data?.name)} — ${txt(r.data?.type) || "بلا نوع"}${
                num(r.data?.kpis) ? ` · ${num(r.data.kpis)} مؤشراً` : ""
              }`,
          )
        : ["لا توجد جهات مسجّلة بعد."],
    };

  /* الافتراضي: أهم ما عندك الآن */
  return {
    title: "أهم ما عندك الآن",
    icon: "alert",
    chips: [
      { k: "مهام متأخرة", v: String(late.length), tone: late.length ? "r" : "g" },
      { k: "مستحقة خلال 3 أيام", v: String(soon.length), tone: soon.length ? "a" : "g" },
      { k: "طلبات متأخرة", v: String(chLate.length), tone: chLate.length ? "r" : "g" },
      { k: "جهات بلا جلسة هذا الربع", v: String(qLate.length), tone: qLate.length ? "a" : "g" },
    ],
    lines: [
      ...late.slice(0, 4).map((x) => `مهمة متأخرة ${Math.abs(daysTo(x.dueDate))} يوم: ${txt(x.title)}`),
      ...soon.slice(0, 3).map((x) => `مستحقة ${daysTo(x.dueDate) === 0 ? "اليوم" : `بعد ${daysTo(x.dueDate)} يوم`}: ${txt(x.title)}`),
      ...chLate.slice(0, 3).map((r) => `طلب تغيير متأخر: ${txt(r.data?.code)} — ${txt(r.data?.entity)}`),
      ...qLate.slice(0, 3).map((r) => `لم تُعقد جلسة الربع: ${txt(r.data?.name)}`),
      ...(late.length + soon.length + chLate.length + qLate.length === 0 ? ["كل شيء تحت السيطرة 👌"] : []),
    ],
  };
}

/* ---------------- الواجهة ---------------- */
const SUGGEST = [
  "أهم شي عندي الآن",
  "أبرز أعمالي هذا الشهر",
  "رتّب صفحتي حسب الأهمية",
  "كم نسبة التزامي؟",
  "كم جهة ما سويت لها اجتماع ربعي؟",
];

export default function Assistant({ me, t, onPin }: { me: Me; t: T; onPin: (p: Pin) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [ans, setAns] = useState<Ans | null>(null);
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const box = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const [tk, pf] = await Promise.all([
      apiFetch("/api/tasks").then((r) => r.json()).catch(() => ({})),
      apiFetch("/api/portfolio").then((r) => r.json()).catch(() => ({})),
    ]);
    setCtx({ me, tasks: tk.tasks || [], rows: pf.items || [], changes: [] });
  }, [me]);

  useEffect(() => {
    if (open && !ctx) void load();
    if (open) setTimeout(() => box.current?.focus(), 60);
  }, [open, ctx, load]);

  function ask(text: string) {
    setQ(text);
    if (!ctx) return;
    setAns(answer(text, ctx));
  }

  const pinIt = () => {
    if (!ans) return;
    onPin({
      id: "pin-" + Date.now().toString(36),
      title: ans.title,
      icon: ans.icon,
      lines: [...(ans.chips || []).map((c) => `${c.k}: ${c.v}`), ...ans.lines].slice(0, 8),
      at: today(),
    });
  };

  const first = useMemo(() => (ctx ? answer("", ctx) : null), [ctx]);
  const show = ans || first;

  return (
    <>
      <button className="ai-fab" onClick={() => setOpen(true)} title={t("المساعد", "Assistant")} aria-label="assistant">
        <PIcon id="idea" size={20} />
        <span>{t("المساعد", "Ask")}</span>
      </button>

      {open && (
        <div className="modal-overlay" onClick={() => setOpen(false)}>
          <div className="modal ai" onClick={(e) => e.stopPropagation()}>
            <div className="m-h">
              <span className="ai-dot">
                <PIcon id="idea" size={14} />
              </span>
              <h3>{t("المساعد", "Assistant")}</h3>
              <button className="mx" onClick={() => setOpen(false)} aria-label="close">
                ✕
              </button>
            </div>

            <div className="ai-ask">
              <input
                ref={box}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && ask(q)}
                placeholder={t("اكتب سؤالك… مثال: أبرز أعمالي هذا الشهر", "Ask…")}
              />
              <button className="btn btn-sm" onClick={() => ask(q)}>
                {t("اسأل", "Ask")}
              </button>
            </div>
            <div className="ai-sg">
              {SUGGEST.map((s) => (
                <span key={s} onClick={() => ask(s)}>
                  {s}
                </span>
              ))}
            </div>

            {!ctx ? (
              <div className="pf-none">{t("جارٍ قراءة بياناتك...", "Reading your data...")}</div>
            ) : (
              show && (
                <div className="ai-ans">
                  <div className="ai-t">
                    <span className="ic">
                      <PIcon id={show.icon} size={15} />
                    </span>
                    <b>{show.title}</b>
                    <button className="ai-pin" onClick={pinIt} title={t("تثبيت أعلى الصفحات", "Pin")}>
                      📌 {t("تثبيت", "Pin")}
                    </button>
                  </div>
                  {!!show.chips?.length && (
                    <div className="ai-chips">
                      {show.chips.map((c) => (
                        <span key={c.k} className={`ai-chip ${c.tone || ""}`}>
                          {c.k} <b>{c.v}</b>
                        </span>
                      ))}
                    </div>
                  )}
                  <ul className="ai-lines">
                    {show.lines.map((l, i) => (
                      <li key={i}>{l}</li>
                    ))}
                  </ul>
                  {show.note && <div className="ai-note">{show.note}</div>}
                </div>
              )
            )}

            <div className="ai-foot">
              {t(
                "الإجابات تُحسب من بياناتك داخل متصفحك — لا تخرج إلى أي خدمة خارجية.",
                "Answers are computed locally in your browser.",
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
