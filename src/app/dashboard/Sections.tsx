"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";

/* ============================================================
   الأقسام الخمسة المتفرّعة من المؤشرات التفصيلية:
     جلسات مراجعة الأداء · الاستراتيجيات الوطنية ·
     الاستراتيجيات المؤسسية · المخرجات الوطنية · المشاريع

   كلها تقرأ من جدول واحد (perf_items) والمحتوى في عمود jsonb،
   لأن حقول كل قسم لم تُحسم بعد — فتغييرها لاحقاً لا يحتاج ترحيلاً.
   لكل قسم كتلة مختصرة في «نظرة عامة» وصفحة كاملة في القائمة.
   ============================================================ */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Rec = Record<string, any>;
export type Item = { id: string; ord: number; data: Rec; updatedAt?: string; updatedBy?: string };

export type SectionKey = "sessions" | "natstrat" | "inststrat" | "outputs" | "projects";

export const SECTION_TITLE: Record<SectionKey, [string, string]> = {
  sessions: ["جلسات مراجعة الأداء", "Performance review sessions"],
  natstrat: ["الاستراتيجيات الوطنية", "National strategies"],
  inststrat: ["الاستراتيجيات المؤسسية", "Institutional strategies"],
  outputs: ["المخرجات الوطنية", "National outputs"],
  projects: ["المشاريع الاستراتيجية", "Strategic projects"],
};

/* مراحل المسار — مبدئية حتى تعتمدها الإدارة المعنية */
const SESS_STAGES = ["تحديد الجهة", "طلب البيانات", "تحليل الأداء", "إعداد العرض", "عقد الجلسة"];
const NAT_STAGES = ["إعداد الاستراتيجية", "المراجعة الفنية", "معالجة الملاحظات", "الاعتماد", "تفعيل القياس"];
const INST_STAGES = ["وصلت المركز", "قيد المراجعة", "معالجة الملاحظات", "اعتُمدت", "فُعِّل القياس"];

const AR = (n: number | string) => String(n).replace(/[0-9]/g, (d) => "٠١٢٣٤٥٦٧٨٩"[Number(d)]);
const numOf = (v: unknown, dflt = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
};

/* ---------------- تحميل بنود قسم ---------------- */
export function useItems(section: SectionKey, enabled = true) {
  const [items, setItems] = useState<Item[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!enabled) return;
    const r = await apiFetch(`/api/items?section=${section}`);
    const d = await r.json().catch(() => ({}));
    if (!r.ok) setError(d.error || "تعذّر تحميل البيانات");
    setItems(Array.isArray(d.items) ? d.items : []);
    setLoaded(true);
  }, [section, enabled]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(
    async (id: string, data: Rec, ord: number) => {
      const r = await apiFetch("/api/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ section, id, data, ord }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return d.error || "تعذّر الحفظ";
      await load();
      return null;
    },
    [section, load],
  );

  const remove = useCallback(
    async (id: string) => {
      const r = await apiFetch(`/api/items?section=${section}&id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!r.ok) return "تعذّر الحذف";
      await load();
      return null;
    },
    [section, load],
  );

  return { items, loaded, error, reload: load, save, remove };
}

/* ---------------- قطع مشتركة ---------------- */

function Flow({ stages, done, dates }: { stages: string[]; done: number; dates?: string[] }) {
  return (
    <div className="sx-flow">
      {stages.map((s, i) => {
        const state = i < done ? "ok" : i === done ? "now" : "";
        const d = dates?.[i] || "";
        return (
          <div
            key={s + i}
            className={`sx-st ${state}`}
            title={d ? `${s} — ${d}` : s}
          >
            <div className="d">{i < done ? "✓" : AR(i + 1)}</div>
            <div className="t">{s}</div>
          </div>
        );
      })}
    </div>
  );
}

function MoreBtn({ n, on, set, t }: { n: number; on: boolean; set: (v: boolean) => void; t: (a: string, e: string) => string }) {
  if (n <= 0) return null;
  return (
    <button className="sx-more" onClick={() => set(!on)}>
      {on ? t("عرض أقل", "Show less") : `${t("عرض الكل", "Show all")} (${AR(n)})`}
    </button>
  );
}

function Empty({ title, note }: { title: string; note: string }) {
  return (
    <div className="sx-empty">
      <div className="ic">◻</div>
      <h3>{title}</h3>
      <p>{note}</p>
    </div>
  );
}

/* شريط مخطط/فعلي: التعبئة هي الفعلي وعلامة سوداء لموقع المخطط */
function PlanBar({ planned, actual }: { planned: number; actual: number }) {
  const g = actual - planned;
  return (
    <div className="sx-dual">
      <div className="bar">
        <i style={{ width: `${Math.max(0, Math.min(100, actual))}%` }} />
        <u style={{ insetInlineStart: `${Math.max(0, Math.min(100, planned))}%` }} />
      </div>
      <div className="lg">
        <span>
          الفعلي <b>{AR(actual)}٪</b>
        </span>
        <span>
          المخطط <b>{AR(planned)}٪</b>
        </span>
        <span className={`sx-gap ${g < 0 ? "neg" : "pos"}`}>
          {g < 0 ? `متأخر ${AR(Math.abs(g))}٪` : `متقدم ${AR(g)}٪`}
        </span>
      </div>
    </div>
  );
}

/* ============================================================
   ١) جلسات مراجعة الأداء
   ============================================================ */
function sessStages(d: Rec): { names: string[]; dates: string[] } {
  const raw = Array.isArray(d.stages) ? d.stages : [];
  const names = raw.length ? raw.map((x: Rec) => String(x.n || "")) : SESS_STAGES;
  const dates = raw.map((x: Rec) => String(x.d || ""));
  return { names, dates };
}

function SessRow({ it }: { it: Item }) {
  const { names, dates } = sessStages(it.data);
  const done = Math.max(0, Math.min(names.length, numOf(it.data.done)));
  const pct = names.length ? Math.round((done / names.length) * 100) : 0;
  return (
    <div className="sx-row sess">
      <div className="sx-tile">
        <b>{AR(pct)}٪</b>
        <span>{`${AR(done)} من ${AR(names.length)}`}</span>
      </div>
      <div className="sx-bd">
        <div className="sx-h">
          <b>{String(it.data.entity || "—")}</b>
          <span className="sx-mini">{String(it.data.quarter || "")}</span>
        </div>
        <Flow stages={names} done={done} dates={dates} />
      </div>
    </div>
  );
}

export function Sessions({
  limit,
  t,
  onMore,
}: {
  limit?: number;
  t: (a: string, e: string) => string;
  onMore?: () => void;
}) {
  const { items, loaded } = useItems("sessions");
  const [all, setAll] = useState(false);
  const shown = limit && !all ? items.slice(0, limit) : items;
  const doneAll = items.filter((i) => {
    const { names } = sessStages(i.data);
    return numOf(i.data.done) >= names.length && names.length > 0;
  }).length;

  if (!loaded) return <div className="empty">{t("جارٍ التحميل...", "Loading...")}</div>;
  if (!items.length)
    return (
      <Empty
        title={t("لا توجد جلسات بعد", "No sessions yet")}
        note={t("تُضاف الجهات ومراحل جلساتها من زر «إضافة».", "Add entities and their session stages.")}
      />
    );

  return (
    <>
      <div className="sx-nums three">
        <div className="sx-tot">
          <b>{AR(items.length)}</b>
          <span>{t("جهات هذا الربع", "Entities this quarter")}</span>
        </div>
        <div className="sx-nc">
          <div className="t">{t("عُقدت جلستها", "Sessions held")}</div>
          <b>{AR(doneAll)}</b>
          <div className="s">{`${t("من أصل", "of")} ${AR(items.length)}`}</div>
        </div>
        <div className="sx-nc g">
          <div className="t">{t("قيد التحضير", "In preparation")}</div>
          <b>{AR(items.length - doneAll)}</b>
          <div className="s">{t("لم تُعقد بعد", "Not held yet")}</div>
        </div>
      </div>
      <div className="sx-rows">
        {shown.map((it) => (
          <SessRow key={it.id} it={it} />
        ))}
      </div>
      {limit && items.length > limit && (
        onMore ? (
          <button className="sx-more" onClick={onMore}>
            {`${t("عرض الكل", "Show all")} (${AR(items.length)})`}
          </button>
        ) : (
          <MoreBtn n={items.length} on={all} set={setAll} t={t} />
        )
      )}
    </>
  );
}

/* ============================================================
   ٢،٣) الاستراتيجيات — الوطنية والمؤسسية (نفس الشكل، مراحل مختلفة)
   ============================================================ */
function StratRow({ it, stages }: { it: Item; stages: string[] }) {
  const d = it.data;
  const stage = Math.max(0, Math.min(stages.length, numOf(d.stage)));
  return (
    <div className="sx-row">
      <div className="sx-bd">
        <div className="sx-h">
          <b>{String(d.name || "—")}</b>
          <span className="sx-own">{String(d.owner || "")}</span>
          <span className="sx-mini">
            {`${AR(numOf(d.goals))} ${"أهداف"} · ${AR(numOf(d.kpis))} ${"مؤشراً"}`}
          </span>
          {d.status ? <span className="sx-pill">{String(d.status)}</span> : null}
          <span className="sx-up">{String(d.updated || (it.updatedAt || "").slice(0, 10))}</span>
        </div>
        <Flow stages={stages} done={stage} />
        {d.note ? <div className="sx-note">{String(d.note)}</div> : null}
      </div>
    </div>
  );
}

export function Strategies({
  section,
  limit,
  t,
  onMore,
}: {
  section: "natstrat" | "inststrat";
  limit?: number;
  t: (a: string, e: string) => string;
  onMore?: () => void;
}) {
  const stages = section === "natstrat" ? NAT_STAGES : INST_STAGES;
  const { items, loaded } = useItems(section);
  const [all, setAll] = useState(false);
  const shown = limit && !all ? items.slice(0, limit) : items;

  const arrived = items.filter((i) => numOf(i.data.stage) >= 1).length;
  const live = items.filter((i) => numOf(i.data.stage) >= stages.length).length;

  if (!loaded) return <div className="empty">{t("جارٍ التحميل...", "Loading...")}</div>;
  if (!items.length)
    return (
      <Empty
        title={t("لا توجد استراتيجيات بعد", "Nothing yet")}
        note={t("تُضاف الاستراتيجيات وحالتها من زر «إضافة».", "Add strategies and their stage.")}
      />
    );

  return (
    <>
      <div className="sx-nums three">
        <div className="sx-tot">
          <b>{AR(items.length)}</b>
          <span>{section === "natstrat" ? t("استراتيجية وطنية", "National") : t("استراتيجية مؤسسية", "Institutional")}</span>
        </div>
        <div className="sx-nc">
          <div className="t">{section === "natstrat" ? t("قيد العمل", "In progress") : t("وصلت المركز", "Received")}</div>
          <b>{AR(arrived)}</b>
          <div className="s">{`${t("من أصل", "of")} ${AR(items.length)}`}</div>
          <div className="sx-prog">
            <i style={{ width: `${items.length ? (arrived / items.length) * 100 : 0}%` }} />
          </div>
        </div>
        <div className="sx-nc g">
          <div className="t">{t("فُعِّل قياسها", "Measurement live")}</div>
          <b>{AR(live)}</b>
          <div className="s">{`${t("من أصل", "of")} ${AR(items.length)}`}</div>
          <div className="sx-prog">
            <i className="g" style={{ width: `${items.length ? (live / items.length) * 100 : 0}%` }} />
          </div>
        </div>
      </div>
      <div className="sx-rows">
        {shown.map((it) => (
          <StratRow key={it.id} it={it} stages={stages} />
        ))}
      </div>
      {limit && items.length > limit && (
        onMore ? (
          <button className="sx-more" onClick={onMore}>
            {`${t("عرض الكل", "Show all")} (${AR(items.length)})`}
          </button>
        ) : (
          <MoreBtn n={items.length} on={all} set={setAll} t={t} />
        )
      )}
    </>
  );
}

/* ============================================================
   ٥) المشاريع الاستراتيجية
   ============================================================ */
export function Projects({ t }: { t: (a: string, e: string) => string }) {
  const { items, loaded } = useItems("projects");
  if (!loaded) return <div className="empty">{t("جارٍ التحميل...", "Loading...")}</div>;
  if (!items.length)
    return (
      <Empty
        title={t("لا توجد مشاريع بعد", "No projects yet")}
        note={t("يُضاف المشروع ونسبتا التقدم من زر «إضافة».", "Add a project and its progress.")}
      />
    );
  return (
    <div className="sx-pjs">
      {items.map((it) => {
        const d = it.data;
        const planned = numOf(d.planned);
        const actual = numOf(d.actual);
        const g = actual - planned;
        // مشروع لم تصل بياناته بعد: لا نعرض «متقدم ٠٪» بل نقول ذلك صراحةً
        const blank = planned === 0 && actual === 0;
        return (
          <div className="sx-pj" key={it.id}>
            <div className="tile">
              <b>{AR(actual)}٪</b>
              <span>{t("الإنجاز الفعلي", "Actual")}</span>
              <em>{`${t("المخطط", "Planned")} ${AR(planned)}٪`}</em>
              {blank ? (
                <span className="sx-gap wait">{t("بانتظار البيانات", "Awaiting data")}</span>
              ) : (
                <span className={`sx-gap ${g < 0 ? "neg" : "pos"}`}>
                  {g < 0 ? `متأخر ${AR(Math.abs(g))}٪` : `متقدم ${AR(g)}٪`}
                </span>
              )}
            </div>
            <div className="bd">
              <h4>{String(d.name || "—")}</h4>
              <div className="meta">
                {d.status ? <span className="sx-pill">{String(d.status)}</span> : null}
                {d.period ? <span className="m">{String(d.period)}</span> : null}
                {numOf(d.months) > 0 ? (
                  <span className="m">{`· ${t("الشهر", "Month")} ${AR(numOf(d.elapsed))} ${t("من", "of")} ${AR(numOf(d.months))}`}</span>
                ) : null}
              </div>
              <div className="br pl">
                <div className="lb">
                  <span>{t("المخطط", "Planned")}</span>
                  <b>{AR(planned)}٪</b>
                </div>
                <div className="bar">
                  <i style={{ width: `${Math.max(0, Math.min(100, planned))}%` }} />
                </div>
              </div>
              <div className="br ac">
                <div className="lb">
                  <span>{t("الفعلي", "Actual")}</span>
                  <b>{AR(actual)}٪</b>
                </div>
                <div className="bar">
                  <i style={{ width: `${Math.max(0, Math.min(100, actual))}%` }} />
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ============================================================
   ٤) المخرجات الوطنية — فاضية حتى يُعتمد محتواها
   ============================================================ */
export function Outputs({ t }: { t: (a: string, e: string) => string }) {
  return (
    <Empty
      title={t("الصفحة قيد الإعداد", "Under preparation")}
      note={t(
        "بانتظار تحديد محتوى المخرجات الوطنية من الإدارة المعنية — وسيُضاف الجدول والتفاصيل بعد اعتماد البيانات.",
        "Awaiting the content of national outputs.",
      )}
    />
  );
}

/* ============================================================
   الصفحات الكاملة — نفس الكتل بلا حدّ صفوف، مع التحرير
   ============================================================ */
export function SectionPage({
  section,
  canEdit,
  t,
}: {
  section: SectionKey;
  canEdit: boolean;
  t: (a: string, e: string) => string;
}) {
  const [editing, setEditing] = useState<Item | "new" | null>(null);
  const [nonce, setNonce] = useState(0);

  if (section === "outputs") return <Outputs t={t} />;

  return (
    <div key={nonce}>
      {canEdit && (
        <div className="sx-tools">
          <button className="btn btn-sm" onClick={() => setEditing("new")}>
            {t("إضافة", "Add")}
          </button>
        </div>
      )}
      {section === "sessions" && <Sessions t={t} />}
      {(section === "natstrat" || section === "inststrat") && <Strategies section={section} t={t} />}
      {section === "projects" && <Projects t={t} />}

      {canEdit && <ItemsEditor section={section} t={t} onChanged={() => setNonce((n) => n + 1)} />}

      {editing && (
        <ItemForm
          section={section}
          item={editing === "new" ? null : editing}
          t={t}
          onClose={(changed) => {
            setEditing(null);
            if (changed) setNonce((n) => n + 1);
          }}
        />
      )}
    </div>
  );
}

/* جدول تحرير مبسّط أسفل الصفحة — لمن يملك «تحرير بيانات هذه الأقسام» */
function ItemsEditor({
  section,
  t,
  onChanged,
}: {
  section: SectionKey;
  t: (a: string, e: string) => string;
  onChanged: () => void;
}) {
  const { items, loaded, remove, reload } = useItems(section);
  const [edit, setEdit] = useState<Item | null>(null);
  if (!loaded || !items.length) return null;
  return (
    <>
      <h3 className="sx-sub">{t("تحرير البنود", "Edit items")}</h3>
      <div className="sx-edit">
        {items.map((it) => (
          <div className="sx-erow" key={it.id}>
            <span className="n">{String(it.data.name || it.data.entity || it.id)}</span>
            <button className="btn btn-ghost btn-sm" onClick={() => setEdit(it)}>
              {t("تعديل", "Edit")}
            </button>
            <button
              className="btn btn-danger btn-sm"
              onClick={async () => {
                if (!confirm(t("حذف هذا البند نهائياً؟", "Delete permanently?"))) return;
                await remove(it.id);
                onChanged();
              }}
            >
              {t("حذف", "Delete")}
            </button>
          </div>
        ))}
      </div>
      {edit && (
        <ItemForm
          section={section}
          item={edit}
          t={t}
          onClose={(changed) => {
            setEdit(null);
            if (changed) {
              void reload();
              onChanged();
            }
          }}
        />
      )}
    </>
  );
}

/* ---------------- نافذة إدخال/تعديل بند ---------------- */
type Field = { k: string; label: string; kind?: "num" | "text" | "date" };

const FIELDS: Record<Exclude<SectionKey, "outputs">, Field[]> = {
  sessions: [
    { k: "entity", label: "الجهة" },
    { k: "quarter", label: "الربع" },
    { k: "done", label: "عدد المراحل المكتملة", kind: "num" },
  ],
  natstrat: [
    { k: "name", label: "الاستراتيجية" },
    { k: "owner", label: "الجهة" },
    { k: "goals", label: "عدد الأهداف", kind: "num" },
    { k: "kpis", label: "عدد المؤشرات", kind: "num" },
    { k: "stage", label: "المرحلة (١..٥)", kind: "num" },
    { k: "status", label: "الحالة" },
    { k: "note", label: "ملاحظة" },
    { k: "updated", label: "آخر تحديث", kind: "date" },
  ],
  inststrat: [
    { k: "name", label: "الاستراتيجية" },
    { k: "owner", label: "الجهة" },
    { k: "goals", label: "عدد الأهداف", kind: "num" },
    { k: "kpis", label: "عدد المؤشرات", kind: "num" },
    { k: "stage", label: "المرحلة (١..٥)", kind: "num" },
    { k: "status", label: "الحالة" },
    { k: "updated", label: "آخر تحديث", kind: "date" },
  ],
  projects: [
    { k: "name", label: "اسم المشروع" },
    { k: "status", label: "الحالة" },
    { k: "planned", label: "نسبة التقدم المخطط ٪", kind: "num" },
    { k: "actual", label: "نسبة التقدم الفعلي ٪", kind: "num" },
    { k: "period", label: "الفترة" },
    { k: "months", label: "مدة المشروع (شهر)", kind: "num" },
    { k: "elapsed", label: "الشهر الحالي", kind: "num" },
  ],
};

function ItemForm({
  section,
  item,
  t,
  onClose,
}: {
  section: SectionKey;
  item: Item | null;
  t: (a: string, e: string) => string;
  onClose: (changed: boolean) => void;
}) {
  const fields = FIELDS[section as Exclude<SectionKey, "outputs">] || [];
  const [form, setForm] = useState<Rec>(() => ({ ...(item?.data || {}) }));
  const [stages, setStages] = useState<{ n: string; d: string }[]>(() => {
    if (section !== "sessions") return [];
    const raw = Array.isArray(item?.data?.stages) ? item!.data.stages : [];
    return raw.length
      ? raw.map((x: Rec) => ({ n: String(x.n || ""), d: String(x.d || "") }))
      : SESS_STAGES.map((n) => ({ n, d: "" }));
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const { save } = useItems(section, false);

  const id = useMemo(() => item?.id || "", [item]);

  async function submit() {
    setBusy(true);
    setErr("");
    const data: Rec = { ...form };
    for (const f of fields) if (f.kind === "num") data[f.k] = numOf(data[f.k]);
    if (section === "sessions") data.stages = stages;
    const e = await save(id, data, item?.ord ?? 100);
    setBusy(false);
    if (e) {
      setErr(e);
      return;
    }
    onClose(true);
  }

  return (
    <div className="modal-overlay" onClick={() => onClose(false)}>
      <div className="modal sx-modal" onClick={(e) => e.stopPropagation()}>
        <div className="m-h">
          <h3>{item ? t("تعديل بند", "Edit item") : t("بند جديد", "New item")}</h3>
          <button className="mx" onClick={() => onClose(false)} aria-label="close">
            ✕
          </button>
        </div>
        <div className="sx-form">
          {fields.map((f) => (
            <label key={f.k}>
              <span>{f.label}</span>
              <input
                type={f.kind === "num" ? "number" : "text"}
                value={form[f.k] ?? ""}
                placeholder={f.kind === "date" ? "YYYY-MM-DD" : ""}
                onChange={(e) => setForm({ ...form, [f.k]: e.target.value })}
              />
            </label>
          ))}
          {section === "sessions" && (
            <div className="sx-stages">
              <div className="hd">{t("المراحل وتواريخها", "Stages & dates")}</div>
              {stages.map((s, i) => (
                <div className="rw" key={i}>
                  <input
                    value={s.n}
                    onChange={(e) => {
                      const next = [...stages];
                      next[i] = { ...next[i], n: e.target.value };
                      setStages(next);
                    }}
                  />
                  <input
                    value={s.d}
                    placeholder="YYYY-MM-DD"
                    onChange={(e) => {
                      const next = [...stages];
                      next[i] = { ...next[i], d: e.target.value };
                      setStages(next);
                    }}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
        {err && <div className="alert alert-error">{err}</div>}
        <div className="m-f">
          <button className="btn btn-ghost" onClick={() => onClose(false)}>
            {t("إلغاء", "Cancel")}
          </button>
          <button className="btn" disabled={busy} onClick={submit}>
            {busy ? t("يُحفظ...", "Saving...") : t("حفظ", "Save")}
          </button>
        </div>
      </div>
    </div>
  );
}

export { PlanBar };
