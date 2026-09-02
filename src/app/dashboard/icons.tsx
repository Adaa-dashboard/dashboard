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
