/** بادئة المسار وقت البناء — فارغة في الجذر، و«/dashboard/perf» على GitHub Pages. */
export const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "";
export const asset = (p: string) => `${BASE}${p}`;
