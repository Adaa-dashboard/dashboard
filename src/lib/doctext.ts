/* ------------------------------------------------------------
   استخراج نصّ الوثائق داخل المتصفح
   ------------------------------------------------------------
   الملف يُقرأ هنا لا على خادم خارجي: المنهجيات لا تغادر جهاز من
   يرفعها إلا إلى قاعدة المنصة نفسها.

   عقبتان حقيقيتان في منهجيات المركز، عولجتا بعد تجربتها كلها:

   ١) بعض ملفات الـPDF تُخرج النصّ بترتيب بصري لا منطقي، فتنقلب
      كلمات السطر. وليست كلها كذلك — فيُكتشف لكل ملف على حدة
      بدليل موضوعي: موضع علامة الترقيم. في المقلوب تلتصق ببداية
      الكلمة التالية («.به») وفي السليم بنهاية سابقتها («به.»).

   ٢) استخراج الـPDF يقلب حرفَي ليغاتورة لام‑ألف، فتُستخرج
      «خالل» مكان «خلال». لا يُصلَح هنا: التوحيد يقع في البحث
      (perf_ar_norm) على النصّ والسؤال معاً.
   ------------------------------------------------------------ */

export type Chunk = { idx: number; page: number; heading: string; body: string };

const ZW = /[‎‏‪-‮⁦-⁩]/g;
const AR = /[ء-ي]/;
const PUNCT = ".،؛:؟!";

/** هل يخرج نصّ هذا الملف مقلوباً؟ — يُقاس على عيّنة من صفحاته */
export function isVisualOrder(pages: string[]): boolean {
  let lead = 0, tail = 0;
  for (const p of pages) {
    for (const tok of (p || "").replace(ZW, "").split(/\s+/)) {
      if (!tok || !AR.test(tok)) continue;
      if (PUNCT.includes(tok[0])) lead++;
      if (PUNCT.includes(tok[tok.length - 1])) tail++;
    }
  }
  return lead > tail;
}

/** بعد قلب الترتيب تبقى النقطة ملتصقة ببداية كلمتها — تُنقل لسابقتها */
function repunct(toks: string[]): string[] {
  const out: string[] = [];
  for (let tok of toks) {
    if (out.length && tok.length > 1 && PUNCT.includes(tok[0])) {
      out[out.length - 1] += tok[0];
      tok = tok.slice(1);
    }
    out.push(tok);
  }
  return out;
}

export function fixPage(txt: string, flip: boolean): string {
  const lines: string[] = [];
  /* بعض الملفات تُخرج الحروف بأشكالها المتصلة (ﺗﺤﻠﻴﻞ) لا بحروفها
     الأساسية (تحليل) — تُقرأ بالعين ولا يجدها البحث. NFKC يعيدها
     إلى أصلها، ويفكّ ليغاتورة لام‑ألف في الوقت نفسه. */
  for (const raw of (txt || "").normalize("NFKC").replace(ZW, "").split("\n")) {
    const ln = raw.trim();
    if (!ln) continue;
    if (!flip) { lines.push(ln); continue; }
    const toks = ln.split(/\s+/);
    const ar = toks.filter((t) => AR.test(t)).length;
    lines.push(ar >= Math.max(1, Math.floor(toks.length / 2))
      ? repunct(toks.slice().reverse()).join(" ")
      : ln);
  }
  return lines.join("\n");
}

/** تقطيع صفحة إلى مقاطع بحجم مقروء — العنوان أول سطر قصير بلا نقطة */
export function chunkPage(text: string, page: number, start: number): Chunk[] {
  const lines = text.split("\n").filter((l) => l.trim().length > 1);
  if (!lines.length) return [];
  const first = lines[0];
  const heading = first.length < 90 && !first.endsWith(".") ? first : "";
  const rest = heading ? lines.slice(1) : lines;
  const bodies: string[] = [];
  let buf = "";
  for (const l of rest) {
    if (buf.length + l.length > 800) { bodies.push(buf); buf = l; }
    else buf = (buf + " " + l).trim();
  }
  if (buf) bodies.push(buf);
  return bodies
    .filter((b) => b.length >= 40)
    .map((b, i) => ({ idx: start + i + 1, page, heading, body: b.slice(0, 1500) }));
}

/** نصّ ملف PDF — pdf.js يُحمَّل عند الحاجة فقط، فلا يثقل بقية المنصة */
export async function pdfChunks(buf: ArrayBuffer): Promise<{ chunks: Chunk[]; pages: number }> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
  const doc = await pdfjs.getDocument({ data: buf }).promise;
  const raw: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const c = await page.getTextContent();
    /* pdf.js يقطّع السطر إلى مقاطع ولا يضع بينها مسافة دائماً،
       فتلتصق الكلمات («تلخيصكميةكبيرة»). فتُقاس الفجوة الأفقية
       بين مقطعٍ وسابقه: ما تجاوز خُمس ارتفاع السطر فهو مسافة.
       والقياس بالإحداثيات لا بالنصّ، فيعمل مع العربية والإنجليزية. */
    type Item = { str?: string; hasEOL?: boolean; width?: number; height?: number; transform?: number[] };
    const lines: string[] = [];
    let line = "";
    let px: number | null = null, pw = 0, ph = 10;
    for (const it of c.items as Item[]) {
      const s0 = it.str || "";
      const x = it.transform?.[4] ?? 0;
      const w = it.width ?? 0;
      const h = it.height || ph || 10;
      if (line && s0 && px !== null && !/\s$/.test(line) && !/^\s/.test(s0)) {
        // في العربية يتقدّم النصّ نحو اليسار، فالفجوة تُقاس في الاتجاهين
        const gap = x < px ? px - (x + w) : x - (px + pw);
        if (gap > Math.max(1, h * 0.2)) line += " ";
      }
      line += s0;
      px = x; pw = w; ph = h;
      if (it.hasEOL) { lines.push(line); line = ""; px = null; }
    }
    if (line) lines.push(line);
    raw.push(lines.join("\n"));
  }
  const flip = isVisualOrder(raw.slice(4, 30));
  const chunks: Chunk[] = [];
  raw.forEach((t, i) => {
    const got = chunkPage(fixPage(t, flip), i + 1, chunks.length);
    chunks.push(...got);
  });
  return { chunks, pages: doc.numPages };
}

/** نصّ ملف إكسل: كل ورقة مقطعٌ أو أكثر، والعنوان اسم الورقة */
export async function sheetChunks(buf: ArrayBuffer): Promise<{ chunks: Chunk[]; pages: number }> {
  const { readXlsxSheets } = await import("./sheet");
  const sheets = await readXlsxSheets(buf);
  const chunks: Chunk[] = [];
  sheets.forEach((s, si) => {
    const text = s.rows
      .map((r) => r.filter((c) => String(c ?? "").trim()).join(" · "))
      .filter((l) => l.trim().length > 1)
      .join("\n");
    chunks.push(...chunkPage(`${s.name}\n${text}`, si + 1, chunks.length));
  });
  return { chunks, pages: sheets.length };
}

export async function extract(file: File): Promise<{ chunks: Chunk[]; pages: number }> {
  const buf = await file.arrayBuffer();
  const n = file.name.toLowerCase();
  if (n.endsWith(".pdf")) return pdfChunks(buf);
  if (n.endsWith(".xlsx") || n.endsWith(".xls")) return sheetChunks(buf);
  // نصّ عادي
  const txt = new TextDecoder().decode(buf);
  const chunks: Chunk[] = [];
  txt.split(/\n{2,}/).forEach((p, i) => chunks.push(...chunkPage(p, i + 1, chunks.length)));
  return { chunks, pages: 0 };
}
