"use client";

/* ============================================================
   مكتبة أيقونات مجال الاستراتيجية وقياس الأداء.
   خطّية بلون الحرف الحالي، مصنَّفة ليسهل العثور عليها،
   ولكل واحدة اسم عربي يُبحث به.
   ============================================================ */

export type PickIcon = { id: string; label: string; group: string; d: string };

export const ICON_GROUPS = [
  "الاستراتيجية والتخطيط",
  "القياس والمؤشرات",
  "التقارير والوثائق",
  "الاجتماعات والفريق",
  "العمليات والطلبات",
  "الجهات والمشاريع",
  "الحالة والتنبيه",
];

export const PICK_ICONS: PickIcon[] = [
  /* ---------- الاستراتيجية والتخطيط ---------- */
  { id: "target", label: "هدف", group: "الاستراتيجية والتخطيط", d: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.6"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/>' },
  { id: "aim", label: "استهداف", group: "الاستراتيجية والتخطيط", d: '<circle cx="12" cy="12" r="6.4"/><path d="M12 2.4v3.2M12 18.4v3.2M2.4 12h3.2M18.4 12h3.2"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/>' },
  { id: "compass", label: "بوصلة", group: "الاستراتيجية والتخطيط", d: '<circle cx="12" cy="12" r="9"/><path d="M15.6 8.4l-2 5.2-5.2 2 2-5.2z"/>' },
  { id: "map", label: "خارطة طريق", group: "الاستراتيجية والتخطيط", d: '<path d="M3 6.4l6-2.4 6 2.4 6-2.4v13.6l-6 2.4-6-2.4-6 2.4z"/><path d="M9 4v13.6M15 6.4V20"/>' },
  { id: "flag", label: "راية", group: "الاستراتيجية والتخطيط", d: '<path d="M6 21V4.2"/><path d="M6 4.6h11.4l-2.2 3.4 2.2 3.4H6"/>' },
  { id: "milestone", label: "محطة", group: "الاستراتيجية والتخطيط", d: '<path d="M12 21v-5"/><path d="M4.4 4.2h13l2.2 3-2.2 3h-13z"/><path d="M12 4.2V2.6"/>' },
  { id: "idea", label: "فكرة", group: "الاستراتيجية والتخطيط", d: '<path d="M9.4 17.6h5.2"/><path d="M10 20.6h4"/><path d="M12 3.4a6 6 0 0 0-3.4 10.9c.6.5.9 1.1.9 1.8h5c0-.7.3-1.3.9-1.8A6 6 0 0 0 12 3.4z"/>' },
  { id: "puzzle", label: "مبادرة", group: "الاستراتيجية والتخطيط", d: '<path d="M10 3.4h4v2.2a1.6 1.6 0 0 0 3.2 0V3.4h3.4v4h-2.2a1.6 1.6 0 0 0 0 3.2h2.2v4h-4v-2.2a1.6 1.6 0 0 0-3.2 0v2.2H10z"/><path d="M10 3.4H6.6v4H4.4a1.6 1.6 0 0 0 0 3.2h2.2v4H10"/>' },
  { id: "layers", label: "محاور", group: "الاستراتيجية والتخطيط", d: '<path d="M12 3.2l8.6 4.3-8.6 4.3-8.6-4.3z"/><path d="M3.4 12.2l8.6 4.3 8.6-4.3"/><path d="M3.4 16.6l8.6 4.3 8.6-4.3"/>' },
  { id: "tree", label: "تسلسل", group: "الاستراتيجية والتخطيط", d: '<rect x="9" y="2.6" width="6" height="4.4" rx="1.4"/><rect x="2.6" y="16.8" width="6" height="4.4" rx="1.4"/><rect x="15.4" y="16.8" width="6" height="4.4" rx="1.4"/><path d="M12 7v3.6M5.6 16.8v-2.6h12.8v2.6M12 10.6v3.6"/>' },
  { id: "vision", label: "رؤية", group: "الاستراتيجية والتخطيط", d: '<path d="M2.4 12S6 5.6 12 5.6 21.6 12 21.6 12 18 18.4 12 18.4 2.4 12 2.4 12z"/><circle cx="12" cy="12" r="2.8"/>' },

  /* ---------- القياس والمؤشرات ---------- */
  { id: "gauge", label: "عدّاد أداء", group: "القياس والمؤشرات", d: '<path d="M3.6 17a8.4 8.4 0 1 1 16.8 0"/><path d="M12 17l4.2-4.6"/><circle cx="12" cy="17" r="1.5" fill="currentColor" stroke="none"/>' },
  { id: "bars", label: "أعمدة بيانية", group: "القياس والمؤشرات", d: '<path d="M3.5 20.5h17"/><path d="M6.5 20.5v-5M11 20.5V8.5M15.5 20.5v-8M20 20.5V4.5"/>' },
  { id: "line", label: "خط بياني", group: "القياس والمؤشرات", d: '<path d="M3.4 19.6h17.2"/><path d="M4.6 15.4l4.4-4.6 3.4 3 6.6-7.2"/><circle cx="9" cy="10.8" r="1.1" fill="currentColor" stroke="none"/><circle cx="12.4" cy="13.8" r="1.1" fill="currentColor" stroke="none"/>' },
  { id: "pie", label: "دائرة نسب", group: "القياس والمؤشرات", d: '<path d="M12 3.4a8.6 8.6 0 1 0 8.6 8.6H12z"/><path d="M14.6 2.6a8.6 8.6 0 0 1 6.8 6.8h-6.8z"/>' },
  { id: "trend", label: "نمو", group: "القياس والمؤشرات", d: '<path d="M3.4 17.4l5.4-5.6 3.6 3.2 8.2-8.6"/><path d="M15.6 6.4h5v5"/>' },
  { id: "percent", label: "نسبة", group: "القياس والمؤشرات", d: '<path d="M5.6 18.4L18.4 5.6"/><circle cx="7.6" cy="7.6" r="2.6"/><circle cx="16.4" cy="16.4" r="2.6"/>' },
  { id: "scale", label: "ميزان", group: "القياس والمؤشرات", d: '<path d="M12 4v16M6 20h12M4 8l4-3 4 3M12 8l4-3 4 3"/><path d="M2 12a3 3 0 0 0 6 0M16 12a3 3 0 0 0 6 0"/>' },
  { id: "ruler", label: "قياس", group: "القياس والمؤشرات", d: '<rect x="2.6" y="8.4" width="18.8" height="7.2" rx="1.6" transform="rotate(-8 12 12)"/><path d="M7 9.6v2.4M11 9v2.4M15 8.4v2.4M19 7.8v2.4"/>' },
  { id: "stack-rank", label: "ترتيب", group: "القياس والمؤشرات", d: '<path d="M4 6.6h9M4 12h13M4 17.4h6"/><path d="M18.6 14.8l2.4 2.6-2.4 2.6"/>' },

  /* ---------- التقارير والوثائق ---------- */
  { id: "doc", label: "وثيقة", group: "التقارير والوثائق", d: '<path d="M6 3.4h7.6L18.6 8v12.6H6z"/><path d="M13.4 3.4V8h5"/><path d="M9 12.6h6.4M9 16h4.6"/>' },
  { id: "report", label: "تقرير", group: "التقارير والوثائق", d: '<rect x="4.6" y="3" width="14.8" height="18" rx="2.4"/><path d="M8.4 8h7.2"/><path d="M8.8 17v-3.2M12 17v-5.4M15.2 17v-2.2"/>' },
  { id: "clipboard", label: "قائمة مهام", group: "التقارير والوثائق", d: '<rect x="5" y="4.2" width="14" height="16.8" rx="3"/><path d="M9 4.2V3.4A1.4 1.4 0 0 1 10.4 2h3.2A1.4 1.4 0 0 1 15 3.4v.8"/><path d="M8.9 13.2l2.2 2.2 4.2-4.4"/>' },
  { id: "checklist", label: "تحقّق", group: "التقارير والوثائق", d: '<path d="M10 6.6h10M10 12h10M10 17.4h10"/><path d="M4 6.2l1.4 1.4L7.6 5M4 11.6l1.4 1.4L7.6 10.4M4 17l1.4 1.4 2.2-2.6"/>' },
  { id: "folder", label: "ملف", group: "التقارير والوثائق", d: '<path d="M3.4 7.6a2 2 0 0 1 2-2h3.4l2 2.2h7.8a2 2 0 0 1 2 2v8.6a2 2 0 0 1-2 2H5.4a2 2 0 0 1-2-2z"/><path d="M3.4 11.4h17.2"/>' },
  { id: "archive", label: "أرشيف", group: "التقارير والوثائق", d: '<rect x="3" y="4" width="18" height="4.4" rx="1.4"/><path d="M4.6 8.4v10a1.6 1.6 0 0 0 1.6 1.6h11.6a1.6 1.6 0 0 0 1.6-1.6v-10"/><path d="M9.6 12.4h4.8"/>' },
  { id: "book", label: "دليل", group: "التقارير والوثائق", d: '<path d="M4 4.6A1.6 1.6 0 0 1 5.6 3H19v18H5.6A1.6 1.6 0 0 1 4 19.4z"/><path d="M4 17.4h15"/><path d="M8 7.6h7"/>' },
  { id: "present", label: "عرض تقديمي", group: "التقارير والوثائق", d: '<rect x="3" y="3.6" width="18" height="11.4" rx="2"/><path d="M12 15v3.4M8.4 21l3.6-2.6L15.6 21"/>' },
  { id: "excel", label: "جدول", group: "التقارير والوثائق", d: '<rect x="3.2" y="4.2" width="17.6" height="15.6" rx="2.2"/><path d="M3.2 9.4h17.6M9.4 9.4V19.8M15 9.4V19.8"/>' },

  /* ---------- الاجتماعات والفريق ---------- */
  { id: "users", label: "فريق", group: "الاجتماعات والفريق", d: '<circle cx="9.3" cy="8.4" r="3.3"/><path d="M3.4 19.6c0-3.1 2.6-5.2 5.9-5.2s5.9 2.1 5.9 5.2"/><circle cx="17.4" cy="9.6" r="2.4"/><path d="M16.6 14.9c2.6.1 4.4 2 4.4 4.7"/>' },
  { id: "session", label: "جلسة مراجعة", group: "الاجتماعات والفريق", d: '<path d="M4 5.5h16v10.5H12.8L9 19.6V16H4z"/><path d="M8.4 10.6l2.1 2.1 4.4-4.5"/>' },
  { id: "chat", label: "نقاش", group: "الاجتماعات والفريق", d: '<path d="M3.4 6.4a2 2 0 0 1 2-2h9.2a2 2 0 0 1 2 2v5.4a2 2 0 0 1-2 2H9l-3.6 3v-3H5.4a2 2 0 0 1-2-2z"/><path d="M19 8.4h1.6v9.2h-1.6"/>' },
  { id: "calendar", label: "تقويم", group: "الاجتماعات والفريق", d: '<rect x="3.4" y="4.8" width="17.2" height="16" rx="2.4"/><path d="M3.4 9.6h17.2M8.2 3v3.6M15.8 3v3.6"/>' },
  { id: "calendar-check", label: "موعد منجز", group: "الاجتماعات والفريق", d: '<rect x="3.4" y="4.8" width="17.2" height="16" rx="2.4"/><path d="M3.4 9.6h17.2M8.2 3v3.6M15.8 3v3.6"/><path d="M8.8 14.6l2.2 2.2 4-4.4"/>' },
  { id: "clock", label: "وقت", group: "الاجتماعات والفريق", d: '<circle cx="12" cy="12" r="8.8"/><path d="M12 6.8V12l3.4 2"/>' },
  { id: "hourglass", label: "مدة", group: "الاجتماعات والفريق", d: '<path d="M6.6 3h10.8M6.6 21h10.8"/><path d="M7.6 3v3.2c0 2 4.4 3.6 4.4 5.8s-4.4 3.8-4.4 5.8V21"/><path d="M16.4 3v3.2c0 2-4.4 3.6-4.4 5.8s4.4 3.8 4.4 5.8V21"/>' },
  { id: "handshake", label: "شراكة", group: "الاجتماعات والفريق", d: '<path d="M2.6 12.4l3.4-3.4 3.4 1.8 2.6-1.4 2.6 1.4 3.4-1.8 3.4 3.4"/><path d="M6 9v6.4l4.4 3.4 2-1.6 2 1.6L18 15.4V9"/>' },
  { id: "user-check", label: "مسؤول", group: "الاجتماعات والفريق", d: '<circle cx="10" cy="7.8" r="3.6"/><path d="M3.4 20c0-3.4 3-5.8 6.6-5.8 1.4 0 2.7.3 3.8.9"/><path d="M15.6 17.8l1.8 1.8 3.4-3.8"/>' },

  /* ---------- العمليات والطلبات ---------- */
  { id: "exchange", label: "طلب تغيير", group: "العمليات والطلبات", d: '<path d="M4 8.4h14l-3-3M20 15.6H6l3 3"/>' },
  { id: "undo", label: "طلب عكس", group: "العمليات والطلبات", d: '<path d="M4.4 9.6h9.2a5.4 5.4 0 1 1 0 10.8H8.4"/><path d="M7.8 5.6L4 9.6l3.8 4"/>' },
  { id: "workflow", label: "سير عمل", group: "العمليات والطلبات", d: '<rect x="3" y="3.4" width="6" height="5.2" rx="1.6"/><rect x="15" y="15.4" width="6" height="5.2" rx="1.6"/><path d="M6 8.6v6a3 3 0 0 0 3 3h6"/>' },
  { id: "cycle", label: "دورة", group: "العمليات والطلبات", d: '<path d="M20.2 12a8.2 8.2 0 1 1-2.4-5.8"/><path d="M20.6 4v4.4h-4.4"/>' },
  { id: "gear", label: "إعداد", group: "العمليات والطلبات", d: '<circle cx="12" cy="12" r="3"/><path d="M4 12h2M18 12h2M12 4v2M12 18v2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M17.7 6.3l-1.4 1.4M7.7 16.3l-1.4 1.4"/>' },
  { id: "filter", label: "تصفية", group: "العمليات والطلبات", d: '<path d="M3.4 5h17.2l-6.6 7.8v6.4l-4 1.8v-8.2z"/>' },
  { id: "inbox", label: "وارد", group: "العمليات والطلبات", d: '<path d="M3.4 13.4h4.2l1.4 2.6h6l1.4-2.6h4.2"/><path d="M5.6 4.4h12.8l2.2 9v5a2 2 0 0 1-2 2H5.4a2 2 0 0 1-2-2v-5z"/>' },
  { id: "send", label: "إرسال", group: "العمليات والطلبات", d: '<path d="M21 3.4L10.6 13.8"/><path d="M21 3.4l-6.6 17.2-3.8-6.8-6.8-3.8z"/>' },
  { id: "link", label: "ارتباط", group: "العمليات والطلبات", d: '<path d="M10 13.6a4 4 0 0 0 5.8.3l2.6-2.6a4 4 0 0 0-5.6-5.6l-1.4 1.4"/><path d="M14 10.4a4 4 0 0 0-5.8-.3l-2.6 2.6a4 4 0 0 0 5.6 5.6l1.4-1.4"/>' },

  /* ---------- الجهات والمشاريع ---------- */
  { id: "building", label: "جهة", group: "الجهات والمشاريع", d: '<rect x="3.4" y="8.6" width="7.6" height="12.4" rx="1.6"/><rect x="12.6" y="3.4" width="8" height="17.6" rx="1.6"/><path d="M6 12.2h2.4M6 15.6h2.4M15.4 7h2.4M15.4 10.6h2.4M15.4 14.2h2.4"/>' },
  { id: "bank", label: "جهة حكومية", group: "الجهات والمشاريع", d: '<path d="M3.4 9.4L12 4l8.6 5.4"/><path d="M5.4 9.6V18M9.4 9.6V18M14.6 9.6V18M18.6 9.6V18"/><path d="M3 20.6h18"/>' },
  { id: "globe", label: "وطني", group: "الجهات والمشاريع", d: '<circle cx="12" cy="12" r="8.8"/><path d="M3.2 12h17.6"/><path d="M12 3.2c2.4 2.6 3.6 5.6 3.6 8.8s-1.2 6.2-3.6 8.8c-2.4-2.6-3.6-5.6-3.6-8.8S9.6 5.8 12 3.2z"/>' },
  { id: "rocket", label: "مشروع", group: "الجهات والمشاريع", d: '<path d="M13.6 3.4c3.6 1 6 3.4 7 7l-8.4 8.4-6-6z"/><path d="M8.4 15.6l-3.8 3.8M6.2 12.8L3.4 15.6M11.2 17.8l-2.8 2.8"/><circle cx="15" cy="9" r="1.6"/>' },
  { id: "briefcase", label: "أعمال", group: "الجهات والمشاريع", d: '<rect x="2.6" y="7" width="18.8" height="13" rx="2.2"/><path d="M8.4 7V5.4A2 2 0 0 1 10.4 3.4h3.2a2 2 0 0 1 2 2V7"/><path d="M2.6 12.6h18.8"/>' },
  { id: "gantt", label: "خطة زمنية", group: "الجهات والمشاريع", d: '<rect x="3.2" y="4.2" width="17.6" height="16.6" rx="2.4"/><path d="M7 9h7.6M7 12.6h10M7 16.2h5.4"/>' },
  { id: "coins", label: "ميزانية", group: "الجهات والمشاريع", d: '<ellipse cx="12" cy="6.4" rx="7.4" ry="3"/><path d="M4.6 6.4v5.2c0 1.7 3.3 3 7.4 3s7.4-1.3 7.4-3V6.4"/><path d="M4.6 11.6v5.2c0 1.7 3.3 3 7.4 3s7.4-1.3 7.4-3v-5.2"/>' },

  /* ---------- الحالة والتنبيه ---------- */
  { id: "check", label: "منجز", group: "الحالة والتنبيه", d: '<circle cx="12" cy="12" r="8.8"/><path d="M8.2 12.4l2.6 2.6 5-5.6"/>' },
  { id: "alert", label: "تنبيه", group: "الحالة والتنبيه", d: '<path d="M12 3.6l9 15.8H3z"/><path d="M12 9.6v4.2M12 16.6v.1"/>' },
  { id: "star", label: "مميّز", group: "الحالة والتنبيه", d: '<path d="M12 3.4l2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.9l6.1-.9z"/>' },
  { id: "shield", label: "التزام", group: "الحالة والتنبيه", d: '<path d="M12 3l7.4 3v5.6c0 4.4-3 7.8-7.4 9.4-4.4-1.6-7.4-5-7.4-9.4V6z"/><path d="M8.8 12l2.2 2.2 4.2-4.6"/>' },
  { id: "award", label: "إنجاز", group: "الحالة والتنبيه", d: '<circle cx="12" cy="9" r="5.6"/><path d="M8.4 13.6L7 21.4l5-2.6 5 2.6-1.4-7.8"/>' },
  { id: "bookmark", label: "مرجع", group: "الحالة والتنبيه", d: '<path d="M6.4 3.6h11.2v17l-5.6-4-5.6 4z"/>' },
  { id: "note", label: "ملاحظة", group: "الحالة والتنبيه", d: '<path d="M4.6 4.6h14.8v10.2l-4.6 4.6H4.6z"/><path d="M19.4 14.8h-4.6v4.6"/><path d="M8 9h8M8 12.4h5"/>' },
  { id: "pin", label: "مثبّت", group: "الحالة والتنبيه", d: '<path d="M12 21v-6.6"/><path d="M8 3.4h8l-1.2 4.4 3 3.6H6.2l3-3.6z"/>' },
];

const BASE = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

/** أيقونة بالمعرّف — وإن لم تُعرف رُسم النص كما هو (توافقاً مع القديم) */
export function PIcon({ id, size = 18 }: { id: string; size?: number }) {
  const ic = PICK_ICONS.find((x) => x.id === id);
  if (!ic) return <span style={{ fontSize: size - 2, lineHeight: 1 }}>{id}</span>;
  return (
    <svg {...BASE} width={size} height={size} aria-hidden dangerouslySetInnerHTML={{ __html: ic.d }} />
  );
}

/** منتقي الأيقونات — بحث بالاسم وتصنيفات */
export function IconPicker({
  value,
  onPick,
  t,
}: {
  value: string;
  onPick: (id: string) => void;
  t: (ar: string, en: string) => string;
}) {
  return (
    <div className="ipk">
      <input
        className="ipk-s"
        placeholder={t("ابحث عن أيقونة… (هدف · مؤشر · جلسة · طلب)", "Search icons…")}
        onChange={(e) => {
          const q = e.target.value.trim();
          const box = e.currentTarget.parentElement;
          box?.querySelectorAll<HTMLElement>(".ipk-i").forEach((el) => {
            el.style.display = !q || (el.dataset.l || "").includes(q) ? "" : "none";
          });
          box?.querySelectorAll<HTMLElement>(".ipk-g").forEach((g) => {
            const any = g.nextElementSibling?.querySelector<HTMLElement>('.ipk-i:not([style*="none"])');
            g.style.display = any ? "" : "none";
            (g.nextElementSibling as HTMLElement).style.display = any ? "" : "none";
          });
        }}
      />
      <div className="ipk-box">
        {ICON_GROUPS.map((g) => (
          <div key={g}>
            <div className="ipk-g">{g}</div>
            <div className="ipk-grid">
              {PICK_ICONS.filter((i) => i.group === g).map((i) => (
                <button
                  key={i.id}
                  type="button"
                  className={`ipk-i ${value === i.id ? "on" : ""}`}
                  data-l={`${i.label} ${i.id}`}
                  title={i.label}
                  onClick={() => onPick(i.id)}
                >
                  <PIcon id={i.id} size={19} />
                  <em>{i.label}</em>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
