/* ===========================================================
   طبقة البيانات — تعمل مع Supabase إن توفّرت الإعدادات،
   وإلا تعمل محليًا (localStorage) ببيانات ابتدائية.
   =========================================================== */
(function () {
  const CFG = window.APP_CONFIG || {};
  const HAS_REMOTE = !!(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY);
  const LS_KEY = "adaa_hr_dashboard_v1";

  /* ---------- الجداول ---------- */
  const TABLES = [
    "org_units",   // الهيكل التنظيمي (قطاعات/إدارات/أقسام)
    "vacancies",   // الوظائف الشاغرة لكل وحدة
    "candidates",  // المرشحون ومراحلهم
    "interviews",  // المقابلات
    "onboarding",  // الانضمام
    "trainees",    // المتدربون
    "resignations",// الاستقالات
    "settings",    // العناوين القابلة للتعديل
  ];

  /* ---------- بيانات ابتدائية ---------- */
  const SEED = {
    org_units: [
      { id: "s1", name: "قطاع الأداء", parent_id: null, approved: 0, filled: 0, junior: 0, senior: 0, male: 0, female: 0 },
      { id: "s1a", name: "إدارة قياس الأداء", parent_id: "s1", approved: 0, filled: 0, junior: 0, senior: 0, male: 0, female: 0 },
      { id: "s1a1", name: "قسم المؤشرات", parent_id: "s1a", approved: 11, filled: 10, junior: 7, senior: 3, male: 6, female: 4 },
      { id: "s1a2", name: "قسم التقارير", parent_id: "s1a", approved: 9, filled: 8, junior: 5, senior: 3, male: 4, female: 4 },
      { id: "s1b", name: "إدارة تطوير الأداء", parent_id: "s1", approved: 16, filled: 14, junior: 8, senior: 6, male: 8, female: 6 },
      { id: "s1c", name: "إدارة تحليل البيانات", parent_id: "s1", approved: 12, filled: 10, junior: 6, senior: 4, male: 7, female: 3 },
      { id: "s2", name: "قطاع الخدمات المشتركة", parent_id: null, approved: 0, filled: 0, junior: 0, senior: 0, male: 0, female: 0 },
      { id: "s2a", name: "إدارة الموارد البشرية", parent_id: "s2", approved: 12, filled: 11, junior: 7, senior: 4, male: 5, female: 6 },
      { id: "s2b", name: "إدارة تقنية المعلومات", parent_id: "s2", approved: 13, filled: 12, junior: 8, senior: 4, male: 8, female: 4 },
      { id: "s2c", name: "إدارة الشؤون المالية", parent_id: "s2", approved: 8, filled: 7, junior: 4, senior: 3, male: 4, female: 3 },
      { id: "s2d", name: "إدارة المشتريات والعقود", parent_id: "s2", approved: 6, filled: 5, junior: 3, senior: 2, male: 2, female: 3 },
      { id: "s3", name: "الإدارة القانونية", parent_id: null, approved: 0, filled: 0, junior: 0, senior: 0, male: 0, female: 0 },
      { id: "s3a", name: "قسم العقود", parent_id: "s3", approved: 8, filled: 6, junior: 3, senior: 3, male: 4, female: 2 },
      { id: "s3b", name: "قسم التقاضي", parent_id: "s3", approved: 6, filled: 5, junior: 2, senior: 3, male: 3, female: 2 },
      { id: "s4", name: "مكتب المدير العام", parent_id: null, approved: 9, filled: 8, junior: 3, senior: 5, male: 5, female: 3 },
      { id: "s5", name: "إدارة الحوكمة والمخاطر والالتزام", parent_id: null, approved: 0, filled: 0, junior: 0, senior: 0, male: 0, female: 0 },
      { id: "s5a", name: "قسم الحوكمة", parent_id: "s5", approved: 9, filled: 7, junior: 4, senior: 3, male: 4, female: 3 },
      { id: "s5b", name: "قسم المخاطر والالتزام", parent_id: "s5", approved: 10, filled: 8, junior: 5, senior: 3, male: 4, female: 4 },
      { id: "s5c", name: "مكتب البيانات", parent_id: "s5", approved: 8, filled: 7, junior: 4, senior: 3, male: 4, female: 3 },
      { id: "s6", name: "مكتب التحول الاستراتيجي", parent_id: null, approved: 0, filled: 0, junior: 0, senior: 0, male: 0, female: 0 },
      { id: "s6a", name: "قسم إدارة المشاريع", parent_id: "s6", approved: 12, filled: 10, junior: 7, senior: 3, male: 6, female: 4 },
      { id: "s6b", name: "قسم التخطيط", parent_id: "s6", approved: 9, filled: 7, junior: 4, senior: 3, male: 4, female: 3 },
      { id: "s7", name: "المراجعة الداخلية", parent_id: null, approved: 18, filled: 15, junior: 8, senior: 7, male: 9, female: 6 },
    ],

    vacancies: [
      { id: "v1", unit_id: "s1", title: "أخصائي تحليل بيانات", count: 9, received: 72, status: "مفتوحة", year: 2026, month: 7 },
      { id: "v2", unit_id: "s2", title: "أخصائي مشتريات", count: 7, received: 58, status: "مفتوحة", year: 2026, month: 7 },
      { id: "v3", unit_id: "s3", title: "مستشار قانوني", count: 4, received: 26, status: "مفتوحة", year: 2026, month: 7 },
      { id: "v4", unit_id: "s4", title: "منسق إداري", count: 3, received: 19, status: "مفتوحة", year: 2026, month: 7 },
      { id: "v5", unit_id: "s5", title: "أخصائي حوكمة", count: 8, received: 54, status: "مفتوحة", year: 2026, month: 7 },
      { id: "v6", unit_id: "s6", title: "مدير مشاريع", count: 5, received: 41, status: "مفتوحة", year: 2026, month: 7 },
      { id: "v7", unit_id: "s7", title: "مدقق داخلي", count: 6, received: 48, status: "مفتوحة", year: 2026, month: 7 },
    ],

    candidates: [
      { id: "c1", name: "ليان المطيري", position: "منسق موارد بشرية", unit_id: "s2a", stage: 4, note: "تم توقيع العرض النهائي", year: 2026, month: 7 },
      { id: "c2", name: "سارة الدوسري", position: "أخصائي تحليل بيانات", unit_id: "s1c", stage: 1, note: "العرض الأولي مرسل · بانتظار الرد", year: 2026, month: 7 },
      { id: "c3", name: "لمى العتيبي", position: "مدير مشاريع", unit_id: "s6a", stage: 2, note: "المسح الأمني قيد المراجعة", year: 2026, month: 7 },
      { id: "c4", name: "فيصل القحطاني", position: "مستشار قانوني", unit_id: "s3a", stage: 3, note: "الفحص الطبي مكتمل", year: 2026, month: 7 },
      { id: "c5", name: "محمد البلوي", position: "مدقق داخلي", unit_id: "s7", stage: 3, note: "الفحص الطبي محجوز ٣٠ يوليو", year: 2026, month: 7 },
      { id: "c6", name: "عبدالعزيز الحارثي", position: "أخصائي أنظمة", unit_id: "s2b", stage: 5, note: "مباشرة رسمية ١٠ أغسطس", year: 2026, month: 7 },
      { id: "c7", name: "نايف الرشيدي", position: "محلل مالي", unit_id: "s2c", stage: 4, note: "العرض النهائي مرسل · بانتظار الرد", year: 2026, month: 7 },
    ],

    interviews: [
      { id: "i1", candidate: "سارة الدوسري", position: "أخصائي تحليل بيانات", unit_id: "s1", owner: "أ. خالد العمري", status: "مجدولة", date: "٢٨ يوليو", day: "الثلاثاء", time: "١٠:٠٠ ص", job_source: "توظيف مباشر", cand_source: "لينكدإن", cand_source_name: "", hr_rating: "ممتاز", mgr_rating: "جيد جدًا", year: 2026, month: 7 },
      { id: "i2", candidate: "فيصل القحطاني", position: "مستشار قانوني", unit_id: "s3", owner: "أ. منى الحربي", status: "تمت", date: "٢٦ يوليو", day: "الأحد", time: "١٢:٣٠ م", job_source: "إعلان داخلي", cand_source: "توصية", cand_source_name: "أ. سعد", hr_rating: "جيد جدًا", mgr_rating: "ممتاز", year: 2026, month: 7 },
      { id: "i3", candidate: "عبدالله الزهراني", position: "أخصائي مشتريات", unit_id: "s2", owner: "أ. نورة السالم", status: "مرفوضة", date: "٢٤ يوليو", day: "الخميس", time: "٩:٠٠ ص", job_source: "منصة توظيف", cand_source: "جدارات", cand_source_name: "", hr_rating: "مقبول", mgr_rating: "ضعيف", year: 2026, month: 7 },
      { id: "i4", candidate: "لمى العتيبي", position: "مدير مشاريع", unit_id: "s6", owner: "أ. ريم الشمري", status: "مجدولة", date: "٢٩ يوليو", day: "الأربعاء", time: "١١:٠٠ ص", job_source: "توظيف مباشر", cand_source: "لينكدإن", cand_source_name: "", hr_rating: "", mgr_rating: "", year: 2026, month: 7 },
      { id: "i5", candidate: "محمد البلوي", position: "مدقق داخلي", unit_id: "s7", owner: "أ. طارق الغامدي", status: "تمت", date: "٢٥ يوليو", day: "الجمعة", time: "١٠:٣٠ ص", job_source: "إعلان خارجي", cand_source: "بيت.كوم", cand_source_name: "", hr_rating: "ممتاز", mgr_rating: "جيد", year: 2026, month: 7 },
    ],

    onboarding: [
      { id: "o1", name: "ليان المطيري", position: "منسق موارد بشرية", grade: "السادسة", start_date: "٣ أغسطس ٢٠٢٦", notes: "مباشرة رسمية", year: 2026, month: 8 },
      { id: "o2", name: "عبدالعزيز الحارثي", position: "أخصائي أنظمة", grade: "السابعة", start_date: "١٠ أغسطس ٢٠٢٦", notes: "بانتظار إنهاء الإجراءات", year: 2026, month: 8 },
    ],

    trainees: [
      { id: "t1", name: "سلمان العنزي", supervisor: "أ. خالد العمري", university: "جامعة الملك سعود", unit_id: "s1", start_date: "١ يوليو", end_date: "٣١ أغسطس", phone: "0551234567", status: "قائم", year: 2026, month: 7 },
      { id: "t2", name: "جواهر الفهد", supervisor: "أ. منى الحربي", university: "جامعة الأميرة نورة", unit_id: "s3", start_date: "١٥ يونيو", end_date: "١٥ سبتمبر", phone: "0559876543", status: "قائم", year: 2026, month: 6 },
      { id: "t3", name: "راكان الدوسري", supervisor: "أ. نورة السالم", university: "جامعة الملك فهد", unit_id: "s2", start_date: "١ أغسطس", end_date: "٣٠ سبتمبر", phone: "0501112223", status: "تحت الإجراء", year: 2026, month: 8 },
      { id: "t4", name: "دانة القحطاني", supervisor: "أ. ريم الشمري", university: "جامعة الإمام", unit_id: "s6", start_date: "١٠ يوليو", end_date: "١٠ أكتوبر", phone: "0533334445", status: "قائم", year: 2026, month: 7 },
      { id: "t5", name: "عبدالرحمن الشهري", supervisor: "أ. طارق الغامدي", university: "جامعة الملك عبدالعزيز", unit_id: "s7", start_date: "٢٠ يونيو", end_date: "٢٠ سبتمبر", phone: "0544445556", status: "مكتمل", year: 2026, month: 6 },
    ],

    resignations: [
      { id: "r1", name: "ماجد السبيعي", position: "محلل نظم", grade: "الثامنة", unit_id: "s1", last_day: "١٥ أغسطس ٢٠٢٦", reason: "", year: 2026, month: 8 },
      { id: "r2", name: "هيفاء المالكي", position: "أخصائي تسويق", grade: "السابعة", unit_id: "s2", last_day: "٣١ يوليو ٢٠٢٦", reason: "", year: 2026, month: 7 },
      { id: "r3", name: "بندر العتيبي", position: "مدير إدارة", grade: "التاسعة", unit_id: "s2", last_day: "٢٠ أغسطس ٢٠٢٦", reason: "", year: 2026, month: 8 },
      { id: "r4", name: "أروى الجهني", position: "منسق إداري", grade: "السادسة", unit_id: "s5", last_day: "٥ أغسطس ٢٠٢٦", reason: "", year: 2026, month: 8 },
    ],

    settings: [
      { id: "targets", key: "training_target", value: "80" },
      { id: "titles", key: "titles", value: "{}" },
    ],
  };

  /* ---------- تخزين محلي ---------- */
  function readLocal() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    const fresh = JSON.parse(JSON.stringify(SEED));
    writeLocal(fresh);
    return fresh;
  }
  function writeLocal(db) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(db)); } catch (e) {}
  }

  /* ---------- عميل Supabase ---------- */
  let sb = null;
  function client() {
    if (!HAS_REMOTE) return null;
    if (!sb && window.supabase) {
      sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
    }
    return sb;
  }

  const uid = () => "x" + Math.random().toString(36).slice(2, 10);

  /* ---------- واجهة البيانات ---------- */
  const DB = {
    isRemote: HAS_REMOTE,
    cache: null,

    async loadAll() {
      if (!HAS_REMOTE) { this.cache = readLocal(); return this.cache; }
      const c = client();
      const out = {};
      for (const t of TABLES) {
        const { data, error } = await c.from(t).select("*");
        if (error) throw new Error(`تعذّر تحميل ${t}: ${error.message}`);
        out[t] = data || [];
      }
      this.cache = out;
      return out;
    },

    async insert(table, row) {
      row = Object.assign({}, row);
      if (!HAS_REMOTE) {
        row.id = row.id || uid();
        this.cache[table].push(row);
        writeLocal(this.cache);
        return row;
      }
      const { data, error } = await client().from(table).insert(row).select().single();
      if (error) throw new Error(error.message);
      this.cache[table].push(data);
      return data;
    },

    async update(table, id, patch) {
      if (!HAS_REMOTE) {
        const i = this.cache[table].findIndex((r) => r.id === id);
        if (i > -1) Object.assign(this.cache[table][i], patch);
        writeLocal(this.cache);
        return this.cache[table][i];
      }
      const { data, error } = await client().from(table).update(patch).eq("id", id).select().single();
      if (error) throw new Error(error.message);
      const i = this.cache[table].findIndex((r) => r.id === id);
      if (i > -1) this.cache[table][i] = data;
      return data;
    },

    async remove(table, id) {
      if (!HAS_REMOTE) {
        this.cache[table] = this.cache[table].filter((r) => r.id !== id);
        writeLocal(this.cache);
        return true;
      }
      const { error } = await client().from(table).delete().eq("id", id);
      if (error) throw new Error(error.message);
      this.cache[table] = this.cache[table].filter((r) => r.id !== id);
      return true;
    },

    resetLocal() { localStorage.removeItem(LS_KEY); },
  };

  /* ---------- الحسابات والصلاحيات ---------- */
  const AUTH = {
    async current() {
      if (!HAS_REMOTE) {
        try { return JSON.parse(sessionStorage.getItem("adaa_hr_user") || "null"); } catch (e) { return null; }
      }
      const c = client();
      const { data } = await c.auth.getUser();
      if (!data || !data.user) return null;
      const { data: prof } = await c.from("profiles").select("*").eq("id", data.user.id).single();
      return {
        name: (prof && prof.full_name) || data.user.email,
        role: (prof && prof.role) || "viewer",
        email: data.user.email,
      };
    },

    async signIn(email, password) {
      if (!HAS_REMOTE) throw new Error("الدخول بالبريد يتطلب ربط قاعدة البيانات");
      const { error } = await client().auth.signInWithPassword({ email, password });
      if (error) throw new Error("بيانات الدخول غير صحيحة");
      return this.current();
    },

    demoSignIn(name, role) {
      const u = { name: name || "مستخدم تجريبي", role: role || "editor", demo: true };
      sessionStorage.setItem("adaa_hr_user", JSON.stringify(u));
      return u;
    },

    async signOut() {
      sessionStorage.removeItem("adaa_hr_user");
      if (HAS_REMOTE) await client().auth.signOut();
    },
  };

  window.DB = DB;
  window.AUTH = AUTH;
  window.SEED = SEED;
})();
