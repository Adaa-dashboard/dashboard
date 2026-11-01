"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { asset } from "@/lib/base";
import { commitStats, ownerMap, nrm } from "@/lib/commit";
import {
  crQuarters, crSectors, crLast, crPrevQ, crBand, crPick, crKindTotal, CR_TONE,
  type CrRow, type CrKind, type CrStat,
} from "@/lib/crq";
import { readDelimited, readXlsx } from "@/lib/sheet";
import { weekStartOf, shiftDays } from "@/lib/weeklyReport";
import { CR_ADAA_STAGE } from "@/lib/crSla";
import { mapRows } from "@/lib/crImport";

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

/** صيغة العدد العربية: طلب واحد · طلبان · ٣-١٠ طلبات · ما زاد طلباً */
function arReq(n: number): string {
  if (n === 1) return "طلب واحد";
  if (n === 2) return "طلبان";
  if (n <= 10) return `${n} طلبات`;
  return `${n} طلباً`;
}

/** جولة مراجعة مكتملة عند أداء */
export type CrRound = {
  id: string; code: string; owner: string; itemName: string;
  axis: string; kind: string; review: string;
  sla: number | null; days: number | null; onTime: boolean | null;
  arrivedAt: string; leftAt: string;
};

const Q_WORDS = ["الأول", "الثاني", "الثالث", "الرابع"];
const qOf = (iso: string) => {
  const m = Number(String(iso || "").slice(5, 7));
  return m ? `الربع ${Q_WORDS[Math.floor((m - 1) / 3)]} ${String(iso).slice(0, 4)}` : "";
};

/** تجميع الجولات في أرباع — الأحدث أولاً */
function roundQuarters(rounds: CrRound[]) {
  const by = new Map<string, { q: string; n: number; ok: number; days: number }>();
  for (const r of rounds) {
    if (r.onTime === null || r.days === null) continue;
    const q = qOf(r.leftAt);
    if (!q) continue;
    const a = by.get(q) || { q, n: 0, ok: 0, days: 0 };
    a.n++;
    if (r.onTime) a.ok++;
    a.days += r.days;
    by.set(q, a);
  }
  return [...by.values()]
    .map((a) => ({ ...a, pct: Math.round((a.ok / a.n) * 100), avg: Math.round((a.days / a.n) * 10) / 10 }))
    .sort((x, y) => (x.q < y.q ? 1 : -1));
}

export default function Changes({
  t,
  canEdit,
  canLink = false,
  mode = "page",
}: {
  t: (ar: string, en: string) => string;
  /** الرفع لمن يسحب الملف من المنصة · والبقية يقرؤون ويصدّرون */
  canEdit: boolean;
  /** مطابقة أسماء الجهات: لمن يحرّر الجهات أو يرفع الملف */
  canLink?: boolean;
  /**
   * `overview` موجزٌ في «نظرة عامة»: المنصّة وخطُّ الأشهر وحدهما.
   * `page` الصفحة الكاملة: الشريط فالمنصّة فالجدول فالأرباع
   * فالقطاعات. كان المكوّن يُعرض كاملاً في الموضعين، فيتكرّر
   * الجدول وأزرار الرفع في صفحتين.
   */
  mode?: "overview" | "page";
}) {
  const page = mode === "page";
  const [items, setItems] = useState<Change[]>([]);
  const [loaded, setLoaded] = useState(false);
  // الافتراضي: الطلبات المفتوحة. الشرائح الثلاث تفلتر داخلها فقط.
  const [filter, setFilter] = useState<Tone | null>(null);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  /* الاستشاري صاحب الطلب يُعرف من جهته: كل طلبٍ يحمل «الجهة المالكة»،
     وسجلّ الجهات يقول من نقطة تواصلها من المركز. فلا عمود جديد في
     ملف المنصة ولا إدخال يدوي. */
  const [ownerOf, setOwnerOf] = useState<Map<string, { name: string; photo: string }>>(new Map());
  /* جولات المراجعة المكتملة: كل مرّة دخل فيها طلبٌ قائمةَ أداء
     وخرج منها، بمدّتها واتفاقيتها. عليها يُحسب المؤشر. */
  const [rounds, setRounds] = useState<CrRound[]>([]);
  /* المدى الذي يُرتَّب عليه الاستشاريون — **الأسبوع افتراضاً**:
     الإدارة تقرأ أداءها أسبوعاً بأسبوع، والتراكم يخفي الحديث */
  const [span, setSpan] = useState<"week" | "quarter" | "all">("week");
  /* الاستشاري المفتوحة قائمته — الضغط على بطاقته يعرض جولاته */
  const [who, setWho] = useState<string>("");
  /* جهاتٌ نفى استشاريوها نسبتها إليهم — تُسقَط من الإسناد وتُعرض
     لمن يرفع الملف ليصحّح سجلّ الجهات */
  const [disown, setDisown] = useState<{ id: string; entity: string; user: string }[]>([]);
  /* سجلّ الجهات كاملاً — لنافذة مطابقة الأسماء غير المعروفة */
  type Ent = { id: string; name: string; sector?: string };
  const [ents, setEnts] = useState<Ent[]>([]);
  const [fixing, setFixing] = useState(false);
  const [pick, setPick] = useState<Record<string, string>>({});
  const [fixMsg, setFixMsg] = useState("");

  const loadEnts = useCallback(async () => {
    const [entRes, ppl, dis] = await Promise.all([
      apiFetch("/api/entities").then((x) => x.json()).catch(() => ({})),
      apiFetch("/api/people").then((x) => x.json()).catch(() => ({})),
      apiFetch("/api/cr/disown").then((x) => x.json()).catch(() => ({})),
    ]);
    const dl = Array.isArray(dis.disown) ? dis.disown : [];
    setDisown(dl);
    const dset = new Set<string>(dl.map((d: { entity: string; user: string }) => `${nrm(d.entity)}|${nrm(d.user)}`));
    const photo = new Map<string, string>();
    for (const u of Array.isArray(ppl.people) ? ppl.people : [])
      if (u?.name) photo.set(nrm(String(u.name)), String(u.photoUrl || ""));
    const list = Array.isArray(entRes.entities) ? entRes.entities : [];
    setEnts(list.map((e: Ent) => ({ id: String(e.id), name: String(e.name || ""), sector: e.sector })));
    setOwnerOf(ownerMap(list, photo, dset));
  }, []);

  const load = useCallback(async () => {
    const r = await apiFetch("/api/changes").then((x) => x.json());
    setItems(r.changes || []);
    setLoaded(true);
    /* الجولات المكتملة — مصدر نسبة الالتزام الحقيقية. تُقرأ بعد
       الطلبات فلا تؤخّر ظهور الجدول، وغيابها لا يكسر الصفحة */
    apiFetch("/api/cr/rounds")
      .then((x) => x.json())
      .then((d) => setRounds(Array.isArray(d.rounds) ? d.rounds : []))
      .catch(() => setRounds([]));
  }, []);

  /* النِّسب المُدخَلة: أرباعٌ وأشهرٌ وقطاعاتٌ مضت قبل أن تدخل
     المنصة، محفوظةٌ في `perf_items` تحت القسم نفسه. تُقرأ ولا
     تُعدَّل من هنا — وما بعدها يُحسب من الملف اليومي. */
  const [agg, setAgg] = useState<CrRow[]>([]);
  useEffect(() => {
    let on = true;
    void apiFetch("/api/items?section=changes")
      .then((x) => x.json())
      .then((d) => {
        if (on && Array.isArray(d.items)) setAgg(d.items as CrRow[]);
      })
      .catch(() => {});
    return () => {
      on = false;
    };
  }, []);

  const quarters = useMemo(() => crQuarters(agg, items), [agg, items]);

  /* القطاعات: الربع المختار، وافتراضُه آخر ربعٍ أُدخلت قطاعاته */
  const secQs = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of agg)
      if (String(r.data?.row || "") === "sec") {
        const q = String(r.data?.quarter || "").trim();
        if (q) seen.set(q, q);
      }
    return [...seen.values()].sort(
      (a, b) => quarters.findIndex((x) => x.label === a) - quarters.findIndex((x) => x.label === b),
    );
  }, [agg, quarters]);
  const [secQ, setSecQ] = useState("");
  /* نوع الطلبات المعروض في أعمدة القطاعات: الكل · رؤية 2030 ·
     الاستراتيجيات الوطنية — زرّان يقلبان العرض ويعيدانه */
  const [kind, setKind] = useState<CrKind>("");
  const curSecQ = secQ || secQs[secQs.length - 1] || "";
  const sectors = useMemo(
    () => (curSecQ ? crSectors(agg, curSecQ, crPrevQ(curSecQ)) : []),
    [agg, curSecQ],
  );

  /* هل للربع السابق أرقامٌ أصلاً في النوع المعروض؟ */
  const hasPrev = useMemo(
    () => sectors.some((x) => crPick(x.was, kind) !== null),
    [sectors, kind],
  );

  /* المربّعان ونسبةُ كلٍّ منهما على مستوى الربع — مرجَّحةً بعدد
     طلباته، فمجموعهما الموزون يساوي نسبة الربع نفسها */
  const kinds = useMemo(() => {
    const out: { k: CrKind; label: string; stat: CrStat }[] = [];
    for (const [k, label] of [
      ["v30", t("رؤية 2030", "Vision 2030")],
      ["nat", t("الاستراتيجيات الوطنية", "National strategies")],
    ] as [CrKind, string][]) {
      const stat = crKindTotal(sectors, k);
      if (stat) out.push({ k, label, stat });
    }
    return out;
  }, [sectors, t]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    void loadEnts();
  }, [loadEnts]);

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

  /* أسماء جهاتٍ في الملف لا تطابق السجلّ — طلباتها لا تُنسب لأحد */
  const unmatched = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of items) {
      if (c.status !== "open") continue;
      const nm = String(c.owner || "").trim();
      if (!nm || ownerOf.has(nrm(nm))) continue;
      m.set(nm, (m.get(nm) || 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [items, ownerOf]);

  async function linkAlias(alias: string, entityId: string) {
    setFixMsg("");
    const r = await apiFetch("/api/entities/alias", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entityId, alias }),
    }).then((x) => x.json()).catch(() => ({ error: "تعذّر الاتصال" }));
    if (r?.error) { setFixMsg(String(r.error)); return; }
    setPick((o) => ({ ...o, [alias]: "" }));
    await loadEnts();
  }

  /* الحسبة في `lib/commit.ts` — يشترك فيها هذا الجدول ومحفظة
     الموظف، فالرقم واحد في المكانين */
  /* الترتيب من **الجولات المكتملة** ما إن تتراكم — فهي المقياس
     الرسمي (مدّة الجولة مقابل اتفاقيتها). وقبلها يُرتَّب بلقطة
     الطلبات المفتوحة كما كان، فلا تبقى الصفحة بلا ترتيب. */
  /* جولات المدى المختار — يُحسب عليها الترتيب وتُعرض عند الضغط */
  const spanRounds = useMemo(() => {
    if (span === "all") return rounds;
    const today = new Date().toISOString().slice(0, 10);
    if (span === "week") {
      const a = weekStartOf(today);
      const b = shiftDays(a, 6);
      return rounds.filter((r) => r.leftAt >= a && r.leftAt <= b);
    }
    const q = qOf(today);
    return rounds.filter((r) => qOf(r.leftAt) === q);
  }, [rounds, span]);

  const tops = useMemo(
    () =>
      rounds.length
        ? commitStats(
            spanRounds.map((r) => ({ owner: r.owner, sla: r.sla, workDays: r.days })),
            ownerOf,
          )
        : commitStats(items, ownerOf),
    [items, rounds, spanRounds, ownerOf],
  );
  const qRows = useMemo(() => roundQuarters(rounds), [rounds]);
  /* جولات الاستشاري المفتوح — بالجهة المالكة كما في الترتيب */
  /* سطور نافذة الاستشاري: من الجولات إن وُجدت، وإلا من الطلبات
     المسجَّلة — فالرقم في البطاقة يُفسَّر من مصدره هو لا من غيره.
     ومعيار التأخّر يتبع المصدر كذلك: الجولة تحمل التزامها
     محسوباً، والطلب يُقاس كما في حسبة الترتيب (بلغ المدة ⇒ متأخر). */
  const whoRows = useMemo(() => {
    if (!who) return [];
    if (rounds.length)
      return spanRounds
        .filter((r) => ownerOf.get(nrm(r.owner))?.name === who)
        .map((r) => ({
          id: r.id, code: r.code, owner: r.owner, itemName: r.itemName,
          kindTxt: [r.kind, r.review].filter(Boolean).join(" · "),
          days: r.days, sla: r.sla, date: r.leftAt, late: r.onTime === false,
        }));
    return items
      .filter((c) => ownerOf.get(nrm(c.owner))?.name === who)
      .map((c) => ({
        id: c.code, code: c.code, owner: c.owner, itemName: c.itemName,
        kindTxt: [c.reviewType, c.status === "closed" ? "تمت مراجعته" : "مفتوح"]
          .filter(Boolean).join(" · "),
        days: c.workDays, sla: c.sla, date: c.closedAt || c.lastSeen || "",
        late: c.sla != null && c.workDays != null && c.workDays >= c.sla,
      }))
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  }, [who, rounds, spanRounds, items, ownerOf]);

  const shown = useMemo(() => {
    const open = items.filter((x) => x.status === "open");
    const list = filter ? open.filter((x) => toneOf(x) === filter) : open;
    const rank: Record<Tone, number> = { late: 0, near: 1, ok: 2, done: 3 };
    return [...list].sort(
      (a, b) => rank[toneOf(a)] - rank[toneOf(b)] || (b.workDays ?? -1) - (a.workDays ?? -1)
    );
  }, [items, filter]);

  async function send(grid: string[][]) {
    setErr("");
    setMsg("");
    const { rows, skipped, full, all, stages } = mapRows(grid);
    if (!rows.length && !all) {
      setErr(
        t(
          "لم أتعرّف على أعمدة الجدول. تأكدي أن الصف الأول يحمل العناوين: الرمز · الجهة المالكة · المرحلة الحالية للطلب · آخر إجراء تم منذ …",
          "Could not recognise the table headers."
        )
      );
      return;
    }
    /* التصدير الكامل بلا طلبٍ عند أداء حالةٌ صحيحة لا خطأ: تعني
       أن القائمة خلت، فتُغلق الجولات المفتوحة كلها */
    const where = full ? t("عند أداء", "at Adaa") : t("في الملف", "in the file");
    const okToGo = window.confirm(
      t(
        full
          ? `قرأت ${all} طلباً، منها ${rows.length} ${CR_ADAA_STAGE} الآن.\n\n` +
            (rows.length
              ? ""
              : `المراحل الموجودة في الملف:\n${stages
                  .map(([k, n]) => `· ${k} (${n})`)
                  .join("\n")}\n\nإن لم تكن فيها «${CR_ADAA_STAGE}» فالتصدير من تقريرٍ آخر — ألغي الرفع.\n\n`) +
            "سيُحدَّث الموجود، ويُضاف الجديد، وتُغلق جولة كل طلبٍ لم يعد عند أداء.\n\nمتابعة؟"
          : `الملف فيه ${rows.length} طلباً. سيُحدَّث الموجود، ويُضاف الجديد، ويُعدّ ما لم يعد في الملف طلباً تمت مراجعته.\n\nمتابعة؟`,
        `${rows.length} requests ${where}. Continue?`
      )
    );
    if (!okToGo) return;

    setBusy(true);
    const r = await apiFetch("/api/changes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rows, full }),
    }).then((x) => x.json());
    setBusy(false);
    if (r.error) {
      setErr(r.error);
      return;
    }
    setMsg(
      t(
        `حُفظ ${r.saved} طلباً${full ? ` عند أداء (من ${all} في الملف)` : ""}` +
          `${r.closed ? ` · أُغلق ${r.closed} طلباً تمت مراجعته` : ""}` +
          `${r.rounds ? ` · سُجّلت ${r.rounds} جولة مراجعة` : ""}` +
          `${skipped ? ` · تُخطّي ${skipped} صفاً بلا رمز` : ""}`,
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
          "تعذّرت قراءة الملف — يُحفظ من إكسل بصيغة xlsx أو CSV، أو يُلصق الجدول مباشرة.",
          "Could not read the file."
        )
      );
    }
  }

  const HEAD = [
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

  function statusText(c: Change): string {
    if (c.status === "closed") return "تمت المراجعة";
    const tn = toneOf(c);
    return tn === "late" ? "متأخر" : tn === "near" ? "قارب على الانتهاء" : "ضمن المدة";
  }

  function bodyRows(): (string | number)[][] {
    return shown.map((c) => [
      c.code, c.program, c.itemCode, c.itemName, c.owner, c.category,
      c.reviewType, c.classification, c.sla ?? "", c.workDays ?? "",
      c.sla != null && c.workDays != null ? c.sla - c.workDays : "",
      statusText(c),
    ]);
  }

  /** نسخ بفواصل Tab فيُلصق في إكسل وWord جدولاً حقيقياً */
  async function copyTable() {
    const tsv = [HEAD, ...bodyRows()]
      .map((r) => r.map((x) => String(x).replace(/[\t\n]+/g, " ")).join("\t"))
      .join("\n");
    try {
      await navigator.clipboard.writeText(tsv);
      setErr("");
      setMsg(t(`نُسخ ${shown.length} طلباً — جاهز للّصق في إكسل أو Word`, "Copied"));
    } catch {
      setErr(t("تعذّر النسخ التلقائي — البديل زرّ «⬇ Excel».", "Copy failed — use Excel export."));
    }
  }

  function exportCsv() {
    const csv = [HEAD, ...bodyRows()]
      .map((r) => r.map((x) => (/[",\n]/.test(String(x)) ? `"${String(x).replace(/"/g, '""')}"` : String(x))).join(","))
      .join("\r\n");
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "طلبات-التغيير.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const CHIPS: { key: Tone; label: string; n: number; c: string }[] = [
    { key: "late", label: t("متأخرة", "Overdue"), n: stats.late, c: TONE_COLOR.late },
    { key: "near", label: t("قاربت على الانتهاء", "Due soon"), n: stats.near, c: TONE_COLOR.near },
    { key: "ok", label: t("ضمن المدة", "On time"), n: stats.ok, c: TONE_COLOR.ok },
  ];

  /* تدرّج ألوان أداء الأساسية — الأغمق للأول ثم يخفّ.
     والخط أبيض في الخمس جميعاً بطلب المستخدمة */
  const RANK = [
    { label: "الأول", en: "1st", c: "#006F68" },
    { label: "الثاني", en: "2nd", c: "#008B84" },
    { label: "الثالث", en: "3rd", c: "#5AABA2" },
    { label: "الرابع", en: "4th", c: "#90BFB7" },
    { label: "الخامس", en: "5th", c: "#BFD9D6" },
  ];

  async function clearDisown(id: string) {
    await apiFetch(`/api/cr/disown?id=${encodeURIComponent(id)}`, { method: "DELETE" })
      .then((x) => x.json())
      .catch(() => ({}));
    await loadEnts();
  }

  return (
    <div className="cr">
      {/* جهاتٌ نفى استشاريوها نسبتها إليهم — طلباتها بلا استشاري
          حتى يُصحَّح سجلّ الجهات، فتظهر هنا لمن يرفع الملف */}
      {page && canLink && disown.length > 0 && (
        <div className="cr-unmatched cr-dis">
          <b>
            {t(
              `${disown.length} جهة بلا استشاري واضح`,
              `${disown.length} entities without a clear consultant`,
            )}
          </b>
          <span>
            {t(
              "نفى الاستشاري نسبتها إليه، فطلباتها لا تُحتسب على أحد حتى تُسند في سجلّ الجهات",
              "A consultant said these are not theirs",
            )}
          </span>
          <div className="cr-dis-l">
            {disown.map((d) => (
              <span className="cr-dis-i" key={d.id}>
                <b>{d.entity}</b>
                <em>{t(`نفاها ${d.user}`, d.user)}</em>
                <button title={t("أُسندت — احذفي النفي", "Clear")} onClick={() => clearDisown(d.id)}>
                  ✕
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      {page && canLink && unmatched.length > 0 && (
        <div className="cr-unmatched">
          <b>
            {t(
              `${unmatched.length} جهة في الملف لا تطابق سجلّ الجهات`,
              `${unmatched.length} unmatched entities`,
            )}
          </b>
          <span>
            {t(
              `${unmatched.reduce((n, x) => n + x[1], 0)} طلباً لا تُحتسب على أحد — طابِقي أسماءها مرة واحدة فتُعرف بعدها تلقائياً`,
              "Their requests count for nobody",
            )}
          </span>
          <button className="btn btn-sm" onClick={() => setFixing(true)}>
            {t("مطابقة الأسماء", "Match names")}
          </button>
        </div>
      )}

      {page && fixing && (
        <div className="modal-overlay" onClick={() => setFixing(false)}>
          <div className="modal" style={{ maxWidth: 680 }} onClick={(e) => e.stopPropagation()}>
            <div className="m-h">
              <h3>{t("مطابقة أسماء الجهات", "Match entity names")}</h3>
              <button className="mx" onClick={() => setFixing(false)}>✕</button>
            </div>
            <div className="m-b">
              <p className="muted" style={{ marginTop: 0 }}>
                {t(
                  "الاسم كما ورد في ملف منصة الرؤية إلى يمينه، ثم اختيار الجهة المقابلة من السجلّ. يُحفظ اسماً بديلاً لها، ولا يتغيّر اسمها المعتمد.",
                  "Pick the registry entity for each name in the file.",
                )}
              </p>
              {fixMsg && <div className="alert alert-error">{fixMsg}</div>}
              {unmatched.length === 0 && (
                <div className="soon"><b>{t("لا يوجد اسمٌ بلا مطابقة", "Nothing left")}</b></div>
              )}
              {unmatched.map(([nm, n]) => (
                <div className="cr-fix" key={nm}>
                  <span className="n">
                    {nm}
                    <i>{t(`${n} طلباً`, `${n}`)}</i>
                  </span>
                  <select
                    value={pick[nm] || ""}
                    onChange={(e) => setPick((o) => ({ ...o, [nm]: e.target.value }))}
                  >
                    <option value="">{t("اختيار الجهة…", "Choose…")}</option>
                    {ents.map((e) => (
                      <option key={e.id} value={e.id}>{e.name}</option>
                    ))}
                  </select>
                  <button
                    className="btn btn-sm"
                    disabled={!pick[nm]}
                    onClick={() => void linkAlias(nm, pick[nm])}
                  >
                    {t("ربط", "Link")}
                  </button>
                </div>
              ))}
            </div>
            <div className="m-f">
              <button className="btn btn-ghost btn-sm" onClick={() => setFixing(false)}>
                {t("إغلاق", "Close")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* الشريط في الموضعين: **الشرائح الثلاث تظهر في «نظرة عامة»**
          أيضاً — بطلب صاحبة المنصة، فهي تقول حالة الطلبات بلمحة
          وتفلتر الجدول تحتها. والرفع والنسخ والتصدير عملُ الصفحة
          لا الموجز، فتبقى محجوبة عنه. */}
      <div className="cr-bar">
        <span className="pills">
          {CHIPS.map((c) => (
            <button
              key={c.key}
              className={`pill ${filter === c.key ? "on" : ""}`}
              style={{ ["--c" as string]: c.c }}
              onClick={() => setFilter(filter === c.key ? null : c.key)}
            >
              <i />
              {c.label}
              <b>{c.n}</b>
            </button>
          ))}
        </span>
        <div style={{ flex: 1 }} />
        {page && (
          <>
            {canEdit && (
              <button className="btn btn-ghost btn-sm" onClick={() => setPasting(true)}>
                {t("لصق الجدول", "Paste")}
              </button>
            )}
            <button className="btn btn-ghost btn-sm" onClick={copyTable} disabled={!shown.length}>
              {t("نسخ الجدول", "Copy")}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={exportCsv} disabled={!shown.length}>
              ⬇ Excel
            </button>
            {canEdit && (
              <>
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
              </>
            )}
          </>
        )}
      </div>

      {/* نسبة الالتزام من الجولات المكتملة — معادلة بطاقة المؤشر
          نفسها: الملتزم ÷ الإجمالي × 100، ربعاً ربعاً. تظهر حين
          تتراكم جولات، فقبل أول رفعٍ للتصدير الكامل لا شيء تقوله. */}
      {page && qRows.length > 0 && (
        <div className="card cr-sla">
          <div className="card-top">
            <h3>{t("الالتزام باتفاقيات مستوى الخدمة", "SLA compliance")}</h3>
            <span className="muted" style={{ fontSize: 11 }}>
              {t("مدّة كل جولة عند أداء مقابل اتفاقيتها", "Each round at Adaa vs its SLA")}
            </span>
          </div>
          <div className="cr-qs">
            {qRows.slice(0, 4).map((r) => (
              <div className="cr-q" key={r.q}>
                <span className="q">{r.q}</span>
                <b style={{ color: r.pct >= 90 ? "#1a9d5c" : r.pct >= 70 ? "#e0971a" : "#d34a4a" }}>
                  {r.pct}%
                </b>
                <span className="s">
                  {t(`${r.ok} من ${r.n} جولة`, `${r.ok} of ${r.n}`)} · {t("متوسط", "avg")} {r.avg}{" "}
                  {t("يوم عمل", "wd")}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {tops.length > 0 && (
        <div className="card cr-top">
          <div className="card-top">
            <h3>{t("أعلى الاستشاريين التزاماً", "Most on-time consultants")}</h3>
            <span className="muted" style={{ fontSize: 11 }}>
              {rounds.length
                ? t(`${spanRounds.length} جولة مراجعة مكتملة`, `${spanRounds.length} rounds`)
                : t("من الطلبات المسجَّلة — حتى تتراكم جولات المراجعة", "From stored requests")}
            </span>
            {rounds.length > 0 && (
              <span className="cr-span">
                {([
                  ["week", t("هذا الأسبوع", "This week")],
                  ["quarter", t("هذا الربع", "This quarter")],
                  ["all", t("الكل", "All")],
                ] as const).map(([k, lb]) => (
                  <button
                    key={k}
                    className={span === k ? "on" : ""}
                    onClick={() => { setSpan(k); setWho(""); }}
                  >
                    {lb}
                  </button>
                ))}
              </span>
            )}
          </div>
          <div className="cr-podium">
            {tops.slice(0, 5).map((x, i) => (
              <div
                className="cr-p clk"
                key={x.name}
                onClick={() => setWho(who === x.name ? "" : x.name)}
                style={{ ["--c" as string]: RANK[i].c }}
                title={t(
                  `${x.ok} من ${x.total} ضمن مدّتها (${x.raw}%) — والنسبة الظاهرة مرجَّحة بعدد الطلبات`,
                  `${x.ok} of ${x.total} on time`,
                )}
              >
                {/* شعار أداء شفافاً خلف البطاقة بدل الزخرفة */}
                <img className="mark" src={asset("/adaa-mark.png")} alt="" aria-hidden />
                <span className="av2">
                  {x.photo ? <img src={x.photo} alt="" /> : (x.name || "?").trim().charAt(0)}
                </span>
                <b>{x.name}</b>
                <em>{x.pct}%</em>
                <span className="rk">{t(arReq(x.total), `${x.total} requests`)}</span>
              </div>
            ))}
          </div>
          {tops.length > 5 && (
            <div className="cr-rest">
              {t("ثم:", "Then:")}{" "}
              {tops.slice(5, 10).map((x) => `${x.name} ${x.pct}%`).join(" · ")}
            </div>
          )}
        </div>
      )}


      {/* قائمة جولات الاستشاري — تُفتح بالضغط على بطاقته */}
      {who && (
        <div className="modal-overlay" onClick={() => setWho("")}>
          <div className="modal" style={{ maxWidth: 820 }} onClick={(e) => e.stopPropagation()}>
            <div className="m-h">
              <h3>
                {who}
                <span className="muted" style={{ fontSize: 11, marginInlineStart: 8 }}>
                  {t(
                    rounds.length
                      ? `${whoRows.length} جولة · ${whoRows.filter((r) => !r.late).length} ضمن المدة`
                      : `${whoRows.length} طلباً · ${whoRows.filter((r) => !r.late).length} ضمن المدة`,
                    `${whoRows.length} rows`,
                  )}
                </span>
              </h3>
              <button className="mx" onClick={() => setWho("")}>✕</button>
            </div>
            <div className="m-b">
              {whoRows.length === 0 ? (
                <div className="muted">{t("لا جولات في هذا المدى", "No rounds in this span")}</div>
              ) : (
                <table className="cr-tbl">
                  <thead>
                    <tr>
                      <th>{t("الرمز", "Code")}</th>
                      <th>{t("الجهة المالكة", "Entity")}</th>
                      <th>{t("البند", "Item")}</th>
                      <th>{t("النوع", "Type")}</th>
                      <th>{t("الأيام", "Days")}</th>
                      <th>{t("المدة", "SLA")}</th>
                      <th>{rounds.length ? t("خرج في", "Left") : t("آخر تحديث", "Updated")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {whoRows.map((r) => (
                      <tr key={r.id} className={r.late ? "cr-late" : ""}>
                        <td className="ltr cr-code">{r.code}</td>
                        <td>{r.owner}</td>
                        <td className="cr-name">{r.itemName}</td>
                        <td>{r.kindTxt}</td>
                        <td>
                          <b>{r.days ?? "—"}</b>
                        </td>
                        <td>{r.sla ?? "—"}</td>
                        <td className="ltr">{r.date}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="m-f">
              <button className="btn btn-ghost btn-sm" onClick={() => setWho("")}>
                {t("إغلاق", "Close")}
              </button>
            </div>
          </div>
        </div>
      )}

      {page && err && <div className="alert alert-error">{err}</div>}
      {page && msg && <div className="alert alert-ok">{msg}</div>}

      {/* الجدول في «نظرة عامة» كما في الصفحة — بطلب صاحبة المنصة،
          بدل خطّ نسب الأشهر. وأزرار الرفع والنسخ تبقى في الصفحة */}
      {!loaded ? (
        <div className="empty">{t("جارٍ التحميل...", "Loading...")}</div>
      ) : !items.length ? (
        <div className="soon">
          <b>{t("لا توجد طلبات تغيير بعد", "No change requests yet")}</b>
          {canEdit
            ? t(
                "رفع الملف اليومي من منصة الرؤية، أو لصق الجدول من البريد.",
                "Upload the daily platform file, or paste the table."
              )
            : t(
                "تظهر هنا فور رفع ملف المتابعة اليومي.",
                "They appear once the daily file is uploaded."
              )}
        </div>
      ) : !shown.length ? (
        <div className="empty">
          {filter
            ? t("لا طلبات في هذا التصنيف.", "Nothing here.")
            : t("لا طلبات مفتوحة — تمت مراجعة الكل.", "No open requests.")}
        </div>
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
              {(showAll ? shown : shown.slice(0, 3)).map((c) => {
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

      {/* خارج حاوية التمرير حتى لا يزحف مع الجدول العريض */}
      {loaded && shown.length > 3 && (
        <div className="cr-more" onClick={() => setShowAll(!showAll)}>
          {showAll
            ? t("عرض أقل ▴", "Show less ▴")
            : t(`عرض الكل (${shown.length - 3} أخرى) ▾`, `Show all (${shown.length - 3} more) ▾`)}
        </div>
      )}

      {/* ------- ③ نسبة الالتزام على مستوى الأرباع ------- */}
      {page && quarters.length > 0 && (
        <>
          <div className="cr-h">
            <h3>{t("نسبة الالتزام على مستوى الأرباع", "Compliance by quarter")}</h3>
          </div>
          <div className="nq-line cr-line">
            {crLast(quarters, 4).map((q) => {
              const gap = q.src === "gap";
              const tone = crBand(q.stat.pct).tone;
              return (
                <div
                  className={`nq-q ${gap ? "" : `on ${tone}`}`}
                  key={q.label}
                  title={
                    gap
                      ? t("لم يُغلق فيه طلب", "No requests closed")
                      : q.src === "stored"
                        ? t("نسبة مُدخَلة في المنصة", "Entered value")
                        : t("محسوبة من الطلبات المُغلقة في الملف اليومي", "Computed")
                  }
                >
                  <b style={gap ? undefined : { color: CR_TONE[tone] }}>
                    {q.stat.pct}%
                    {q.delta != null && q.delta !== 0 && (
                      <span className={`nq-dl ${q.delta < 0 ? "dn" : "up"}`}>
                        {q.delta < 0 ? "▼" : "▲"} {Math.abs(q.delta)}%
                      </span>
                    )}
                  </b>
                  <i style={gap ? undefined : { borderColor: CR_TONE[tone] }} />
                  <span>
                    {q.label}
                    {/* الربع الجاري نسبته جزئية بطبعها — تُقرأ «حتى
                        اليوم» لا نتيجةً نهائية للربع */}
                    {q.label === qOf(new Date().toISOString().slice(0, 10)) && (
                      <b className="nq-now">{t("حتى اليوم", "to date")}</b>
                    )}
                  </span>
                  <em>{gap ? t("لا طلبات", "No requests") : t(arReq(q.stat.n), `${q.stat.n} requests`)}</em>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* ------- ④ نسبة الالتزام لكل قطاع -------
          عمودان لكل قطاع: الربع المعروض وما قبله — كصفحة جودة
          ملاحظات الأداء. والقطاع يأتي من الصفوف المُدخَلة، فملفُ
          الطلبات لا يحمل قطاعاً.

          ومربّعا النوع فوقها: الضغط على أحدهما يقلب الأعمدة إلى
          نسبه وحده، والضغط ثانيةً يعيد النسبة الإجمالية. */}
      {page && sectors.length > 0 && (
        <>
          <div className="cr-h">
            <h3>{t("نسبة الالتزام لكل قطاع", "Compliance by sector")}</h3>
            {secQs.length > 1 && (
              <span className="chips">
                {secQs.map((q) => (
                  <button
                    key={q}
                    className={`chip sm ${q === curSecQ ? "on" : ""}`}
                    onClick={() => setSecQ(q)}
                  >
                    {q}
                  </button>
                ))}
              </span>
            )}
          </div>

          {kinds.length > 0 && (
            <div className="cr-kinds">
              {kinds.map((k) => (
                <button
                  key={k.k}
                  className={`cr-kind ${kind === k.k ? "on" : ""}`}
                  onClick={() => setKind(kind === k.k ? "" : k.k)}
                  title={t(
                    kind === k.k ? "اضغط لعرض النسبة الإجمالية" : `اضغط لعرض نسب ${k.label}`,
                    "Toggle",
                  )}
                >
                  <b>{k.stat.pct}%</b>
                  <span>{k.label}</span>
                  <em>{t(arReq(k.stat.n), `${k.stat.n}`)}</em>
                </button>
              ))}
            </div>
          )}

          <div className="nq-sec">
            <div className="nqk">
              {sectors.map((x) => {
                const now = crPick(x.now, kind);
                const was = crPick(x.was, kind);
                const d = now && was ? now.pct - was.pct : null;
                const tone = now ? crBand(now.pct).tone : "no";
                return (
                  <div className="g" key={x.name}>
                    <div className="gb">
                      {/* السابق أولاً فالحالي — فيُقرأ الاتجاه يميناً.
                          وربعٌ لا رقم فيه لأي قطاع يُطوى عمودُه كلّه:
                          عمودٌ مخطَّطٌ بـ«—» بجانب كل قطاع ضجيجٌ لا خبر */}
                      {[
                        ...(hasPrev ? [{ q: crPrevQ(curSecQ), v: was, c: "var(--g-400)" }] : []),
                        { q: curSecQ, v: now, c: CR_TONE[tone] },
                      ].map((b, i) => (
                        <div className={`c ${b.v ? "" : "na"}`} key={i} title={`${x.name} — ${b.q}`}>
                          <div className="bw" style={b.v ? { height: `${Math.max(3, b.v.pct)}%` } : undefined}>
                            <span className="v">{b.v ? `${b.v.pct}%` : "—"}</span>
                            <span className="bar" style={b.v ? { background: b.c } : undefined} />
                          </div>
                          <span className="q">{b.q}</span>
                        </div>
                      ))}
                    </div>
                    <div className="lb">
                      {x.name}
                      <em>
                        {now ? t(arReq(now.n), `${now.n}`) : t("لا طلبات", "None")}
                        {d != null && d !== 0 && (
                          <span className={`nq-dl ${d < 0 ? "dn" : "up"}`}>
                            {" · "}
                            {d < 0 ? "▼" : "▲"} {Math.abs(d)}%
                          </span>
                        )}
                      </em>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {page && pasting && (
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
                  "يُلصق الجدول هنا بصف عناوينه.",
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
