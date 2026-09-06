import { chromium } from "playwright-core";
import { readFileSync, writeFileSync } from "node:fs";
const spec = JSON.parse(readFileSync("/tmp/guide/spec.json","utf8"));
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const out = {};
for (const [name, sels] of Object.entries(spec)) {
  const p = await b.newPage({ viewport: { width: 1200, height: 900 } });
  await p.goto(`file:///tmp/guide/s_${name}.html`);
  await p.waitForTimeout(250);
  const wrap = await p.$(".wrap");
  const W = await wrap.boundingBox();
  const pts = [];
  for (const s of sels) {
    const el = await p.$(s);
    if (!el) { pts.push(null); console.log("  ✗", name, s); continue; }
    const r = await el.boundingBox();
    // الركن العلوي (جهة البداية في RTL) حتى لا تغطّي النقطةُ المحتوى
    const cx = r.x + r.width, cy = r.y;
    pts.push([ +(((cy - W.y)/W.height)*100).toFixed(1),
               +(((W.x + W.width - cx)/W.width)*100).toFixed(1) ]);
  }
  out[name] = pts;
  await p.close();
}
writeFileSync("/tmp/guide/pos.json", JSON.stringify(out, null, 1));
console.log("تم القياس");
await b.close();
