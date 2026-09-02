"use client";

/* ============================================================
   قراءة ملف الجدول في المتصفح بلا أي مكتبة خارجية.
   السبب: اللوحة تُنشر ملفات ثابتة على GitHub Pages، وشبكة الدوام
   تحجب أغلب مواقع الـ CDN — فأي مكتبة تُحمَّل وقت التشغيل قد لا تصل.
   ملف xlsx ما هو إلا أرشيف zip، وفكّ الضغط متاح في المتصفح نفسه
   عبر DecompressionStream، فلا حاجة لشيء غيره.
   ============================================================ */

/* ---------- فكّ أرشيف zip ---------- */
async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("deflate-raw");
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(ds);
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

async function unzip(buf: ArrayBuffer): Promise<Map<string, Uint8Array>> {
  const b = new Uint8Array(buf);
  const dv = new DataView(buf);
  const out = new Map<string, Uint8Array>();

  // نهاية الفهرس المركزي: نبحث عن التوقيع من آخر الملف
  let eocd = -1;
  for (let i = b.length - 22; i >= 0 && i > b.length - 66000; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("الملف ليس بصيغة xlsx سليمة");

  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder("utf-8");

  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true);
    const elen = dv.getUint16(p + 30, true);
    const clen = dv.getUint16(p + 32, true);
    const lho = dv.getUint32(p + 42, true);
    const name = dec.decode(b.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + elen + clen;

    // الترويسة المحلية تحمل أطوالها الخاصة للاسم والحقول الإضافية
    const lnlen = dv.getUint16(lho + 26, true);
    const lelen = dv.getUint16(lho + 28, true);
    const start = lho + 30 + lnlen + lelen;
    const raw = b.subarray(start, start + csize);
    if (name.endsWith("/")) continue;
    out.set(name, method === 0 ? raw : await inflateRaw(raw));
  }
  return out;
}

/* ---------- أدوات XML ---------- */
function unesc(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, "&");
}

/** كل نصوص <t> داخل عقدة واحدة (النص الغني يأتي على أجزاء) */
function texts(xml: string): string {
  let out = "";
  const re = /<t[^>]*>([\s\S]*?)<\/t>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out += unesc(m[1]);
  return out;
}

function colOf(ref: string): number {
  let n = 0;
  for (const ch of ref) {
    const c = ch.charCodeAt(0);
    if (c >= 65 && c <= 90) n = n * 26 + (c - 64);
    else if (c >= 97 && c <= 122) n = n * 26 + (c - 96);
    else break;
  }
  return Math.max(0, n - 1);
}

function sheetRows(xml: string, shared: string[]): string[][] {
  const rows: string[][] = [];
  const rowRe = /<row[^>]*>([\s\S]*?)<\/row>/g;
  let r: RegExpExecArray | null;
  while ((r = rowRe.exec(xml))) {
    const cells: string[] = [];
    const cRe = /<c\s([^>]*?)(\/>|>([\s\S]*?)<\/c>)/g;
    let c: RegExpExecArray | null;
    while ((c = cRe.exec(r[1]))) {
      const attrs = c[1];
      const inner = c[3] || "";
      const ref = /r="([A-Za-z]+)\d+"/.exec(attrs)?.[1] || "";
      const type = /t="([^"]+)"/.exec(attrs)?.[1] || "";
      let v = "";
      if (type === "inlineStr") v = texts(inner);
      else {
        const vm = /<v[^>]*>([\s\S]*?)<\/v>/.exec(inner);
        const raw = vm ? unesc(vm[1]) : "";
        v = type === "s" ? shared[Number(raw)] ?? "" : raw;
      }
      const idx = ref ? colOf(ref) : cells.length;
      while (cells.length < idx) cells.push("");
      cells[idx] = v.trim();
    }
    rows.push(cells);
  }
  return rows;
}

/** أوراق العمل بترتيب المصنّف، فالورقة الأولى هي أول ما يفتحه المستخدم */
function orderedSheets(files: Map<string, Uint8Array>, dec: TextDecoder): string[] {
  const wb = files.get("xl/workbook.xml");
  const rels = files.get("xl/_rels/workbook.xml.rels");
  const paths: string[] = [];
  if (wb && rels) {
    const map = new Map<string, string>();
    const rRe = /<Relationship\b[^>]*>/g;
    let m: RegExpExecArray | null;
    while ((m = rRe.exec(dec.decode(rels)))) {
      const id = /Id="([^"]+)"/.exec(m[0])?.[1];
      const tgt = /Target="([^"]+)"/.exec(m[0])?.[1];
      if (id && tgt) map.set(id, tgt.replace(/^\/?xl\//, "").replace(/^\.\//, ""));
    }
    const sRe = /<sheet\b[^>]*>/g;
    while ((m = sRe.exec(dec.decode(wb)))) {
      const rid = /r:id="([^"]+)"/.exec(m[0])?.[1];
      const tgt = rid ? map.get(rid) : undefined;
      if (tgt) paths.push("xl/" + tgt);
    }
  }
  for (const k of files.keys()) {
    if (/^xl\/worksheets\/.+\.xml$/.test(k) && !paths.includes(k)) paths.push(k);
  }
  return paths;
}

/** يقرأ ملف xlsx ويُرجع صفوف الورقة الأولى التي فيها بيانات */
export async function readXlsx(buf: ArrayBuffer): Promise<string[][]> {
  const files = await unzip(buf);
  const dec = new TextDecoder("utf-8");

  const shared: string[] = [];
  const ss = files.get("xl/sharedStrings.xml");
  if (ss) {
    const xml = dec.decode(ss);
    const re = /<si>([\s\S]*?)<\/si>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml))) shared.push(texts(m[1]));
  }

  for (const path of orderedSheets(files, dec)) {
    const f = files.get(path);
    if (!f) continue;
    const rows = sheetRows(dec.decode(f), shared);
    if (rows.some((r) => r.some((c) => c !== ""))) return rows;
  }
  return [];
}

/* ---------- نص مفصول: CSV أو ملصوق من إكسل (Tab) ---------- */
export function readDelimited(text: string): string[][] {
  const t = text.replace(/\r\n?/g, "\n").replace(/^﻿/, "");
  const head = t.split("\n")[0] || "";
  const sep = (head.match(/\t/g)?.length || 0) >= (head.match(/,/g)?.length || 0) ? "\t" : ",";
  const rows: string[][] = [];
  let cell = "";
  let row: string[] = [];
  let quoted = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (quoted) {
      if (ch === '"') {
        if (t[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === sep) {
      row.push(cell.trim());
      cell = "";
    } else if (ch === "\n") {
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  row.push(cell.trim());
  rows.push(row);
  return rows.filter((r) => r.some((c) => c !== ""));
}
