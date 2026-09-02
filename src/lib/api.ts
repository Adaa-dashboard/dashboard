"use client";

import { ensureAnon, sb, whoAmI } from "./supa";
import { buildWeekly, weekStartOf, type WeeklyInput } from "./weekly";

/* ============================================================
   طبقة ترجمة: الواجهة تنادي نفس مسارات /api/... التي كانت تنادي
   الخادم، وهذه الدالة تترجمها إلى استدعاءات Supabase مباشرة.
   بهذا بقيت الشاشات كما هي ولم يتغيّر إلا مصدر البيانات.
   ============================================================ */

type Init = { method?: string; headers?: Record<string, string>; body?: string };

/* eslint-disable @typescript-eslint/no-explicit-any */
function ok(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async (): Promise<any> => data,
    text: async () => JSON.stringify(data),
  };
}
function err(message: string, status = 400) {
  return ok({ error: message }, status);
}

const num = (v: unknown): number | null => {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v).trim());
const newId = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

/* ---------- تحويل صفوف القاعدة إلى الأشكال التي تتوقعها الشاشات ---------- */
const rowSector = (r: Record<string, unknown>) => ({ id: r.id, name: r.name, order: r.ord });
const rowIndicator = (r: Record<string, unknown>) => ({
  id: r.id, name: r.name, unit: r.unit, active: r.active, order: r.ord,
});
const rowPeriod = (r: Record<string, unknown>) => ({
  id: r.id, label: r.label, order: r.ord, weekStart: r.week_start ?? undefined,
});
const rowMeasurement = (r: Record<string, unknown>) => ({
  id: r.id, sectorId: r.sector_id, indicatorId: r.indicator_id, periodId: r.period_id,
  target: r.target === null ? null : Number(r.target),
  actual: r.actual === null ? null : Number(r.actual),
  updatedBy: r.updated_by, updatedAt: r.updated_at,
});
const rowTask = (r: Record<string, unknown>) => ({
  id: r.id, title: r.title, description: r.description ?? "",
  assigneeId: r.assignee_id, priority: r.priority, dueDate: r.due_date,
  indicatorId: r.indicator_id ?? undefined, state: r.state,
  kind: r.kind === "assignment" ? "assignment" : "task",
  updates: Array.isArray(r.updates) ? r.updates : [],
  createdById: r.created_by_id, createdAt: r.created_at,
  completedAt: r.completed_at ?? undefined,
});
const rowNote = (r: Record<string, unknown>) => ({
  id: r.id, sectorId: r.sector_id, indicatorId: r.indicator_id, text: r.body,
  mentions: r.mentions || [], byId: r.by_id, byName: r.by_name, at: r.at,
});
/* طلبات التغيير الواردة من منصة الرؤية — مرآة للملف اليومي */
const rowChange = (r: Record<string, unknown>) => ({
  code: r.code, program: r.program ?? "", itemCode: r.item_code ?? "",
  itemName: r.item_name ?? "", owner: r.owner_entity ?? "",
  category: r.request_cat ?? "", reviewType: r.review_type ?? "",
  classification: r.classification ?? "",
  sla: r.sla_days === null ? null : Number(r.sla_days),
  workDays: r.work_days === null ? null : Number(r.work_days),
  status: r.status, firstSeen: r.first_seen, lastSeen: r.last_seen,
  closedAt: r.closed_at ?? undefined, updatedAt: r.updated_at,
  updatedBy: r.updated_by ?? "",
});

async function people() {
  const { data } = await sb().rpc("perf_list_users");
  return (data || []).map((u: Record<string, unknown>) => ({
    id: String(u.id), name: u.name, role: u.role,
  }));
}

/* ============================================================ */
export async function apiFetch(path: string, init: Init = {}) {
  const method = (init.method || "GET").toUpperCase();
  const body = init.body ? JSON.parse(init.body) : {};
  const url = new URL(path, "http://x");
  const p = url.pathname;
  const q = url.searchParams;
  const s = sb();

  try {
    /* ---------------- الدخول ---------------- */
    if (p === "/api/auth/login" && method === "POST") {
      await ensureAnon();
      const { data, error } = await s.rpc("perf_login", {
        p_username: body.username, p_password: body.password,
      });
      if (error) return err(error.message, 500);
      if (!data) return err("اسم المستخدم أو كلمة المرور غير صحيحة", 401);
      if (data.needsActivation) {
        return ok({ error: "لم تُفعَّل كلمة مرور هذا الحساب بعد", needsActivation: true }, 409);
      }
      return ok({ ok: true, role: data.role });
    }

    if (p === "/api/auth/activate" && method === "POST") {
      await ensureAnon();
      const { data, error } = await s.rpc("perf_activate", {
        p_username: body.username,
        p_phone: body.phone ?? null,
        p_last4: body.last4 ?? null,
        p_password: body.password,
        p_sectors: body.sectorIds ?? null,
      });
      if (error) return err(error.message, 500);
      if (!data) return err("اسم المستخدم أو رقم الجوال غير صحيح", 401);
      if (data.error === "short") return err("كلمة المرور لا تقل عن ٦ أحرف", 400);
      return ok({ ok: true, role: data.role });
    }

    if (p === "/api/auth/logout" && method === "POST") {
      await s.auth.signOut();
      return ok({ ok: true });
    }

    if (p === "/api/me/password" && method === "PATCH") {
      const { data, error } = await s.rpc("perf_change_password", {
        p_current: body.current, p_next: body.next,
      });
      if (error) return err(error.message, 500);
      if (data?.error === "wrong_current") return err("كلمة المرور الحالية غير صحيحة", 400);
      if (data?.error === "short") return err("كلمة المرور الجديدة لا تقل عن ٦ أحرف", 400);
      if (data?.error) return err("تعذّر التغيير", 400);
      return ok({ ok: true });
    }

    if (p === "/api/me") {
      const me = await whoAmI();
      return ok({ user: me });
    }

    /* ---------------- المرجعيات ---------------- */
    if (p === "/api/sectors" && method === "GET") {
      const { data } = await s.from("perf_sectors").select("*").order("ord");
      return ok({ sectors: (data || []).map(rowSector) });
    }
    if (p === "/api/sectors" && method === "POST") {
      const { error } = await s.from("perf_sectors")
        .insert({ id: "sec-" + newId(), name: String(body.name).trim(), ord: 99 });
      if (error) return err(error.message, 403);
      return ok({ ok: true });
    }
    if (p.startsWith("/api/sectors/")) {
      const id = p.split("/")[3];
      if (method === "PATCH") {
        const { error } = await s.from("perf_sectors").update({ name: body.name }).eq("id", id);
        if (error) return err(error.message, 403);
      } else if (method === "DELETE") {
        const { error } = await s.from("perf_sectors").delete().eq("id", id);
        if (error) return err(error.message, 403);
      }
      return ok({ ok: true });
    }

    if (p === "/api/indicators" && method === "GET") {
      const { data } = await s.from("perf_indicators").select("*").order("ord");
      return ok({ indicators: (data || []).map(rowIndicator) });
    }
    if (p === "/api/indicators" && method === "POST") {
      const { error } = await s.from("perf_indicators").insert({
        id: "ind-" + newId(), name: String(body.name).trim(),
        unit: body.unit === "number" ? "number" : "percent", ord: 99,
      });
      if (error) return err(error.message, 403);
      return ok({ ok: true });
    }

    if (p === "/api/periods" && method === "GET") {
      const { data } = await s.from("perf_periods").select("*").order("ord");
      return ok({ periods: (data || []).map(rowPeriod) });
    }
    if (p === "/api/periods" && method === "POST") {
      const id = "per-" + newId();
      const { error } = await s.from("perf_periods")
        .insert({ id, label: body.label || "التحديث", ord: 99 });
      if (error) return err(error.message, 403);
      return ok({ period: { id, label: body.label || "التحديث", order: 99 } });
    }

    if (p === "/api/targets" && method === "GET") {
      const { data } = await s.from("perf_targets").select("*");
      const targets: Record<string, number | number[]> = {};
      for (const r of data || []) targets[`${r.sector_id}|${r.indicator_id}`] = r.value;
      return ok({ targets });
    }
    if (p === "/api/targets" && (method === "PUT" || method === "POST")) {
      const rows = Object.entries(body.targets || {}).map(([k, v]) => {
        const [sector_id, indicator_id] = k.split("|");
        return { sector_id, indicator_id, value: v };
      });
      if (rows.length) {
        const { error } = await s.from("perf_targets")
          .upsert(rows, { onConflict: "sector_id,indicator_id" });
        if (error) return err(error.message, 403);
      }
      return ok({ ok: true });
    }

    if (p === "/api/settings" && method === "GET") {
      const { data } = await s.from("perf_settings").select("*");
      const map: Record<string, unknown> = {};
      for (const r of data || []) map[r.key] = r.value;
      return ok({ settings: { statuses: map.statuses || [], targetMode: map.targetMode || "annual" } });
    }
    if (p === "/api/settings" && (method === "PUT" || method === "POST")) {
      const rows: { key: string; value: unknown }[] = [];
      if (body.statuses) rows.push({ key: "statuses", value: body.statuses });
      if (body.targetMode) rows.push({ key: "targetMode", value: body.targetMode });
      if (rows.length) {
        const { error } = await s.from("perf_settings").upsert(rows, { onConflict: "key" });
        if (error) return err(error.message, 403);
      }
      return ok({ ok: true });
    }

    /* ---------------- القياسات ---------------- */
    if (p === "/api/measurements" && method === "GET") {
      let qq = s.from("perf_measurements").select("*");
      const sid = q.get("sectorId");
      if (sid) qq = qq.eq("sector_id", sid);
      const { data } = await qq;
      return ok({ measurements: (data || []).map(rowMeasurement) });
    }
    if (p === "/api/measurements" && method === "PUT") {
      const me = await whoAmI();
      const items = Array.isArray(body.items) ? body.items : [];
      for (const it of items) {
        if (!it.sectorId || !it.indicatorId || !it.periodId) continue;
        const { error } = await s.from("perf_measurements").upsert(
          {
            id: `${it.sectorId}|${it.indicatorId}|${it.periodId}`,
            sector_id: it.sectorId, indicator_id: it.indicatorId, period_id: it.periodId,
            target: num(it.target), actual: num(it.actual),
            updated_by: me?.username || "", updated_at: new Date().toISOString(),
          },
          { onConflict: "sector_id,indicator_id,period_id" }
        );
        if (error) return err("لا تملك صلاحية على هذا القطاع", 403);
      }
      return ok({ ok: true });
    }

    /* ---------------- المستخدمون ---------------- */
    if (p === "/api/users" && method === "GET") {
      const { data, error } = await s.rpc("perf_list_users");
      if (error) return err("غير مصرّح", 403);
      return ok({
        users: (data || []).map((u: Record<string, unknown>) => ({
          id: String(u.id), username: u.username, name: u.name, phone: u.phone,
          role: u.role, sectorIds: u.sector_ids || [], active: u.active,
          hasPassword: u.has_password,
        })),
      });
    }
    if (p === "/api/users" && method === "POST") {
      const { data, error } = await s.rpc("perf_save_user", {
        p_id: null, p_username: body.username, p_name: body.name, p_phone: body.phone,
        p_role: body.role, p_sectors: body.sectorIds || [], p_active: true,
        p_password: body.password || null, p_clear_password: false,
      });
      if (error) return err("غير مصرّح", 403);
      if (data?.error === "dup_username") return err("اسم المستخدم مستخدَم مسبقًا", 400);
      if (data?.error === "short") return err("كلمة المرور لا تقل عن ٦ أحرف", 400);
      if (data?.error === "no_username") return err("اسم المستخدم مطلوب", 400);
      return ok({ ok: true, user: { id: data.id, name: body.name || body.username } });
    }
    if (p.startsWith("/api/users/")) {
      const id = p.split("/")[3];
      if (method === "DELETE") {
        const { data, error } = await s.rpc("perf_delete_user", { p_id: id });
        if (error) return err("غير مصرّح", 403);
        if (data?.error === "self_delete") return err("لا يمكنك حذف حسابك الخاص", 400);
        return ok({ ok: true });
      }
      if (method === "PATCH") {
        const cur = (await s.rpc("perf_list_users")).data?.find(
          (u: Record<string, unknown>) => String(u.id) === id
        );
        if (!cur) return err("المستخدم غير موجود", 404);
        const { data, error } = await s.rpc("perf_save_user", {
          p_id: id,
          p_username: body.username ?? cur.username,
          p_name: body.name ?? cur.name,
          p_phone: body.phone ?? "",
          p_role: body.role ?? cur.role,
          p_sectors: body.sectorIds ?? null,
          p_active: typeof body.active === "boolean" ? body.active : cur.active,
          p_password: body.password || null,
          p_clear_password: body.clearPassword === true,
        });
        if (error) return err("غير مصرّح", 403);
        if (data?.error === "dup_username") return err("اسم المستخدم مستخدَم مسبقًا", 400);
        if (data?.error === "short") return err("كلمة المرور لا تقل عن ٦ أحرف", 400);
        if (data?.error === "self_demote") return err("لا يمكنك سحب صلاحيتك من نفسك", 400);
        if (data?.error === "self_disable") return err("لا يمكنك إيقاف حسابك الخاص", 400);
        return ok({ ok: true });
      }
    }

    /* ---------------- المهام ---------------- */
    if (p === "/api/tasks" && method === "GET") {
      const [{ data }, ppl] = await Promise.all([
        s.from("perf_tasks").select("*").order("created_at", { ascending: false }),
        people(),
      ]);
      return ok({ tasks: (data || []).map(rowTask), people: ppl });
    }
    if (p === "/api/tasks" && method === "POST") {
      const me = await whoAmI();
      const { error } = await s.from("perf_tasks").insert({
        id: "tsk-" + newId(), title: body.title, description: body.description || "",
        assignee_id: body.assigneeId,
        priority: body.priority === "high" ? "high" : "mid",
        due_date: body.dueDate, indicator_id: body.indicatorId || null,
        kind: body.kind === "assignment" ? "assignment" : "task",
        state: "ok", updates: [], created_by_id: me?.id || "",
      });
      if (error) return err(error.message, 403);
      return ok({ ok: true });
    }
    if (p.startsWith("/api/tasks/")) {
      const id = p.split("/")[3];
      if (method === "DELETE") {
        const { error } = await s.from("perf_tasks").delete().eq("id", id);
        if (error) return err("الحذف لمدير الإدارة وحده", 403);
        return ok({ ok: true });
      }
      if (method === "PATCH") {
        const me = await whoAmI();
        const { data: cur } = await s.from("perf_tasks").select("*").eq("id", id).maybeSingle();
        if (!cur) return err("المهمة غير موجودة", 404);
        const updates = Array.isArray(cur.updates) ? [...cur.updates] : [];
        if (body.text && String(body.text).trim()) {
          updates.push({
            id: newId(), text: String(body.text).trim(),
            byId: me?.id || "", byName: me?.name || "", at: new Date().toISOString(),
          });
        }
        const patch: Record<string, unknown> = { updates };
        if (body.state) {
          patch.state = body.state;
          patch.completed_at = body.state === "done" ? new Date().toISOString() : null;
        }
        const { error } = await s.from("perf_tasks").update(patch).eq("id", id);
        if (error) return err(error.message, 403);
        return ok({ ok: true });
      }
    }

    /* ---------------- طلبات التغيير (منصة الرؤية) ---------------- */
    if (p === "/api/changes" && method === "GET") {
      const me = await whoAmI();
      if (!me) return err("غير مصرّح", 401);
      const { data, error } = await s
        .from("perf_change_requests")
        .select("*")
        .order("status")
        .order("work_days", { ascending: false });
      if (error) return err(error.message, 403);
      return ok({ changes: (data || []).map(rowChange) });
    }

    /* رفع الملف اليومي: يحدّث الموجود، يضيف الجديد،
       ويُغلق ما اختفى من الملف (أي ما تمت مراجعته). */
    if (p === "/api/changes" && method === "POST") {
      const me = await whoAmI();
      if (!me) return err("غير مصرّح", 401);
      const rows: Record<string, unknown>[] = Array.isArray(body.rows) ? body.rows : [];
      const clean: { row: Record<string, unknown>; code: string }[] = rows
        .map((r) => ({ row: r, code: String(r.code ?? "").trim() }))
        .filter((x) => x.code);
      if (!clean.length) return err("لم يُقرأ أي صف فيه «الرمز» من الملف", 400);

      const today = new Date().toISOString().slice(0, 10);
      const nowISO = new Date().toISOString();
      const codes = [...new Set(clean.map((x) => x.code))];

      // نحافظ على «أول ظهور» للطلبات المعروفة مسبقاً
      const { data: prev } = await s
        .from("perf_change_requests")
        .select("code,first_seen")
        .in("code", codes);
      const firstSeen = new Map((prev || []).map((r) => [r.code as string, r.first_seen as string]));

      const payload = clean.map(({ row: r, code }) => ({
        code,
        program: str(r.program),
        item_code: str(r.itemCode),
        item_name: str(r.itemName),
        owner_entity: str(r.owner),
        request_cat: str(r.category),
        review_type: str(r.reviewType),
        classification: str(r.classification),
        sla_days: num(r.sla),
        work_days: num(r.workDays),
        status: "open",
        first_seen: firstSeen.get(code) || today,
        last_seen: today,
        closed_at: null,
        updated_at: nowISO,
        updated_by: me.name || "",
      }));

      const { error } = await s.from("perf_change_requests").upsert(payload, { onConflict: "code" });
      if (error) return err(error.message, 403);

      // ما كان مفتوحاً ولم يعد في الملف ⇒ تمت مراجعته
      const { data: openRows } = await s
        .from("perf_change_requests")
        .select("code")
        .eq("status", "open");
      const inFile = new Set(codes);
      const gone = (openRows || []).map((r) => r.code as string).filter((c) => !inFile.has(c));
      if (gone.length) {
        await s
          .from("perf_change_requests")
          .update({ status: "closed", closed_at: today, updated_at: nowISO, updated_by: me.name || "" })
          .in("code", gone);
      }
      return ok({ ok: true, saved: payload.length, closed: gone.length });
    }

    /* ---------------- الملاحظات ---------------- */
    if (p === "/api/notes" && method === "GET") {
      let qq = s.from("perf_notes").select("*").order("at");
      const sid = q.get("sectorId");
      const iid = q.get("indicatorId");
      if (sid) qq = qq.eq("sector_id", sid);
      if (iid) qq = qq.eq("indicator_id", iid);
      const [{ data }, ppl] = await Promise.all([qq, people()]);
      return ok({
        notes: (data || []).map(rowNote),
        people: ppl.map((x: { id: string; name: string }) => ({ id: x.id, name: x.name })),
      });
    }
    if (p === "/api/notes" && method === "POST") {
      const me = await whoAmI();
      const { error } = await s.from("perf_notes").insert({
        id: "not-" + newId(), sector_id: body.sectorId, indicator_id: body.indicatorId,
        body: String(body.text).trim(), mentions: body.mentions || [],
        by_id: me?.id || "", by_name: me?.name || "",
      });
      if (error) return err("لا تملك صلاحية على هذا القطاع", 403);
      return ok({ ok: true });
    }

    /* ---------------- أسماء القطاعات قبل الدخول ---------------- */
    if (p === "/api/sectors/public") {
      await ensureAnon();
      const { data } = await s.rpc("perf_public_sectors");
      return ok({ sectors: (data || []).map((r: Record<string, unknown>) => ({ id: r.id, name: r.name })) });
    }

    /* ---------------- آخر التحديثات ---------------- */
    if (p === "/api/activity") {
      const me = await whoAmI();
      if (!me) return err("غير مصرّح", 401);
      if (method === "POST") {
        await s.from("perf_last_seen").upsert(
          { app_user_id: Number(me.id), at: new Date().toISOString() },
          { onConflict: "app_user_id" }
        );
        return ok({ ok: true });
      }
      const [ms, nt, tk, sec, ind, seen] = await Promise.all([
        s.from("perf_measurements").select("*").order("updated_at", { ascending: false }).limit(30),
        s.from("perf_notes").select("*").order("at", { ascending: false }).limit(20),
        s.from("perf_tasks").select("*").order("created_at", { ascending: false }).limit(20),
        s.from("perf_sectors").select("id,name"),
        s.from("perf_indicators").select("id,name"),
        s.from("perf_last_seen").select("at").eq("app_user_id", Number(me.id)).maybeSingle(),
      ]);
      const secName = new Map((sec.data || []).map((x) => [x.id, x.name]));
      const indName = new Map((ind.data || []).map((x) => [x.id, x.name]));
      const since = seen.data?.at || "";
      // sectorId/indicatorId/taskId يحملها زر «عرض» ليفتح مصدر التحديث
      type Item = {
        id: string; kind: string; tone: string; title: string; sub: string;
        at: string; unread: boolean;
        sectorId?: string; indicatorId?: string; taskId?: string;
      };
      const items: Item[] = [];
      for (const m of ms.data || []) {
        if (m.actual === null) continue;
        items.push({
          id: "m" + m.id, kind: "measurement", tone: "info",
          title: `تحديث ${indName.get(m.indicator_id) || ""}`,
          sub: `${secName.get(m.sector_id) || ""} · ${m.actual}`,
          at: m.updated_at, unread: !since || m.updated_at > since,
          sectorId: m.sector_id, indicatorId: m.indicator_id,
        });
      }
      for (const n of nt.data || []) {
        items.push({
          id: "n" + n.id, kind: "note", tone: "warn",
          title: `${n.by_name} كتب ملاحظة`,
          sub: `${secName.get(n.sector_id) || ""} · ${indName.get(n.indicator_id) || ""}`,
          at: n.at, unread: !since || n.at > since,
          sectorId: n.sector_id, indicatorId: n.indicator_id,
        });
      }
      for (const t of tk.data || []) {
        const done = t.state === "done";
        const isAsg = t.kind === "assignment";
        items.push({
          id: "t" + t.id,
          kind: isAsg ? "assignment" : "task",
          tone: done ? "good" : t.state === "risk" ? "bad" : "info",
          title: done ? `${isAsg ? "اكتمل التكليف" : "اكتملت المهمة"}: ${t.title}` : t.title,
          sub: `تنتهي ${t.due_date}`,
          at: t.completed_at || t.created_at,
          unread: !since || (t.completed_at || t.created_at) > since,
          taskId: t.id,
        });
      }
      items.sort((a, b) => (b.at || "").localeCompare(a.at || ""));
      const top = items.slice(0, 6);
      return ok({ activity: top, unread: top.filter((x) => x.unread).length });
    }

    /* ---------------- الإنجاز الأسبوعي ---------------- */
    if (p === "/api/report" && method === "GET") {
      const me = await whoAmI();
      if (!me) return err("غير مصرّح", 401);
      const asked = q.get("week") || "";
      const week = /^\d{4}-\d{2}-\d{2}$/.test(asked)
        ? weekStartOf(asked)
        : weekStartOf(new Date().toISOString().slice(0, 10));

      const [ms, sec, ind, tk, tg, st, ppl] = await Promise.all([
        s.from("perf_measurements").select("*"),
        s.from("perf_sectors").select("*").order("ord"),
        s.from("perf_indicators").select("*").eq("active", true).order("ord"),
        s.from("perf_tasks").select("*"),
        s.from("perf_targets").select("*"),
        s.from("perf_settings").select("*").eq("key", "statuses").maybeSingle(),
        people(),
      ]);
      const targets: Record<string, number | number[]> = {};
      for (const r of tg.data || []) targets[`${r.sector_id}|${r.indicator_id}`] = r.value;

      const input: WeeklyInput = {
        measurements: (ms.data || []).map((r) => ({
          sectorId: r.sector_id, indicatorId: r.indicator_id,
          actual: r.actual === null ? null : Number(r.actual), updatedAt: r.updated_at,
        })),
        sectors: (sec.data || []).map((r) => ({ id: r.id, name: r.name })),
        indicators: (ind.data || []).map((r) => ({ id: r.id, name: r.name, unit: r.unit })),
        tasks: (tk.data || []).map((r) => ({
          id: r.id, title: r.title, assigneeId: r.assignee_id, createdById: r.created_by_id,
          dueDate: r.due_date, state: r.state,
          updates: Array.isArray(r.updates) ? r.updates : [],
          completedAt: r.completed_at ?? undefined,
        })),
        users: ppl.map((x: { id: string; name: string }) => ({ id: x.id, name: x.name })),
        targets,
        statuses: (st.data?.value as WeeklyInput["statuses"]) || [],
      };
      const report = buildWeekly(week, input, {
        id: me.id, role: me.role, sectorIds: me.sectorIds,
      });
      return ok({ report, canShare: me.role === "admin" });
    }

    if (p === "/api/report/share") {
      const me = await whoAmI();
      if (!me || me.role !== "admin") return err("غير مصرّح", 403);
      if (method === "GET") {
        const { data } = await s.from("perf_shares").select("*").order("created_at", { ascending: false });
        return ok({
          shares: (data || []).map((r) => ({
            token: r.token, weekStart: r.week_start, createdAt: r.created_at,
            expiresAt: r.expires_at, views: r.views, lastView: r.last_view,
          })),
        });
      }
      if (method === "POST") {
        const token = newId() + newId();
        const days = body.days === null || body.days === "" ? null : Number(body.days);
        const { error } = await s.from("perf_shares").insert({
          token, week_start: weekStartOf(String(body.weekStart)), created_by: me.username,
          expires_at: days && days > 0 ? new Date(Date.now() + days * 86400000).toISOString() : null,
        });
        if (error) return err(error.message, 400);
        return ok({ token });
      }
      if (method === "DELETE") {
        const token = q.get("token") || "";
        const { error } = await s.from("perf_shares").delete().eq("token", token);
        if (error) return err(error.message, 400);
        return ok({ ok: true });
      }
    }

    return err("مسار غير معروف: " + p, 404);
  } catch (e) {
    return err(e instanceof Error ? e.message : "خطأ غير متوقع", 500);
  }
}
