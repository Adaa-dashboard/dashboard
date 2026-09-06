import { chromium } from "playwright-core";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
for (const name of process.argv.slice(2)) {
  const p = await b.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 2 });
  const errs=[]; p.on("pageerror", e=>errs.push(String(e)));
  await p.goto(`file:///tmp/guide/${name}.html`);
  await p.waitForTimeout(300);
  const el = await p.$(".wrap");
  await el.screenshot({ path: `/tmp/guide/${name}.png` });
  console.log(name, "ok", errs.length?("ERR "+errs.join("|")):"");
  await p.close();
}
await b.close();
