import fs from "fs";
const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
const path = "/root/.claude/uploads/8f84bc41-662d-5929-a88a-d6b0e8cf9b06/34fa95bf-81692725-7B2A-437A-8052-D8F142E7E4A9__________________________.pdf";
const data = new Uint8Array(fs.readFileSync(path));
const doc = await getDocument({ data, useSystemFonts: true }).promise;
console.log("صفحات:", doc.numPages);
let all = "";
for (let i = 1; i <= doc.numPages; i++) {
  const pg = await doc.getPage(i);
  const tc = await pg.getTextContent();
  // تجميع بالأسطر حسب إحداثي y
  const lines = new Map();
  for (const it of tc.items) {
    if (!it.str || !it.str.trim()) continue;
    const y = Math.round(it.transform[5]);
    const k = Math.round(y / 4) * 4;
    if (!lines.has(k)) lines.set(k, []);
    lines.get(k).push({ x: it.transform[4], s: it.str });
  }
  const out = [...lines.entries()].sort((a, b) => b[0] - a[0])
    .map(([, arr]) => arr.sort((a, b) => b.x - a.x).map((o) => o.s).join(" ").replace(/\s+/g, " ").trim())
    .filter(Boolean).join("\n");
  all += `\n===== صفحة ${i} =====\n${out}\n`;
}
fs.writeFileSync(".pdfchk/text.txt", all);
console.log(all.slice(0, 3000));
