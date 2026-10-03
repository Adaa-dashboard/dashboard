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

   والنشر من **قلم الصفحة** لا من زرٍّ في الشريط: القلم مكان
   الكتابة في المنصة، فتجتمع عنده الملاحظة والإعلان — ويبقى
   الشريط للقراءة وحدها.
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

/* ---------------- الشريط: للقراءة وحدها ---------------- */
export default function Ticker({ items, t }: { items: TickItem[]; t: T }) {
  const winRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [run, setRun] = useState({ t: 0, w: 0, dur: 30 });

  /* **مرّة واحدة لا نسختان**: الشريط يدخل من اليمين ويمشي حتى
     يختفي عند اليسار ثم يعود — فلا يُرى الإعلان مرّتين في وقتٍ
     واحد. المسافة = عرض الشريط + عرض النافذة، ولذلك يُقاسان.

     والسرعة ثابتةٌ بالبكسل لا المدّة: إعلانٌ قصير وعشرةٌ طوال لا
     يمشيان بالسرعة نفسها إن ثبتت المدّة — يسابق أحدهما العين
     ويزحف الآخر. ٧٠ بكسل في الثانية قراءةٌ مريحة. */
  useEffect(() => {
    const el = trackRef.current;
    const win = winRef.current;
    if (!el || !win) return;
    const measure = () => {
      const tw = el.scrollWidth;
      const ww = win.clientWidth;
      setRun({ t: tw, w: ww, dur: Math.max(10, Math.round((tw + ww) / 70)) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(win);
    return () => ro.disconnect();
  }, [items]);

  /* بلا إعلانات لا شريط: سطرُ «لا توجد إعلانات» يشغل مكاناً بلا
     خبر — والنشر صار عند القلم لا هنا */
  if (!items.length) return null;

  const urgent = items.some((x) => x.tone === "red");

  return (
    <div className={`anb ${urgent ? "urg" : ""}`}>
      <div className="anb-win" ref={winRef}>
        <div
          className="anb-track"
          ref={trackRef}
          style={{
            animationDuration: `${run.dur}s`,
            ["--anb-t" as string]: `${run.t}px`,
            ["--anb-w" as string]: `${run.w}px`,
          }}
        >
          {items.map((x) => (
            <span className={`anb-it ${x.tone}`} key={x.id}>
              <i />
              <b>{x.body}</b>
              <em>{x.byName}</em>
            </span>
          ))}
        </div>
      </div>
      <span className="anb-tag">{t("إعلانات", "Announcements")}</span>
    </div>
  );
}

/* ---------------- نافذة النشر — تُفتح من القلم ---------------- */
export function TickerCompose({
  items,
  t,
  onClose,
  onReload,
}: {
  items: TickItem[];
  t: T;
  onClose: () => void;
  onReload: () => void;
}) {
  const [body, setBody] = useState("");
  const [tone, setTone] = useState("green");
  const [hours, setHours] = useState(24);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

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
    onReload();
    onClose();
  }

  async function stop(id: string) {
    if (!confirm(t("إنهاء هذا الإعلان الآن؟", "End this announcement now?"))) return;
    await apiFetch(`/api/ticker/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => {});
    onReload();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="m-h">
          <h3>{t("نشر إعلان", "New announcement")}</h3>
          <button className="mx" onClick={onClose} aria-label="close">✕</button>
        </div>

        <label className="op-note">
          <span>{t("نصّ الإعلان", "Text")}</span>
          <textarea
            rows={2}
            maxLength={280}
            autoFocus
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
                {x.canStop && <button onClick={() => void stop(x.id)}>{t("إنهاء", "End")}</button>}
              </div>
            ))}
          </div>
        )}

        <div className="m-f">
          <button className="btn btn-ghost" onClick={onClose}>{t("إغلاق", "Close")}</button>
          <button className="btn" disabled={busy || !body.trim()} onClick={() => void say()}>
            {busy ? t("يُنشر…", "Posting…") : t("نشر", "Post")}
          </button>
        </div>
      </div>
    </div>
  );
}
