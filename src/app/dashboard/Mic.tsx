"use client";

/* ------------------------------------------------------------
   الإملاء الصوتي — زرّ مايك يتبع الحقل المركَّز عليه
   ------------------------------------------------------------
   الهدف: من كان مستعجلاً يتكلّم فيُكتب كلامه، في أي خانة كتابة
   في المنصة بلا استثناء.

   لماذا زرّ واحد يتنقّل بدل زرّ داخل كل حقل: الحقول مئات موزّعة
   على عشرات المكوّنات، وإضافة زرّ لكلٍّ منها تعني تعديل كل نموذج
   في المنصة — وأي حقل جديد لاحقاً سيُنسى. هذه الطبقة تصغي
   للتركيز، فتخدم كل حقل قائم وكل حقل يُضاف بعدها.

   يظهر الزرّ عند التركيز في حقل نصّي وحده: التاريخ والرقم
   وكلمة المرور والقوائم لا إملاء فيها.
   ------------------------------------------------------------ */

import { useCallback, useEffect, useRef, useState } from "react";

type Field = HTMLInputElement | HTMLTextAreaElement;

/* أنواع Web Speech API — غير معرَّفة في lib.dom */
type SRResult = { 0: { transcript: string }; isFinal: boolean };
type SREvent = { resultIndex: number; results: { length: number } & Record<number, SRResult> };
type SR = {
  lang: string; continuous: boolean; interimResults: boolean;
  start: () => void; stop: () => void;
  onresult: ((e: SREvent) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
};
type SRCtor = new () => SR;

function ctor(): SRCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

/** الحقول التي يصحّ فيها الإملاء */
const NO_TYPE = new Set(["date", "datetime-local", "time", "month", "week", "number", "password", "checkbox", "radio", "range", "color", "file", "submit", "button", "hidden"]);
function dictatable(el: Element | null): el is Field {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "TEXTAREA") return !(el as HTMLTextAreaElement).disabled && !(el as HTMLTextAreaElement).readOnly;
  if (tag !== "INPUT") return false;
  const i = el as HTMLInputElement;
  if (i.disabled || i.readOnly) return false;
  if (i.hasAttribute("data-nomic")) return false;
  return !NO_TYPE.has((i.type || "text").toLowerCase());
}

/* الكتابة عبر setter الأصلي: الإسناد المباشر لا يُعلم React بالتغيير،
   فتعود القيمة القديمة عند أول إعادة رسم */
function writeInto(el: Field, text: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? start;
  const before = el.value.slice(0, start);
  const sep = before && !/\s$/.test(before) ? " " : "";
  const next = before + sep + text + el.value.slice(end);
  setter?.call(el, next);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  const caret = (before + sep + text).length;
  try { el.setSelectionRange(caret, caret); } catch { /* بعض الأنواع لا تدعمه */ }
}

export default function Mic({ t }: { t: (ar: string, en: string) => string }) {
  const [box, setBox] = useState<{ x: number; y: number } | null>(null);
  const [on, setOn] = useState(false);
  const [err, setErr] = useState("");
  const fieldRef = useRef<Field | null>(null);
  const recRef = useRef<SR | null>(null);
  const supported = useRef<boolean>(false);

  useEffect(() => {
    supported.current = !!ctor();
  }, []);

  /* موضع الزرّ: داخل الحقل عند حافته الأمامية (يسار في RTL).
     الحقل الطويل يأخذه أعلاه لا في منتصفه. */
  const place = useCallback(() => {
    const el = fieldRef.current;
    if (!el || !el.isConnected) { setBox(null); return; }
    const r = el.getBoundingClientRect();
    if (r.bottom < 0 || r.top > window.innerHeight) { setBox(null); return; }
    const dir = getComputedStyle(el).direction;
    const x = dir === "rtl" ? r.left + 6 : r.right - 38;
    const y = r.height > 64 ? r.top + 6 : r.top + (r.height - 32) / 2;
    setBox({ x, y });
  }, []);

  const stop = useCallback(() => {
    try { recRef.current?.stop(); } catch { /* ignore */ }
    recRef.current = null;
    setOn(false);
  }, []);

  useEffect(() => {
    if (!supported.current) return;
    const onFocus = (e: FocusEvent) => {
      const el = e.target as Element | null;
      if (dictatable(el)) {
        fieldRef.current = el;
        setErr("");
        place();
      }
    };
    const onBlur = () => {
      // تأخير بسيط: الضغط على الزرّ نفسه يمرّ بـ blur قبل الضغط
      setTimeout(() => {
        if (!dictatable(document.activeElement)) {
          if (!recRef.current) { fieldRef.current = null; setBox(null); }
        }
      }, 120);
    };
    document.addEventListener("focusin", onFocus);
    document.addEventListener("focusout", onBlur);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("focusout", onBlur);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [place]);

  useEffect(() => () => stop(), [stop]);

  // الخطأ يزول وحده — لا يبقى معلّقاً فوق الحقل التالي
  useEffect(() => {
    if (!err) return;
    const h = setTimeout(() => setErr(""), 4000);
    return () => clearTimeout(h);
  }, [err]);

  function toggle() {
    if (on) { stop(); return; }
    const C = ctor();
    const el = fieldRef.current;
    if (!C || !el) return;
    const r = new C();
    r.lang = "ar-SA";
    r.continuous = true;
    r.interimResults = false;
    r.onresult = (e) => {
      let said = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) said += res[0].transcript;
      }
      const txt = said.trim();
      if (txt && fieldRef.current) writeInto(fieldRef.current, txt);
    };
    r.onerror = (ev) => {
      setErr(
        ev.error === "not-allowed"
          ? t("أذن المتصفح بالميكروفون أولاً", "Allow microphone access")
          : t("تعذّر الاستماع", "Could not listen")
      );
      stop();
    };
    r.onend = () => setOn(false);
    try {
      r.start();
      recRef.current = r;
      setOn(true);
    } catch {
      setErr(t("تعذّر بدء التسجيل", "Could not start"));
    }
  }

  if (!box) return null;

  return (
    <>
      <button
        type="button"
        className={`mic-b ${on ? "on" : ""}`}
        style={{ left: box.x, top: box.y }}
        // الضغط لا يسحب التركيز من الحقل، وإلا اختفى الزرّ قبل أن يعمل
        onMouseDown={(e) => e.preventDefault()}
        onTouchStart={(e) => e.preventDefault()}
        onClick={toggle}
        title={on ? t("إيقاف الإملاء", "Stop dictation") : t("أملِ بصوتك", "Dictate")}
        aria-label={t("إملاء صوتي", "Dictate")}
        aria-pressed={on}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="2" width="6" height="12" rx="3" />
          <path d="M5 11a7 7 0 0 0 14 0" />
          <path d="M12 18v4" />
        </svg>
      </button>
      {(on || err) && (
        <div className="mic-tip" style={{ left: box.x, top: box.y + 38 }}>
          {err || t("أتكلّم… اضغط للإيقاف", "Listening… tap to stop")}
        </div>
      )}
    </>
  );
}
