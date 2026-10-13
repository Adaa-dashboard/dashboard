"use client";

/* ============================================================
   حلقة الحالة وأسطورتها — **رسمٌ واحد يخدم التقرير الأسبوعي
   وصفحة «نظرة عامة» معاً**.

   في وسط الحلقة العدد الإجمالي ووحدته، وأسطورتها بالأعداد لا
   بالنسب: هذه جهاتٌ واستراتيجياتٌ تُعدّ. والشرائح تُبنى في
   `lib/weekReport.ts` فحسبةٌ واحدة لا حسبتان.
   ============================================================ */

import type { Slice } from "@/lib/weekReport";

export function DonutRing({
  slices,
  total,
  unit,
  size = 92,
  base,
}: {
  slices: Slice[];
  total: number;
  unit: string;
  size?: number;
  /** قاعدة النسبة إن خالفت مجموع الشرائح — فيبقى الباقي رمادياً */
  base?: number;
}) {
  const r = size * 0.37;
  const w = size * 0.141;
  const c = 2 * Math.PI * r;
  const sum = base || slices.reduce((n, s) => n + s.n, 0) || 1;
  let off = 0;
  return (
    <span className="wk-dn" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line2)" strokeWidth={w} />
        {slices
          .filter((s) => s.n > 0)
          .map((s) => {
            const len = (c * s.n) / sum;
            const el = (
              <circle
                key={s.label}
                cx={size / 2} cy={size / 2} r={r} fill="none" stroke={s.color} strokeWidth={w}
                strokeDasharray={`${len} ${c - len}`}
                strokeDashoffset={-off}
              />
            );
            off += len;
            return el;
          })}
      </svg>
      {/* العدد في الوسط يكبر مع الحلقة — وإلا تاه في فراغها */}
      <b style={size > 100 ? { fontSize: Math.round(size * 0.185) } : undefined}>
        {total}
        <span style={size > 100 ? { fontSize: Math.round(size * 0.075) } : undefined}>{unit}</span>
      </b>
    </span>
  );
}

export function DonutLegend({ slices }: { slices: Slice[] }) {
  return (
    <div className="wk-lg">
      {slices.map((s) => (
        <div key={s.label}>
          <i style={{ background: s.color }} />
          {s.label}
          <u>{s.n}</u>
          {/* ما زاد في هذه المرحلة هذا الأسبوع — سهمٌ أخضر وعدد */}
          {s.up ? <em className="up">▲ {s.up}+</em> : null}
        </div>
      ))}
    </div>
  );
}

/** الأسطورة والحلقة في صفٍّ واحد — كما في التقرير الأسبوعي */
export default function DonutCard({
  slices,
  total,
  unit,
  size,
}: {
  slices: Slice[];
  total: number;
  unit: string;
  size?: number;
}) {
  return (
    <div className="wk-dw">
      <DonutLegend slices={slices} />
      <DonutRing slices={slices} total={total} unit={unit} size={size} />
    </div>
  );
}
