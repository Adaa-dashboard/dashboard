/* ===========================================================
   داشبورد إدارة استقطاب المواهب — مركز أداء
   تطبيق صفحة واحدة (SPA) بتوجيه عبر الـ hash
   =========================================================== */
(function () {
  const CFG = window.APP_CONFIG || {};
  const MONTHS = ["ينا", "فبر", "مار", "أبر", "ماي", "يون", "يول", "أغس", "سبت", "أكت", "نوف", "ديس"];
  const MONTHS_FULL = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
  const STAGES = ["المقابلة", "العرض الأولي", "المسح الأمني", "الفحص الطبي", "العرض النهائي", "الانضمام"];
  const PALETTE = ["var(--g-800)", "var(--emerald)", "var(--g-700)", "var(--g-600)", "var(--g-500)", "var(--gold)", "var(--g-400)"];

  const state = {
    page: "index",
    tab: null,
    node: "root",
    user: null,
    filters: { unit: "", year: 2026, month: 0 }, // month=0 يعني كل الأشهر
    edit: false,
  };

  /* ---------------- أدوات ---------------- */
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  const db = () => DB.cache;
  const canEdit = () => state.user && state.user.role === "editor";

  const ICONS = {
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/>',
    users: '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 20c0-3.3 2.5-5.5 5.5-5.5s5.5 2.2 5.5 5.5"/><path d="M16 5.2a3 3 0 0 1 0 5.6M17.5 20c0-2.4-1-4.2-2.6-5"/>',
    cap: '<path d="M12 4 22 9l-10 5L2 9z"/><path d="M6 11v5c0 1.4 2.7 2.6 6 2.6s6-1.2 6-2.6v-5"/>',
    exit: '<path d="M15 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h9"/><path d="M11 12h9M17 8l4 4-4 4"/>',
    office: '<path d="M3 21h18M5 21V6a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v15M13 21V10h5a1 1 0 0 1 1 1v10"/><path d="M8 9h2M8 13h2M8 17h2M16 14h.01M16 17h.01"/>',
    pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>',
    check: '<circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16 9"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/>',
  };
  const icon = (n) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[n] || ""}</svg>`;
  const CHEV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg>';

  /* ---------------- الهيكل التنظيمي ---------------- */
  function units() { return db().org_units || []; }
  function unitById(id) { return units().find((u) => u.id === id); }
  function childrenOf(id) { return units().filter((u) => (u.parent_id || null) === (id || null)); }
  function roots() { return childrenOf(null); }

  function aggregate(id) {
    const t = { approved: 0, filled: 0, junior: 0, senior: 0, male: 0, female: 0 };
    const kids = childrenOf(id);
    if (!kids.length) {
      const u = unitById(id);
      if (u) for (const k in t) t[k] = Number(u[k] || 0);
      return t;
    }
    for (const k of kids) {
      const s = aggregate(k.id);
      for (const key in t) t[key] += s[key];
    }
    return t;
  }
  function aggregateAll() {
    const t = { approved: 0, filled: 0, junior: 0, senior: 0, male: 0, female: 0 };
    for (const r of roots()) {
      const s = aggregate(r.id);
      for (const k in t) t[k] += s[k];
    }
    return t;
  }
  function pathOf(id) {
    const out = [];
    let cur = id;
    while (cur) { out.unshift(cur); const u = unitById(cur); cur = u ? u.parent_id : null; }
    return out;
  }
  // يرجّع القطاع الجذر لأي وحدة
  function rootOf(id) { const p = pathOf(id); return p[0] || id; }

  /* ---------------- الفلاتر ---------------- */
  function inPeriod(r) {
    if (!r) return false;
    if (state.filters.year && Number(r.year) !== Number(state.filters.year)) return false;
    if (state.filters.month && Number(r.month) !== Number(state.filters.month)) return false;
    return true;
  }
  function inUnit(r) {
    const f = state.filters.unit;
    if (!f) return true;
    if (!r.unit_id) return true;
    return pathOf(r.unit_id).includes(f);
  }
  const rows = (t) => (db()[t] || []).filter((r) => inPeriod(r) && inUnit(r));

  /* ---------------- الرسوم ---------------- */
  function donut(segs, ctop, cbot, opts) {
    opts = opts || {};
    const size = opts.size || 200;
    const total = segs.reduce((s, x) => s + x[1], 0) || 1;
    let ang = -90, paths = "";
    const R = 74, r = 49, cx = 94, cy = 94;
    for (const [lab, v, col] of segs) {
      const sw = (v / total) * 360;
      const a0 = (ang * Math.PI) / 180, a1 = ((ang + sw) * Math.PI) / 180;
      const x0 = cx + R * Math.cos(a0), y0 = cy + R * Math.sin(a0);
      const x1 = cx + R * Math.cos(a1), y1 = cy + R * Math.sin(a1);
      const xi1 = cx + r * Math.cos(a1), yi1 = cy + r * Math.sin(a1);
      const xi0 = cx + r * Math.cos(a0), yi0 = cy + r * Math.sin(a0);
      const lg = sw > 180 ? 1 : 0;
      paths += `<path d="M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${R} ${R} 0 ${lg} 1 ${x1.toFixed(2)} ${y1.toFixed(2)} L ${xi1.toFixed(2)} ${yi1.toFixed(2)} A ${r} ${r} 0 ${lg} 0 ${xi0.toFixed(2)} ${yi0.toFixed(2)} Z" fill="${col}" stroke="#fff" stroke-width="2.5"/>`;
      ang += sw;
    }
    const svg = `<svg viewBox="0 0 188 188" width="${size}" height="${size}">${paths}
      <text x="94" y="88" text-anchor="middle" style="font-size:30px;font-weight:800;font-family:Noto Kufi Arabic;fill:var(--g-800)">${ctop}</text>
      <text x="94" y="110" text-anchor="middle" style="font-size:13px;fill:var(--muted)">${cbot}</text></svg>`;
    const leg = segs.map(([l, v, c]) => `<div class="it"><span class="sw" style="background:${c}"></span>${esc(l)} <b>(${v})</b></div>`).join("");
    return `<div class="donut-wrap${opts.stack ? " stack" : ""}">${svg}<div class="legend${opts.row ? " row" : ""}">${leg}</div></div>`;
  }

  function ring(p, col, label, note, size) {
    const R = 60, C = 2 * Math.PI * R, off = C * (1 - p / 100);
    return `<div class="ring-wrap"><svg viewBox="0 0 154 154" width="${size || 240}" height="${size || 240}">
      <circle cx="77" cy="77" r="${R}" fill="none" stroke="var(--ringtrack,var(--g-50))" stroke-width="15"/>
      <circle cx="77" cy="77" r="${R}" fill="none" stroke="${col}" stroke-width="15" stroke-linecap="round" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" transform="rotate(-90 77 77)"/>
      <text x="77" y="72" text-anchor="middle" style="font-size:32px;font-weight:800;font-family:Noto Kufi Arabic;fill:var(--g-800)">${p}%</text>
      <text x="77" y="95" text-anchor="middle" style="font-size:12px;fill:var(--muted)">${esc(label)}</text></svg>
      ${note ? `<div class="ring-note">${esc(note)}</div>` : ""}</div>`;
  }

  function colbars(items, maxh) {
    maxh = maxh || 190;
    const mx = Math.max(...items.map((i) => i[1]), 1);
    const cols = items.map(([l, v, c]) => `<div class="cb"><div class="cbv">${v}</div>
      <div class="cbcol" style="height:${Math.max(14, (v / mx) * maxh).toFixed(0)}px;background:${c}"></div>
      <div class="cbl">${esc(l)}</div></div>`).join("");
    return `<div class="cbars">${cols}</div>`;
  }

  function splitbar(parts) {
    const tot = parts.reduce((s, p) => s + p[1], 0) || 1;
    const bars = parts.map(([l, v, c]) => `<i style="width:${((v / tot) * 100).toFixed(1)}%;background:${c}">${v}</i>`).join("");
    const lg = parts.map(([l, v, c]) => `<div class="i"><span class="sw" style="background:${c}"></span>${esc(l)}</div>`).join("");
    return `<div class="split">${bars}</div><div class="slg">${lg}</div>`;
  }

  /* ---------------- بطاقات الأشخاص ---------------- */
  function pcard(name, pos, metas, badge, act) {
    const m = metas.filter(([k, v]) => v && v !== "—")
      .map(([k, v]) => `<div class="mi"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>`).join("");
    const b = badge ? `<span class="badge ${badge[1]}">${esc(badge[0])}</span>` : "";
    const acts = act && canEdit()
      ? `<span class="iact" title="تعديل" onclick="APP.openForm('${act.form}','${act.id}')">${icon("pen")}</span>
         <span class="iact del" title="حذف" onclick="APP.removeRow('${act.table}','${act.id}')">${icon("trash")}</span>` : "";
    return `<div class="prow"><div class="pav">${esc((name || "?").trim()[0])}</div>
      <div class="pid"><div class="pn">${esc(name)}</div><div class="pp">${esc(pos)}</div></div>
      <div class="pmeta">${m}</div><div class="pend hact">${b}${acts}</div></div>`;
  }

  function plist(title, chip, cards, add) {
    const a = add && canEdit() ? `<button class="btn btn-p" onclick="APP.openForm('${add[1]}')">${icon("plus")} ${esc(add[0])}</button>` : "";
    return `<div class="card"><div class="tbl-h"><h3 class="ttl-edit" data-k="${esc(title)}">${esc(title)}</h3>
      <div class="hact"><span class="chip2">${esc(chip)}</span>${a}</div></div>
      <div class="plist">${cards || '<div class="empty">لا توجد بيانات مطابقة للفلاتر الحالية</div>'}</div></div>`;
  }

  /* ---------------- الصفحات ---------------- */
  // اللوحة الرئيسية
  function pageIndex() {
    const vac = rows("vacancies");
    const totalVac = vac.reduce((s, v) => s + Number(v.count || 0), 0);
    const received = vac.reduce((s, v) => s + Number(v.received || 0), 0);
    const cands = rows("candidates");
    const done = cands.filter((c) => c.stage >= 5).length;
    const inprog = cands.filter((c) => c.stage < 5).length;
    const trainees = rows("trainees");
    const resg = rows("resignations");
    const target = Number((db().settings.find((s) => s.key === "training_target") || {}).value || 80);
    const trDone = trainees.filter((t) => t.status === "مكتمل").length;
    const trProg = trainees.filter((t) => t.status === "تحت الإجراء").length;
    const trOn = trainees.filter((t) => t.status === "قائم").length;

    const bySector = roots().map((r, i) => [r.name, resg.filter((x) => x.unit_id && rootOf(x.unit_id) === r.id).length, PALETTE[i % PALETTE.length]]);

    const cards = [
      ["recruitment", "users", received, "طلبات التوظيف المستلمة"],
      ["training", "cap", trainees.length, "طلبات التدريب"],
      ["resignations", "exit", resg.length, "الاستقالات"],
      ["recruitment", "check", pct(done, totalVac) + "%", "نسبة إنجاز التوظيف"],
    ].map(([href, ic, v, l]) => `<a class="tcard" href="#/${href}"><div class="ic">${icon(ic)}</div>
      <div><div class="v">${v}</div><div class="l">${esc(l)}</div></div></a>`).join("");

    const panels = [
      ["توزيع حالة طلبات التوظيف", `من إجمالي ${totalVac + inprog + done}`,
        donut([["شاغرة", totalVac, "var(--g-400)"], ["تحت الإجراء", inprog, "var(--g-600)"], ["مكتملة", done, "var(--g-800)"]],
          totalVac + inprog + done, "إجمالي", { size: 240 })],
      ["توزيع حالة طلبات التدريب", `من إجمالي ${trainees.length}`,
        donut([["مكتملة", trDone, "var(--emerald)"], ["تحت الإجراء", trProg, "var(--g-600)"], ["قائم", trOn, "var(--g-400)"]],
          trainees.length, "طلب", { size: 240 })],
      ["توزيع الاستقالات حسب القطاع", `الإجمالي ${resg.length}`, colbars(bySector)],
    ].map((p, i, arr) => `<div class="panel"${i === arr.length - 1 && arr.length % 2 === 1 ? ' style="grid-column:1/-1"' : ""}>
      <div class="p-h"><h3 class="ttl-edit" data-k="${esc(p[0])}">${esc(p[0])}</h3><span class="hint">${esc(p[1])}</span></div>
      <div class="body">${p[2]}</div></div>`).join("");

    return `<div class="tcards">${cards}</div><div class="mrow full"><div class="vgrid">${panels}</div></div>`;
  }

  // التوظيف
  function pageRecruitment() {
    const vac = rows("vacancies");
    const cands = rows("candidates");
    const ivs = rows("interviews");
    const totalVac = vac.reduce((s, v) => s + Number(v.count || 0), 0);
    const received = vac.reduce((s, v) => s + Number(v.received || 0), 0);
    const done = cands.filter((c) => c.stage >= 5).length;
    const rate = pct(done, totalVac);

    const bySectorVac = roots().map((r, i) => [r.name, vac.filter((v) => rootOf(v.unit_id) === r.id).reduce((s, v) => s + Number(v.count || 0), 0), PALETTE[i % PALETTE.length]]);
    const bySectorRec = roots().map((r, i) => [r.name, vac.filter((v) => rootOf(v.unit_id) === r.id).reduce((s, v) => s + Number(v.received || 0), 0), PALETTE[i % PALETTE.length]]);

    const ivDone = ivs.filter((i) => i.status === "تمت").length;
    const ivRej = ivs.filter((i) => i.status === "مرفوضة").length;
    const ivSch = ivs.filter((i) => i.status === "مجدولة").length;

    const ov = `<div class="vgrid">
      <div class="panel" style="grid-column:1/-1"><div class="p-h"><h3 class="ttl-edit">حالة المقابلات</h3></div>
        <div class="body">${donut([["مجدولة", ivSch, "var(--amber)"], ["مرفوضة", ivRej, "var(--red)"], ["مكتملة", ivDone, "var(--g-800)"]], ivs.length, "مقابلة", { size: 190 })}</div></div>
      <div class="panel" style="grid-column:1/-1"><div class="p-h"><h3 class="ttl-edit">الوظائف الشاغرة حسب القطاع</h3><span class="hint">الإجمالي ${totalVac}</span></div>
        <div class="body">${colbars(bySectorVac)}</div></div>
      <div class="panel" style="grid-column:1/-1"><div class="p-h"><h3 class="ttl-edit">الطلبات المستلمة حسب القطاع</h3><span class="hint">الإجمالي ${received}</span></div>
        <div class="body">${colbars(bySectorRec)}</div></div></div>`;

    // المقابلات
    const ivCards = ivs.map((r) => pcard(r.candidate, r.position, [
      ["الإدارة", (unitById(r.unit_id) || {}).name], ["مالك الوظيفة", r.owner],
      ["التاريخ", r.date ? r.date + (r.day ? " · " + r.day : "") : ""], ["الوقت", r.time],
      ["مصدر الوظيفة", r.job_source], ["مصدر المرشح", r.cand_source_name ? r.cand_source + " · " + r.cand_source_name : r.cand_source],
      ["تقييم الموارد البشرية", r.hr_rating], ["تقييم الإدارة", r.mgr_rating],
    ], [r.status, r.status === "تمت" ? "b-good" : r.status === "مرفوضة" ? "b-crit" : "b-info"],
      { form: "interview", id: r.id, table: "interviews" })).join("");

    // المراحل
    const sum = STAGES.slice(1).map((s, i) => `<div class="sum"><div class="n">${cands.filter((c) => c.stage >= i + 1).length}</div><div class="l">${esc(s)}</div></div>`).join("");
    const accs = cands.map((c, i) => {
      const steps = STAGES.map((s, si) => {
        const cls = si < c.stage ? "done" : si === c.stage ? "cur" : "";
        return `<div class="step ${cls}"><div class="c">${si < c.stage ? "✓" : si + 1}</div><div class="t">${esc(s)}</div></div>`;
      }).join("");
      const upd = canEdit() ? `<button class="btn btn-g" onclick="APP.openForm('candidate','${c.id}')">${icon("pen")} تحديث المرحلة</button>` : "";
      return `<div class="acc ${i === 0 ? "open" : ""}"><div class="head" onclick="this.parentElement.classList.toggle('open')">
        <span class="nm">${esc(c.name)}</span><span class="pos">${esc(c.position)}</span>
        <span class="badge b-info">${esc(STAGES[c.stage] || "")}</span><span class="chev">${CHEV}</span></div>
        <div class="body"><div class="stepper">${steps}</div>
        <div style="display:flex;align-items:center;gap:10px;margin-top:14px;flex-wrap:wrap">
        <div class="note" style="margin:0">آخر تحديث: ${esc(c.note || "—")}</div>${upd}</div></div></div>`;
    }).join("");
    const addCand = canEdit() ? `<div style="display:flex;margin-bottom:14px"><button class="btn btn-p" onclick="APP.openForm('candidate')">${icon("plus")} إضافة مرشح</button></div>` : "";

    const onbCards = rows("onboarding").map((r) => pcard(r.name, r.position, [
      ["الدرجة", r.grade], ["تاريخ المباشرة", r.start_date], ["الملاحظات", r.notes],
    ], null, { form: "onboarding", id: r.id, table: "onboarding" })).join("");

    const flow = addCand + `<div class="sumrow">${sum}</div>` + (accs || '<div class="empty">لا يوجد مرشحون</div>') +
      `<div style="margin-top:22px"></div>` + plist("مرحلة الانضمام", rows("onboarding").length + " منضم", onbCards, ["إضافة منضم", "onboarding"]);

    const views = [
      ["ov", ov],
      ["iv", plist("جدول المقابلات", ivs.length + " مقابلة", ivCards, ["إضافة مقابلة", "interview"])],
      ["flow", flow],
    ];
    const side = `<div class="s-h"><h3 class="ttl-edit">نسبة إنجاز التوظيف</h3></div>
      <div class="hero">${ring(rate, "var(--g-700)", "إنجاز التوظيف", `${done} مكتمل من ${totalVac} شاغرة`, 290)}</div>`;

    return tabbed([["ov", "نظرة عامة"], ["iv", "المقابلات"], ["flow", "مراحل التوظيف"]], views, side);
  }

  // التدريب
  function pageTraining() {
    const tr = rows("trainees");
    const target = Number((db().settings.find((s) => s.key === "training_target") || {}).value || 80);
    const done = tr.filter((t) => t.status === "مكتمل").length;
    const prog = tr.filter((t) => t.status === "تحت الإجراء").length;
    const on = tr.filter((t) => t.status === "قائم").length;
    const dist = roots().map((r, i) => [r.name, tr.filter((t) => t.unit_id && rootOf(t.unit_id) === r.id).length, PALETTE[i % PALETTE.length]]);

    const ov = `<div class="vgrid">
      <div class="panel"><div class="p-h"><h3 class="ttl-edit">حالة طلبات التدريب</h3><span class="hint">من إجمالي ${tr.length}</span></div>
        <div class="body">${donut([["مكتملة", done, "var(--emerald)"], ["تحت الإجراء", prog, "var(--g-600)"], ["قائم", on, "var(--g-400)"]], tr.length, "طلب", { size: 190 })}</div></div>
      <div class="panel"><div class="p-h"><h3 class="ttl-edit">نسبة الإنجاز من الطلبات</h3></div>
        <div class="body">${ring(pct(done, tr.length), "var(--emerald)", "من الطلبات", `${done} مكتمل من ${tr.length}`, 200)}</div></div>
      <div class="panel" style="grid-column:1/-1"><div class="p-h"><h3 class="ttl-edit">توزيع المتدربين على القطاعات</h3><span class="hint">الإجمالي ${tr.length}</span></div>
        <div class="body">${colbars(dist)}</div></div></div>`;

    const cards = tr.map((r) => pcard(r.name, r.university, [
      ["المشرف التدريبي", r.supervisor], ["الإدارة", (unitById(r.unit_id) || {}).name],
      ["بداية التدريب", r.start_date], ["نهاية التدريب", r.end_date], ["رقم الجوال", r.phone],
    ], [r.status, r.status === "مكتمل" ? "b-info" : r.status === "تحت الإجراء" ? "b-warn" : "b-good"],
      { form: "trainee", id: r.id, table: "trainees" })).join("");

    const side = `<div class="s-h"><h3 class="ttl-edit">المحقق من المستهدف</h3></div>
      <div class="hero">${ring(pct(tr.length, target), "var(--g-700)", "من المستهدف", `${tr.length} من مستهدف ${target}`, 290)}</div>`;

    return tabbed([["ov", "نظرة عامة"], ["tt", "المتدربون"]],
      [["ov", ov], ["tt", plist("جدول المتدربين", tr.length + " متدرب", cards, ["إضافة متدرب", "trainee"])]], side);
  }

  // الاستقالات
  function pageResignations() {
    const rs = rows("resignations");
    const dist = roots().map((r, i) => [r.name, rs.filter((x) => x.unit_id && rootOf(x.unit_id) === r.id).length, PALETTE[i % PALETTE.length]]);
    const grades = {};
    rs.forEach((r) => { if (r.grade) grades[r.grade] = (grades[r.grade] || 0) + 1; });
    const gsegs = Object.keys(grades).map((g, i) => [g, grades[g], PALETTE[i % PALETTE.length]]);
    const thisMonth = rs.filter((r) => Number(r.month) === new Date().getMonth() + 1).length;
    const top = dist.slice().sort((a, b) => b[1] - a[1])[0] || ["—", 0];

    const ov = `<div class="vgrid">
      <div class="panel" style="grid-column:1/-1"><div class="p-h"><h3 class="ttl-edit">حسب الدرجة</h3></div>
        <div class="body">${gsegs.length ? donut(gsegs, rs.length, "استقالة", { size: 190 }) : '<div class="empty">لا توجد بيانات</div>'}</div></div>
      <div class="panel" style="grid-column:1/-1"><div class="p-h"><h3 class="ttl-edit">توزيع الاستقالات حسب القطاع</h3><span class="hint">الإجمالي ${rs.length}</span></div>
        <div class="body">${colbars(dist)}</div></div></div>`;

    const cards = rs.map((r) => pcard(r.name, r.position, [
      ["الدرجة", r.grade], ["الإدارة", (unitById(r.unit_id) || {}).name], ["آخر يوم عمل", r.last_day], ["السبب", r.reason],
    ], null, { form: "resignation", id: r.id, table: "resignations" })).join("");

    const side = `<div class="s-h"><h3 class="ttl-edit">عدد الاستقالات</h3></div>
      <div class="hero"><div class="hero-circle"><span class="hero-n">${rs.length}</span><span class="hero-l">استقالة حتى اليوم</span></div>
      <div class="hero-facts"><div class="hf"><span>استقالات الشهر الحالي</span><b>${thisMonth}</b></div>
      <div class="hf"><span>أعلى قطاع</span><b>${esc(top[0])} · ${top[1]}</b></div></div></div>`;

    return tabbed([["ov", "نظرة عامة"], ["rd", "تفاصيل الاستقالات"]],
      [["ov", ov], ["rd", plist("جدول الاستقالات", rs.length + " استقالة", cards, ["تسجيل استقالة", "resignation"])]], side);
  }

  // القطاعات
  function pageSectors() {
    const nid = state.node;
    const isRoot = nid === "root";
    const a = isRoot ? aggregateAll() : aggregate(nid);
    const kids = isRoot ? roots() : childrenOf(nid);
    const name = isRoot ? "الجهة كاملة" : (unitById(nid) || {}).name || "";
    const vac = a.approved - a.filled;

    const path = isRoot ? [] : pathOf(nid);
    const crumbs = `<div class="crumbs">
      ${isRoot ? '<span class="cur">الجهة كاملة</span>' : `<a onclick="APP.goNode('root')">الجهة كاملة</a><span class="sep">›</span>`}
      ${path.map((x, i) => (i === path.length - 1
        ? `<span class="cur">${esc((unitById(x) || {}).name)}</span>`
        : `<a onclick="APP.goNode('${x}')">${esc((unitById(x) || {}).name)}</a><span class="sep">›</span>`)).join("")}
    </div>`;

    const chips = `<div class="dchips">
      <div class="dchip">الوظائف المعتمدة<b>${a.approved}</b></div>
      <div class="dchip">المشغولة<b>${a.filled}</b></div>
      <div class="dchip">الشاغرة<b>${vac}</b></div>
      <div class="dchip">نسبة الإشغال<b>${pct(a.filled, a.approved)}٪</b></div></div>`;

    const charts = `<div class="d3">
      <div class="dbox"><div class="bt ttl-edit">الشواغر</div>${splitbar([["مشغولة", a.filled, "var(--g-700)"], ["شاغرة", vac, "var(--g-400)"]])}</div>
      <div class="dbox"><div class="bt ttl-edit">المستوى الوظيفي</div>${splitbar([["مبتدئ", a.junior, "var(--emerald)"], ["متقدم", a.senior, "var(--g-800)"]])}</div>
      <div class="dbox"><div class="bt ttl-edit">الجنس</div>${splitbar([["ذكور", a.male, "var(--g-600)"], ["إناث", a.female, "var(--gold)"]])}</div></div>`;

    let ch = "";
    if (kids.length) {
      const cardsHtml = kids.map((k) => {
        const s = aggregate(k.id);
        const sub = childrenOf(k.id).length;
        const editIc = canEdit() ? `<span class="iact" title="تعديل" onclick="event.stopPropagation();APP.openForm('unit','${k.id}')">${icon("pen")}</span>` : "";
        return `<div class="dcard" onclick="APP.goNode('${k.id}')">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px">
          <div class="dn">${esc(k.name)}</div>${editIc}</div>
          <div class="dm"><span class="b">${s.filled}</span><span class="s">من ${s.approved} وظيفة معتمدة</span></div>
          <div class="dbar"><span style="width:${pct(s.filled, s.approved)}%"></span></div>
          <div class="dpct">إشغال ${pct(s.filled, s.approved)}٪ · شاغر ${s.approved - s.filled}${sub ? ` · ${sub} وحدات ↙` : ""}</div></div>`;
      }).join("");
      const addBtn = canEdit() ? `<button class="btn btn-p" onclick="APP.openForm('unit')">${icon("plus")} إضافة إدارة / قسم</button>` : "";
      ch = `<div style="margin-top:18px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;flex-wrap:wrap;gap:10px">
        <div class="bt ttl-edit" style="font-size:13.5px;color:var(--g-900);margin:0">الإدارات / الأقسام التابعة</div>${addBtn}</div>
        <div class="dgrid" style="margin-bottom:0">${cardsHtml}</div></div>`;
    }

    const sub = kids.length
      ? `<div class="dsub">يضم ${kids.length} إدارة/قسم · الإحصائيات مجمّعة على الكل</div>`
      : '<div class="dsub">وحدة تنظيمية نهائية</div>';

    return `<div class="mrow full"><div class="vhost"><div class="view show">
      ${crumbs}<div class="dhead"><h3>${esc(name)}</h3>${chips}</div>${sub}${charts}${ch}</div></div></div>`;
  }

  /* ---------------- غلاف التبويبات ---------------- */
  function tabbed(tabs, views, side) {
    const active = state.tab || tabs[0][0];
    const t = tabs.map(([k, l]) => `<div class="ptab ${k === active ? "on" : ""}" onclick="APP.setTab('${k}')">${esc(l)}</div>`).join("");
    const v = views.map(([k, html]) => `<div class="view ${k === active ? "show" : ""}" id="v-${k}">${html}</div>`).join("");
    return `<div class="ptabs">${t}</div>
      <div class="mrow${side ? "" : " full"}"><div class="vhost">${v}</div>
      ${side ? `<div class="panel side-panel">${side}</div>` : ""}</div>`;
  }

  /* ---------------- الهيكل العام ---------------- */
  function shell(title, body) {
    const nav = [["index", "الرئيسية", "home"], ["recruitment", "التوظيف", "users"], ["training", "التدريب", "cap"],
    ["resignations", "الاستقالات", "exit"], ["sectors", "القطاعات", "office"]];
    const rail = nav.map(([p, t, ic]) => `<a href="#/${p === "index" ? "" : p}" class="${state.page === p ? "on" : ""}"><span class="tip">${t}</span>${icon(ic)}</a>`).join("");

    const unitOpts = `<option value="">الكل</option>` + units().map((u) =>
      `<option value="${u.id}" ${state.filters.unit === u.id ? "selected" : ""}>${esc((u.parent_id ? "— " : "") + u.name)}</option>`).join("");
    const yearOpts = (CFG.YEARS || [2026]).map((y) => `<option value="${y}" ${Number(state.filters.year) === y ? "selected" : ""}>${y}</option>`).join("");
    const monthOpts = `<option value="0">كل الأشهر</option>` + MONTHS_FULL.map((m, i) =>
      `<option value="${i + 1}" ${Number(state.filters.month) === i + 1 ? "selected" : ""}>${m}</option>`).join("");

    const editBtn = canEdit() ? `<button class="btn btn-g" onclick="APP.toggleEdit()">${icon("pen")} تعديل العناوين</button>` : "";
    const today = new Date();
    const dateTxt = `${today.getDate()} ${MONTHS_FULL[today.getMonth()]} ${today.getFullYear()}`;

    return `<div class="shell"><div class="board">
      <div class="rail">${rail}</div>
      <div class="content">
        <div class="chead">
          <div class="ttl"><img class="hlogo" src="assets/adaa-logo.png" alt="أداء"><div class="div"></div>
            <div><h1>${esc(title)}</h1><div class="crumb">${esc(CFG.ORG_NAME || "")}</div></div></div>
          <div class="who"><div class="meta"><div class="nm">${esc(state.user.name)}</div>
            <div class="rl">${state.user.role === "editor" ? "مُدخِل بيانات" : "عرض فقط"}</div></div>
            <div class="av">${esc((state.user.name || "?").trim()[0])}</div>
            <button class="iact logout" title="تسجيل الخروج" onclick="APP.logout()">${icon("logout")}</button></div>
        </div>
        <div class="toolbar">
          <label class="tb sel-wrap"><span class="k">القطاع / الإدارة</span>
            <select onchange="APP.setFilter('unit',this.value)">${unitOpts}</select>${CHEV}</label>
          <label class="tb sel-wrap"><span class="k">السنة</span>
            <select onchange="APP.setFilter('year',this.value)">${yearOpts}</select>${CHEV}</label>
          <label class="tb sel-wrap"><span class="k">الشهر</span>
            <select onchange="APP.setFilter('month',this.value)">${monthOpts}</select>${CHEV}</label>
          <div class="sp"></div>${editBtn}
          <div class="tb">📅 <b>${dateTxt}</b></div>
        </div>
        ${body}
      </div></div>
      <div class="foot">${DB.isRemote ? "متصل بقاعدة البيانات" : "وضع تجريبي محلي — البيانات محفوظة في هذا المتصفح"}</div>
      <div class="editbar"><span>وضع تعديل العناوين مُفعّل — اضغط على أي عنوان وعدّله</span>
        <button class="btn btn-p" onclick="APP.saveTitles()">حفظ التعديلات</button>
        <button class="btn btn-x" onclick="APP.toggleEdit()">إلغاء</button></div>
      <div class="mask" id="formMask"><div class="sheet" id="formSheet"></div></div>
    </div>`;
  }

  /* ---------------- النماذج ---------------- */
  const unitSelect = (val) => units().map((u) => `<option value="${u.id}" ${val === u.id ? "selected" : ""}>${esc((u.parent_id ? "— " : "") + u.name)}</option>`).join("");
  const opts = (arr, val) => arr.map((o) => `<option value="${esc(o)}" ${String(val) === String(o) ? "selected" : ""}>${esc(o)}</option>`).join("");

  const FORMS = {
    interview: {
      table: "interviews", title: "بيانات المقابلة",
      fields: (r) => [
        ["candidate", "اسم المرشح", "text", r.candidate, null, false],
        ["position", "المنصب", "text", r.position, null, false],
        ["unit_id", "الإدارة", "select", r.unit_id, unitSelect(r.unit_id), false],
        ["owner", "مالك الوظيفة", "text", r.owner, null, false],
        ["date", "التاريخ", "text", r.date, null, false],
        ["day", "اليوم", "select", r.day, opts(["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"], r.day), false],
        ["time", "الوقت", "text", r.time, null, false],
        ["status", "الحالة", "select", r.status, opts(["مجدولة", "تمت", "مرفوضة"], r.status), false],
        ["job_source", "مصدر الوظيفة", "select", r.job_source, opts(["توظيف مباشر", "إعلان داخلي", "إعلان خارجي", "منصة توظيف"], r.job_source), false],
        ["cand_source", "مصدر المرشح", "select", r.cand_source, opts(["لينكدإن", "جدارات", "بيت.كوم", "توصية", "أخرى"], r.cand_source), false],
        ["cand_source_name", "اسم مصدر المرشح", "text", r.cand_source_name, null, false],
        ["hr_rating", "تقييم الموارد البشرية", "select", r.hr_rating, opts(["", "ممتاز", "جيد جدًا", "جيد", "مقبول", "ضعيف"], r.hr_rating), false],
        ["mgr_rating", "تقييم الإدارة", "select", r.mgr_rating, opts(["", "ممتاز", "جيد جدًا", "جيد", "مقبول", "ضعيف"], r.mgr_rating), false],
      ],
    },
    candidate: {
      table: "candidates", title: "المرشح والمرحلة",
      fields: (r) => [
        ["name", "اسم المرشح", "text", r.name, null, false],
        ["position", "المنصب", "text", r.position, null, false],
        ["unit_id", "الإدارة", "select", r.unit_id, unitSelect(r.unit_id), false],
        ["stage", "المرحلة الحالية", "select", r.stage == null ? 0 : r.stage,
          STAGES.map((s, i) => `<option value="${i}" ${Number(r.stage) === i ? "selected" : ""}>${s}</option>`).join(""), false],
        ["note", "آخر تحديث / ملاحظة", "text", r.note, null, true],
      ],
    },
    onboarding: {
      table: "onboarding", title: "مرحلة الانضمام",
      fields: (r) => [
        ["name", "اسم المرشح", "text", r.name, null, false],
        ["position", "المنصب", "text", r.position, null, false],
        ["grade", "الدرجة", "select", r.grade, opts(["الخامسة", "السادسة", "السابعة", "الثامنة", "التاسعة", "العاشرة"], r.grade), false],
        ["start_date", "تاريخ المباشرة", "text", r.start_date, null, false],
        ["notes", "الملاحظات", "text", r.notes, null, true],
      ],
    },
    trainee: {
      table: "trainees", title: "بيانات المتدرب",
      fields: (r) => [
        ["name", "اسم المتدرب", "text", r.name, null, false],
        ["university", "الجامعة", "text", r.university, null, false],
        ["supervisor", "المشرف التدريبي", "text", r.supervisor, null, false],
        ["unit_id", "القطاع / الإدارة", "select", r.unit_id, unitSelect(r.unit_id), false],
        ["start_date", "بداية التدريب", "text", r.start_date, null, false],
        ["end_date", "نهاية التدريب", "text", r.end_date, null, false],
        ["phone", "رقم الجوال", "text", r.phone, null, false],
        ["status", "حالة التدريب", "select", r.status, opts(["قائم", "تحت الإجراء", "مكتمل"], r.status), false],
      ],
    },
    resignation: {
      table: "resignations", title: "بيانات الاستقالة",
      fields: (r) => [
        ["name", "الاسم", "text", r.name, null, false],
        ["position", "المنصب", "text", r.position, null, false],
        ["grade", "الدرجة", "select", r.grade, opts(["الخامسة", "السادسة", "السابعة", "الثامنة", "التاسعة", "العاشرة"], r.grade), false],
        ["unit_id", "القطاع / الإدارة", "select", r.unit_id, unitSelect(r.unit_id), false],
        ["last_day", "آخر يوم عمل", "text", r.last_day, null, false],
        ["reason", "السبب (اختياري)", "text", r.reason, null, true],
      ],
    },
    unit: {
      table: "org_units", title: "إدارة / قسم",
      noPeriod: true,
      fields: (r) => [
        ["name", "اسم الإدارة / القسم", "text", r.name, null, true],
        ["parent_id", "التبعية", "select", r.parent_id, `<option value="">— بلا تبعية (قطاع رئيسي)</option>` + unitSelect(r.parent_id), false],
        ["approved", "الوظائف المعتمدة", "number", r.approved, null, false],
        ["filled", "الوظائف المشغولة", "number", r.filled, null, false],
        ["junior", "عدد المبتدئ", "number", r.junior, null, false],
        ["senior", "عدد المتقدم", "number", r.senior, null, false],
        ["male", "عدد الذكور", "number", r.male, null, false],
        ["female", "عدد الإناث", "number", r.female, null, false],
      ],
    },
  };

  function openForm(kind, id) {
    if (!canEdit()) return;
    const F = FORMS[kind];
    const row = id ? (db()[F.table] || []).find((r) => r.id === id) || {} : {};
    const fh = F.fields(row).map(([k, lbl, type, val, sel, full]) => {
      const inp = sel != null
        ? `<select class="inp" data-k="${k}">${sel}</select>`
        : `<input class="inp" data-k="${k}" type="${type}" value="${esc(val == null ? "" : val)}" placeholder="اكتب هنا…">`;
      return `<div class="fld2 ${full ? "full" : ""}"><label>${esc(lbl)}</label>${inp}</div>`;
    }).join("");

    const period = F.noPeriod ? "" : `
      <div class="fld2"><label>السنة</label><select class="inp" data-k="year">
        ${(CFG.YEARS || [2026]).map((y) => `<option value="${y}" ${Number(row.year || state.filters.year) === y ? "selected" : ""}>${y}</option>`).join("")}
      </select></div>
      <div class="fld2"><label>الشهر</label><select class="inp" data-k="month">
        ${MONTHS_FULL.map((m, i) => `<option value="${i + 1}" ${Number(row.month || new Date().getMonth() + 1) === i + 1 ? "selected" : ""}>${m}</option>`).join("")}
      </select></div>`;

    $("#formSheet").innerHTML = `
      <div class="sheet-h"><h3>${id ? "تعديل" : "إضافة"} — ${esc(F.title)}</h3>
        <button class="xbtn" onclick="APP.closeForm()">✕</button></div>
      <div class="sheet-b"><div class="frm">${fh}${period}</div></div>
      <div class="sheet-f"><button class="btn btn-p" onclick="APP.saveForm('${kind}','${id || ""}')">${icon("check")} حفظ</button>
        <button class="btn btn-x" onclick="APP.closeForm()">إلغاء</button></div>`;
    $("#formMask").classList.add("open");
  }

  async function saveForm(kind, id) {
    const F = FORMS[kind];
    const payload = {};
    $("#formSheet").querySelectorAll("[data-k]").forEach((el) => {
      let v = el.value;
      if (el.type === "number" || ["stage", "year", "month", "approved", "filled", "junior", "senior", "male", "female"].includes(el.dataset.k)) {
        v = v === "" ? null : Number(v);
      }
      payload[el.dataset.k] = v;
    });
    try {
      if (id) await DB.update(F.table, id, payload);
      else await DB.insert(F.table, payload);
      closeForm();
      render();
      toast(id ? "تم حفظ التعديلات" : "تمت الإضافة بنجاح");
    } catch (e) {
      alert("تعذّر الحفظ: " + e.message);
    }
  }

  async function removeRow(table, id) {
    if (!confirm("هل تريد حذف هذا السجل؟")) return;
    try { await DB.remove(table, id); render(); toast("تم الحذف"); }
    catch (e) { alert("تعذّر الحذف: " + e.message); }
  }

  const closeForm = () => $("#formMask") && $("#formMask").classList.remove("open");

  function toast(msg) {
    let t = $(".toast");
    if (!t) { t = document.createElement("div"); t.className = "toast"; document.body.appendChild(t); }
    t.textContent = msg;
    t.classList.add("show");
    setTimeout(() => t.classList.remove("show"), 2200);
  }

  /* ---------------- تعديل العناوين ---------------- */
  function toggleEdit() {
    state.edit = !state.edit;
    document.body.classList.toggle("edit", state.edit);
    document.querySelectorAll(".ttl-edit, .chead h1, .dhead h3").forEach((el) => {
      el.classList.toggle("editable", state.edit);
      el.contentEditable = state.edit ? "true" : "false";
    });
  }
  async function saveTitles() {
    const map = {};
    document.querySelectorAll(".ttl-edit").forEach((el) => { if (el.dataset.k) map[el.dataset.k] = el.textContent.trim(); });
    try {
      const rec = (db().settings || []).find((s) => s.key === "titles");
      if (rec) await DB.update("settings", rec.id, { value: JSON.stringify(map) });
      else await DB.insert("settings", { key: "titles", value: JSON.stringify(map) });
      toast("تم حفظ العناوين");
    } catch (e) { alert("تعذّر الحفظ: " + e.message); }
    toggleEdit();
  }
  function applyTitles() {
    let map = {};
    try { map = JSON.parse(((db().settings || []).find((s) => s.key === "titles") || {}).value || "{}"); } catch (e) {}
    document.querySelectorAll(".ttl-edit").forEach((el) => {
      const k = el.dataset.k;
      if (k && map[k]) el.textContent = map[k];
    });
  }

  /* ---------------- التوجيه والعرض ---------------- */
  const PAGES = {
    index: { title: "اللوحة الرئيسية", render: pageIndex },
    recruitment: { title: "التوظيف", render: pageRecruitment },
    training: { title: "التدريب", render: pageTraining },
    resignations: { title: "الاستقالات", render: pageResignations },
    sectors: { title: "القطاعات", render: pageSectors },
  };

  function readHash() {
    const h = (location.hash || "#/").replace(/^#\/?/, "").split("/")[0];
    state.page = PAGES[h] ? h : "index";
  }

  function render() {
    const P = PAGES[state.page];
    document.getElementById("app").innerHTML = shell(P.title, P.render());
    document.title = P.title + " · أداء";
    applyTitles();
    if (state.edit) { state.edit = false; toggleEdit(); }
  }

  /* ---------------- الدخول ---------------- */
  function loginScreen(msg) {
    const demo = !DB.isRemote;
    document.getElementById("app").innerHTML = `
      <div class="login-wrap"><div class="login-card">
        <img src="assets/adaa-logo.png" alt="أداء" class="login-logo">
        <h2>متابعة إدارة استقطاب المواهب</h2>
        <p class="login-sub">${demo ? "وضع تجريبي — أدخل اسمك للدخول" : "سجّل الدخول بحساب المركز"}</p>
        ${msg ? `<div class="login-err">${esc(msg)}</div>` : ""}
        ${demo ? `
          <div class="fld2 full"><label>الاسم</label><input class="inp" id="dname" placeholder="مثال: أحمد الغانم"></div>
          <div class="fld2 full"><label>الصلاحية</label><select class="inp" id="drole">
            <option value="editor">مُدخِل بيانات</option><option value="viewer">عرض فقط (الإدارة)</option></select></div>
          <button class="btn btn-p login-btn" onclick="APP.demoLogin()">دخول</button>`
        : `
          <div class="fld2 full"><label>البريد الإلكتروني</label><input class="inp" id="email" type="email" placeholder="name@adaa.gov.sa"></div>
          <div class="fld2 full"><label>كلمة المرور</label><input class="inp" id="pass" type="password" placeholder="••••••••"></div>
          <button class="btn btn-p login-btn" onclick="APP.login()">تسجيل الدخول</button>`}
      </div></div>`;
  }

  /* ---------------- الواجهة العامة ---------------- */
  window.APP = {
    setTab(k) { state.tab = k; render(); },
    goNode(id) { state.node = id; render(); },
    setFilter(k, v) { state.filters[k] = k === "unit" ? v : Number(v); state.tab = state.tab; render(); },
    toggleEdit, saveTitles, openForm, saveForm, closeForm, removeRow,
    async demoLogin() {
      const name = document.getElementById("dname").value.trim();
      const role = document.getElementById("drole").value;
      if (!name) return alert("فضلًا أدخل الاسم");
      state.user = AUTH.demoSignIn(name, role);
      await boot();
    },
    async login() {
      try {
        state.user = await AUTH.signIn(document.getElementById("email").value.trim(), document.getElementById("pass").value);
        await boot();
      } catch (e) { loginScreen(e.message); }
    },
    async logout() { await AUTH.signOut(); state.user = null; loginScreen(); },
  };

  async function boot() {
    try {
      await DB.loadAll();
      readHash();
      render();
    } catch (e) {
      loginScreen("تعذّر تحميل البيانات: " + e.message);
    }
  }

  window.addEventListener("hashchange", () => { if (state.user) { state.tab = null; readHash(); render(); } });

  (async function init() {
    state.user = await AUTH.current();
    if (state.user) await boot();
    else loginScreen();
  })();
})();
