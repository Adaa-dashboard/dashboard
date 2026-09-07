"use client";

/* ============================================================
   جهاتي — قائمة الجهات التي يتابعها الموظف، ولكل جهة مساهماتها.

   المساهمة سطرٌ يقول: هذه الجهة تساهم في ماذا (استراتيجية وطنية
   · رؤية ٢٠٣٠ · استراتيجية مؤسسية · مخرجات وطنية · مؤشرات التزام)
   وكم فيها من مؤشرات وأهداف ومبادرات. فالجهة الواحدة قد تساهم في
   أكثر من واحدة بأعداد مختلفة، ولذلك الأعداد على مستوى المساهمة
   لا الجهة.

   البيانات في قسم entities من محفظة الموظف — خاصة به وحده،
   وتُحفظ في perf_portfolio كما بقية بنود «محفظتي».
   ============================================================ */

import { useMemo, useState } from "react";
import type { Row } from "./Portfolio";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Rec = Record<string, any>;
type T = (ar: string, en: string) => string;

export const CONTRIB_KINDS = [
  "استراتيجية وطنية",
  "رؤية 2030",
  "استراتيجية مؤسسية",
  "مخرجات وطنية",
  "مؤشرات التزام",
] as const;

/** لون هادئ لكل نوع — للتمييز بلمحة لا للتزيين */
const KIND_TONE: Record<string, string> = {
  "استراتيجية وطنية": "#016b5f",
  "رؤية 2030": "#7a5cd1",
  "استراتيجية مؤسسية": "#1a9d5c",
  "مخرجات وطنية": "#2f7fd1",
  "مؤشرات التزام": "#c9a020",
  "غير مصنّف": "#9aa8a4",
};

export type Contrib = {
  id: string;
  kind: string;
  name: string;
  kpis: number;
  goals: number;
  inits: number;
  note: string;
};

const num = (v: unknown, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const txt = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/** مساهمات الجهة — والأعداد القديمة (kpis/initiatives) تظهر سطراً
    «غير مصنّف» فلا تضيع، ولا يُكتب في القاعدة شيء حتى يعدّل المستخدم */
export function contribsOf(d: Rec): Contrib[] {
  const raw = Array.isArray(d.contribs) ? d.contribs : null;
  if (raw)
    return raw.map((c: Rec) => ({
      id: txt(c.id) || newId(),
      kind: txt(c.kind),
      name: txt(c.name),
      kpis: num(c.kpis),
      goals: num(c.goals),
      inits: num(c.inits),
      note: txt(c.note),
    }));
  const legacyK = num(d.kpis);
  const legacyI = num(d.initiatives);
  if (!legacyK && !legacyI) return [];
  return [
    { id: "legacy", kind: "غير مصنّف", name: "", kpis: legacyK, goals: 0, inits: legacyI, note: "" },
  ];
}

export function sumOf(list: Contrib[]) {
  return list.reduce(
    (a, c) => ({ kpis: a.kpis + c.kpis, goals: a.goals + c.goals, inits: a.inits + c.inits }),
    { kpis: 0, goals: 0, inits: 0 },
  );
}

function Num({
  v,
  onChange,
  disabled,
}: {
  v: number;
  onChange: (n: number) => void;
  disabled?: boolean;
}) {
  return (
    <input
      className="en-n"
      type="number"
      min={0}
      value={v || ""}
      placeholder="0"
      disabled={disabled}
      onChange={(e) => onChange(num(e.target.value))}
    />
  );
}

export default function MyEntities({
  rows,
  t,
  canEdit = true,
  onSave,
  onDelete,
  onAdd,
}: {
  rows: Row[];
  t: T;
  canEdit?: boolean;
  onSave: (id: string, data: Rec) => void;
  onDelete: (id: string) => void;
  onAdd: (data: Rec) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");

  const per = useMemo(
    () => rows.map((r) => ({ row: r, list: contribsOf(r.data) })),
    [rows],
  );

  const totals = useMemo(() => sumOf(per.flatMap((x) => x.list)), [per]);
  const byKind = useMemo(() => {
    const m = new Map<string, number>();
    for (const x of per) for (const c of x.list) m.set(c.kind || "غير مصنّف", (m.get(c.kind || "غير مصنّف") || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [per]);

  /* كل تعديل يكتب المصفوفة كاملة — فالسطر «غير مصنّف» يتحوّل
     بياناتٍ حقيقية عند أول تعديل، ولا يُكتب شيء قبله */
  const patch = (r: Row, list: Contrib[]) =>
    onSave(r.id, { ...r.data, contribs: list });

  const addContrib = (r: Row, list: Contrib[]) =>
    patch(r, [
      ...list.map((c) => ({ ...c, id: c.id === "legacy" ? newId() : c.id })),
      { id: newId(), kind: CONTRIB_KINDS[0], name: "", kpis: 0, goals: 0, inits: 0, note: "" },
    ]);

  const setC = (r: Row, list: Contrib[], id: string, f: Partial<Contrib>) =>
    patch(
      r,
      list.map((c) => (c.id === id ? { ...c, ...f, id: c.id === "legacy" ? newId() : c.id } : { ...c, id: c.id === "legacy" ? newId() : c.id })),
    );

  const delC = (r: Row, list: Contrib[], id: string) =>
    patch(r, list.filter((c) => c.id !== id).map((c) => ({ ...c, id: c.id === "legacy" ? newId() : c.id })));

  return (
    <div className="en">
      <div className="en-sum">
        <div>
          <b>{rows.length}</b>
          <span>{t("جهة", "entities")}</span>
        </div>
        <div>
          <b>{totals.kpis}</b>
          <span>{t("مؤشراً", "KPIs")}</span>
        </div>
        <div>
          <b>{totals.goals}</b>
          <span>{t("هدفاً", "goals")}</span>
        </div>
        <div>
          <b>{totals.inits}</b>
          <span>{t("مبادرة", "initiatives")}</span>
        </div>
        {byKind.length > 0 && (
          <div className="en-kinds">
            {byKind.map(([k, n]) => (
              <span key={k} style={{ ["--c" as string]: KIND_TONE[k] || "#9aa8a4" }}>
                <em />
                {k} <b>{n}</b>
              </span>
            ))}
          </div>
        )}
      </div>

      {rows.length === 0 && (
        <div className="empty">
          {t("لا توجد جهات بعد — أضِف أول جهة من الأسفل.", "No entities yet — add the first below.")}
        </div>
      )}

      {per.map(({ row: r, list }) => {
        const s = sumOf(list);
        const open = openId === r.id;
        return (
          <div className={`en-c ${open ? "open" : ""}`} key={r.id}>
            <div className="en-h" onClick={() => setOpenId(open ? null : r.id)}>
              <span className="en-ar">{open ? "▾" : "◂"}</span>
              <b>{txt(r.data.name) || t("جهة بلا اسم", "Unnamed")}</b>
              <span className="en-t">{txt(r.data.type)}</span>
              <span className="en-m">
                {list.length} {t("مساهمة", "contributions")} · {s.kpis} {t("مؤشراً", "KPIs")} · {s.goals}{" "}
                {t("هدفاً", "goals")} · {s.inits} {t("مبادرة", "initiatives")}
              </span>
              {canEdit && (
                <span
                  className="en-x"
                  title={t("حذف الجهة", "Delete")}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(r.id);
                  }}
                >
                  ✕
                </span>
              )}
            </div>

            {open && (
              <div className="en-b">
                <div className="en-name">
                  <label>
                    {t("اسم الجهة", "Entity")}
                    <input
                      value={txt(r.data.name)}
                      disabled={!canEdit}
                      onChange={(e) => onSave(r.id, { ...r.data, name: e.target.value })}
                    />
                  </label>
                  <label>
                    {t("النوع", "Type")}
                    <select
                      value={txt(r.data.type)}
                      disabled={!canEdit}
                      onChange={(e) => onSave(r.id, { ...r.data, type: e.target.value })}
                    >
                      {["", "مؤسسية", "وطنية", "مناطقية", "برنامج"].map((o) => (
                        <option key={o} value={o}>
                          {o || t("بلا نوع", "—")}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                {list.length === 0 ? (
                  <div className="empty">
                    {t("لم تُسجَّل مساهمات لهذه الجهة بعد.", "No contributions recorded yet.")}
                  </div>
                ) : (
                  <div className="en-tblw">
                    <table className="en-tbl">
                      <thead>
                        <tr>
                          <th>{t("تساهم في", "Contributes to")}</th>
                          <th>{t("الاسم", "Name")}</th>
                          <th>{t("مؤشرات", "KPIs")}</th>
                          <th>{t("أهداف", "Goals")}</th>
                          <th>{t("مبادرات", "Initiatives")}</th>
                          <th>{t("ملاحظة", "Note")}</th>
                          {canEdit && <th />}
                        </tr>
                      </thead>
                      <tbody>
                        {list.map((c) => (
                          <tr key={c.id}>
                            <td data-l={t("تساهم في", "In")}>
                              <span className="en-dot" style={{ background: KIND_TONE[c.kind] || "#9aa8a4" }} />
                              <select
                                value={c.kind}
                                disabled={!canEdit}
                                onChange={(e) => setC(r, list, c.id, { kind: e.target.value })}
                              >
                                {[...CONTRIB_KINDS, ...(c.kind && !CONTRIB_KINDS.includes(c.kind as never) ? [c.kind] : [])].map(
                                  (o) => (
                                    <option key={o}>{o}</option>
                                  ),
                                )}
                              </select>
                            </td>
                            <td data-l={t("الاسم", "Name")}>
                              <input
                                value={c.name}
                                placeholder={t("اسم الاستراتيجية أو المخرج", "Name")}
                                disabled={!canEdit}
                                onChange={(e) => setC(r, list, c.id, { name: e.target.value })}
                              />
                            </td>
                            <td data-l={t("مؤشرات", "KPIs")}>
                              <Num v={c.kpis} disabled={!canEdit} onChange={(n) => setC(r, list, c.id, { kpis: n })} />
                            </td>
                            <td data-l={t("أهداف", "Goals")}>
                              <Num v={c.goals} disabled={!canEdit} onChange={(n) => setC(r, list, c.id, { goals: n })} />
                            </td>
                            <td data-l={t("مبادرات", "Initiatives")}>
                              <Num v={c.inits} disabled={!canEdit} onChange={(n) => setC(r, list, c.id, { inits: n })} />
                            </td>
                            <td data-l={t("ملاحظة", "Note")}>
                              <input
                                value={c.note}
                                disabled={!canEdit}
                                onChange={(e) => setC(r, list, c.id, { note: e.target.value })}
                              />
                            </td>
                            {canEdit && (
                              <td>
                                <button className="en-del" onClick={() => delC(r, list, c.id)} title={t("حذف", "Delete")}>
                                  ✕
                                </button>
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {canEdit && (
                  <button className="btn btn-ghost btn-sm" onClick={() => addContrib(r, list)}>
                    ＋ {t("إضافة مساهمة", "Add a contribution")}
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}

      {canEdit && (
        <div className="en-add">
          <input
            value={newName}
            placeholder={t("اسم جهة جديدة", "New entity name")}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newName.trim()) {
                onAdd({ name: newName.trim(), type: "", contribs: [] });
                setNewName("");
              }
            }}
          />
          <button
            className="btn btn-sm"
            disabled={!newName.trim()}
            onClick={() => {
              onAdd({ name: newName.trim(), type: "", contribs: [] });
              setNewName("");
            }}
          >
            ＋ {t("إضافة جهة", "Add entity")}
          </button>
        </div>
      )}
    </div>
  );
}
