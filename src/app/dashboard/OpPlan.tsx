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

import { useMemo, useState } from "react";
import { useItems, type Item, SECTION_TITLE } from "./Sections";

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
  "معاذ البقاص",
  "بدر الغنام",
  "عمر العتيق",
];
const OWNER_COLOR: Record<string, string> = {
  "عبدالله الحزامي": "#00584c",
  "دعاء الفهمي": "#016b5f",
  "معاذ البقاص": "#008b84",
  "بدر الغنام": "#0f8a8a",
  "عمر العتيق": "#1a9d5c",
};
const KIND_COLOR: Record<string, string> = { kpi: "#00584c", init: "#7a5cd1", win: "#c9a020" };
const KIND_LABEL: Record<string, [string, string]> = {
  kpi: ["المؤشرات", "KPIs"],
  init: ["المبادرات", "Initiatives"],
  win: ["المكاسب السريعة", "Quick wins"],
};
const LEVELS = ["", "مستوى أول", "مستوى ثانٍ", "مستوى ثالث"];
const INIT_TYPES = ["استراتيجية", "تشغيلية"];
const STATUSES = ["جديدة", "مستمرة", "مكتملة", "لم تبدأ"];
const ST_TONE: Record<string, string> = {
  مكتملة: "ok",
  مستمرة: "go",
  جديدة: "nw",
  "لم تبدأ": "no",
};

/** أحرف الاسم الأولى — وجهٌ صغير للمحفظة */
const short = (n: string) => {
  const w = n.trim().split(/\s+/);
  return ((w[0]?.[0] || "") + (w[1]?.[0] || "")).trim() || "؟";
};
/** آخر كلمة من الاسم — تكفي للتمييز في الشرائح الضيّقة */
const last = (n: string) => n.trim().split(/\s+/).slice(-1)[0] || n;

/* ---------- حالة المؤشر: آخر ربعٍ فيه فعلي، مقارناً بمستهدفه ---------- */
type QCell = { t: number | null; a: number | null };
function quarters(d: Rec): QCell[] {
  return [1, 2, 3, 4].map((i) => ({
    t: has(d[`q${i}t`]) ? num(d[`q${i}t`]) : null,
    a: has(d[`q${i}a`]) ? num(d[`q${i}a`]) : null,
  }));
}
/** آخر ربعٍ أُدخل فيه فعليّ — هو ما يُحكم به على المؤشر */
function lastQ(qs: QCell[]) {
  for (let i = qs.length - 1; i >= 0; i--) if (qs[i].a !== null) return { i, ...qs[i] };
  return null;
}
/** على المسار إن بلغ فعليُّه مستهدفَ ربعه — وبلا مستهدفٍ لا حكم */
function onTrack(d: Rec): boolean | null {
  const q = lastQ(quarters(d));
  if (!q || q.a === null) return null;
  if (q.t === null) return null;
  return q.a >= q.t;
}

export default function OpPlan({ t, canEdit }: { t: T; canEdit: boolean }) {
  const { items, loaded, save } = useItems("opplan");
  const [own, setOwn] = useState("");
  const [edit, setEdit] = useState<Item | null>(null);

  const rows = useMemo(() => items.map((x) => ({ ...x, data: x.data as Rec })), [items]);
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
      </div>

      {/* المحافظ — الضغط يفلتر الأعمدة الثلاثة على صاحبها */}
      <div className="op-pf">
        {owners.map((o) => (
          <button
            key={o}
            className={`c ${own === o ? "on" : ""}`}
            style={{ ["--c" as string]: OWNER_COLOR[o] || "#4e615c" }}
            onClick={() => setOwn(own === o ? "" : o)}
          >
            <span className="av">{short(o)}</span>
            <span className="nm">{o}</span>
            <span className="rl">
              {o === OP_OWNERS[0] ? t("مدير الإدارة", "Director") : t("مدير قطاع", "Sector manager")}
            </span>
            <span className="n3">
              {(["kpi", "init", "win"] as const).map((k) => (
                <span key={k}>
                  {t(KIND_LABEL[k][0], KIND_LABEL[k][1])} <b>{cnt(o, k)}</b>
                </span>
              ))}
            </span>
          </button>
        ))}
      </div>
      {own && (
        <div className="op-filt">
          {t(`معروضة محفظة: ${own}`, `Portfolio: ${own}`)}
          <button onClick={() => setOwn("")}>{t("عرض الجميع", "Show all")}</button>
        </div>
      )}

      <div className="op-3">
        {(["kpi", "init", "win"] as const).map((k) => (
          <div className="op-col" key={k} style={{ ["--c" as string]: KIND_COLOR[k] }}>
            <h3>
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
        />
      )}
    </div>
  );
}

/* ---------------- بطاقة بند ---------------- */
function OpCard({
  r, canEdit, t, onEdit,
}: {
  r: { id: string; ord: number; data: Rec };
  canEdit: boolean;
  t: T;
  onEdit: () => void;
}) {
  const d = r.data;
  const kind = txt(d.kind);
  const qs = quarters(d);
  const ok = onTrack(d);
  const st = txt(d.status);
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
        {st && <span className={`chip ${ST_TONE[st] || "nw"}`}>{st}</span>}
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
      {has(d.note) && <div className="op-nt">{txt(d.note)}</div>}
    </div>
  );
}

/* ---------------- نافذة التعديل ---------------- */
function OpEdit({
  it, t, owners, onClose, onSave,
}: {
  it: Item;
  t: T;
  owners: string[];
  onClose: () => void;
  onSave: (d: Rec) => Promise<string | null>;
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
          {kind !== "kpi" && (
            <label>
              <span>{t("الحالة", "Status")}</span>
              <select value={txt(f.status)} onChange={(e) => set("status", e.target.value)}>
                {STATUSES.map((x) => (
                  <option key={x} value={x}>{x}</option>
                ))}
              </select>
            </label>
          )}
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

        <label className="op-note">
          <span>{t("ملاحظات", "Notes")}</span>
          <textarea rows={2} value={txt(f.note)} onChange={(e) => set("note", e.target.value)} />
        </label>

        {err && <div className="op-err">{err}</div>}
        <div className="m-f">
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
  const rows = useMemo(() => items.map((x) => x.data as Rec), [items]);
  if (!loaded || !rows.length) return null;

  const of = (k: string) => rows.filter((d) => txt(d.kind) === k);
  const kpis = of("kpi");
  const good = kpis.filter((d) => onTrack(d) === true).length;
  const bad = kpis.filter((d) => onTrack(d) === false).length;
  const stOf = (k: string, s: string) => of(k).filter((d) => txt(d.status) === s).length;
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
              `${stOf("init", "مكتملة")} مكتملة · ${stOf("init", "مستمرة")} مستمرة · ${stOf("init", "لم تبدأ")} لم تبدأ`,
              `${stOf("init", "مكتملة")} done`,
            )}
          </em>
        </div>
        <div className="k" style={{ ["--c" as string]: KIND_COLOR.win }}>
          <b>{of("win").length}</b>
          <span>{t("مكاسب سريعة", "Quick wins")}</span>
          <em>
            {t(`${stOf("win", "جديدة")} جديدة · ${stOf("win", "مستمرة")} مستمرة`, `${stOf("win", "جديدة")} new`)}
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
