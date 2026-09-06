import { chromium } from "playwright-core";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const p = await b.newPage();
const errs=[]; p.on("pageerror", e=>errs.push(String(e)));
await p.goto("file:///tmp/guide/guide2.html", { waitUntil: "load" });
await p.waitForTimeout(1500);
await p.pdf({ path: "/tmp/guide/النموذج-التشغيلي-المختصر.pdf",
  format: "A4", printBackground: true, preferCSSPageSize: true });
console.log("pdf ok", errs.length?errs.join("|"):"");
await b.close();
