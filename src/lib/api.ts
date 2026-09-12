"use client";

import { ensureAnon, sb, whoAmI } from "./supa";
import { weekStartOf } from "./weeklyReport";

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
/* بنود الأقسام الخمسة — المحتوى في data وشكله يختلف حسب القسم */
const rowItem = (r: Record<string, unknown>) => ({
  id: String(r.id),
  ord: Number(r.ord ?? 100),
  data: (r.data || {}) as Record<string, unknown>,
  updatedAt: r.updated_at,
  updatedBy: r.updated_by ?? "",
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
  // perf_people متاحة لكل مسجَّل — قائمة الأسماء يحتاجها الجميع،
  // بخلاف perf_list_users المحصورة بصلاحية «المستخدمون والصلاحيات»
  const { data } = await sb().rpc("perf_people");
  return (data || []).map((u: Record<string, unknown>) => ({
    id: String(u.id), name: u.name, role: u.role, sectorIds: u.sector_ids || [],
    isLead: u.is_lead === true, jobTitle: u.job_title || "",
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
      /* «مقفل»: الجوال المخزَّن ليس رقماً — لا خطأ فيما أدخله.
         الرسالة العامة كانت تدور بالموظف بلا فائدة */
      if (data.error === "locked")
        return err("حسابك لم يُجهَّز بعد: لم يُسجَّل رقم جوالك. راجع مدير المنصة لإضافته ثم أعد المحاولة.", 403);
      if (data.error === "phone") return err("أدخل رقم جوال صحيح", 400);
      if (data.error === "phone_taken") return err("رقم الجوال مسجَّل لحساب آخر", 400);
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

    if (p === "/api/people" && method === "GET") {
      const me = await whoAmI();
      if (!me) return err("غير مصرّح", 401);
      return ok({ people: await people() });
    }

    if (p === "/api/me") {
      const me = await whoAmI();
      if (!me) return ok({ user: null });
      const { data: card } = await s.rpc("perf_me");
      const c = Array.isArray(card) ? card[0] : card;
      return ok({
        user: {
          ...me,
          scopes: Array.isArray(c?.scopes) ? c.scopes : [],
          jobTitle: c?.job_title || "",
          isLead: c?.is_lead === true,
        },
      });
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
          hasPassword: u.has_password, scopes: u.scopes || [],
          isLead: u.is_lead === true, jobTitle: u.job_title || "",
        })),
      });
    }
    if (p === "/api/users" && method === "POST") {
      const { data, error } = await s.rpc("perf_save_user", {
        p_id: null, p_username: body.username, p_name: body.name, p_phone: body.phone,
        p_role: body.role, p_sectors: body.sectorIds || [], p_active: true,
        p_password: body.password || null, p_clear_password: false,
        p_scopes: Array.isArray(body.scopes) ? body.scopes : null,
        p_is_lead: body.isLead === true,
        p_job_title: typeof body.jobTitle === "string" ? body.jobTitle : null,
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
          p_scopes: Array.isArray(body.scopes) ? body.scopes : null,
          p_is_lead: typeof body.isLead === "boolean" ? body.isLead : null,
          p_job_title: typeof body.jobTitle === "string" ? body.jobTitle : null,
        });
        if (error) return err("غير مصرّح", 403);
        if (data?.error === "dup_username") return err("اسم المستخدم مستخدَم مسبقًا", 400);
        if (data?.error === "short") return err("كلمة المرور لا تقل عن ٦ أحرف", 400);
        if (data?.error === "self_demote") return err("لا يمكنك سحب صلاحيتك من نفسك", 400);
        if (data?.error === "self_scope")
          return err("لا يمكنك سحب صلاحية «المستخدمون والصلاحيات» من نفسك", 400);
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
    /* بيانات تجريبية للعرض — معرّفاتها تبدأ بـ tsk-demo- فتُميَّز وتُحذف دفعة واحدة.
       تُدرج بمُسنِد صريح (created_by_id) حتى تظهر «من مديري» كما تظهر في الواقع. */
    if (p === "/api/tasks/demo") {
      if (method === "POST") {
        const rows = (Array.isArray(body.tasks) ? body.tasks : []).map(
          (x: Record<string, unknown>) => ({
            id: String(x.id),
            title: String(x.title || ""),
            description: String(x.description || ""),
            assignee_id: String(x.assigneeId || ""),
            priority: x.priority === "high" ? "high" : "mid",
            due_date: x.dueDate,
            indicator_id: null,
            kind: x.kind === "assignment" ? "assignment" : "task",
            state: x.state === "done" ? "done" : x.state === "risk" ? "risk" : "ok",
            updates: Array.isArray(x.updates) ? x.updates : [],
            created_by_id: String(x.createdById || ""),
            completed_at: x.state === "done" ? new Date().toISOString() : null,
          })
        );
        if (!rows.length) return err("لا توجد بيانات", 400);
        if (rows.some((r: { id: string }) => !r.id.startsWith("tsk-demo-")))
          return err("معرّف غير تجريبي", 400);
        const { error } = await s.from("perf_tasks").upsert(rows, { onConflict: "id" });
        if (error) return err(error.message, 403);
        return ok({ ok: true, count: rows.length });
      }
      if (method === "DELETE") {
        const kind = q.get("kind");
        let del = s.from("perf_tasks").delete().like("id", "tsk-demo-%");
        if (kind) del = del.eq("kind", kind);
        const { error } = await del;
        if (error) return err("حذف البيانات التجريبية لمدير الإدارة وحده", 403);
        return ok({ ok: true });
      }
    }

    /* إعادة بند محذوف كما كان — للتراجع عن الحذف.
       يُدرج بمعرّفه وتاريخه وتحديثاته الأصلية، فلا يُعدّ بنداً جديداً. */
    if (p === "/api/tasks/restore" && method === "POST") {
      const x = (body.task || {}) as Record<string, unknown>;
      const id = String(x.id || "");
      if (!id) return err("لا يوجد بند لإعادته", 400);
      const { error } = await s.from("perf_tasks").insert({
        id,
        title: String(x.title || ""),
        description: String(x.description || ""),
        assignee_id: String(x.assigneeId || ""),
        priority: x.priority === "high" ? "high" : "mid",
        due_date: x.dueDate,
        indicator_id: x.indicatorId || null,
        kind: x.kind === "assignment" ? "assignment" : "task",
        state: x.state === "done" ? "done" : x.state === "risk" ? "risk" : "ok",
        updates: Array.isArray(x.updates) ? x.updates : [],
        created_by_id: String(x.createdById || ""),
        created_at: x.createdAt || new Date().toISOString(),
        completed_at: x.completedAt || null,
      });
      if (error) return err("تعذّرت إعادة البند", 403);
      return ok({ ok: true });
    }

    if (p.startsWith("/api/tasks/")) {
      const id = p.split("/")[3];
      if (method === "DELETE") {
        // RLS ترفض بلا خطأ: تُرجع صفراً من الصفوف. لذلك نطلب المحذوف
        // بـ select ونتحقق منه، وإلا بدا الحذف ناجحاً والبند باقٍ.
        const { data, error } = await s.from("perf_tasks").delete().eq("id", id).select("id");
        if (error) return err("تعذّر الحذف — الصلاحية لمن سجّل البند أو لمدير الإدارة", 403);
        if (!data || data.length === 0) return err("الحذف لمن سجّل البند أو لمدير الإدارة", 403);
        return ok({ ok: true });
      }
      if (method === "PATCH") {
        const me = await whoAmI();
        const { data: cur } = await s.from("perf_tasks").select("*").eq("id", id).maybeSingle();
        if (!cur) return err("المهمة غير موجودة", 404);
        type Rep = { id: string; text: string; byId: string; byName: string; at: string };
        type Upd = Rep & { replies?: Rep[] };
        const updates: Upd[] = Array.isArray(cur.updates) ? [...cur.updates] : [];
        const text = String(body.text ?? "").trim();
        if (text && body.replyTo) {
          // ردّ على تحديث بعينه — يبقى تحته لا في آخر القائمة
          const i = updates.findIndex((u) => u.id === body.replyTo);
          if (i < 0) return err("التحديث غير موجود", 404);
          const reps = Array.isArray(updates[i].replies) ? [...(updates[i].replies as Rep[])] : [];
          reps.push({
            id: newId(), text,
            byId: me?.id || "", byName: me?.name || "", at: new Date().toISOString(),
          });
          updates[i] = { ...updates[i], replies: reps };
        } else if (text) {
          updates.push({
            id: newId(), text,
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

    /* ---------------- محفظتي — صفوف كل موظف ----------------
       القراءة يحرسها RLS (صاحبها ومديره)، والكتابة لصاحبها وحده. */
    /* تغطية الاجتماعات الربعية على مستوى الإدارة — أعداد فقط.
       الدالة في القاعدة تتحقّق بنفسها ممّن يحقّ له، ولا تُرجع أي
       محتوى من المحافظ: اسم صاحب المحفظة وعدد جهاته وكم منها
       عُقد اجتماع ربعه الحالي. */
    if (p === "/api/team/quarter" && method === "GET") {
      const me = await whoAmI();
      if (!me) return err("غير مصرّح", 401);
      const { data, error } = await s.rpc("perf_team_quarter");
      if (error) return ok({ team: [] });
      return ok({
        team: (Array.isArray(data) ? data : []).map((r: Record<string, unknown>) => ({
          name: String(r.user_name || ""),
          done: Number(r.done || 0),
          total: Number(r.total || 0),
        })),
      });
    }

    if (p === "/api/portfolio" && method === "GET") {
      const me = await whoAmI();
      if (!me) return err("غير مصرّح", 401);
      const section = q.get("section") || "";
      const uid = q.get("user") || me.id;
      let qq = s.from("perf_portfolio").select("*").eq("app_user_id", uid);
      if (section) qq = qq.eq("section", section);
      const { data, error } = await qq.order("ord");
      if (error) return err(error.message, 403);
      return ok({
        items: (data || []).map((r: Record<string, unknown>) => ({
          section: String(r.section),
          id: String(r.id),
          ord: Number(r.ord ?? 100),
          data: (r.data || {}) as Record<string, unknown>,
          updatedAt: r.updated_at,
        })),
      });
    }
    if (p === "/api/portfolio" && (method === "POST" || method === "PUT")) {
      const me = await whoAmI();
      if (!me) return err("غير مصرّح", 401);
      const rows = (Array.isArray(body.items) ? body.items : [body]) as Record<string, unknown>[];
      const payload = rows
        .filter((r) => str(r.section))
        .map((r) => ({
          app_user_id: Number(me.id),
          section: str(r.section),
          id: str(r.id) || "pf-" + newId(),
          ord: num(r.ord) ?? 100,
          data: r.data ?? {},
          updated_at: new Date().toISOString(),
        }));
      if (!payload.length) return err("لا يوجد بند", 400);
      const { error } = await s
        .from("perf_portfolio")
        .upsert(payload, { onConflict: "app_user_id,section,id" });
      if (error) return err(error.message, 403);
      return ok({ ok: true, ids: payload.map((r) => r.id) });
    }
    if (p === "/api/portfolio" && method === "DELETE") {
      const me = await whoAmI();
      if (!me) return err("غير مصرّح", 401);
      const section = q.get("section") || "";
      const id = q.get("id") || "";
      if (!section || !id) return err("لا يوجد بند", 400);
      const { error } = await s
        .from("perf_portfolio")
        .delete()
        .eq("app_user_id", me.id)
        .eq("section", section)
        .eq("id", id);
      if (error) return err(error.message, 403);
      return ok({ ok: true });
    }

    /* ---------------- صلاحيات محفظتي ----------------
       المحفظة خاصة بصاحبها، ولا يراها أحد — ولو كان مديره — إلا
       بمنحٍ صريح منه. الحراسة الحقيقية في RLS؛ ما هنا واجهة فقط. */
    /* ---------------- الجهات ونقاط التواصل ---------------- */
    if (p === "/api/entities" && method === "GET") {
      const me = await whoAmI();
      if (!me) return err("غير مصرّح", 401);
      const [ents, cons, ppl] = await Promise.all([
        s.from("perf_entities").select("*").eq("active", true).order("name"),
        s.from("perf_contacts").select("*"),
        people(),
      ]);
      if (ents.error) return err(ents.error.message, 403);
      const nameOf = new Map(ppl.map((u: { id: string; name: string }) => [String(u.id), u.name]));
      const by = new Map<string, { ours: Record<string, unknown>[]; theirs: Record<string, unknown>[] }>();
      for (const c of (cons.data || []) as Record<string, unknown>[]) {
        const k = String(c.entity_id);
        if (!by.has(k)) by.set(k, { ours: [], theirs: [] });
        const row = {
          id: String(c.id), side: String(c.side || ""), name: String(c.name || ""),
          role: String(c.role || "أساسي"),
          jobTitle: String(c.job_title || ""), email: String(c.email || ""),
          phone: String(c.phone || ""), note: String(c.note || ""),
          userId: c.user_id ? String(c.user_id) : null,
          userName: c.user_id ? nameOf.get(String(c.user_id)) || "" : "",
        };
        (String(c.side) === "نحن" ? by.get(k)!.ours : by.get(k)!.theirs).push(row);
      }
      return ok({
        entities: (ents.data || []).map((e: Record<string, unknown>) => ({
          id: String(e.id), name: String(e.name || ""), kind: String(e.kind || ""),
          sector: String(e.sector || ""), note: String(e.note || ""),
          extra: (e.extra || {}) as Record<string, string>,
          ours: by.get(String(e.id))?.ours || [], theirs: by.get(String(e.id))?.theirs || [],
        })),
      });
    }

    /* استيراد ملف الجهات — الواجهة تقرأ الملف وتُصنّف أعمدته
       وتعرض الخريطة على المستخدم، فلا يصل هنا إلا ما أقرّه. */
    if (p === "/api/entities/import" && method === "POST") {
      const me = await whoAmI();
      if (!me) return err("غير مصرّح", 401);
      type InC = { side: string; role: string; name: string; jobTitle: string; phone: string; email: string };
      type InE = { name: string; kind: string; sector: string; note: string; contacts: InC[]; extra?: Record<string, string> };
      const ents = (Array.isArray(body.entities) ? body.entities : []) as InE[];
      if (!ents.length) return err("لا توجد جهات", 400);

      let nE = 0, nC = 0;
      for (const E of ents) {
        const nm = String(E.name || "").trim();
        if (!nm) continue;
        const { data: cur } = await s.from("perf_entities").select("id").eq("name", nm).maybeSingle();
        const eid = cur?.id ? String(cur.id) : "ent-" + newId();
        const { error: e1 } = await s.from("perf_entities").upsert({
          id: eid, name: nm, kind: str(E.kind), sector: str(E.sector), note: str(E.note),
          extra: E.extra && typeof E.extra === "object" ? E.extra : {}, active: true,
        });
        if (e1) return err("الرفع لمن يملك صلاحية «الجهات»", 403);
        nE++;
        for (const c of E.contacts || []) {
          const side = c.side === "نحن" ? "نحن" : "الجهة";
          const role = c.role === "بديل" ? "بديل" : "أساسي";
          /* المفتاح (الجهة · الطرف · الدور): إعادة الرفع تُحدِّث
             الشخص نفسه ولا تُكرّره، وتغييرُ الاسم تصحيحٌ لا إضافة */
          const { data: dup } = await s.from("perf_contacts").select("id")
            .eq("entity_id", eid).eq("side", side).eq("role", role).maybeSingle();
          const { error: e2 } = await s.from("perf_contacts").upsert({
            id: dup?.id ? String(dup.id) : "con-" + newId(),
            entity_id: eid, side, role,
            name: str(c.name), job_title: str(c.jobTitle),
            email: str(c.email), phone: str(c.phone),
          });
          if (!e2) nC++;
        }
      }
      const { data: link } = await s.rpc("perf_contacts_link");
      const L = Array.isArray(link) ? link[0] : link;
      return ok({ entities: nE, contacts: nC, linked: Number(L?.linked || 0), unmatched: Number(L?.unmatched || 0) });
    }

    /* تعديل نقطة تواصل — من السجلّ أو من صفحة من يتولّى الجهة.
       من يملك ماذا تحسمه RLS ومحرّس القاعدة، لا هذه الدالة. */
    if (p === "/api/entities/contact" && (method === "POST" || method === "PATCH")) {
      const me = await whoAmI();
      if (!me) return err("غير مصرّح", 401);
      const id = str(body.id);
      const patch: Record<string, unknown> = {};
      for (const [k, col] of [["name", "name"], ["jobTitle", "job_title"],
                              ["email", "email"], ["phone", "phone"], ["note", "note"]] as const)
        if (body[k] !== undefined) patch[col] = str(body[k]);
      if (id) {
        const { data, error } = await s.from("perf_contacts").update(patch).eq("id", id).select("id");
        if (error) return err(error.message, 403);
        if (!data?.length) return err("التعديل لمن يتولّى هذه الجهة أو لصاحب صلاحية «الجهات»", 403);
        return ok({ ok: true, id });
      }
      const entityId = str(body.entityId);
      if (!entityId) return err("لا توجد جهة", 400);
      const { data, error } = await s.from("perf_contacts").insert({
        id: "con-" + newId(), entity_id: entityId,
        side: str(body.side) || "الجهة", ...patch,
      }).select("id");
      if (error) return err(error.message, 403);
      if (!data?.length) return err("الإضافة لمن يتولّى هذه الجهة", 403);
      return ok({ ok: true, id: String(data[0].id) });
    }

    if (p.startsWith("/api/entities/contact/") && method === "DELETE") {
      const me = await whoAmI();
      if (!me) return err("غير مصرّح", 401);
      const id = p.split("/")[4];
      const { data, error } = await s.from("perf_contacts").delete().eq("id", id).select("id");
      if (error || !data?.length) return err("الحذف لمن يتولّى هذه الجهة", 403);
      return ok({ ok: true });
    }

    /* المراجعة الربعية: ما استحقّ منها، وختمُها بعد التأكيد */
    if (p === "/api/entities/review" && method === "GET") {
      const me = await whoAmI();
      if (!me) return err("غير مصرّح", 401);
      const [due, st] = await Promise.all([
        s.rpc("perf_review_due"),
        s.rpc("perf_review_status"),
      ]);
      return ok({
        due: (due.data || []).map((r: Record<string, unknown>) => ({
          entityId: String(r.entity_id), entity: String(r.entity || ""),
          reviewedAt: r.reviewed_at || null,
        })),
        status: (st.data || []).map((r: Record<string, unknown>) => ({
          name: String(r.name || ""), entities: Number(r.entities || 0),
          reviewed: Number(r.reviewed || 0), lastAt: r.last_at || null,
        })),
      });
    }
    if (p === "/api/entities/review" && method === "POST") {
      const me = await whoAmI();
      if (!me) return err("غير مصرّح", 401);
      const { data, error } = await s.rpc("perf_review_done", { p_entity: str(body.entityId) || null });
      if (error) return err(error.message, 403);
      return ok({ ok: true, marked: Number(data || 0) });
    }

    /* جهاتي — ما أنا نقطة التواصل فيه، تُقرأ في محفظتي بلا تعبئة */
    if (p === "/api/entities/mine" && method === "GET") {
      const me = await whoAmI();
      if (!me) return err("غير مصرّح", 401);
      const { data } = await s.rpc("perf_my_entities");
      return ok({
        mine: (data || []).map((r: Record<string, unknown>) => ({
          entityId: String(r.entity_id), name: String(r.name || ""),
          kind: String(r.kind || ""), sector: String(r.sector || ""),
          myContactId: String(r.my_contact_id || ""),
          myRole: String(r.my_role || ""), theirs: r.theirs || [],
        })),
      });
    }

    /* ---------------- منهجيات أداء ----------------
       الوثيقة وملفها للتنزيل، ونصّها مقطّعاً ليبحث فيه المساعد.
       الحارس RLS: القراءة لكل من دخل، والرفع بصلاحية docs:edit. */
    if (p === "/api/docs" && method === "GET") {
      const me = await whoAmI();
      if (!me) return err("غير مصرّح", 401);
      const { data, error } = await s
        .from("perf_docs").select("*").eq("active", true).order("at", { ascending: false });
      if (error) return err(error.message, 403);
      return ok({
        docs: (data || []).map((r: Record<string, unknown>) => ({
          id: String(r.id), title: String(r.title || ""), kind: String(r.kind || ""),
          tags: (r.tags || []) as string[], summary: String(r.summary || ""),
          filePath: String(r.file_path || ""), fileName: String(r.file_name || ""),
          size: Number(r.size || 0), pages: Number(r.pages || 0),
          addedBy: String(r.added_by || ""), at: r.at,
        })),
      });
    }

    if (p === "/api/docs" && method === "POST") {
      const me = await whoAmI();
      if (!me) return err("غير مصرّح", 401);
      const id = str(body.id) || "doc-" + newId();
      const { error } = await s.from("perf_docs").upsert({
        id,
        title: str(body.title),
        kind: str(body.kind) || "منهجية",
        tags: Array.isArray(body.tags) ? body.tags.map(String) : [],
        summary: str(body.summary),
        file_path: str(body.filePath),
        file_name: str(body.fileName),
        mime: str(body.mime),
        size: num(body.size) ?? 0,
        pages: num(body.pages) ?? 0,
        added_by: me.name || me.username || "",
      });
      if (error) return err("الرفع لمن يملك صلاحية «منهجيات أداء»", 403);
      /* المقاطع تُستبدل بالكامل: إعادة رفع الوثيقة تعني نصّاً جديداً */
      const chunks = (Array.isArray(body.chunks) ? body.chunks : []) as Record<string, unknown>[];
      await s.from("perf_doc_chunks").delete().eq("doc_id", id);
      for (let i = 0; i < chunks.length; i += 400) {
        const part = chunks.slice(i, i + 400).map((c) => ({
          doc_id: id, idx: num(c.idx) ?? 0, page: num(c.page) ?? 0,
          heading: str(c.heading).slice(0, 180), body: str(c.body).slice(0, 1500),
        }));
        const { error: e2 } = await s.from("perf_doc_chunks").insert(part);
        if (e2) return err("حُفظت الوثيقة ولم يكتمل نصّها: " + e2.message, 500);
      }
      return ok({ ok: true, id, chunks: chunks.length });
    }

    if (p.startsWith("/api/docs/") && method === "DELETE") {
      const me = await whoAmI();
      if (!me) return err("غير مصرّح", 401);
      const id = p.split("/")[3];
      const { data, error } = await s.from("perf_docs").delete().eq("id", id).select("id");
      if (error || !data?.length) return err("الحذف لمن يملك صلاحية «منهجيات أداء»", 403);
      return ok({ ok: true });
    }

    /* بحث المساعد: ملفٌ بالاسم، أو جوابٌ من نصّ المنهجيات */
    if (p === "/api/docs/ask" && method === "GET") {
      const me = await whoAmI();
      if (!me) return err("غير مصرّح", 401);
      const qq = q.get("q") || "";
      if (!qq.trim()) return ok({ files: [], passages: [] });
      const [f, k, en] = await Promise.all([
        s.rpc("perf_docs_find", { p_q: qq, p_limit: 4 }),
        s.rpc("perf_kb_search", { p_q: qq, p_limit: 3 }),
        s.rpc("perf_entities_find", { p_q: qq, p_limit: 3 }),
      ]);
      return ok({
        files: (f.data || []).map((r: Record<string, unknown>) => ({
          id: String(r.id), title: String(r.title || ""), kind: String(r.kind || ""),
          filePath: String(r.file_path || ""), fileName: String(r.file_name || ""),
          pages: Number(r.pages || 0), hits: Number(r.hits || 0),
        })),
        passages: (k.data || []).map((r: Record<string, unknown>) => ({
          docId: String(r.doc_id), title: String(r.title || ""), page: Number(r.page || 0),
          heading: String(r.heading || ""), body: String(r.body || ""),
          filePath: String(r.file_path || ""),
        })),
        entities: (en.data || []).map((r: Record<string, unknown>) => ({
          id: String(r.id), name: String(r.name || ""), kind: String(r.kind || ""),
          ours: (r.ours || []) as Record<string, string>[],
          theirs: (r.theirs || []) as Record<string, string>[],
        })),
      });
    }

    /* «فريقي» — موظفو قطاع المدير وأحجام محافظهم.
       الصلاحية يحرسها RLS (perf_can_see_pf): من ليس مديراً
       لا تُرجع له استعلاماتُ المحافظ شيئاً أصلاً. */
    if (p === "/api/portfolio/team" && method === "GET") {
      const me = await whoAmI();
      if (!me) return err("غير مصرّح", 401);
      const { data: card } = await s.rpc("perf_me");
      const c = Array.isArray(card) ? card[0] : card;
      if (c?.is_lead !== true) return ok({ team: [] });
      const mine = new Set((me.sectorIds || []).map(String));
      const team = (await people()).filter(
        (u: { id: string; sectorIds: string[] }) =>
          String(u.id) !== String(me.id) && (u.sectorIds || []).some((x) => mine.has(String(x))),
      );
      if (!team.length) return ok({ team: [] });
      const ids = team.map((u: { id: string }) => Number(u.id));
      const { data: rows } = await s
        .from("perf_portfolio")
        .select("app_user_id, updated_at")
        .in("app_user_id", ids);
      const stat = new Map<string, { n: number; at: string }>();
      for (const r of (rows || []) as { app_user_id: number; updated_at: string }[]) {
        const k = String(r.app_user_id);
        const cur = stat.get(k) || { n: 0, at: "" };
        cur.n += 1;
        if (!cur.at || String(r.updated_at) > cur.at) cur.at = String(r.updated_at);
        stat.set(k, cur);
      }
      type TeamRow = { userId: string; name: string; jobTitle: string; count: number; lastAt: string };
      const list: TeamRow[] = team.map((u: { id: string; name: string; jobTitle: string }) => ({
        userId: String(u.id),
        name: String(u.name || ""),
        jobTitle: u.jobTitle || "",
        count: stat.get(String(u.id))?.n || 0,
        lastAt: stat.get(String(u.id))?.at || "",
      }));
      list.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "ar"));
      return ok({ team: list });
    }

    if (p === "/api/portfolio/grants" && method === "GET") {
      const me = await whoAmI();
      if (!me) return err("غير مصرّح", 401);
      const [g, sh] = await Promise.all([
        s.rpc("perf_pf_grants"),
        s.rpc("perf_pf_shared"),
      ]);
      const map = (d: unknown) =>
        ((d || []) as Record<string, unknown>[]).map((r) => ({
          userId: String(r.user_id),
          name: String(r.name || ""),
          jobTitle: String(r.job_title || ""),
          scopes: (r.scopes || []) as string[],
          at: r.created_at,
        }));
      return ok({ grants: map(g.data), shared: map(sh.data) });
    }
    if (p === "/api/portfolio/grants" && method === "POST") {
      const me = await whoAmI();
      if (!me) return err("غير مصرّح", 401);
      const to = str(body.userId);
      const scopes = Array.isArray(body.scopes) ? body.scopes.map(String).filter(Boolean) : [];
      if (!to) return err("لم يُحدَّد الشخص", 400);
      if (to === String(me.id)) return err("لا حاجة لمنح نفسك", 400);
      if (!scopes.length) return err("لم يُحدَّد أي قسم", 400);
      const { error } = await s
        .from("perf_portfolio_grants")
        .upsert(
          { owner_id: Number(me.id), grantee_id: Number(to), scopes },
          { onConflict: "owner_id,grantee_id" },
        );
      if (error) return err(error.message, 403);
      return ok({ ok: true });
    }
    if (p === "/api/portfolio/grants" && method === "DELETE") {
      const me = await whoAmI();
      if (!me) return err("غير مصرّح", 401);
      const to = q.get("user") || "";
      if (!to) return err("لم يُحدَّد الشخص", 400);
      const { error } = await s
        .from("perf_portfolio_grants")
        .delete()
        .eq("owner_id", me.id)
        .eq("grantee_id", to);
      if (error) return err(error.message, 403);
      return ok({ ok: true });
    }

    /* ---------------- أقسام نظرة عامة الخمسة ----------------
       جدول واحد لكل الأقسام: القراءة والكتابة يحرسهما RLS حسب
       صلاحية القسم نفسه، فلا حاجة لفحص إضافي هنا. */
    if (p === "/api/items" && method === "GET") {
      const me = await whoAmI();
      if (!me) return err("غير مصرّح", 401);
      const section = q.get("section") || "";
      if (!section) return err("لا يوجد قسم", 400);
      const { data, error } = await s
        .from("perf_items")
        .select("*")
        .eq("section", section)
        .order("ord");
      if (error) return err(error.message, 403);
      return ok({ items: (data || []).map(rowItem) });
    }
    if (p === "/api/items" && (method === "POST" || method === "PUT")) {
      const me = await whoAmI();
      if (!me) return err("غير مصرّح", 401);
      /* دفعة واحدة: تحميل بيانات قسم كامل بطلب واحد بدل عشرات الطلبات.
         RLS هي التي تسمح أو تمنع — لا فحص إضافي هنا. */
      if (Array.isArray(body.items)) {
        const sec = str(body.section);
        const rows = (body.items as Record<string, unknown>[])
          .filter((r) => str(r.id))
          .map((r) => ({
            section: sec,
            id: str(r.id),
            ord: num(r.ord) ?? 100,
            data: r.data ?? {},
            updated_at: new Date().toISOString(),
            updated_by: me.name || me.username || "",
          }));
        if (!sec || !rows.length) return err("لا توجد بنود", 400);
        const { error } = await s.from("perf_items").upsert(rows, { onConflict: "section,id" });
        if (error) return err(error.message, 403);
        return ok({ ok: true, n: rows.length });
      }
      const section = str(body.section);
      if (!section) return err("لا يوجد قسم", 400);
      const id = str(body.id) || "it-" + newId();
      const { error } = await s.from("perf_items").upsert(
        {
          section,
          id,
          ord: num(body.ord) ?? 100,
          data: body.data ?? {},
          updated_at: new Date().toISOString(),
          updated_by: me.name || me.username || "",
        },
        { onConflict: "section,id" },
      );
      if (error) return err(error.message, 403);
      return ok({ ok: true, id });
    }
    if (p === "/api/items" && method === "DELETE") {
      const me = await whoAmI();
      if (!me) return err("غير مصرّح", 401);
      const section = q.get("section") || "";
      const id = q.get("id") || "";
      if (!section || !id) return err("لا يوجد بند", 400);
      const { error } = await s.from("perf_items").delete().eq("section", section).eq("id", id);
      if (error) return err(error.message, 403);
      return ok({ ok: true });
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
      const [ms, nt, tk, sec, ind, seen, tlog, its, sti, ntc, card] = await Promise.all([
        s.from("perf_measurements").select("*").order("updated_at", { ascending: false }).limit(30),
        s.from("perf_notes").select("*").order("at", { ascending: false }).limit(20),
        s.from("perf_tasks").select("*").order("created_at", { ascending: false }).limit(20),
        s.from("perf_sectors").select("id,name"),
        s.from("perf_indicators").select("id,name"),
        s.from("perf_last_seen").select("at").eq("app_user_id", Number(me.id)).maybeSingle(),
        s.from("perf_target_log").select("*").order("at", { ascending: false }).limit(20),
        s.from("perf_items").select("*").order("updated_at", { ascending: false }).limit(40),
        s.from("perf_stickies").select("*").eq("done", false).order("at", { ascending: false }).limit(20),
        s.from("perf_notices").select("*").order("at", { ascending: false }).limit(6),
        s.rpc("perf_me"),
      ]);
      const myScopes: string[] = (() => {
        const c = Array.isArray(card.data) ? card.data[0] : card.data;
        return Array.isArray(c?.scopes) ? (c.scopes as string[]) : [];
      })();
      const secName = new Map((sec.data || []).map((x) => [x.id, x.name]));
      const indName = new Map((ind.data || []).map((x) => [x.id, x.name]));
      const since = seen.data?.at || "";
      // sectorId/indicatorId/taskId يحملها زر «عرض» ليفتح مصدر التحديث
      type Item = {
        id: string; kind: string; tone: string; title: string; sub: string;
        at: string; unread: boolean;
        sectorId?: string; indicatorId?: string; taskId?: string; section?: string;
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
      /* التعليق على مؤشر خاصٌّ بأصحابه: كاتبه ومن ذُكر فيه.
         وما يعني الجميع هو تحديث البنود لا تعليقات الأفراد. */
      for (const n of nt.data || []) {
        const mine =
          String(n.by_id || "") === String(me.id) ||
          (Array.isArray(n.mentions) ? n.mentions : []).some((x: unknown) => String(x) === String(me.id));
        if (!mine) continue;
        items.push({
          id: "n" + n.id, kind: "note", tone: "warn",
          title:
            String(n.by_id || "") === String(me.id)
              ? `ملاحظتك على ${indName.get(n.indicator_id) || ""}`
              : `${n.by_name} ذكرك في ملاحظة`,
          sub: `${secName.get(n.sector_id) || ""} · ${indName.get(n.indicator_id) || ""}`,
          at: n.at, unread: !since || n.at > since,
          sectorId: n.sector_id, indicatorId: n.indicator_id,
        });
      }

      /* تحديثات بنود الأقسام — لمن يملك صلاحية القسم وحده */
      const SEC_AR: Record<string, string> = {
        sessions: "جلسات مراجعة الأداء",
        natstrat: "الاستراتيجيات الوطنية",
        inststrat: "الاستراتيجيات المؤسسية",
        outputs: "المخرجات الوطنية",
        cx: "أعمال قياس تجربة المستفيد",
        projects: "المشاريع الاستراتيجية",
      };
      const itemName = (d: unknown) => {
        const o = (d || {}) as Record<string, unknown>;
        for (const k of ["name", "owner", "entity", "title"]) {
          const v = o[k];
          if (typeof v === "string" && v.trim()) return v.trim();
        }
        return "";
      };
      for (const it of its.data || []) {
        if (!myScopes.includes(it.section)) continue;
        const nm = itemName(it.data);
        items.push({
          id: "i" + it.section + it.id,
          kind: "section",
          tone: "info",
          title: `${it.updated_by ? `${it.updated_by} حدّث` : "تحديث"} ${SEC_AR[it.section] || it.section}`,
          sub: nm || "بند",
          at: it.updated_at,
          unread: !since || it.updated_at > since,
          section: it.section,
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
      /* الملاحظات اللاصقة — تصل من يفتح تلك الصفحة، ولا تصل كاتبها */
      const PAGE_AR: Record<string, string> = {
        overview: "نظرة عامة",
        details: "المؤشرات التفصيلية",
        weekly: "الإنجاز الأسبوعي",
        ...SEC_AR,
      };
      for (const k of sti.data || []) {
        if (!myScopes.includes(k.page)) continue;
        if (String(k.by_id || "") === String(me.id)) continue;
        items.push({
          id: "s" + k.id,
          kind: "sticky",
          tone: "warn",
          title: `${k.by_name || "أحدهم"} علّق على ${PAGE_AR[k.page] || k.page}`,
          sub: String(k.body || "").slice(0, 90),
          at: k.at,
          unread: !since || k.at > since,
          section: k.page,
        });
      }

      /* ردٌّ على مهمة أو تكليف — يصل مَن أسندها ومَن أُسندت له.
         وصفوف perf_tasks محدودة أصلاً بمن يراها، فلا يتسرّب ردٌّ لغيرهم. */
      type Rep = { id?: string; text?: string; byId?: string; byName?: string; at?: string };
      for (const t of tk.data || []) {
        const ups: Rep[] = Array.isArray(t.updates) ? (t.updates as Rep[]) : [];
        const last = ups[ups.length - 1];
        if (!last || !last.text) continue;
        const mineToo =
          String(t.created_by_id || "") === String(me.id) ||
          String(t.assignee_id || "") === String(me.id);
        if (!mineToo || String(last.byId || "") === String(me.id)) continue;
        items.push({
          id: "u" + t.id + (last.id || ""),
          kind: t.kind === "assignment" ? "assignment" : "task",
          tone: "info",
          title: `${last.byName || "أحدهم"} ردّ على ${t.kind === "assignment" ? "التكليف" : "المهمة"}: ${t.title}`,
          sub: String(last.text).slice(0, 90),
          at: last.at || t.created_at,
          unread: !since || (last.at || "") > since,
          taskId: t.id,
        });
      }

      // تغيير المستهدف يعني المدير أكثر من غيره — يظهر بلونٍ منبّه
      const fmtT = (v: unknown) =>
        v === null || v === undefined ? "—" : Array.isArray(v) ? v.join(" · ") : String(v);
      for (const g of tlog.data || []) {
        items.push({
          id: "g" + g.id, kind: "target", tone: "warn",
          title: `${g.by_name} عدّل مستهدف ${indName.get(g.indicator_id) || ""}`,
          sub: `${secName.get(g.sector_id) || ""} · من ${fmtT(g.old_value)} إلى ${fmtT(g.new_value)}`,
          at: g.at, unread: !since || g.at > since,
          sectorId: g.sector_id, indicatorId: g.indicator_id,
        });
      }
      items.sort((a, b) => (b.at || "").localeCompare(a.at || ""));
      const top = items.slice(0, 6);
      /* إعلانات المطوّر كتلةٌ مستقلة تحت عنوانها — لا تزاحم
         تحديثات العمل ولا تُدفن تحتها */
      const notices = (ntc.data || []).map((r) => ({
        id: String(r.id),
        title: String(r.title || ""),
        body: String(r.body || ""),
        at: r.at,
        unread: !since || String(r.at) > since,
      }));
      return ok({
        activity: top,
        unread: top.filter((x) => x.unread).length,
        notices,
      });
    }

    /* ---------------- الإنجاز الأسبوعي ---------------- */
    /* ---------------- الملاحظات اللاصقة على الصفحات ----------------
       الموضع بالنسبة المئوية، والرؤية والكتابة يحرسهما RLS. */
    if (p === "/api/stickies" && method === "GET") {
      const me = await whoAmI();
      if (!me) return err("غير مصرّح", 401);
      const page = q.get("page") || "";
      if (!page) return err("لا توجد صفحة", 400);
      const { data, error } = await s
        .from("perf_stickies")
        .select("*")
        .eq("page", page)
        .eq("done", false)
        .order("at");
      if (error) return err(error.message, 403);
      const today = new Date().toISOString().slice(0, 10);
      return ok({
        stickies: (data || [])
          /* ما انقضت مدّته لا يُعرض — ويبقى في القاعدة للسجل */
          .filter((r) => !r.pinned_until || String(r.pinned_until) >= today)
          .map((r) => ({
            id: r.id, page: r.page, x: Number(r.x), y: Number(r.y),
            body: r.body ?? "", byId: String(r.by_id ?? ""), byName: r.by_name ?? "",
            at: r.at, pinnedUntil: r.pinned_until ?? null,
            anchor: r.anchor ?? "",
          })),
        meId: me.id,
      });
    }
    if (p === "/api/stickies" && (method === "POST" || method === "PUT")) {
      const me = await whoAmI();
      if (!me) return err("غير مصرّح", 401);
      const id = str(body.id) || "st-" + newId();
      const patch: Record<string, unknown> = {};
      if (body.x !== undefined) patch.x = num(body.x) ?? 50;
      if (body.y !== undefined) patch.y = num(body.y) ?? 30;
      if (body.body !== undefined) patch.body = str(body.body);
      if (body.anchor !== undefined) patch.anchor = str(body.anchor).slice(0, 120);
      if (body.pinnedUntil !== undefined)
        patch.pinned_until = /^\d{4}-\d{2}-\d{2}$/.test(str(body.pinnedUntil)) ? str(body.pinnedUntil) : null;
      if (body.done === true) {
        patch.done = true;
        patch.done_by = me.name || me.username || "";
        patch.done_at = new Date().toISOString();
      }
      if (str(body.id)) {
        const { error } = await s.from("perf_stickies").update(patch).eq("id", id);
        if (error) return err(error.message, 403);
        return ok({ ok: true, id });
      }
      const page = str(body.page);
      if (!page) return err("لا توجد صفحة", 400);
      const { error } = await s.from("perf_stickies").insert({
        id, page,
        x: num(body.x) ?? 50, y: num(body.y) ?? 30,
        body: str(body.body),
        by_id: me.id, by_name: me.name || me.username || "",
        pinned_until: patch.pinned_until ?? null,
        /* البند الذي وُضعت عنده — فتعود إليه مهما تغيّر التخطيط */
        anchor: str(body.anchor).slice(0, 120),
      });
      if (error) return err(error.message, 403);
      return ok({ ok: true, id });
    }
    if (p === "/api/stickies" && method === "DELETE") {
      const me = await whoAmI();
      if (!me) return err("غير مصرّح", 401);
      const id = q.get("id") || "";
      if (!id) return err("لا توجد ملاحظة", 400);
      const { error } = await s.from("perf_stickies").delete().eq("id", id);
      if (error) return err(error.message, 403);
      return ok({ ok: true });
    }

    /* ---------------- تفويض قسم أثناء الإجازة ----------------
       المنح لصاحب القسم وحده — والحارس RLS ودوال القاعدة. */
    if (p === "/api/grants" && method === "GET") {
      const me = await whoAmI();
      if (!me) return err("غير مصرّح", 401);
      const section = q.get("section") || "";
      if (!section) return err("لا يوجد قسم", 400);
      const [rows, mine] = await Promise.all([
        s.rpc("perf_grants_of", { p_section: section }),
        s.rpc("perf_can_delegate", { p_section: section }),
      ]);
      if (rows.error) return err(rows.error.message, 403);
      return ok({
        grants: (rows.data || []).map((r: Record<string, unknown>) => ({
          granteeId: String(r.grantee_id),
          name: r.name,
          canEdit: !!r.can_edit,
          grantedBy: r.granted_by ?? "",
          grantedAt: r.granted_at,
          expiresAt: r.expires_at ?? null,
          note: r.note ?? "",
          active: !!r.active,
        })),
        canDelegate: mine.data === true,
      });
    }
    if (p === "/api/grants" && (method === "POST" || method === "PUT")) {
      const me = await whoAmI();
      if (!me) return err("غير مصرّح", 401);
      const section = str(body.section);
      const granteeId = str(body.granteeId);
      if (!section || !granteeId) return err("بيانات ناقصة", 400);
      const exp = str(body.expiresAt);
      const { error } = await s.from("perf_section_grants").upsert(
        {
          section,
          grantee_id: Number(granteeId),
          can_edit: body.canEdit === true,
          granted_by: me.name || me.username || "",
          expires_at: /^\d{4}-\d{2}-\d{2}$/.test(exp) ? exp : null,
          note: str(body.note),
        },
        { onConflict: "section,grantee_id" },
      );
      if (error) return err(error.message, 403);
      return ok({ ok: true });
    }
    if (p === "/api/grants" && method === "DELETE") {
      const me = await whoAmI();
      if (!me) return err("غير مصرّح", 401);
      const section = q.get("section") || "";
      const granteeId = q.get("granteeId") || "";
      if (!section || !granteeId) return err("بيانات ناقصة", 400);
      const { error } = await s
        .from("perf_section_grants")
        .delete()
        .eq("section", section)
        .eq("grantee_id", Number(granteeId));
      if (error) return err(error.message, 403);
      return ok({ ok: true });
    }

    /* ---------------- تخصيص التقرير الأسبوعي ----------------
       مفتاحان في perf_settings: الافتراضي واستثناء أسبوع بعينه.
       الكتابة يحرسها RLS (صلاحية weekly:edit) لا فحصٌ هنا. */
    if (p === "/api/weekly" && method === "GET") {
      const me = await whoAmI();
      if (!me) return err("غير مصرّح", 401);
      const week = q.get("week") || "";
      const keys = ["weekly_prefs", ...(week ? [`weekly_wk_${week}`] : [])];
      const { data, error } = await s.from("perf_settings").select("*").in("key", keys);
      if (error) return err(error.message, 403);
      const map: Record<string, unknown> = {};
      for (const r of data || []) map[r.key] = r.value;
      return ok({
        base: map["weekly_prefs"] ?? null,
        week: week ? (map[`weekly_wk_${week}`] ?? null) : null,
      });
    }
    if (p === "/api/weekly" && (method === "PUT" || method === "POST")) {
      const me = await whoAmI();
      if (!me) return err("غير مصرّح", 401);
      const scope = str(body.scope) === "week" ? "week" : "default";
      const week = str(body.week);
      if (scope === "week" && !/^\d{4}-\d{2}-\d{2}$/.test(week))
        return err("أسبوع غير صالح", 400);
      const key = scope === "week" ? `weekly_wk_${week}` : "weekly_prefs";
      const { error } = await s
        .from("perf_settings")
        .upsert({ key, value: body.prefs ?? {} }, { onConflict: "key" });
      if (error) return err(error.message, 403);
      return ok({ ok: true, key });
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
