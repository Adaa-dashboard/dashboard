"use client";

/* ============================================================
   الخطة التشغيلية لإدارة عمليات الأداء
   ------------------------------------------------------------
   خمس محافظ، لكل مديرٍ محفظة، وداخل كل محفظة ثلاثة أنواع من
   المساهمات: مؤشرات · مبادرات · مكاسب سريعة.

   **الراعي غير صاحب المحفظة**: البند قد يرعاه من ليس مديراً،
   فيُحفَظ اسمه كما هو ويبقى البند في محفظة المدير المسؤول عنه.
   ولذلك `owner` حقلٌ مستقلّ عن `sponsor` لا يُشتقّ منه.
   ============================================================ */

import { useEffect, useMemo, useRef, useState } from "react";
import { useItems, type Item, SECTION_TITLE } from "./Sections";
import { nrm } from "@/lib/commit";
import { apiFetch } from "@/lib/api";
import { IconDown, IconUp } from "./icons";
import { writeXlsx, readXlsxSheets } from "@/lib/sheet";
import {
  OP_STATUSES, quarters, onTrack, opStatus,
  xlBook, xlParseBook, type XlRow, type XlPlan,
} from "@/lib/opxl";

/* المنطق في `lib/opxl` ليُختبر بلا React ولا شبكة، والصفحة تعرضه.
   ويُعاد تصديره هنا ليبقى مستوردوه على ما ألفوه */
export { OP_STATUSES, opStatus };

/** الكتاب يُغلَّف ملفاً — بناؤه في `lib/opxl` */
const xlExport = (rows: XlRow[], owners: string[]) => writeXlsx(xlBook(rows, owners));

type T = (ar: string, en: string) => string;
type Rec = Record<string, unknown>;

const txt = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const num = (v: unknown, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
/** قيمة مُدخَلة فعلاً — الصفر قيمة، والفراغ ليس صفراً */
const has = (v: unknown) => v !== undefined && v !== null && String(v).trim() !== "";

/** أصحاب المحافظ الخمس بترتيب العرض */
export const OP_OWNERS = [
  "عبدالله الحزامي",
  "دعاء الفهمي",
  "معاذ الهقاص",
  "بدر الغنام",
  "عمر العتيق",
];
const OWNER_COLOR: Record<string, string> = {
  "عبدالله الحزامي": "#00584c",
  "دعاء الفهمي": "#016b5f",
  "معاذ الهقاص": "#008b84",
  "بدر الغنام": "#0f8a8a",
  "عمر العتيق": "#1a9d5c",
};
const KIND_COLOR: Record<string, string> = { kpi: "#00584c", init: "#7a5cd1", win: "#c9a020" };
const KIND_LABEL: Record<string, [string, string]> = {
  kpi: ["المؤشرات", "KPIs"],
  init: ["المبادرات", "Initiatives"],
  win: ["المكاسب السريعة", "Quick wins"],
};
/** مختصرٌ لشرائح البطاقة — «المكاسب السريعة» لا تسع في صفٍّ واحد */
const KIND_SHORT: Record<string, string> = { kpi: "مؤشرات", init: "مبادرات", win: "مكاسب" };
const KINDS = ["kpi", "init", "win"] as const;
const LEVELS = ["", "مستوى أول", "مستوى ثانٍ", "مستوى ثالث"];
const INIT_TYPES = ["استراتيجية", "تشغيلية"];
/** الحالات الأربع المعتمدة — لا «جديدة» ولا «مستمرة» بعد اليوم */
const ST_TONE: Record<string, string> = {
  مكتملة: "ok",
  "على المسار": "nw",
  متأخرة: "no",
  "لم تبدأ": "nt",
};

/** أحرف الاسم الأولى — وجهٌ صغير للمحفظة */
const short = (n: string) => {
  const w = n.trim().split(/\s+/);
  return ((w[0]?.[0] || "") + (w[1]?.[0] || "")).trim() || "؟";
};
/** آخر كلمة من الاسم — تكفي للتمييز في الشرائح الضيّقة */
const last = (n: string) => n.trim().split(/\s+/).slice(-1)[0] || n;

/* ---------- أسماء قديمة بقيت في المخزون ---------- */
/* بندٌ محفوظ باسمٍ قديم يصنع **محفظةً ثانية** للشخص نفسه: واحدة
   فارغة بالاسم الصحيح من قائمة أصحاب المحافظ، وأخرى فيها بنوده
   بالاسم الخطأ لأنها ليست في القائمة فتُعرض كمحفظةٍ زائدة.
   فتُصحَّح الأسماء عند العرض، ويُصحَّح المخزون نفسه بملف
   perf-opplan-rename.sql — والاثنان معاً: الواجهة تصلح فوراً
   والقاعدة تصلح دائماً. */
const NAME_ALIAS: Record<string, string> = { "معاذ البقاص": "معاذ الهقاص" };
export const opName = (v: unknown) => {
  const x = txt(v).trim();
  return NAME_ALIAS[x] ?? x;
};
/** خانةٌ قد تحمل عدة أسماء — يُصحَّح كلٌّ منها على حدة */
const fixList = (v: unknown) => {
  const x = txt(v).trim();
  if (!x) return x;
  const parts = x.split(/[·,،|]+/).map((p) => p.trim()).filter(Boolean);
  return parts.length > 1 ? parts.map(opName).join(" · ") : opName(x);
};
/** نسخةٌ من بيانات البند بأسماءٍ مصحَّحة — تُستعمل في العرض والمطابقة */
export function opFix(d: Rec): Rec {
  return {
    ...d,
    owner: opName(d.owner),
    sponsor: fixList(d.sponsor),
    assignee: fixList(d.assignee),
    contributor: opName(d.contributor),
  };
}

/* ---------- «مَن يخصّه البند» ---------- */
/** خانةٌ قد تحمل أكثر من اسم: «أ · ب» أو «أ، ب» */
const namesOf = (v: unknown) =>
  txt(v).split(/[·,،/|]+/).map((x) => x.trim()).filter(Boolean);

/** أدوار الشخص في البند — فارغة إن لم يكن له فيه شيء */
export function opRoles(d: Rec, me: string): string[] {
  const n = nrm(me);
  if (!n) return [];
  const r: string[] = [];
  if (namesOf(d.sponsor).some((x) => nrm(x) === n)) r.push("راعي");
  if (namesOf(d.assignee).some((x) => nrm(x) === n)) r.push("مسؤول");
  if (namesOf(d.owner).some((x) => nrm(x) === n) && !r.length) r.push("صاحب المحفظة");
  if (nrm(txt(d.contributor)) === n && !r.length) r.push("مساهمة");
  return r;
}

/* ---------- آخر تحديثٍ لحالة المساهمة ---------- */
/* «حالة المساهمة» تتحدّث أسبوعياً، فمتى تحدّثت آخر مرة جزءٌ من
   المعلومة: سطرٌ عمره أسبوعان يُقرأ على أنه الحاضر وهو ليس كذلك. */
export function agoOf(iso?: string): { txt: string; stale: boolean } | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  const w =
    days <= 0 ? "اليوم"
    : days === 1 ? "أمس"
    : days === 2 ? "قبل يومين"
    : days < 11 ? `قبل ${days} أيام`
    : days < 30 ? `قبل ${days} يوماً`
    : d.toLocaleDateString("ar-SA-u-nu-latn", { year: "numeric", month: "short", day: "numeric" });
  return { txt: w, stale: days > 10 };
}

export const opTone = (s: string) => ST_TONE[s] || "nt";

export default function OpPlan({ t, canEdit }: { t: T; canEdit: boolean }) {
  const { items, loaded, save, remove, reload } = useItems("opplan");
  const [own, setOwn] = useState("");
  /* نوعٌ واحد معروض، أو الثلاثة. يُختار من شريحة البطاقة أو من
     عنوان العمود — فمن أراد مؤشرات محفظةٍ وحدها رآها وحدها */
  const [kind, setKind] = useState<"" | (typeof KINDS)[number]>("");
  /* صورة صاحب المحفظة إن رفعها في محفظته — تُطابَق بالاسم بعد
     التطبيع، فاختلاف الهمزة لا يُسقطها. وبلا صورةٍ يبقى الحرفان */
  const [photo, setPhoto] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    void apiFetch("/api/people")
      .then((r) => r.json())
      .then((d) => {
        const m = new Map<string, string>();
        for (const u of (Array.isArray(d.people) ? d.people : []) as Rec[]) {
          const url = txt(u.photoUrl);
          if (url && txt(u.name)) m.set(nrm(opName(u.name)), url);
        }
        setPhoto(m);
      })
      .catch(() => {});
  }, []);
  const [edit, setEdit] = useState<Item | null>(null);

  const rows = useMemo(() => items.map((x) => ({ ...x, data: opFix(x.data as Rec) })), [items]);
  const byOwner = useMemo(() => {
    const m: Record<string, typeof rows> = {};
    for (const o of OP_OWNERS) m[o] = [];
    for (const r of rows) {
      const o = txt(r.data.owner);
      (m[o] = m[o] || []).push(r);
    }
    return m;
  }, [rows]);
  /* محافظ لم يُذكر أصحابها في الخمسة — تُعرض ولا تُخفى */
  const extra = useMemo(
    () => Object.keys(byOwner).filter((o) => o && !OP_OWNERS.includes(o)),
    [byOwner],
  );
  const owners = [...OP_OWNERS, ...extra];

  const shown = own ? rows.filter((r) => txt(r.data.owner) === own) : rows;
  const of = (k: string) => shown.filter((r) => txt(r.data.kind) === k);
  const cnt = (o: string, k: string) => (byOwner[o] || []).filter((r) => txt(r.data.kind) === k).length;

  if (!loaded) return <div className="empty">{t("جارٍ التحميل...", "Loading...")}</div>;

  return (
    <div className="op">
      <div className="op-head">
        <h2>{t(SECTION_TITLE.opplan[0], SECTION_TITLE.opplan[1])} <b>2026م</b></h2>
        <span>
          {t(
            `${owners.length} محافظ · ${of("kpi").length} مؤشراً · ${of("init").length} مبادرة · ${of("win").length} مكاسب سريعة`,
            `${owners.length} portfolios`,
          )}
        </span>
        {/* الملف يحمل الخطة كما هي على الشاشة — المعروض بعد الفلتر
            لا كل شيء، فما تراه هو ما تُنزّله. و**التنزيل لمن يقرأ**:
            أخذُ نسخةٍ لا يغيّر شيئاً، وإنما الرفع هو الذي يحتاج
            صلاحية التحرير */}
        <OpXlsx rows={shown} owners={owners} t={t} canEdit={canEdit} onDone={reload} />
      </div>

      {/* المحافظ — الضغط يفلتر الأعمدة الثلاثة على صاحبها */}
      <div className="op-pf">
        {/* البطاقة `div` لا `button`: فيها أزرارٌ أربعة — الاسم
            يختار المحفظة، وكلُّ شريحةٍ تختارها ونوعَها معاً.
            والزرّ داخل الزرّ لا يصحّ في HTML */}
        {owners.map((o) => (
          <div key={o} className={`c ${own === o ? "on" : ""}`}>
            <button className="hd" onClick={() => setOwn(own === o ? "" : o)}>
              <span className="av">
                {photo.get(nrm(o)) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={photo.get(nrm(o))} alt="" />
                ) : (
                  short(o)
                )}
              </span>
              <span className="nm">{o}</span>
              <span className="rl">
                {o === OP_OWNERS[0] ? t("مدير الإدارة", "Director") : t("مدير قطاع", "Sector manager")}
              </span>
            </button>
            <span className="n3">
              {KINDS.map((k) => (
                <button
                  key={k}
                  className={own === o && kind === k ? "on" : ""}
                  title={t(`${KIND_LABEL[k][0]} — ${o}`, KIND_LABEL[k][1])}
                  onClick={() => {
                    const same = own === o && kind === k;
                    setOwn(same ? "" : o);
                    setKind(same ? "" : k);
                  }}
                >
                  {KIND_SHORT[k]} <b>{cnt(o, k)}</b>
                </button>
              ))}
            </span>
          </div>
        ))}
      </div>
      {(own || kind) && (
        <div className="op-filt">
          {own ? t(`معروضة محفظة: ${own}`, `Portfolio: ${own}`) : t("كل المحافظ", "All portfolios")}
          {kind && <b>{t(KIND_LABEL[kind][0], KIND_LABEL[kind][1])}</b>}
          <button
            onClick={() => {
              setOwn("");
              setKind("");
            }}
          >
            {t("عرض الجميع", "Show all")}
          </button>
        </div>
      )}

      {/* نوعٌ مختار ⇒ عمودٌ واحد يملأ العرض */}
      <div className={`op-3 ${kind ? "one" : ""}`}>
        {KINDS.filter((k) => !kind || k === kind).map((k) => (
          <div className="op-col" key={k} style={{ ["--c" as string]: KIND_COLOR[k] }}>
            <h3
              className="pick"
              title={kind ? t("عرض الأنواع الثلاثة", "Show all three") : t("عرض هذا النوع وحده", "Show only this")}
              onClick={() => setKind(kind === k ? "" : k)}
            >
              <i />
              {t(KIND_LABEL[k][0], KIND_LABEL[k][1])}
              <b>{of(k).length}</b>
            </h3>
            {of(k).map((r) => (
              <OpCard key={r.id} r={r} canEdit={canEdit} t={t} onEdit={() => setEdit(r)} />
            ))}
            {!of(k).length && <div className="op-none">{t("لا توجد بنود", "Nothing here")}</div>}
          </div>
        ))}
      </div>

      {edit && (
        <OpEdit
          it={edit}
          t={t}
          owners={owners}
          onClose={() => setEdit(null)}
          onSave={async (d) => {
            const err = await save(edit.id, d, edit.ord);
            if (!err) setEdit(null);
            return err;
          }}
          onDelete={async () => {
            const err = await remove(edit.id);
            if (!err) setEdit(null);
            return err;
          }}
        />
      )}
    </div>
  );
}

function OpXlsx({
  rows, owners, t, canEdit, onDone,
}: {
  rows: XlRow[];
  /** ترتيب المحافظ — ورقةٌ لكل واحدة بالترتيب نفسه */
  owners: string[];
  t: T;
  /** الرفع لمن يحرّر الخطة وحده — والتنزيل للجميع */
  canEdit: boolean;
  onDone: () => void;
}) {
  const file = useRef<HTMLInputElement | null>(null);
  const [plan, setPlan] = useState<XlPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  function down() {
    const url = URL.createObjectURL(xlExport(rows, owners));
    const a = document.createElement("a");
    a.href = url;
    a.download = `الخطة-التشغيلية-${new Date().toISOString().slice(0, 10)}.xlsx`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  async function pick(f: File | null | undefined) {
    if (!f) return;
    setMsg("");
    try {
      const sheets = await readXlsxSheets(await f.arrayBuffer());
      if (!sheets.length) throw new Error("فارغ");
      const p = xlParseBook(sheets, rows);
      if (!p.put.length) {
        setMsg(t(`لا جديد في الملف — ${p.same} بنداً كما هي.`, "Nothing changed."));
        return;
      }
      setPlan(p);
    } catch {
      setMsg(t("تعذّرت قراءة الملف — يُحفظ من إكسل بصيغة xlsx.", "Could not read the file."));
    }
  }

  async function run() {
    if (!plan) return;
    setBusy(true);
    /* دفعةٌ واحدة لا طلبٌ لكل بند: ثلاثون طلباً متتابعاً تُبطئ
       وتترك الخطة نصفَ محدَّثة إن انقطع الاتصال في وسطها */
    const r = await apiFetch("/api/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        section: "opplan",
        items: plan.put.map((x) => ({ id: x.id, ord: x.ord, data: x.data })),
      }),
    }).catch(() => null);
    const okAll = !!r && r.ok;
    setBusy(false);
    setPlan(null);
    setMsg(
      okAll
        ? t(`حُدِّث ${plan.put.length} بنداً.`, `Updated ${plan.put.length}.`)
        : t("تعذّر الحفظ — تحقّق من صلاحيتك على الخطة.", "Save failed."),
    );
    if (okAll) onDone();
  }

  return (
    <div className="op-xl">
      <button className="btn btn-sm" onClick={down}>
        <IconDown size={15} /> {t("تنزيل إكسل", "Download Excel")}
      </button>
      {canEdit && (
        <>
          <button className="btn btn-sm" onClick={() => file.current?.click()}>
            <IconUp size={15} /> {t("رفع إكسل", "Upload Excel")}
          </button>
          <input
            ref={file}
            type="file"
            accept=".xlsx"
            style={{ display: "none" }}
            onChange={(e) => {
              void pick(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </>
      )}
      {msg && <span className="op-xmsg">{msg}</span>}

      {plan && (
        <div className="modal-overlay" onClick={() => setPlan(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="m-h">
              <h3>{t("تحديث الخطة من الملف", "Update from file")}</h3>
              <button className="mx" onClick={() => setPlan(null)} aria-label="close">✕</button>
            </div>
            <div className="op-xsum">
              <b>{plan.put.filter((x) => !x.add).length}</b> {t("بنداً سيُحدَّث", "updated")} ·{" "}
              <b>{plan.put.filter((x) => x.add).length}</b> {t("بنداً جديداً", "new")} ·{" "}
              <b>{plan.same}</b> {t("بلا تغيير", "unchanged")}
            </div>
            <div className="op-xlist">
              {plan.put.slice(0, 40).map((x) => (
                <div className="r" key={x.id}>
                  <i className={x.add ? "add" : ""} />
                  <span>{x.name}</span>
                  <em>{x.add ? t("جديد", "new") : t("تحديث", "update")}</em>
                </div>
              ))}
              {plan.put.length > 40 && (
                <div className="r more">{t(`و${plan.put.length - 40} غيرها…`, "…")}</div>
              )}
            </div>
            {plan.skipped.length > 0 && (
              <div className="op-err">{plan.skipped.slice(0, 5).join(" · ")}</div>
            )}
            <p className="muted" style={{ fontSize: 11, lineHeight: 1.8 }}>
              {t(
                "الرفع لا يحذف شيئاً: بندٌ غائبٌ عن الملف يبقى كما هو في المنصة. والمطابقة بعمود «المعرّف»، فإن حُذف فبـ«المحفظة + البند».",
                "Upload never deletes; rows are matched by id, else by portfolio + item.",
              )}
            </p>
            <div className="m-f">
              <button className="btn btn-ghost" onClick={() => setPlan(null)}>{t("إلغاء", "Cancel")}</button>
              <button className="btn" disabled={busy} onClick={() => void run()}>
                {busy ? t("يُحدَّث…", "Updating…") : t("تحديث الخطة", "Update")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------- بطاقة بند ---------------- */
function OpCard({
  r, canEdit, t, onEdit,
}: {
  r: { id: string; ord: number; data: Rec; updatedAt?: string };
  canEdit: boolean;
  t: T;
  onEdit: () => void;
}) {
  const d = r.data;
  const kind = txt(d.kind);
  const qs = quarters(d);
  const ok = onTrack(d);
  const st = opStatus(d);
  const unit = txt(d.unit) === "عدد" ? "" : "٪";

  return (
    <div className={`op-it ${ok === false ? "off" : ""}`}>
      <span className="t">{txt(d.name)}</span>
      <div className="mt">
        <em>
          {t("الراعي", "Sponsor")} <b>{txt(d.sponsor) || "—"}</b>
        </em>
        {has(d.assignee) && (
          <em>
            {t("المسؤول", "Owner")} <b>{txt(d.assignee)}</b>
          </em>
        )}
        {kind === "kpi" && num(d.level) > 0 && <span className="chip nw">{LEVELS[num(d.level)]}</span>}
        {kind === "init" && has(d.itype) && <span className="chip go">{txt(d.itype)}</span>}
        {st && <span className={`chip ${opTone(st)}`}>{st}</span>}
        {has(d.contributor) && (
          <span className="chip ct" title={t("مساهمة من محفظة موظف", "From a portfolio")}>
            {t(`مساهمة · ${txt(d.contributor)}`, txt(d.contributor))}
          </span>
        )}
        {canEdit && (
          <button className="op-pen" title={t("تعديل", "Edit")} onClick={onEdit}>
            ✎
          </button>
        )}
      </div>

      {kind === "kpi" && (
        <>
          <div className="q4">
            {qs.map((q, i) => {
              const cls = q.a === null ? "" : q.t === null ? "ok" : q.a >= q.t ? "ok" : "bad";
              return (
                <span className={cls} key={i}>
                  Q{i + 1} {q.a === null ? "—" : `${q.a}${unit}`}
                </span>
              );
            })}
          </div>
          {has(d.yearTarget) && (
            <div className="yt">
              {t("المستهدف العام", "Year target")} <b>{num(d.yearTarget)}{unit}</b>
            </div>
          )}
        </>
      )}
      {(has(d.start) || has(d.end)) && (
        <div className="op-dt">
          <span>{t("البداية", "Start")} <b>{txt(d.start) || "—"}</b></span>
          <i />
          <span>{t("النهاية", "End")} <b>{txt(d.end) || "—"}</b></span>
        </div>
      )}
      {has(d.note) && (
        <div className="op-nt">
          {txt(d.note)}
          {(() => {
            const a = agoOf(r.updatedAt);
            return a ? (
              <em className={a.stale ? "old" : ""}>
                {t(`آخر تحديث ${a.txt}`, `Updated ${a.txt}`)}
              </em>
            ) : null;
          })()}
        </div>
      )}
    </div>
  );
}

/* ---------------- نافذة التعديل ---------------- */
function OpEdit({
  it, t, owners, onClose, onSave, onDelete,
}: {
  it: Item;
  t: T;
  owners: string[];
  onClose: () => void;
  onSave: (d: Rec) => Promise<string | null>;
  /** حذف بندٍ سقط من الخطة — التراجع يعيده من شريط ↩ */
  onDelete: () => Promise<string | null>;
}) {
  const [f, setF] = useState<Rec>({ ...(it.data as Rec) });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const kind = txt(f.kind);
  const set = (k: string, v: unknown) => setF((o) => ({ ...o, [k]: v }));
  const numOrDel = (k: string, v: string) =>
    setF((o) => {
      const n = { ...o };
      if (v.trim() === "") delete n[k];
      else n[k] = Number(v);
      return n;
    });

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="m-h">
          <h3>{t("تعديل بند الخطة", "Edit item")}</h3>
          <button className="mx" onClick={onClose} aria-label="close">✕</button>
        </div>

        <div className="op-f">
          <label className="wide">
            <span>{t("البند", "Item")}</span>
            <textarea rows={2} value={txt(f.name)} onChange={(e) => set("name", e.target.value)} />
          </label>
          <label>
            <span>{t("المحفظة", "Portfolio")}</span>
            <select value={txt(f.owner)} onChange={(e) => set("owner", e.target.value)}>
              {owners.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          </label>
          <label>
            <span>{t("الراعي", "Sponsor")}</span>
            <input value={txt(f.sponsor)} onChange={(e) => set("sponsor", e.target.value)} />
          </label>
          <label className="wide">
            <span>{t("المسؤول", "Responsible")}</span>
            <input value={txt(f.assignee)} onChange={(e) => set("assignee", e.target.value)} />
          </label>

          {kind === "kpi" && (
            <>
              <label>
                <span>{t("المستوى", "Level")}</span>
                <select value={num(f.level, 1)} onChange={(e) => set("level", Number(e.target.value))}>
                  {[1, 2, 3].map((n) => (
                    <option key={n} value={n}>{LEVELS[n]}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>{t("الوحدة", "Unit")}</span>
                <select value={txt(f.unit) || "%"} onChange={(e) => set("unit", e.target.value)}>
                  <option value="%">٪</option>
                  <option value="عدد">{t("عدد", "count")}</option>
                </select>
              </label>
              <label>
                <span>{t("المستهدف العام", "Year target")}</span>
                <input type="number" value={has(f.yearTarget) ? num(f.yearTarget) : ""}
                       onChange={(e) => numOrDel("yearTarget", e.target.value)} />
              </label>
            </>
          )}
          {kind === "init" && (
            <label>
              <span>{t("نوع المبادرة", "Type")}</span>
              <select value={txt(f.itype)} onChange={(e) => set("itype", e.target.value)}>
                {INIT_TYPES.map((x) => (
                  <option key={x} value={x}>{x}</option>
                ))}
              </select>
            </label>
          )}
          <label>
            <span>{t("الحالة", "Status")}</span>
            <select value={txt(f.status)} onChange={(e) => set("status", e.target.value)}>
              <option value="">
                {kind === "kpi" ? t("تلقائي من الأرباع", "Auto") : t("— اختر —", "— pick —")}
              </option>
              {OP_STATUSES.map((x) => (
                <option key={x} value={x}>{x}</option>
              ))}
            </select>
          </label>
        </div>

        {kind === "kpi" && (
          <>
            <div className="op-qh">{t("مستهدف وفعلي كل ربع — الفراغ يعني لم يُدخَل بعد", "Quarterly")}</div>
            <div className="op-q">
              {[1, 2, 3, 4].map((i) => (
                <div className="r" key={i}>
                  <b>Q{i}</b>
                  <label>
                    <span>{t("المستهدف", "Target")}</span>
                    <input type="number" value={has(f[`q${i}t`]) ? num(f[`q${i}t`]) : ""}
                           onChange={(e) => numOrDel(`q${i}t`, e.target.value)} />
                  </label>
                  <label>
                    <span>{t("الفعلي", "Actual")}</span>
                    <input type="number" value={has(f[`q${i}a`]) ? num(f[`q${i}a`]) : ""}
                           onChange={(e) => numOrDel(`q${i}a`, e.target.value)} />
                  </label>
                </div>
              ))}
            </div>
          </>
        )}

        <div className="op-f">
          <label>
            <span>{t("تاريخ البداية", "Start")}</span>
            <input
              value={txt(f.start)}
              placeholder={t("مثال: 1 يناير 2026م", "e.g. Jan 2026")}
              onChange={(e) => set("start", e.target.value)}
            />
          </label>
          <label>
            <span>{t("تاريخ النهاية", "End")}</span>
            <input
              value={txt(f.end)}
              placeholder={t("مثال: 31 ديسمبر 2026م", "e.g. Dec 2026")}
              onChange={(e) => set("end", e.target.value)}
            />
          </label>
        </div>

        <label className="op-note">
          <span>{t("حالة المساهمة", "Progress")}</span>
          <textarea rows={3} value={txt(f.note)} onChange={(e) => set("note", e.target.value)} />
        </label>

        {err && <div className="op-err">{err}</div>}
        <div className="m-f">
          <button
            className="btn btn-del"
            disabled={busy}
            onClick={async () => {
              if (!confirm(t(`حذف «${txt(it.data.name)}» من الخطة؟`, "Delete this item?"))) return;
              setBusy(true);
              const e = await onDelete();
              setBusy(false);
              if (e) setErr(e);
            }}
          >
            🗑 {t("حذف البند", "Delete")}
          </button>
          <button className="btn btn-ghost" onClick={onClose}>{t("إلغاء", "Cancel")}</button>
          <button
            className="btn"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const e = await onSave(f);
              setBusy(false);
              if (e) setErr(e);
            }}
          >
            {t("حفظ", "Save")}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- بطاقة «نظرة عامة» ---------------- */
export function OpPlanCard({ t, onOpen }: { t: T; onOpen: () => void }) {
  const { items, loaded } = useItems("opplan");
  const rows = useMemo(() => items.map((x) => opFix(x.data as Rec)), [items]);
  if (!loaded || !rows.length) return null;

  const of = (k: string) => rows.filter((d) => txt(d.kind) === k);
  const kpis = of("kpi");
  const good = kpis.filter((d) => onTrack(d) === true).length;
  const bad = kpis.filter((d) => onTrack(d) === false).length;
  const stOf = (k: string, s: string) => of(k).filter((d) => opStatus(d) === s).length;
  const perOwner = OP_OWNERS.map((o) => ({ o, n: rows.filter((d) => txt(d.owner) === o).length }));

  return (
    <div className="op-card" onClick={onOpen} role="button" tabIndex={0}
         onKeyDown={(e) => e.key === "Enter" && onOpen()}>
      <div className="h">
        <h3>{t("الخطة التشغيلية 2026م", "Operational plan 2026")}</h3>
        <span>{t("↩ اضغط للتفاصيل", "Open")}</span>
      </div>
      <div className="n3">
        <div className="k" style={{ ["--c" as string]: KIND_COLOR.kpi }}>
          <b>{kpis.length}</b>
          <span>{t("مؤشراً", "KPIs")}</span>
          <em>{t(`${good} على المسار · ${bad} دون المستهدف`, `${good} on track`)}</em>
        </div>
        <div className="k" style={{ ["--c" as string]: KIND_COLOR.init }}>
          <b>{of("init").length}</b>
          <span>{t("مبادرة", "Initiatives")}</span>
          <em>
            {t(
              `${stOf("init", "مكتملة")} مكتملة · ${stOf("init", "على المسار")} على المسار · ${stOf("init", "متأخرة")} متأخرة`,
              `${stOf("init", "مكتملة")} done`,
            )}
          </em>
        </div>
        <div className="k" style={{ ["--c" as string]: KIND_COLOR.win }}>
          <b>{of("win").length}</b>
          <span>{t("مكاسب سريعة", "Quick wins")}</span>
          <em>
            {t(
              `${stOf("win", "مكتملة")} مكتملة · ${stOf("win", "على المسار")} على المسار · ${stOf("win", "متأخرة")} متأخرة`,
              `${stOf("win", "مكتملة")} done`,
            )}
          </em>
        </div>
      </div>
      <div className="pp">
        {perOwner.map(({ o, n }) => (
          <span className="p" key={o}>
            <i style={{ background: (OWNER_COLOR[o] || "#4e615c") + "1f", color: OWNER_COLOR[o] || "#4e615c" }}>
              {short(o)}
            </i>
            <span>{last(o)}</span>
            <em>{n}</em>
          </span>
        ))}
      </div>
    </div>
  );
}
