"use client";

import { useCallback, useRef, useState } from "react";
import { SeriesPoint } from "@/lib/analytics";

/* درجات الأخضر لمسارات القطاعات — لكل قطاع درجة ونمط خط،
   لأن أربع درجات من لون واحد وحدها لا تُميَّز في الطباعة ولا لأصحاب عمى الألوان. */
export const SECTOR_STYLES: { color: string; dash: string }[] = [
  { color: "#003b33", dash: "" },
  { color: "#00695b", dash: "10 6" },
  { color: "#009e88", dash: "2 6" },
  { color: "#4bb8a3", dash: "16 5 3 5" },
];

export interface Line {
  name: string;
  color: string;
  dash: string;
  points: SeriesPoint[];
}

/* الرسم يُقاس بعرض حاويته الحقيقي (1:1 مع بكسل الشاشة) بدل viewBox ثابت
   يتمدّد أو ينكمش. كان العرض الثابت 1000 يعني أن خطاً مكتوباً بـ 11px
   يصير ~5px داخل بطاقة نصف الشاشة فلا يُقرأ، ويصير ضخماً في بطاقة كاملة.
   بهذه الطريقة حجم الخط ثابت بالبكسل مهما اتّسعت البطاقة أو ضاقت. */
const VB_H = 250;
const PAD_S = 48; // مساحة أرقام المحور
const PAD_E = 56; // مساحة قيمة آخر نقطة
const Y_TOP = 28;
const Y_BOT = 200;

const F_AXIS = "600 14px 'Noto Sans Arabic', sans-serif";
const F_VAL = "800 16px 'Noto Kufi Arabic', sans-serif";
const F_LBL = "700 14px 'Noto Sans Arabic', sans-serif";

function yOf(v: number, min: number, max: number) {
  const t = (v - min) / Math.max(1, max - min);
  return +(Y_BOT - t * (Y_BOT - Y_TOP)).toFixed(1);
}

/** رسم خطّي بمحور واحد وتلميح يعرض أرقام الفترة كاملة. */
export function LineChart({
  lines,
  labels,
  emptyText,
}: {
  lines: Line[];
  labels: string[];
  emptyText: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [w, setW] = useState(760);
  const roRef = useRef<ResizeObserver | null>(null);
  // ref دالة لا كائن: الحاوية قد تظهر متأخرة (حالة «لا توجد قياسات» أولاً)
  const setNode = useCallback((el: HTMLDivElement | null) => {
    roRef.current?.disconnect();
    roRef.current = null;
    if (!el) return;
    const read = () => setW(Math.max(320, Math.round(el.clientWidth)));
    const ro = new ResizeObserver(read);
    ro.observe(el);
    roRef.current = ro;
    read();
  }, []);

  const X0 = PAD_S;
  const X1 = Math.max(PAD_S + 60, w - PAD_E);

  const all = lines.flatMap((l) => l.points.map((p) => p.value)).filter((v): v is number => v != null);
  if (!all.length || labels.length < 2)
    return (
      <div className="chart-wrap" ref={setNode}>
        <div className="empty">{emptyText}</div>
      </div>
    );

  const rawMin = Math.min(...all);
  const rawMax = Math.max(...all);
  const min = Math.max(0, Math.floor((rawMin - 8) / 10) * 10);
  const max = Math.ceil((rawMax + 8) / 10) * 10;
  const grid: number[] = [];
  for (let g = min; g <= max; g += Math.max(10, Math.round((max - min) / 4 / 10) * 10)) grid.push(g);
  if (grid[grid.length - 1] !== max) grid.push(max);

  const n = labels.length;
  const xs = labels.map((_, i) => +(X0 + ((X1 - X0) * i) / (n - 1)).toFixed(1));
  const step = (X1 - X0) / (n - 1);

  return (
    <div className="chart-wrap" ref={setNode}>
      <svg
        viewBox={`0 0 ${w} ${VB_H}`}
        width="100%"
        height={VB_H}
        style={{ display: "block" }}
        role="img"
        aria-label={emptyText}
      >
        <g stroke="#eef2f1" strokeWidth={1}>
          {grid.map((g) => (
            <line key={g} x1={X0} y1={yOf(g, min, max)} x2={X1} y2={yOf(g, min, max)} />
          ))}
        </g>
        <g fill="#6d7f7a" textAnchor="end" style={{ font: F_AXIS, direction: "ltr" }}>
          {grid.map((g) => (
            <text key={g} x={X0 - 10} y={yOf(g, min, max) + 4}>
              {g}
            </text>
          ))}
        </g>

        {hover != null && (
          <line
            x1={xs[hover]}
            y1={Y_TOP}
            x2={xs[hover]}
            y2={Y_BOT}
            stroke="#c8ddd8"
            strokeWidth={1.5}
            strokeDasharray="4 4"
          />
        )}

        {[...lines].reverse().map((l) => {
          const pts = l.points
            .map((p, i) => (p.value == null ? null : `${xs[i]},${yOf(p.value, min, max)}`))
            .filter(Boolean)
            .join(" ");
          if (!pts) return null;
          return (
            <polyline
              key={l.name}
              points={pts}
              fill="none"
              stroke={l.color}
              strokeWidth={3}
              strokeDasharray={l.dash || undefined}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          );
        })}

        <g stroke="#fff" strokeWidth={2.5}>
          {lines.map((l) =>
            l.points.map((p, i) =>
              p.value == null ? null : (
                <circle
                  key={l.name + i}
                  cx={xs[i]}
                  cy={yOf(p.value, min, max)}
                  r={i === l.points.length - 1 ? 6 : 4.5}
                  fill={l.color}
                  opacity={hover == null || hover === i ? 1 : 0.35}
                />
              )
            )
          )}
        </g>

        <g textAnchor="start" style={{ font: F_VAL, direction: "ltr" }}>
          {lines.map((l) => {
            let lastIdx = -1;
            l.points.forEach((p, i) => {
              if (p.value != null) lastIdx = i;
            });
            const v = lastIdx >= 0 ? l.points[lastIdx].value : null;
            if (v == null) return null;
            return (
              <text key={l.name} x={xs[lastIdx] + 14} y={yOf(v, min, max) + 5} fill={l.color}>
                {v}%
              </text>
            );
          })}
        </g>

        <g
          textAnchor="middle"
          style={{ font: F_LBL, direction: "ltr" }}
          fill="#3f4f4a"
        >
          {labels.map((lb, i) => (
            <text key={lb} x={xs[i]} y={Y_BOT + 28}>
              {lb}
            </text>
          ))}
        </g>

        <g fill="transparent">
          {labels.map((lb, i) => (
            <rect
              key={lb}
              x={xs[i] - step / 2}
              y={Y_TOP - 14}
              width={step}
              height={Y_BOT - Y_TOP + 28}
              style={{ cursor: "crosshair" }}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            />
          ))}
        </g>
      </svg>

      {hover != null && (
        <div className="chart-tip" style={{ insetInlineStart: `${(xs[hover] / w) * 100}%` }}>
          <span className="h">{labels[hover]}</span>
          {lines.map((l) => (
            <span className="r" key={l.name}>
              <i style={{ background: l.color }} />
              {l.name}
              <b>{l.points[hover]?.value != null ? `${l.points[hover].value}%` : "لم يُقس"}</b>
            </span>
          ))}
        </div>
      )}

      {lines.length > 1 && (
        <div className="chart-legend">
          {lines.map((l) => (
            <span className="hi" key={l.name}>
              <svg width="32" height="10" viewBox="0 0 32 10" aria-hidden="true">
                <line
                  x1="1"
                  y1="5"
                  x2="31"
                  y2="5"
                  stroke={l.color}
                  strokeWidth={3}
                  strokeDasharray={l.dash || undefined}
                  strokeLinecap="round"
                />
              </svg>
              {l.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
