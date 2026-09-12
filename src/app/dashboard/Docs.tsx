"use client";

/* ============================================================
   منهجيات أداء — مكتبة الوثائق
   ------------------------------------------------------------
   الوثيقة تُرفع مرة واحدة فتخدم بابين:
     · تُنزَّل كما هي من هذه الصفحة.
     · ويُستخرج نصّها فيجيب منه المساعد الذكي مع ذكر الصفحة.

   الاستخراج يقع **داخل المتصفح** — لا تغادر المنهجية جهاز رافعها
   إلا إلى قاعدة المنصة. ولا خدمة خارجية في المسار كلّه.
   ============================================================ */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { sb } from "@/lib/supa";
import { extract } from "@/lib/doctext";

type T = (ar: string, en: string) => string;

export type DocRow = {
  id: string; title: string; kind: string; tags: string[]; summary: string;
  filePath: string; fileName: string; size: number; pages: number;
  addedBy: string; at: string;
};

const KINDS = ["منهجية", "دليل", "نموذج", "محضر", "عرض", "أخرى"];

function human(n: number): string {
  if (!n) return "—";
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} كيلوبايت`;
  return `${(n / 1024 / 1024).toFixed(1)} ميجابايت`;
}

/** رابط تنزيل الملف من تخزين المنصة.
    الاسم الأصلي يُمرَّر ليصل الملف باسمه العربي لا بمفتاح التخزين */
export function docUrl(path: string, fileName?: string): string {
  if (!path) return "";
  const o = fileName ? { download: fileName } : undefined;
  return sb().storage.from("docs").getPublicUrl(path, o).data.publicUrl;
}

/** مفتاح التخزين — لاتيني بحت.
    تخزين Supabase يرفض الحروف العربية في المفتاح («Invalid key»)،
    فالمفتاح اسم محايد والاسم الأصلي يُحفظ في قاعدة المنصة ويظهر
    للناس ويُنزَّل الملف به. */
function storageKey(name: string): string {
  const dot = name.lastIndexOf(".");
  const ext = (dot > 0 ? name.slice(dot + 1) : "").replace(/[^A-Za-z0-9]/g, "").toLowerCase();
  const base = (dot > 0 ? name.slice(0, dot) : name)
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 40);
  const rnd = Math.random().toString(36).slice(2, 7);
  return `${Date.now()}-${rnd}${base ? `-${base}` : ""}${ext ? `.${ext}` : ""}`;
}

export default function Docs({ t, canEdit }: { t: T; canEdit: boolean }) {
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const file = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    const r = await apiFetch("/api/docs").then((x) => x.json()).catch(() => ({}));
    setDocs(Array.isArray(r.docs) ? r.docs : []);
    setLoaded(true);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const shown = useMemo(() => {
    const term = q.trim();
    return docs.filter(
      (d) =>
        (!kind || d.kind === kind) &&
        (!term ||
          d.title.includes(term) ||
          d.summary.includes(term) ||
          d.tags.some((g) => g.includes(term))),
    );
  }, [docs, q, kind]);

  async function upload(f: File) {
    setErr("");
    try {
      setBusy(t("يُرفع الملف…", "Uploading…"));
      const path = storageKey(f.name);
      const up = await sb().storage.from("docs").upload(path, f, { upsert: true });
      if (up.error) throw new Error(up.error.message);

      setBusy(t("يُقرأ النصّ داخل متصفحك…", "Reading text…"));
      let chunks: { idx: number; page: number; heading: string; body: string }[] = [];
      let pages = 0;
      try {
        const got = await extract(f);
        chunks = got.chunks;
        pages = got.pages;
      } catch {
        /* ملفٌ لا يُقرأ نصُّه (ممسوح ضوئياً مثلاً): يبقى للتنزيل
           بلا معرفة — أفضل من رفضه كلّه */
      }

      setBusy(t(`يُحفظ… ${chunks.length} مقطعاً`, `Saving… ${chunks.length} chunks`));
      const title = f.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim();
      const r = await apiFetch("/api/docs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title, kind: f.name.toLowerCase().endsWith(".xlsx") ? "نموذج" : "منهجية",
          filePath: path, fileName: f.name, mime: f.type, size: f.size, pages, chunks,
        }),
      }).then((x) => x.json());
      if (r.error) throw new Error(r.error);
      setBusy("");
      await load();
    } catch (e) {
      setBusy("");
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function save(d: DocRow, patch: Partial<DocRow>) {
    const next = { ...d, ...patch };
    setDocs((v) => v.map((x) => (x.id === d.id ? next : x)));
    await apiFetch("/api/docs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...next, chunks: undefined }),
    });
  }

  async function del(d: DocRow) {
    if (!confirm(t(`حذف «${d.title}» ونصّها من المساعد؟`, `Delete "${d.title}"?`))) return;
    const r = await apiFetch(`/api/docs/${d.id}`, { method: "DELETE" }).then((x) => x.json());
    if (r.error) { setErr(r.error); return; }
    if (d.filePath) await sb().storage.from("docs").remove([d.filePath]);
    await load();
  }

  return (
    <div className="dcs">
      <div className="dcs-bar">
        <input
          className="dcs-q"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("ابحث في المنهجيات…", "Search…")}
        />
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">{t("كل الأنواع", "All kinds")}</option>
          {KINDS.map((k) => <option key={k}>{k}</option>)}
        </select>
        <div style={{ flex: 1 }} />
        {canEdit && (
          <>
            <input
              ref={file}
              type="file"
              accept=".pdf,.xlsx,.xls,.txt,.csv"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void upload(f);
                e.target.value = "";
              }}
            />
            <button className="btn btn-sm" disabled={!!busy} onClick={() => file.current?.click()}>
              ＋ {t("رفع وثيقة", "Upload")}
            </button>
          </>
        )}
      </div>

      {busy && <div className="dcs-busy">{busy}</div>}
      {err && <div className="alert alert-error">{err}</div>}

      {!loaded ? (
        <div className="empty">{t("جارٍ التحميل...", "Loading...")}</div>
      ) : !shown.length ? (
        <div className="soon">
          <b>{t("لا توجد وثائق بعد", "No documents yet")}</b>
          {canEdit
            ? t("ارفعي المنهجيات والنماذج — يُقرأ نصّها فيجيب منها المساعد الذكي.",
                "Upload documents — the assistant will answer from them.")
            : t("ستظهر هنا منهجيات المركز ونماذجه.", "Documents will appear here.")}
        </div>
      ) : (
        <div className="dcs-g">
          {shown.map((d) => (
            <div className="dc" key={d.id}>
              <div className="dc-h">
                <span className={`dc-k ${d.kind === "نموذج" ? "n" : ""}`}>{d.kind}</span>
                <b>{d.title}</b>
              </div>
              {d.summary && <p className="dc-s">{d.summary}</p>}
              <div className="dc-m">
                {d.pages > 0 && <span>{d.pages} {d.kind === "نموذج" ? t("ورقة", "sheets") : t("صفحة", "pages")}</span>}
                <span>{human(d.size)}</span>
                {d.addedBy && <span>{t("أضافها", "by")} {d.addedBy}</span>}
              </div>
              <div className="dc-a">
                <a className="btn2" href={docUrl(d.filePath, d.fileName)} target="_blank" rel="noreferrer" download={d.fileName}>
                  ⬇ {t("تنزيل", "Download")}
                </a>
                {canEdit && (
                  <>
                    <button
                      className="btn2"
                      onClick={() => {
                        const v = prompt(t("وصف مختصر يظهر تحت الاسم", "Short summary"), d.summary);
                        if (v !== null) void save(d, { summary: v });
                      }}
                    >
                      {t("وصف", "Summary")}
                    </button>
                    <button
                      className="btn2"
                      onClick={() => {
                        const v = prompt(
                          t("كلمات يبحث بها المساعد — تُفصل بفاصلة", "Tags, comma separated"),
                          d.tags.join("، "),
                        );
                        if (v !== null) void save(d, { tags: v.split(/[,،]/).map((x) => x.trim()).filter(Boolean) });
                      }}
                    >
                      {t("كلمات البحث", "Tags")}
                    </button>
                    <button className="btn2 del" onClick={() => del(d)}>{t("حذف", "Delete")}</button>
                  </>
                )}
              </div>
              {d.tags.length > 0 && (
                <div className="dc-t">{d.tags.map((g) => <span key={g}>{g}</span>)}</div>
              )}
            </div>
          ))}
        </div>
      )}

      <p className="dcs-note">
        {t(
          "النصّ يُقرأ داخل متصفحك ويُحفظ في قاعدة المنصة — لا تخرج الوثيقة إلى أي خدمة خارجية. والمساعد يجيب منها ويذكر اسم الوثيقة وصفحتها.",
          "Text is read in your browser and stored in the platform's own database.",
        )}
      </p>
    </div>
  );
}
