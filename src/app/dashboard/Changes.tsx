"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { readDelimited, readXlsx } from "@/lib/sheet";

/* ============================================================
   طلبات التغيير الواردة من منصة الرؤية.
   الملف اليومي الذي كان يُرسل بريداً يُرفع هنا بدله: الرمز هو
   المفتاح، فما تكرّر يُحدَّث وما اختفى من الملف يُعدّ مراجَعاً.
   ============================================================ */

export type Change = {
  code: string;
  program: string;
  itemCode: string;
  itemName: string;
  owner: string;
  category: string;
  reviewType: string;
  classification: string;
  sla: number | null;
  workDays: number | null;
  status: "open" | "closed";
  firstSeen: string;
  lastSeen: string;
  closedAt?: string;
  updatedAt: string;
  updatedBy: string;
};

type Tone = "late" | "near" | "ok" | "done";

/** أحمر عند استنفاد المدة · برتقالي عند اقترابها (٦٠٪ فأكثر) */
export function toneOf(c: Change): Tone {
  if (c.status === "closed") return "done";
  if (c.sla == null || c.workDays == null) return "ok";
  if (c.workDays >= c.sla) return "late";
  if (c.workDays >= c.sla * 0.6) return "near";
  return "ok";
}

const TONE_COLOR: Record<Tone, string> = {
  late: "#d34a4a",
  near: "#e0971a",
  ok: "#1a9d5c",
  done: "#8a9a95",
};

/* ---------- مطابقة عناوين الأعمدة عربياً ---------- */
function norm(s: string): string {
  return s
    .replace(/[ً-ْـ]/g, "")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[\s/\\_-]+/g, " ")
    .trim();
}
function digits(s: string): string {
  return s.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
}
function toNum(s: string): number | null {
  const v = digits(String(s)).replace(/[^\d.-]/g, "");
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

type Field = keyof Pick<
  Change,
  "code" | "program" | "itemCode" | "itemName" | "owner" | "category" | "reviewType" | "classification"
> | "sla" | "workDays";

function fieldOf(headRaw: string): Field | null {
  const h = norm(headRaw);
  if (!h) return null;
  if (h.includes("رمز")) return "code";
  if (h.includes("كود")) return "itemCode";
  if (h.includes("ايام")) return "workDays";
  if (h.includes("اتفاقيه") || h.includes("مستوي الخدمه")) return "sla";
  if (h.includes("جهه")) return "owner";
  if (h.includes("فئه")) return "category";
  if (h.includes("نوع")) return "reviewType";
  if (h.includes("تصنيف")) return "classification";
  if (h.includes("برنامج") || h.includes("استراتيجيه")) return "program";
  if (h.includes("اسم")) return "itemName";
  return null;
}

type Parsed = { rows: Record<string, string | number | null>[]; skipped: number };

/** يجد صف العناوين ثم يحوّل ما بعده إلى صفوف بأسماء الحقول */
function mapRows(grid: string[][]): Parsed {
  let headIdx = -1;
  let map: (Field | null)[] = [];
  for (let i = 0; i < Math.min(grid.length, 20); i++) {
    const m = grid[i].map(fieldOf);
    if (m.includes("code") && m.filter(Boolean).length >= 4) {
      headIdx = i;
      map = m;
      break;
    }
  }
  if (headIdx < 0) return { rows: [], skipped: 0 };

  const rows: Record<string, string | number | null>[] = [];
  let skipped = 0;
  for (let i = headIdx + 1; i < grid.length; i++) {
    const r = grid[i];
    if (!r.some((c) => c.trim() !== "")) continue;
    const o: Record<string, string | number | null> = {};
    map.forEach((f, ci) => {
      if (!f) return;
      const v = (r[ci] ?? "").trim();
      o[f] = f === "sla" || f === "workDays" ? toNum(v) : v;
    });
    if (!String(o.code || "").trim()) {
      skipped++;
      continue;
    }
    rows.push(o);
  }
  return { rows, skipped };
}

export default function Changes({ t }: { t: (ar: string, en: string) => string }) {
  const [items, setItems] = useState<Change[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState<"open" | Tone | "all">("open");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const r = await apiFetch("/api/changes").then((x) => x.json());
    setItems(r.changes || []);
    setLoaded(true);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const stats = useMemo(() => {
    const open = items.filter((x) => x.status === "open");
    return {
      open: open.length,
      late: open.filter((x) => toneOf(x) === "late").length,
      near: open.filter((x) => toneOf(x) === "near").length,
      ok: open.filter((x) => toneOf(x) === "ok").length,
      done: items.filter((x) => x.status === "closed").length,
    };
  }, [items]);

  const shown = useMemo(() => {
    const list =
      filter === "all"
        ? items
        : filter === "open"
          ? items.filter((x) => x.status === "open")
          : filter === "done"
            ? items.filter((x) => x.status === "closed")
            : items.filter((x) => x.status === "open" && toneOf(x) === filter);
    const rank: Record<Tone, number> = { late: 0, near: 1, ok: 2, done: 3 };
    return [...list].sort(
      (a, b) => rank[toneOf(a)] - rank[toneOf(b)] || (b.workDays ?? -1) - (a.workDays ?? -1)
    );
  }, [items, filter]);

  async function send(grid: string[][]) {
    setErr("");
    setMsg("");
    const { rows, skipped } = mapRows(grid);
    if (!rows.length) {
      setErr(
        t(
          "لم أتعرّف على أعمدة الجدول. تأكدي أن الصف الأول يحمل العناوين: الرمز · الجهة المالكة · اتفاقية مستوى الخدمة · أيام العمل …",
          "Could not recognise the table headers."
        )
      );
      return;
    }
    const okToGo = window.confirm(
      t(
        `الملف فيه ${rows.length} طلباً. سيُحدَّث الموجود، ويُضاف الجديد، ويُعدّ ما لم يعد في الملف طلباً تمت مراجعته.\n\nمتابعة؟`,
        `${rows.length} requests found. Continue?`
      )
    );
    if (!okToGo) return;

    setBusy(true);
    const r = await apiFetch("/api/changes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rows }),
    }).then((x) => x.json());
    setBusy(false);
    if (r.error) {
      setErr(r.error);
      return;
    }
    setMsg(
      t(
        `حُفظ ${r.saved} طلباً${r.closed ? ` · أُغلق ${r.closed} طلباً تمت مراجعته` : ""}${
          skipped ? ` · تُخطّي ${skipped} صفاً بلا رمز` : ""
        }`,
        `Saved ${r.saved}`
      )
    );
    load();
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setErr("");
    setMsg("");
    try {
      if (/\.xlsx?$/i.test(f.name)) {
        const grid = await readXlsx(await f.arrayBuffer());
        if (!grid.length) throw new Error("empty");
        await send(grid);
      } else {
        await send(readDelimited(await f.text()));
      }
    } catch {
      setErr(
        t(
          "تعذّرت قراءة الملف. إن كان بصيغة xls القديمة فاحفظيه من إكسل بصيغة xlsx أو CSV، أو انسخي الجدول والصقيه.",
          "Could not read the file."
        )
      );
    }
  }

  function exportCsv() {
    const head = [
      "الرمز",
      "اسم البرنامج/الاستراتيجية",
      "كود المبادرة / المؤشر",
      "اسم المبادرة/ المؤشر",
      "الجهة المالكة",
      "فئة الطلب",
      "نوع المراجعة",
      "التصنيف",
      "اتفاقية مستوى الخدمة",
      "أيام العمل",
      "المتبقي",
      "الحالة",
    ];
    const body = shown.map((c) => [
      c.code,
      c.program,
      c.itemCode,
      c.itemName,
      c.owner,
      c.category,
      c.reviewType,
      c.classification,
      c.sla ?? "",
      c.workDays ?? "",
      c.sla != null && c.workDays != null ? c.sla - c.workDays : "",
      c.status === "closed" ? "تمت المراجعة" : toneOf(c) === "late" ? "متأخر" : toneOf(c) === "near" ? "قارب على الانتهاء" : "ضمن المدة",
    ]);
    const csv = [head, ...body]
      .map((r) => r.map((x) => (/[",\n]/.test(String(x)) ? `"${String(x).replace(/"/g, '""')}"` : String(x))).join(","))
      .join("\r\n");
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "طلبات-التغيير.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const CHIPS: { key: "open" | Tone | "all"; label: string; n: number; c?: string }[] = [
    { key: "open", label: t("المفتوحة", "Open"), n: stats.open },
    { key: "late", label: t("متأخرة", "Overdue"), n: stats.late, c: TONE_COLOR.late },
    { key: "near", label: t("قاربت على الانتهاء", "Due soon"), n: stats.near, c: TONE_COLOR.near },
    { key: "ok", label: t("ضمن المدة", "On time"), n: stats.ok, c: TONE_COLOR.ok },
    { key: "done", label: t("تمت مراجعتها", "Reviewed"), n: stats.done, c: TONE_COLOR.done },
    { key: "all", label: t("الكل", "All"), n: items.length },
  ];

  return (
    <div className="cr">
      <div className="cr-bar">
        <span className="pills">
          {CHIPS.map((c) => (
            <button
              key={c.key}
              className={`pill ${filter === c.key ? "on" : ""}`}
              style={{ ["--c" as string]: c.c || "#016b5f" }}
              onClick={() => setFilter(c.key)}
            >
              <i />
              {c.label}
              <b>{c.n}</b>
            </button>
          ))}
        </span>
        <div style={{ flex: 1 }} />
        <button className="btn btn-ghost btn-sm" onClick={() => setPasting(true)}>
          {t("لصق الجدول", "Paste")}
        </button>
        <button className="btn btn-ghost btn-sm" onClick={exportCsv} disabled={!shown.length}>
          ⬇ Excel
        </button>
        <button className="btn btn-sm" onClick={() => fileRef.current?.click()} disabled={busy}>
          {busy ? t("جارٍ الحفظ…", "Saving…") : t("⬆ رفع ملف المنصة", "Upload file")}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls,.csv,.txt"
          style={{ display: "none" }}
          onChange={onFile}
        />
      </div>

      {err && <div className="alert alert-error">{err}</div>}
      {msg && <div className="alert alert-ok">{msg}</div>}

      {!loaded ? (
        <div className="empty">{t("جارٍ التحميل...", "Loading...")}</div>
      ) : !items.length ? (
        <div className="soon">
          <b>{t("لا توجد طلبات تغيير بعد", "No change requests yet")}</b>
          {t(
            "ارفعي ملف المتابعة اليومي المسحوب من منصة الرؤية، أو انسخي الجدول من البريد والصقيه.",
            "Upload the daily platform file, or paste the table."
          )}
        </div>
      ) : !shown.length ? (
        <div className="empty">{t("لا طلبات في هذا التصنيف.", "Nothing here.")}</div>
      ) : (
        <div className="cr-tw">
          <table className="cr-tbl">
            <thead>
              <tr>
                <th>{t("الرمز", "Code")}</th>
                <th>{t("الجهة المالكة", "Owner")}</th>
                <th>{t("اسم المبادرة / المؤشر", "Initiative / KPI")}</th>
                <th>{t("فئة الطلب", "Category")}</th>
                <th>{t("نوع المراجعة", "Review")}</th>
                <th className="mini">{t("المدة", "SLA")}</th>
                <th className="mini">{t("أيام العمل", "Days")}</th>
                <th className="mini">{t("المتبقي", "Left")}</th>
                <th>{t("الحالة", "Status")}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((c) => {
                const tone = toneOf(c);
                const left = c.sla != null && c.workDays != null ? c.sla - c.workDays : null;
                return (
                  <tr key={c.code} className={`cr-${tone}`}>
                    <td className="ltr cr-code" data-l={t("الرمز", "Code")}>
                      {c.code}
                    </td>
                    <td data-l={t("الجهة المالكة", "Owner")}>{c.owner}</td>
                    <td className="cr-name" data-l={t("اسم المبادرة / المؤشر", "Initiative")}>
                      {c.itemName}
                      {c.itemCode && <span className="cr-sub ltr">{c.itemCode}</span>}
                    </td>
                    <td data-l={t("فئة الطلب", "Category")}>{c.category}</td>
                    <td data-l={t("نوع المراجعة", "Review")}>{c.reviewType}</td>
                    <td className="ltr" data-l={t("المدة", "SLA")}>
                      {c.sla ?? "—"}
                    </td>
                    <td className="ltr" data-l={t("أيام العمل", "Days")}>
                      {c.workDays ?? "—"}
                    </td>
                    <td className="ltr" data-l={t("المتبقي", "Left")}>
                      {left == null ? "—" : left}
                    </td>
                    <td data-l={t("الحالة", "Status")}>
                      <span className="cr-st" style={{ ["--c" as string]: TONE_COLOR[tone] }}>
                        <i />
                        {c.status === "closed"
                          ? t("تمت المراجعة", "Reviewed")
                          : tone === "late"
                            ? t("متأخر", "Overdue")
                            : tone === "near"
                              ? t("قارب على الانتهاء", "Due soon")
                              : t("ضمن المدة", "On time")}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {pasting && (
        <div className="modal-overlay" onClick={() => setPasting(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="m-h">
              <h3>{t("لصق جدول طلبات التغيير", "Paste table")}</h3>
              <button className="mx" onClick={() => setPasting(false)} aria-label="close">
                ✕
              </button>
            </div>
            <div className="m-b">
              <label>
                {t(
                  "حدّدي الجدول في البريد أو إكسل، انسخيه، ثم الصقيه هنا بما فيه صف العناوين.",
                  "Paste the table including its header row."
                )}
              </label>
              <textarea rows={8} value={pasted} onChange={(e) => setPasted(e.target.value)} />
            </div>
            <div className="m-f">
              <button className="btn btn-ghost btn-sm" onClick={() => setPasting(false)}>
                {t("إلغاء", "Cancel")}
              </button>
              <button
                className="btn btn-sm"
                disabled={!pasted.trim()}
                onClick={async () => {
                  setPasting(false);
                  await send(readDelimited(pasted));
                  setPasted("");
                }}
              >
                {t("قراءة الجدول", "Read table")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
