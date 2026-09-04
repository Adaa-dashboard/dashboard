"use client";

/* أيقونات خطّية بلون الحرف الحالي — أوضح من الإيموجي وتتبع الهوية */

const base = {
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export function IconCalc(p: { size?: number }) {
  const s = p.size ?? 18;
  return (
    <svg {...base} width={s} height={s}>
      <rect x="4" y="2.5" width="16" height="19" rx="3" />
      <rect x="7.5" y="6" width="9" height="3.4" rx="1" />
      <circle cx="8.6" cy="13.4" r="1.05" fill="currentColor" stroke="none" />
      <circle cx="12" cy="13.4" r="1.05" fill="currentColor" stroke="none" />
      <circle cx="15.4" cy="13.4" r="1.05" fill="currentColor" stroke="none" />
      <circle cx="8.6" cy="17.6" r="1.05" fill="currentColor" stroke="none" />
      <circle cx="12" cy="17.6" r="1.05" fill="currentColor" stroke="none" />
      <circle cx="15.4" cy="17.6" r="1.05" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconCalendar(p: { size?: number }) {
  const s = p.size ?? 18;
  return (
    <svg {...base} width={s} height={s}>
      <rect x="3" y="5" width="18" height="16" rx="3" />
      <path d="M3 10h18" />
      <path d="M8 2.5v4M16 2.5v4" />
      <circle cx="8.4" cy="14.6" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="12" cy="14.6" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="15.6" cy="14.6" r="1.15" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconNote(p: { size?: number }) {
  const s = p.size ?? 18;
  return (
    <svg {...base} width={s} height={s}>
      <path d="M5 4.5A2.5 2.5 0 0 1 7.5 2h9A2.5 2.5 0 0 1 19 4.5v15A2.5 2.5 0 0 1 16.5 22h-9A2.5 2.5 0 0 1 5 19.5z" />
      <path d="M8.6 7.5h6.8M8.6 11.5h6.8M8.6 15.5h4.2" />
    </svg>
  );
}

/** فقاعة تعليق — بديل الإيموجي 💬 في جدول المؤشرات */
export function IconComment(p: { size?: number }) {
  const s = p.size ?? 15;
  return (
    <svg {...base} width={s} height={s} strokeWidth={1.9}>
      <path d="M20.5 11.4c0 3.9-3.8 7-8.5 7-1 0-2-.14-2.9-.4L4 19.6l1.3-3.6C4.2 14.8 3.5 13.2 3.5 11.4c0-3.9 3.8-7 8.5-7s8.5 3.1 8.5 7z" />
    </svg>
  );
}

export function IconReply(p: { size?: number }) {
  const s = p.size ?? 14;
  return (
    <svg {...base} width={s} height={s} strokeWidth={2}>
      <path d="M9.5 6.5 4.5 11l5 4.5" />
      <path d="M4.5 11h8.2a6 6 0 0 1 6 6v1.5" />
    </svg>
  );
}

export function IconGear(p: { size?: number }) {
  const s = p.size ?? 16;
  return (
    <svg {...base} width={s} height={s}>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.4 14.5a1.6 1.6 0 0 0 .32 1.77l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.6 1.6 0 0 0-1.77-.32 1.6 1.6 0 0 0-.97 1.47V21a2 2 0 1 1-4 0v-.11a1.6 1.6 0 0 0-1.05-1.47 1.6 1.6 0 0 0-1.77.32l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.6 1.6 0 0 0 .32-1.77 1.6 1.6 0 0 0-1.47-.97H3a2 2 0 1 1 0-4h.11a1.6 1.6 0 0 0 1.47-1.05 1.6 1.6 0 0 0-.32-1.77l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.6 1.6 0 0 0 1.77.32H9a1.6 1.6 0 0 0 .97-1.47V3a2 2 0 1 1 4 0v.11a1.6 1.6 0 0 0 .97 1.47 1.6 1.6 0 0 0 1.77-.32l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.6 1.6 0 0 0-.32 1.77V9a1.6 1.6 0 0 0 1.47.97H21a2 2 0 1 1 0 4h-.11a1.6 1.6 0 0 0-1.47.97z" />
    </svg>
  );
}

/* ============================================================
   أيقونات القائمة الجانبية — بديل الرموز النصية (◱ ◎ ✓ ▤)
   التي كانت تختلف من متصفح لآخر ولا تدلّ على معناها
   ============================================================ */
function nav(d: string) {
  const C = (p: { size?: number }) => {
    const s = p.size ?? 18;
    return (
      <svg {...base} width={s} height={s} strokeWidth={1.75} dangerouslySetInnerHTML={{ __html: d }} />
    );
  };
  C.displayName = "NavIcon";
  return C;
}

/* الصفحات الرئيسية */
export const IconOverview = nav(
  '<path d="M3.6 17a8.4 8.4 0 1 1 16.8 0"/><path d="M12 17l4.2-4.6"/><circle cx="12" cy="17" r="1.5" fill="currentColor" stroke="none"/>',
);
export const IconKpi = nav('<path d="M3.5 20.5h17"/><path d="M6.5 20.5v-5M11 20.5V8.5M15.5 20.5v-8M20 20.5V4.5"/>');
export const IconTask = nav(
  '<rect x="5" y="4.2" width="14" height="16.8" rx="3"/><path d="M9 4.2V3.4A1.4 1.4 0 0 1 10.4 2h3.2A1.4 1.4 0 0 1 15 3.4v.8"/><path d="M8.9 13.2l2.2 2.2 4.2-4.4"/>',
);
export const IconWeek = nav(
  '<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M8 7.5h8"/><path d="M8.5 17v-2.6M12 17v-4.6M15.5 17v-1.6"/>',
);

/* الأقسام الخمسة */
export const IconSess = nav('<path d="M4 5.5h16v10.5H12.8L9 19.6V16H4z"/><path d="M8.4 10.6l2.1 2.1 4.4-4.5"/>');
export const IconNat = nav('<path d="M6 21V4.2"/><path d="M6 4.6h11.4l-2.2 3.4 2.2 3.4H6"/>');
export const IconInst = nav(
  '<rect x="3.4" y="8.6" width="7.6" height="12.4" rx="1.6"/><rect x="12.6" y="3.4" width="8" height="17.6" rx="1.6"/><path d="M6 12.2h2.4M6 15.6h2.4M15.4 7h2.4M15.4 10.6h2.4M15.4 14.2h2.4"/>',
);
export const IconOut = nav(
  '<path d="M20.5 8.6v8.2L12 21l-8.5-4.2V8.6"/><path d="M3.5 8.6L12 4.4l8.5 4.2L12 12.8z"/><path d="M12 12.8V21"/>',
);
export const IconProj = nav('<rect x="3.2" y="4.2" width="17.6" height="16.6" rx="3"/><path d="M7 9h7.6M7 12.6h10M7 16.2h5.4"/>');

/* الإعدادات وما تحتها */
export const IconSettings = nav(
  '<circle cx="12" cy="12" r="3"/><path d="M4 12h2M18 12h2M12 4v2M12 18v2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M17.7 6.3l-1.4 1.4M7.7 16.3l-1.4 1.4"/>',
);
