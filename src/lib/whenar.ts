"use client";

/* ============================================================
   قراءة التواريخ من نصّ عربي حرّ.
   الغاية: من يكتب في ملاحظاته «بكرة الساعة ٩ اجتماع الديوان»
   يجدها في التقويم بلا إدخال ثانٍ. ما لم يُفهم يبقى بلا تاريخ
   ولا نخترع شيئاً — والمستخدم يستطيع ضبط التاريخ يدوياً دائماً.
   ============================================================ */

export type When = { date: string; time?: string };

const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";

export function normAr(s: string): string {
  return s
    .replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)))
    .replace(/[ً-ْـ]/g, "")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const shift = (base: Date, days: number) => {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  d.setDate(d.getDate() + days);
  return d;
};

/* \b لا يعمل مع العربية: الحرف العربي ليس \w عند JS، فالحدّ يفشل دائماً.
   نبني الحدّ بأنفسنا: ما قبل الكلمة وما بعدها ليس حرفاً ولا رقماً. */
function w(body: string): RegExp {
  return new RegExp(`(?:^|[^\\p{L}\\d])(?:${body})(?:[^\\p{L}\\d]|$)`, "u");
}

// الأحد = 0 كما في Date.getDay
const DAYS: [RegExp, number][] = [
  [w("الاحد"), 0],
  [w("الاثنين|الاتنين"), 1],
  [w("الثلاثاء|الثلاثا"), 2],
  [w("الاربعاء|الاربعا"), 3],
  [w("الخميس"), 4],
  [w("الجمعه"), 5],
  [w("السبت"), 6],
];

function findTime(s: string): string | undefined {
  // 9:30 أو الساعة 9 أو 9 صباحا/مساء
  let m = /(\d{1,2})\s*[:.]\s*(\d{2})/.exec(s);
  let h: number | null = null;
  let min = 0;
  if (m) {
    h = Number(m[1]);
    min = Number(m[2]);
  } else {
    m =
      /(?:الساعه)\s*(\d{1,2})/.exec(s) ||
      new RegExp("(?:^|[^\\p{L}\\d])(\\d{1,2})\\s*(?:صباحا|مساءا|مساء|ص|م)(?:[^\\p{L}\\d]|$)", "u").exec(s);
    if (m) h = Number(m[1]);
  }
  if (h == null || h > 23 || min > 59) return undefined;
  const pm = w("مساءا|مساء|العصر|المغرب|ليلا|م").test(s);
  const am = w("صباحا|الصبح|الفجر|ص").test(s);
  if (pm && h < 12) h += 12;
  if (am && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/** يُرجع أول موعد مفهوم في النص، أو null */
export function parseWhen(raw: string, from: Date = new Date()): When | null {
  const s = normAr(raw);
  if (!s) return null;
  const time = findTime(s);
  const done = (d: Date): When => (time ? { date: iso(d), time } : { date: iso(d) });

  // تاريخ صريح: 2026-09-12
  let m = /\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/.exec(s);
  if (m) return done(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])));

  // 12/9 أو 12/9/2026 — يوم/شهر كما هو الشائع محلياً
  m = /\b(\d{1,2})\s*[/-]\s*(\d{1,2})(?:\s*[/-]\s*(20\d{2}))?\b/.exec(s);
  if (m) {
    const day = Number(m[1]);
    const mon = Number(m[2]);
    const yr = m[3] ? Number(m[3]) : from.getFullYear();
    if (day >= 1 && day <= 31 && mon >= 1 && mon <= 12) {
      const d = new Date(yr, mon - 1, day);
      // بلا سنة: لو مضى التاريخ فالمقصود العام القادم
      if (!m[3] && d < shift(from, 0)) d.setFullYear(yr + 1);
      return done(d);
    }
  }

  // الأطول أولاً حتى لا تبتلع «بكرة» عبارةَ «بعد بكرة»
  if (/بعد بكره|بعد غد|بعد بكرا/.test(s)) return done(shift(from, 2));
  if (w("بكره|بكرا|غدا|الغد").test(s)) return done(shift(from, 1));
  if (w("اليوم").test(s) && !/بعد/.test(s)) return done(shift(from, 0));

  m = /بعد\s*(\d{1,2})\s*(?:يوم|ايام)/.exec(s);
  if (m) return done(shift(from, Number(m[1])));
  if (/بعد\s*اسبوعين/.test(s)) return done(shift(from, 14));
  if (/بعد\s*اسبوع/.test(s)) return done(shift(from, 7));

  for (const [re, dow] of DAYS) {
    if (re.test(s)) {
      const cur = from.getDay();
      let diff = (dow - cur + 7) % 7;
      // «الأحد» ونحن في الأحد ⇒ الأحد القادم، إلا إن قيلت مع «اليوم»
      if (diff === 0) diff = w("اليوم").test(s) ? 0 : 7;
      if (/الجايه|القادم|القادمه|الجاي/.test(s) && diff < 7) diff += 7;
      return done(shift(from, diff));
    }
  }

  return null;
}

/** صياغة عربية مختصرة لموعد */
export function whenLabel(w: When, from: Date = new Date()): string {
  const d = new Date(w.date + "T00:00:00");
  const base = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const diff = Math.round((d.getTime() - base.getTime()) / 86400000);
  const day =
    diff === 0 ? "اليوم" : diff === 1 ? "غداً" : diff === -1 ? "أمس" : diff === 2 ? "بعد غد" : w.date;
  return w.time ? `${day} ${w.time}` : day;
}
