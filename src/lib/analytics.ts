// اشتقاق السلاسل الزمنية (ربعية وسنوية) من القياسات المحفوظة.
// القياسات مرتبطة بفترات (أسابيع) لكل منها تاريخ بداية، ومنه نستخرج الربع والسنة.

import { Band, computeAchievement } from "@/lib/calc";

export interface SeriesPoint {
  key: string; // Q1 · 2026
  label: string;
  value: number | null; // متوسط الإنجاز %
}

type Msr = {
  sectorId: string;
  indicatorId: string;
  periodId: string;
  actual: number | null;
  updatedAt: string;
};
type Per = { id: string; weekStart?: string; order: number };

export function quarterOf(iso: string): number {
  const m = Number((iso || "").slice(5, 7));
  if (!m) return 0;
  return Math.floor((m - 1) / 3) + 1;
}
export function yearOf(iso: string): number {
  return Number((iso || "").slice(0, 4)) || 0;
}

/** تاريخ بداية أسبوع الفترة، أو تاريخ آخر تحديث كبديل حين لا يوجد تاريخ للأسبوع. */
function periodDate(periods: Per[], periodId: string, fallback: string): string {
  const p = periods.find((x) => x.id === periodId);
  return p?.weekStart || fallback || "";
}

/** آخر قياس لكل (قطاع|مؤشر) داخل مجموعة قياسات. */
function latestPerCell(list: Msr[]): Map<string, Msr> {
  const map = new Map<string, Msr>();
  for (const m of list) {
    const k = `${m.sectorId}|${m.indicatorId}`;
    const cur = map.get(k);
    if (!cur || (m.updatedAt || "") > (cur.updatedAt || "")) map.set(k, m);
  }
  return map;
}

/** متوسط الإنجاز عبر خلايا مجموعة قياسات. */
function averageAchievement(
  list: Msr[],
  targetOf: (sectorId: string, indicatorId: string) => number | null
): number | null {
  const cells = latestPerCell(list);
  const vals: number[] = [];
  cells.forEach((m) => {
    const a = computeAchievement(m.actual, targetOf(m.sectorId, m.indicatorId));
    if (a != null) vals.push(a);
  });
  if (!vals.length) return null;
  return Math.round(vals.reduce((s, v) => s + v, 0) / vals.length);
}

/** سلسلة ربعية لسنة واحدة: Q1..Q4 (القيمة null للربع الذي لم يُقس بعد). */
export function quarterlySeries(
  measurements: Msr[],
  periods: Per[],
  year: number,
  targetOf: (sectorId: string, indicatorId: string) => number | null
): SeriesPoint[] {
  const out: SeriesPoint[] = [];
  for (let q = 1; q <= 4; q++) {
    const inQ = measurements.filter((m) => {
      const d = periodDate(periods, m.periodId, m.updatedAt);
      return yearOf(d) === year && quarterOf(d) === q;
    });
    out.push({ key: `Q${q}`, label: `Q${q}`, value: averageAchievement(inQ, targetOf) });
  }
  return out;
}

/** سلسلة سنوية عبر كل السنوات التي فيها قياسات. */
export function yearlySeries(
  measurements: Msr[],
  periods: Per[],
  targetOf: (sectorId: string, indicatorId: string) => number | null
): SeriesPoint[] {
  const years = new Set<number>();
  for (const m of measurements) {
    const y = yearOf(periodDate(periods, m.periodId, m.updatedAt));
    if (y) years.add(y);
  }
  return [...years]
    .sort((a, b) => a - b)
    .map((y) => {
      const inY = measurements.filter(
        (m) => yearOf(periodDate(periods, m.periodId, m.updatedAt)) === y
      );
      return { key: String(y), label: String(y), value: averageAchievement(inY, targetOf) };
    });
}

/** نفس السلسلتين لكن مقصورتين على قطاع واحد. */
export function sectorSeries(
  measurements: Msr[],
  periods: Per[],
  sectorId: string,
  mode: "quarter" | "year",
  year: number,
  targetOf: (sectorId: string, indicatorId: string) => number | null
): SeriesPoint[] {
  const mine = measurements.filter((m) => m.sectorId === sectorId);
  return mode === "quarter"
    ? quarterlySeries(mine, periods, year, targetOf)
    : yearlySeries(mine, periods, targetOf);
}

/** أحدث سنة فيها قياسات، وإلا السنة الحالية. */
export function latestYear(measurements: Msr[], periods: Per[]): number {
  let max = 0;
  for (const m of measurements) {
    const y = yearOf(periodDate(periods, m.periodId, m.updatedAt));
    if (y > max) max = y;
  }
  return max || new Date().getFullYear();
}

/** عدّ المؤشرات في كل حالة. */
export function bandCounts(
  values: (number | null)[],
  bands: Band[]
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const b of bands) out[b.label] = 0;
  for (const v of values) {
    if (v == null) continue;
    const sorted = [...bands].sort((a, b) => a.from - b.from);
    let match = sorted[0];
    for (const b of sorted) if (v >= b.from) match = b;
    if (match) out[match.label] = (out[match.label] || 0) + 1;
  }
  return out;
}
