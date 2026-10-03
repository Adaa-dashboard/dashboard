"use client";

/* ============================================================
   شريط الإعلانات المتحرّك
   ------------------------------------------------------------
   إعلانٌ قصير يمرّ على المنصة كلها أمام الجميع. ثلاثة قرارات
   فيه مقصودة:

   ١) **مدّةٌ لا حذفٌ يدوي** — الكاتب يحدّد ساعتين أو يومين فينتهي
      وحده. الإعلان الذي لا ينتهي يصير أثاثاً لا يُقرأ.
   ٢) **الكلّ في شريطٍ واحد** — إعلانان من شخصين يمشيان وراء بعض
      لا شريطان فوق بعض، فلا ينمو الشريط بعدد من أعلن.
   ٣) **شفافٌ يقف عند المرور** — خلفيته شبه شفافة فلا تحجب ما
      تحتها، ويقف الدوران عند التمرير عليه ليُقرأ على مهل، ويقف
      كذلك لمن يطلب تقليل الحركة في نظامه.
   ============================================================ */

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";

export type TickItem = {
  id: string;
  body: string;
  tone: string;
  byName: string;
  until: string;
  mine: boolean;
  /** يُنهيه صاحبُه، أو صاحب الصلاحية الكاملة ليكنس ما لا يصلح */
  canStop: boolean;
};

type T = (ar: string, en: string) => string;

/** المُدد المعروضة — بالساعات */
const SPANS: { h: number; ar: string; en: string }[] = [
  { h: 2, ar: "ساعتان", en: "2 hours" },
  { h: 6, ar: "٦ ساعات", en: "6 hours" },
  { h: 24, ar: "يوم", en: "1 day" },
  { h: 48, ar: "يومان", en: "2 days" },
  { h: 168, ar: "أسبوع", en: "1 week" },
];

const TONES: { v: string; ar: string; en: string }[] = [
  { v: "red", ar: "عاجل جدّاً", en: "Urgent" },
  { v: "green", ar: "تحديث دوري", en: "Routine" },
];

/** كم بقي للإعلان — يُعرض لصاحبه ليعرف متى ينتهي */
function left(iso: string): string {
  const d = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(d) || d <= 0) return "انتهى";
  const h = Math.floor(d / 3600000);
  if (h >= 48) return `${Math.round(h / 24)} أيام`;
  if (h >= 24) return "يوم";
  if (h >= 1) return `${h} ساعة`;
  return `${Math.max(1, Math.round(d / 60000))} دقيقة`;
}

export function useTicker() {
  const [items, setItems] = useState<TickItem[]>([]);
  const load = useCallback(() => {
    void apiFetch("/api/ticker")
      .then((r) => r.json())
      .then((d) => setItems(Array.isArray(d.ticker) ? (d.ticker as TickItem[]) : []))
      .catch(() => setItems([]));
  }, []);
  useEffect(() => {
    load();
    /* الإعلان يُنشر ليُرى الآن، فالشريط يسأل كل دقيقة — وينتهي
       المنتهي من تلقاء نفسه لأن القاعدة لا تُرجعه */
    const id = setInterval(() => {
      if (!document.hidden) load();
    }, 60000);
    return () => clearInterval(id);
  }, [load]);
  return { items, reload: load };
}

/* النشر لكل من دخل — لا صلاحية له. والإعلان خبرٌ قصير بمدّةٍ
   تنتهي وحدها، لا قراراً يحتاج إذناً. */
export default function Ticker({
  items,
  t,
  onReload,
}: {
  items: TickItem[];
  t: T;
  onReload: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [tone, setTone] = useState("green");
  const [hours, setHours] = useState(24);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [dur, setDur] = useState(30);

  /* سرعةٌ ثابتةٌ بالبكسل لا مدّةٌ ثابتة: إعلانٌ واحد قصير وعشرةٌ
     طويلة لا يمشيان بالسرعة نفسها إن ثبتت المدّة — يسابق أحدهما
     العين ويزحف الآخر. ٦٠ بكسل في الثانية قراءةٌ مريحة. */
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const w = el.scrollWidth / 2;
    setDur(Math.max(14, Math.round(w / 60)));
  }, [items]);

  async function say() {
    if (!body.trim() || busy) return;
    setBusy(true);
    setErr("");
    const r = await apiFetch("/api/ticker", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: body.trim(), tone, hours }),
    })
      .then((x) => x.json())
      .catch(() => ({ error: "تعذّر الاتصال" }));
    setBusy(false);
    if (r?.error) {
      setErr(String(r.error));
      return;
    }
    setBody("");
    setOpen(false);
    onReload();
  }

  async function stop(id: string) {
    if (!confirm(t("إنهاء هذا الإعلان الآن؟", "End this announcement now?"))) return;
    await apiFetch(`/api/ticker/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => {});
    onReload();
  }

  const urgent = items.some((x) => x.tone === "red");
  /* النسخة الثانية تجعل الدوران بلا فجوة: حين تخرج الأولى تكون
     الثانية قد حلّت محلّها تماماً */
  const run = items.length ? [...items, ...items] : [];

  return (
    <div className={`anb ${urgent ? "urg" : ""}`}>
      {items.length > 0 && (
        <div className="anb-win">
          <div className="anb-track" ref={trackRef} style={{ animationDuration: `${dur}s` }}>
            {run.map((x, i) => (
              <span className={`anb-it ${x.tone}`} key={`${x.id}-${i}`}>
                <i />
                <b>{x.body}</b>
                <em>{x.byName}</em>
              </span>
            ))}
          </div>
        </div>
      )}
      {!items.length && (
        <span className="anb-none">{t("لا توجد إعلانات سارية.", "No announcements.")}</span>
      )}

      <button className="anb-btn" onClick={() => setOpen(true)} title={t("نشر إعلان", "Announce")}>
        📣 {t("إعلان", "Announce")}
      </button>

      {open && (
        <div className="modal-overlay" onClick={() => setOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="m-h">
              <h3>{t("نشر إعلان", "New announcement")}</h3>
              <button className="mx" onClick={() => setOpen(false)} aria-label="close">✕</button>
            </div>

            <label className="op-note">
              <span>{t("نصّ الإعلان", "Text")}</span>
              <textarea
                rows={2}
                maxLength={280}
                value={body}
                placeholder={t("مثال: حدّثوا جهات الاتصال قبل نهاية الأسبوع.", "e.g. Update your contacts")}
                onChange={(e) => setBody(e.target.value)}
              />
            </label>
            <div className="anb-cnt">{280 - body.length}</div>

            <div className="op-f">
              <label>
                <span>{t("النوع", "Tone")}</span>
                <select value={tone} onChange={(e) => setTone(e.target.value)}>
                  {TONES.map((x) => (
                    <option key={x.v} value={x.v}>{t(x.ar, x.en)}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>{t("يبقى لمدّة", "Duration")}</span>
                <select value={hours} onChange={(e) => setHours(Number(e.target.value))}>
                  {SPANS.map((x) => (
                    <option key={x.h} value={x.h}>{t(x.ar, x.en)}</option>
                  ))}
                </select>
              </label>
            </div>

            <div className={`anb-prev ${tone}`}>
              <i />
              <b>{body.trim() || t("هكذا يظهر إعلانك", "Preview")}</b>
            </div>
            <p className="muted" style={{ fontSize: 11, lineHeight: 1.7 }}>
              {t(
                "ينتهي وحده بانقضاء المدّة فلا يحتاج حذفاً. وإن أعلن غيرك في الوقت نفسه مشى الإعلانان في الشريط وراء بعضهما.",
                "It expires on its own.",
              )}
            </p>

            {err && <div className="op-err">{err}</div>}

            {items.length > 0 && (
              <div className="anb-list">
                <b>{t("الإعلانات السارية", "Running now")}</b>
                {items.map((x) => (
                  <div className={`anb-row ${x.tone}`} key={x.id}>
                    <i />
                    <span className="n">{x.body}</span>
                    <em>{x.mine ? t("منك", "You") : x.byName} · {left(x.until)}</em>
                    {x.canStop && (
                      <button onClick={() => void stop(x.id)}>{t("إنهاء", "End")}</button>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="m-f">
              <button className="btn btn-ghost" onClick={() => setOpen(false)}>{t("إغلاق", "Close")}</button>
              <button className="btn" disabled={busy || !body.trim()} onClick={() => void say()}>
                {busy ? t("يُنشر…", "Posting…") : t("نشر", "Post")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
