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


/* ============================================================
   كتابة ملف xlsx — بلا مكتبات أيضاً.
   الأرشيف يُكتب بلا ضغط (stored): الملفات هنا صغيرة، والضغط يحتاج
   CompressionStream وقد لا يكون متاحاً في كل متصفح، والملف المخزَّن
   يفتحه إكسل تماماً كالمضغوط.
   ============================================================ */
export type SheetOut = { name: string; rows: (string | number | null | undefined)[][] };

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    // المحارف التحكمية غير مسموحة في XML وتفسد الملف كله
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
}

function colLetter(i: number): string {
  let s = "";
  let n = i + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function sheetXml(rows: SheetOut["rows"]): string {
  const body = rows
    .map((row, ri) => {
      const cells = row
        .map((v, ci) => {
          const ref = `${colLetter(ci)}${ri + 1}`;
          if (v === null || v === undefined || v === "") return "";
          if (typeof v === "number" && Number.isFinite(v)) return `<c r="${ref}"><v>${v}</v></c>`;
          const style = ri === 0 ? ' s="1"' : "";
          return `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${esc(String(v))}</t></is></c>`;
        })
        .join("");
      return `<row r="${ri + 1}">${cells}</row>`;
    })
    .join("");
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<sheetData>${body}</sheetData></worksheet>`
  );
}

const STYLES_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>' +
  '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>' +
  '<fills count="3"><fill><patternFill patternType="none"/></fill>' +
  '<fill><patternFill patternType="gray125"/></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FF00584C"/><bgColor indexed="64"/></patternFill></fill></fills>' +
  '<borders count="1"><border/></borders>' +
  '<cellStyleXfs count="1"><xf/></cellStyleXfs>' +
  '<cellXfs count="2"><xf xfId="0"/>' +
  '<xf xfId="0" fontId="1" fillId="2" applyFont="1" applyFill="1"/></cellXfs>' +
  "</styleSheet>";

/** يبني ملف xlsx متعدّد الأوراق ويُرجعه Blob جاهزاً للتنزيل */
export function writeXlsx(sheets: SheetOut[]): Blob {
  const enc = new TextEncoder();
  const files: { name: string; data: Uint8Array }[] = [];
  const push = (name: string, xml: string) => files.push({ name, data: enc.encode(xml) });

  // اسم الورقة في إكسل: ٣١ محرفاً بلا : \ / ? * [ ]
  const names = sheets.map((s, i) =>
    (s.name || `ورقة${i + 1}`).replace(/[\\/?*[\]:]/g, " ").slice(0, 31)
  );

  push(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      sheets
        .map(
          (_, i) =>
            `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
        )
        .join("") +
      "</Types>"
  );
  push(
    "_rels/.rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      "</Relationships>"
  );
  push(
    "xl/workbook.xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
      names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("") +
      "</sheets></workbook>"
  );
  push(
    "xl/_rels/workbook.xml.rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      sheets
        .map(
          (_, i) =>
            `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
        )
        .join("") +
      `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
      "</Relationships>"
  );
  push("xl/styles.xml", STYLES_XML);
  sheets.forEach((s, i) => push(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s.rows)));

  // ---- بناء أرشيف zip بلا ضغط ----
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const f of files) {
    const nameBytes = enc.encode(f.name);
    const crc = crc32(f.data);
    const lh = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(lh.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true); // النسخة المطلوبة
    lv.setUint16(6, 0x0800, true); // أسماء الملفات UTF-8
    lv.setUint16(8, 0, true); // بلا ضغط
    lv.setUint32(14, crc, true);
    lv.setUint32(18, f.data.length, true);
    lv.setUint32(22, f.data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lh.set(nameBytes, 30);
    locals.push(lh, f.data);

    const ch = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, f.data.length, true);
    cv.setUint32(24, f.data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    ch.set(nameBytes, 46);
    centrals.push(ch);

    offset += lh.length + f.data.length;
  }

  const cdSize = centrals.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);

  return new Blob([...locals, ...centrals, eocd] as BlobPart[], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}
