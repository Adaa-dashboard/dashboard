"use client";

import { useState } from "react";
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

const VB_W = 1000;
const VB_H = 272;
const X0 = 70;
const X1 = 900;
const Y_TOP = 40;
const Y_BOT = 226;

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

  const all = lines.flatMap((l) => l.points.map((p) => p.value)).filter((v): v is number => v != null);
  if (!all.length || labels.length < 2) return <div className="empty">{emptyText}</div>;

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
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${VB_W} ${VB_H}`} width="100%" style={{ display: "block", height: "auto" }} role="img" aria-label={emptyText}>
        <g stroke="#eef2f1" strokeWidth={1}>
          {grid.map((g) => (
            <line key={g} x1={X0} y1={yOf(g, min, max)} x2={X1} y2={yOf(g, min, max)} />
          ))}
        </g>
        <g fill="#8a9a95" textAnchor="end" style={{ font: "400 11px 'Noto Sans Arabic', sans-serif", direction: "ltr" }}>
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

        <g textAnchor="start" style={{ font: "800 13px 'Noto Kufi Arabic', sans-serif", direction: "ltr" }}>
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
          style={{ font: "700 12.5px 'Noto Sans Arabic', sans-serif", direction: "ltr" }}
          fill="#4b5a55"
        >
          {labels.map((lb, i) => (
            <text key={lb} x={xs[i]} y={Y_BOT + 26}>
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
        <div className="chart-tip" style={{ insetInlineStart: `${(xs[hover] / VB_W) * 100}%` }}>
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
