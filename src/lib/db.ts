import fs from "fs";
import path from "path";
import crypto from "crypto";
import { Pool } from "pg";

// ===== الأنواع =====
export type Role = "admin" | "manager";

export interface User {
  id: string;
  phone: string; // رقم الجوال (يبقى مخزّناً — كان معرّف الدخول قبل كلمات المرور)
  username?: string; // اسم المستخدم في العمل — معرّف الدخول الجديد
  passwordHash?: string; // scrypt$<salt>$<hash> — لا تُخزَّن كلمة المرور نفسها أبداً
  email?: string; // اختياري
  name: string;
  role: Role;
  active: boolean;
  createdAt: string;
  sectorIds: string[];
}

export interface Otp {
  phone: string;
  code: string;
  expiresAt: number;
}

// توحيد صيغة رقم الجوال السعودي إلى صيغة موحّدة 9665XXXXXXXX
export function normalizePhone(input: string): string {
  let p = (input || "").replace(/[\s\-()]/g, "").replace(/^\+/, "");
  if (p.startsWith("00")) p = p.slice(2);
  if (p.startsWith("0")) p = "966" + p.slice(1);
  else if (p.startsWith("5") && p.length === 9) p = "966" + p;
  else if (!p.startsWith("966") && p.length === 9) p = "966" + p;
  return p;
}

/** توحيد اسم المستخدم: حروف صغيرة بلا مسافات طرفية — المطابقة تتم عليه. */
export function normUsername(input: string): string {
  return (input || "").trim().toLowerCase();
}

/* كلمات المرور تُخزَّن مُجزّأة بـ scrypt (من مكتبة node نفسها — بلا اعتماد جديد
   يحتاج بناءً أصلياً داخل Docker). الصيغة: scrypt$<salt>$<hash> */
const SCRYPT_KEYLEN = 64;
export function hashPassword(plain: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(plain, salt, SCRYPT_KEYLEN).toString("hex");
  return `scrypt$${salt}$${hash}`;
}
export function verifyPassword(plain: string, stored: string | undefined): boolean {
  if (!stored) return false;
  const [scheme, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const got = crypto.scryptSync(plain, salt, SCRYPT_KEYLEN);
  const want = Buffer.from(hash, "hex");
  // مقارنة بزمن ثابت حتى لا يتسرّب طول التطابق
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

export interface Session {
  token: string;
  userId: string;
  expiresAt: number;
}

export interface Sector {
  id: string;
  name: string;
  order: number;
}

export type IndicatorUnit = "percent" | "number";

export interface Indicator {
  id: string;
  name: string;
  unit: IndicatorUnit;
  active: boolean;
  order: number;
}

export interface Period {
  id: string;
  label: string;
  order: number;
  weekStart?: string; // تاريخ بداية الأسبوع (YYYY-MM-DD) — للأسابيع المبنية على التقويم
}

export interface Measurement {
  id: string;
  sectorId: string;
  indicatorId: string;
  periodId: string;
  target: number | null;
  actual: number | null;
  updatedBy: string;
  updatedAt: string;
}

/* ===== المهام والتكليفات ===== */
export type TaskPriority = "high" | "mid";
export type TaskState = "ok" | "risk" | "done";

export interface TaskUpdate {
  id: string;
  text: string;
  byId: string;
  byName: string;
  at: string;
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  assigneeId: string;
  priority: TaskPriority;
  dueDate: string; // YYYY-MM-DD
  indicatorId?: string;
  state: TaskState;
  updates: TaskUpdate[];
  createdById: string;
  createdAt: string;
  completedAt?: string;
}

/* ===== ملاحظات المؤشرات (مع منشن) ===== */
export interface Note {
  id: string;
  sectorId: string;
  indicatorId: string;
  text: string;
  mentions: string[]; // معرّفات المستخدمين المذكورين
  byId: string;
  byName: string;
  at: string;
}

/* ===== روابط مشاركة الإنجاز الأسبوعي ===== */
export interface ReportShare {
  token: string;
  weekStart: string; // YYYY-MM-DD — الأحد
  createdById: string;
  createdAt: string;
  expiresAt?: string;
  views: { at: string; ua?: string }[];
}

export interface StatusBand {
  label: string;
  color: string;
  from: number;
}

export type TargetMode = "annual" | "quarterly";

export interface Settings {
  statuses: StatusBand[];
  targetMode: TargetMode;
}

const DEFAULT_STATUS_BANDS: StatusBand[] = [
  { label: "متعثر", color: "#ef4444", from: 0 },
  { label: "متعثر جزئيًا", color: "#f59e0b", from: 80 },
  { label: "وفق المسار", color: "#22c55e", from: 100 },
];

interface DBShape {
  users: User[];
  otps: Otp[];
  sessions: Session[];
  sectors: Sector[];
  indicators: Indicator[];
  periods: Period[];
  measurements: Measurement[];
  tasks: Task[];
  notes: Note[];
  shares: ReportShare[];
  lastSeen: Record<string, string>; // معرّف المستخدم → آخر وقت اطّلع فيه على التحديثات
  settings: Settings;
  // المستهدفات لكل (قطاع|مؤشر): رقم واحد (سنوي) أو مصفوفة [ربع1..ربع4]
  targets: Record<string, number | number[]>;
}

const DATA_DIR = path.join(process.cwd(), "data");
const DB_FILE = path.join(DATA_DIR, "db.json");

function defaultDB(): DBShape {
  return {
    users: [],
    otps: [],
    sessions: [],
    sectors: [],
    indicators: [],
    periods: [],
    measurements: [],
    tasks: [],
    notes: [],
    shares: [],
    lastSeen: {},
    settings: { statuses: DEFAULT_STATUS_BANDS, targetMode: "annual" },
    targets: {},
  };
}

export function targetKey(sectorId: string, indicatorId: string): string {
  return `${sectorId}|${indicatorId}`;
}

export function newId(): string {
  return crypto.randomBytes(9).toString("hex");
}

// ===== الخلفية: Postgres إذا توفّر DATABASE_URL، وإلا ملف محلي =====
const USE_PG = !!process.env.DATABASE_URL;
let pool: Pool | null = null;
let pgReady: Promise<void> | null = null;

function getPool(): Pool {
  if (!pool) {
    const url = process.env.DATABASE_URL || "";
    const isLocal = /localhost|127\.0\.0\.1/.test(url);
    pool = new Pool({
      connectionString: url,
      ssl: isLocal ? false : { rejectUnauthorized: false },
      max: 3,
    });
  }
  return pool;
}

async function ensurePg() {
  if (!pgReady) {
    pgReady = getPool()
      .query("CREATE TABLE IF NOT EXISTS app_state (id int PRIMARY KEY, data jsonb NOT NULL)")
      .then(() => undefined);
  }
  return pgReady;
}

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

// السجلات المحفوظة قبل إضافة المهام والملاحظات لا تحتوي هذه المفاتيح —
// نكمّلها بقيم فارغة بدل أن ينهار القارئ عليها. لا يُمسّ أي مفتاح موجود.
function normalize(db: DBShape): DBShape {
  if (!Array.isArray(db.tasks)) db.tasks = [];
  if (!Array.isArray(db.notes)) db.notes = [];
  if (!Array.isArray(db.shares)) db.shares = [];
  if (!db.lastSeen || typeof db.lastSeen !== "object") db.lastSeen = {};
  db.tasks.forEach((t) => {
    if (!Array.isArray(t.updates)) t.updates = [];
  });
  return db;
}

async function loadRaw(): Promise<DBShape | null> {
  if (USE_PG) {
    await ensurePg();
    const res = await getPool().query("SELECT data FROM app_state WHERE id = 1");
    if (res.rows.length === 0) return null;
    return normalize({ ...defaultDB(), ...(res.rows[0].data as Partial<DBShape>) });
  }
  ensureDir();
  if (!fs.existsSync(DB_FILE)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(DB_FILE, "utf-8")) as Partial<DBShape>;
    return normalize({ ...defaultDB(), ...parsed });
  } catch {
    return defaultDB();
  }
}

async function save(db: DBShape): Promise<void> {
  if (USE_PG) {
    await ensurePg();
    await getPool().query(
      "INSERT INTO app_state (id, data) VALUES (1, $1::jsonb) ON CONFLICT (id) DO UPDATE SET data = $1::jsonb",
      [JSON.stringify(db)]
    );
    return;
  }
  ensureDir();
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

// ===== المؤشرات السبعة الافتراضية =====
const DEFAULT_INDICATORS: { name: string; unit: IndicatorUnit }[] = [
  { name: "نسبة الأجهزة العامة التي يتم قياس خدماتها", unit: "number" },
  { name: "نسبة الأجهزة ذات الأداء المنخفض التي تم عقد جلسات مراجعة لها", unit: "percent" },
  { name: "نسبة قابلية قياس مؤشرات المخرجات الوطنية", unit: "percent" },
  { name: "نسبة قابلية قياس الاستراتيجيات الوطنية المعتمدة من مجلس الوزراء", unit: "percent" },
  { name: "عدد الأجهزة العامة التي تم قياس استراتيجياتها المؤسسية", unit: "number" },
  { name: "نسبة التكليفات المباشرة المكتملة أو على المسار", unit: "percent" },
  { name: "نسبة إتمام الخطة الفردية للاحتياج التطويري", unit: "percent" },
];

const DEFAULT_SECTORS = [
  "قطاع البنية التحتية",
  "قطاع الخدمات الاجتماعية",
  "قطاع المالي والاقتصادي",
  "قطاع الشؤون الحكومية",
];

// ===== المستهدفات السنوية الافتراضية موزّعة على القطاعات =====
// المفتاح: اسم القطاع · القيمة: { اسم المؤشر العددي: عدد الجهات المستهدف }
// المؤشرات العددية تأخذ عدد الجهات لكل قطاع · وبقية المؤشرات النسبية تأخذ 100٪.
const IND_SERVICES = "نسبة الأجهزة العامة التي يتم قياس خدماتها";
const IND_STRATEGIES = "عدد الأجهزة العامة التي تم قياس استراتيجياتها المؤسسية";
const DEFAULT_TARGETS_BY_SECTOR: Record<string, Record<string, number>> = {
  "قطاع الشؤون الحكومية": { [IND_SERVICES]: 16, [IND_STRATEGIES]: 8 },
  "قطاع الخدمات الاجتماعية": { [IND_SERVICES]: 12, [IND_STRATEGIES]: 3 },
  "قطاع البنية التحتية": { [IND_SERVICES]: 19, [IND_STRATEGIES]: 4 },
  "قطاع المالي والاقتصادي": { [IND_SERVICES]: 15, [IND_STRATEGIES]: 4 },
};


// ===== التهيئة =====
function seed(db: DBShape): DBShape {
  const adminPhone = normalizePhone(process.env.ADMIN_PHONE || "0500000000");
  const adminName = process.env.ADMIN_NAME || "مدير إدارة عمليات الأداء";

  if (!db.users.some((u) => u.phone === adminPhone)) {
    db.users.push({
      id: newId(),
      phone: adminPhone,
      email: process.env.ADMIN_EMAIL,
      name: adminName,
      role: "admin",
      active: true,
      createdAt: new Date().toISOString(),
      sectorIds: [],
    });
  }
  db.users.forEach((u) => {
    if (!Array.isArray(u.sectorIds)) u.sectorIds = [];
  });

  if (db.sectors.length === 0) {
    db.sectors = DEFAULT_SECTORS.map((name, i) => ({ id: newId(), name, order: i + 1 }));
  }
  if (db.indicators.length === 0) {
    db.indicators = DEFAULT_INDICATORS.map((ind, i) => ({
      id: newId(),
      name: ind.name,
      unit: ind.unit,
      active: true,
      order: i + 1,
    }));
  }
  // لا تُنشأ أسابيع افتراضية — تُنشأ من التقويم عند إدخال البيانات

  // المستهدفات السنوية الافتراضية لكل (قطاع|مؤشر) — تُهيّأ مرة واحدة إن لم تكن موجودة
  if (!db.targets || Object.keys(db.targets).length === 0) {
    const targets: Record<string, number | number[]> = {};
    db.sectors.forEach((s) => {
      db.indicators.forEach((ind) => {
        const perSector = DEFAULT_TARGETS_BY_SECTOR[s.name]?.[ind.name];
        if (typeof perSector === "number") {
          targets[targetKey(s.id, ind.id)] = perSector;
        } else if (ind.unit === "percent") {
          targets[targetKey(s.id, ind.id)] = 100;
        }
      });
    });
    db.targets = targets;
  }

  if (process.env.SEED_DEMO === "true" && db.measurements.length === 0) {
    db.sectors.forEach((s, si) =>
      db.indicators.forEach((ind, ii) =>
        db.periods.forEach((p, pi) => {
          const isNum = ind.unit === "number";
          const target = isNum ? 10 : 100;
          const base = isNum ? 10 : 100;
          const variance = ((si * 7 + ii * 13 + pi * 5) % 6) * (isNum ? 1 : 8);
          const actual = Math.max(0, base - variance + pi * (isNum ? 0 : 2));
          db.measurements.push({
            id: newId(),
            sectorId: s.id,
            indicatorId: ind.id,
            periodId: p.id,
            target,
            actual: isNum ? Math.min(actual, 13) : actual,
            updatedBy: "demo",
            updatedAt: new Date().toISOString(),
          });
        })
      )
    );
  }
  return db;
}

let initOnce: Promise<void> | null = null;
async function getDB(): Promise<DBShape> {
  const existing = await loadRaw();
  if (existing) return existing;
  // أول تشغيل: تهيئة وحفظ (مرة واحدة)
  if (!initOnce) {
    initOnce = (async () => {
      const db = seed(defaultDB());
      await save(db);
    })();
  }
  await initOnce;
  return (await loadRaw()) || seed(defaultDB());
}

// ===== المستخدمون =====
export async function listUsers(): Promise<User[]> {
  return (await getDB()).users.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function getUserById(id: string): Promise<User | undefined> {
  return (await getDB()).users.find((u) => u.id === id);
}

export async function getUserByPhone(phone: string): Promise<User | undefined> {
  const p = normalizePhone(phone);
  return (await getDB()).users.find((u) => u.phone === p);
}

export async function getUserByUsername(username: string): Promise<User | undefined> {
  const u = normUsername(username);
  if (!u) return undefined;
  return (await getDB()).users.find((x) => normUsername(x.username || "") === u);
}

export async function createUser(input: {
  phone: string;
  name: string;
  role: Role;
  sectorIds?: string[];
  username?: string;
  password?: string;
}): Promise<User> {
  const db = await getDB();
  const phone = normalizePhone(input.phone);
  if (!phone || phone.length < 10) throw new Error("رقم جوال غير صحيح");
  if (db.users.some((u) => u.phone === phone)) throw new Error("هذا الرقم مضاف مسبقًا");
  const username = normUsername(input.username || "");
  if (username && db.users.some((u) => normUsername(u.username || "") === username)) {
    throw new Error("اسم المستخدم مستخدَم مسبقًا");
  }
  const user: User = {
    id: newId(),
    phone,
    username: username || undefined,
    passwordHash: input.password ? hashPassword(input.password) : undefined,
    name: input.name.trim() || phone,
    role: input.role,
    active: true,
    createdAt: new Date().toISOString(),
    sectorIds: input.role === "manager" ? input.sectorIds || [] : [],
  };
  db.users.push(user);
  await save(db);
  return user;
}

export async function updateUser(
  id: string,
  patch: {
    active?: boolean;
    sectorIds?: string[];
    name?: string;
    role?: Role;
    username?: string;
    password?: string;
  }
): Promise<void> {
  const db = await getDB();
  const u = db.users.find((x) => x.id === id);
  if (!u) return;
  if (typeof patch.active === "boolean") u.active = patch.active;
  if (Array.isArray(patch.sectorIds)) u.sectorIds = patch.sectorIds;
  if (typeof patch.name === "string" && patch.name.trim()) u.name = patch.name.trim();
  if (patch.role === "admin" || patch.role === "manager") {
    u.role = patch.role;
    if (patch.role === "admin") u.sectorIds = [];
  }
  if (typeof patch.username === "string") {
    const un = normUsername(patch.username);
    if (un && db.users.some((x) => x.id !== id && normUsername(x.username || "") === un)) {
      throw new Error("اسم المستخدم مستخدَم مسبقًا");
    }
    u.username = un || undefined;
  }
  // كلمة مرور فارغة = أبقِ الحالية كما هي (لا تُمسح بالخطأ)
  if (patch.password) u.passwordHash = hashPassword(patch.password);
  await save(db);
}

export async function deleteUser(id: string): Promise<void> {
  const db = await getDB();
  db.users = db.users.filter((u) => u.id !== id);
  await save(db);
}

// ===== رموز الدخول (OTP) =====
export async function setOtp(phone: string, code: string, ttlMs: number): Promise<void> {
  const db = await getDB();
  const p = normalizePhone(phone);
  db.otps = db.otps.filter((o) => o.phone !== p);
  db.otps.push({ phone: p, code, expiresAt: Date.now() + ttlMs });
  await save(db);
}

export async function verifyOtp(phone: string, code: string): Promise<boolean> {
  const db = await getDB();
  const p = normalizePhone(phone);
  const otp = db.otps.find((o) => o.phone === p);
  if (!otp) return false;
  const ok = otp.code === code.trim() && otp.expiresAt > Date.now();
  if (ok) {
    db.otps = db.otps.filter((o) => o.phone !== p);
    await save(db);
  }
  return ok;
}

// ===== الجلسات =====
export async function createSession(userId: string, ttlMs: number): Promise<string> {
  const db = await getDB();
  const token = crypto.randomBytes(24).toString("hex");
  db.sessions = db.sessions.filter((s) => s.expiresAt > Date.now());
  db.sessions.push({ token, userId, expiresAt: Date.now() + ttlMs });
  await save(db);
  return token;
}

export async function getSessionUser(token: string | undefined): Promise<User | undefined> {
  if (!token) return undefined;
  const db = await getDB();
  const s = db.sessions.find((x) => x.token === token);
  if (!s || s.expiresAt < Date.now()) return undefined;
  return db.users.find((u) => u.id === s.userId && u.active);
}

export async function destroySession(token: string | undefined): Promise<void> {
  if (!token) return;
  const db = await getDB();
  db.sessions = db.sessions.filter((s) => s.token !== token);
  await save(db);
}

// ===== القطاعات =====
const MAX_SECTORS = 7;

export async function listSectors(): Promise<Sector[]> {
  return (await getDB()).sectors.sort((a, b) => a.order - b.order);
}

export async function getSector(id: string): Promise<Sector | undefined> {
  return (await getDB()).sectors.find((s) => s.id === id);
}

export async function createSector(name: string): Promise<Sector> {
  const db = await getDB();
  if (db.sectors.length >= MAX_SECTORS) throw new Error(`الحد الأقصى ${MAX_SECTORS} قطاعات`);
  const sector: Sector = { id: newId(), name: name.trim(), order: db.sectors.length + 1 };
  db.sectors.push(sector);
  await save(db);
  return sector;
}

export async function updateSector(id: string, name: string): Promise<void> {
  const db = await getDB();
  const s = db.sectors.find((x) => x.id === id);
  if (s && name.trim()) {
    s.name = name.trim();
    await save(db);
  }
}

export async function deleteSector(id: string): Promise<void> {
  const db = await getDB();
  db.measurements = db.measurements.filter((m) => m.sectorId !== id);
  db.sectors = db.sectors.filter((s) => s.id !== id);
  db.users.forEach((u) => {
    u.sectorIds = (u.sectorIds || []).filter((sid) => sid !== id);
  });
  await save(db);
}

// ===== المؤشرات =====
export type IndicatorInput = {
  id?: string;
  name: string;
  unit: IndicatorUnit;
  active: boolean;
};

export async function listIndicators(includeInactive = false): Promise<Indicator[]> {
  const all = (await getDB()).indicators.sort((a, b) => a.order - b.order);
  return includeInactive ? all : all.filter((i) => i.active);
}

export async function saveIndicators(items: IndicatorInput[]): Promise<Indicator[]> {
  const db = await getDB();
  db.indicators = items
    .filter((i) => i.name.trim())
    .map((i, idx) => ({
      id: i.id || newId(),
      name: i.name.trim(),
      unit: i.unit === "number" ? "number" : "percent",
      active: i.active !== false,
      order: idx + 1,
    }));
  const ids = new Set(db.indicators.map((i) => i.id));
  db.measurements = db.measurements.filter((m) => ids.has(m.indicatorId));
  await save(db);
  return db.indicators;
}

// ===== المستهدفات (سنوي أو ربعي) =====
export async function getTargets(): Promise<Record<string, number | number[]>> {
  return (await getDB()).targets || {};
}

// حفظ المستهدفات (سنوي: رقم · ربعي: مصفوفة 4 قيم)
export async function saveTargets(
  map: Record<string, number | number[]>
): Promise<Record<string, number | number[]>> {
  const db = await getDB();
  const clean: Record<string, number | number[]> = {};
  for (const [k, v] of Object.entries(map || {})) {
    if (Array.isArray(v)) {
      const arr = v.slice(0, 4).map((x) => (Number.isFinite(Number(x)) ? Math.max(0, Number(x)) : 0));
      while (arr.length < 4) arr.push(0);
      if (arr.some((x) => x > 0)) clean[k] = arr;
    } else {
      const n = Number(v);
      if (Number.isFinite(n) && n >= 0) clean[k] = n;
    }
  }
  db.targets = clean;
  await save(db);
  return db.targets;
}

// ===== الفترات =====
export async function listPeriods(): Promise<Period[]> {
  return (await getDB()).periods.sort((a, b) => a.order - b.order);
}

export async function createPeriod(label: string, weekStart?: string): Promise<Period> {
  const db = await getDB();
  // منع التكرار: لو الأسبوع (بنفس تاريخ البداية) موجود، أعِده
  if (weekStart) {
    const existing = db.periods.find((p) => p.weekStart === weekStart);
    if (existing) return existing;
  }
  // ترتيب زمني تلقائي حسب تاريخ بداية الأسبوع (أيام منذ 1970)
  const order = weekStart
    ? Math.floor(new Date(weekStart + "T00:00:00Z").getTime() / 86400000)
    : db.periods.length + 1;
  const period: Period = { id: newId(), label: label.trim(), order, weekStart };
  db.periods.push(period);
  await save(db);
  return period;
}

export async function updatePeriod(id: string, label: string): Promise<void> {
  const db = await getDB();
  const p = db.periods.find((x) => x.id === id);
  if (p && label.trim()) {
    p.label = label.trim();
    await save(db);
  }
}

export async function deletePeriod(id: string): Promise<void> {
  const db = await getDB();
  db.periods = db.periods.filter((p) => p.id !== id);
  db.measurements = db.measurements.filter((m) => m.periodId !== id);
  await save(db);
}

// ===== القياسات =====
export async function listMeasurements(filter?: {
  sectorId?: string;
  periodId?: string;
  sectorIds?: string[];
}): Promise<Measurement[]> {
  let list = (await getDB()).measurements;
  if (filter?.sectorId) list = list.filter((m) => m.sectorId === filter.sectorId);
  if (filter?.periodId) list = list.filter((m) => m.periodId === filter.periodId);
  if (filter?.sectorIds) list = list.filter((m) => filter.sectorIds!.includes(m.sectorId));
  return list;
}

export async function upsertMeasurement(input: {
  sectorId: string;
  indicatorId: string;
  periodId: string;
  target: number | null;
  actual: number | null;
  updatedBy: string;
}): Promise<Measurement> {
  const db = await getDB();
  let m = db.measurements.find(
    (x) =>
      x.sectorId === input.sectorId &&
      x.indicatorId === input.indicatorId &&
      x.periodId === input.periodId
  );
  if (m) {
    m.target = input.target;
    m.actual = input.actual;
    m.updatedBy = input.updatedBy;
    m.updatedAt = new Date().toISOString();
  } else {
    m = {
      id: newId(),
      sectorId: input.sectorId,
      indicatorId: input.indicatorId,
      periodId: input.periodId,
      target: input.target,
      actual: input.actual,
      updatedBy: input.updatedBy,
      updatedAt: new Date().toISOString(),
    };
    db.measurements.push(m);
  }
  await save(db);
  return m;
}

// ===== الإعدادات (حالات الأداء + وضع المستهدف) =====
export async function getSettings(): Promise<Settings> {
  const s = (await getDB()).settings as unknown as {
    statuses?: StatusBand[];
    targetMode?: TargetMode;
    goodThreshold?: number;
    excellentThreshold?: number;
  };
  const targetMode: TargetMode = s?.targetMode === "quarterly" ? "quarterly" : "annual";
  if (s && Array.isArray(s.statuses) && s.statuses.length) {
    return { statuses: s.statuses, targetMode };
  }
  if (s && typeof s.goodThreshold === "number") {
    return {
      statuses: [
        { label: "متعثر", color: "#ef4444", from: 0 },
        { label: "متعثر جزئيًا", color: "#f59e0b", from: s.goodThreshold },
        { label: "وفق المسار", color: "#22c55e", from: s.excellentThreshold ?? 100 },
      ],
      targetMode,
    };
  }
  return { statuses: DEFAULT_STATUS_BANDS, targetMode };
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const db = await getDB();
  const cur: Settings = {
    statuses: db.settings?.statuses?.length ? db.settings.statuses : DEFAULT_STATUS_BANDS,
    targetMode: db.settings?.targetMode === "quarterly" ? "quarterly" : "annual",
  };
  if (Array.isArray(patch.statuses)) {
    cur.statuses =
      patch.statuses
        .filter((b) => b && typeof b.label === "string" && b.label.trim())
        .map((b) => ({
          label: String(b.label).trim(),
          color: /^#[0-9a-fA-F]{3,8}$/.test(b.color) ? b.color : "#64748b",
          from: Number.isFinite(Number(b.from)) ? Math.max(0, Number(b.from)) : 0,
        }))
        .sort((a, b) => a.from - b.from) || DEFAULT_STATUS_BANDS;
    if (cur.statuses.length === 0) cur.statuses = DEFAULT_STATUS_BANDS;
  }
  if (patch.targetMode === "annual" || patch.targetMode === "quarterly") {
    cur.targetMode = patch.targetMode;
  }
  db.settings = cur;
  await save(db);
  return db.settings;
}

/* ============ المهام والتكليفات ============ */
export async function listTasks(): Promise<Task[]> {
  const db = await getDB();
  return [...db.tasks].sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
}

export async function createTask(input: {
  title: string;
  description?: string;
  assigneeId: string;
  priority: TaskPriority;
  dueDate: string;
  indicatorId?: string;
  createdById: string;
}): Promise<Task> {
  const db = await getDB();
  const task: Task = {
    id: newId(),
    title: input.title.trim(),
    description: (input.description || "").trim() || undefined,
    assigneeId: input.assigneeId,
    priority: input.priority === "high" ? "high" : "mid",
    dueDate: input.dueDate,
    indicatorId: input.indicatorId || undefined,
    state: "ok",
    updates: [],
    createdById: input.createdById,
    createdAt: new Date().toISOString(),
  };
  db.tasks.push(task);
  await save(db);
  return task;
}

export async function updateTask(
  id: string,
  patch: { state?: TaskState; update?: { text: string; byId: string; byName: string } }
): Promise<Task | undefined> {
  const db = await getDB();
  const task = db.tasks.find((t) => t.id === id);
  if (!task) return undefined;
  if (patch.state === "ok" || patch.state === "risk" || patch.state === "done") {
    task.state = patch.state;
    task.completedAt = patch.state === "done" ? new Date().toISOString() : undefined;
  }
  const text = patch.update?.text?.trim();
  if (text) {
    task.updates.push({
      id: newId(),
      text,
      byId: patch.update!.byId,
      byName: patch.update!.byName,
      at: new Date().toISOString(),
    });
  }
  await save(db);
  return task;
}

export async function deleteTask(id: string): Promise<void> {
  const db = await getDB();
  db.tasks = db.tasks.filter((t) => t.id !== id);
  await save(db);
}

/* ============ ملاحظات المؤشرات ============ */
export async function listNotes(filter?: { sectorId?: string; indicatorId?: string }): Promise<Note[]> {
  const db = await getDB();
  return db.notes
    .filter((n) => (!filter?.sectorId || n.sectorId === filter.sectorId))
    .filter((n) => (!filter?.indicatorId || n.indicatorId === filter.indicatorId))
    .sort((a, b) => (a.at || "").localeCompare(b.at || ""));
}

export async function createNote(input: {
  sectorId: string;
  indicatorId: string;
  text: string;
  mentions: string[];
  byId: string;
  byName: string;
}): Promise<Note> {
  const db = await getDB();
  const note: Note = {
    id: newId(),
    sectorId: input.sectorId,
    indicatorId: input.indicatorId,
    text: input.text.trim(),
    mentions: input.mentions.filter(Boolean),
    byId: input.byId,
    byName: input.byName,
    at: new Date().toISOString(),
  };
  db.notes.push(note);
  await save(db);
  return note;
}

/* ============ آخر اطّلاع على التحديثات ============ */
export async function getLastSeen(userId: string): Promise<string> {
  const db = await getDB();
  return db.lastSeen[userId] || "";
}

export async function markSeen(userId: string): Promise<void> {
  const db = await getDB();
  db.lastSeen[userId] = new Date().toISOString();
  await save(db);
}

/* ============ روابط مشاركة التقرير ============ */
export async function listShares(): Promise<ReportShare[]> {
  const db = await getDB();
  return db.shares;
}

export async function createShare(input: {
  weekStart: string;
  createdById: string;
  days: number | null;
}): Promise<ReportShare> {
  const db = await getDB();
  const share: ReportShare = {
    token: crypto.randomBytes(12).toString("hex"),
    weekStart: input.weekStart,
    createdById: input.createdById,
    createdAt: new Date().toISOString(),
    expiresAt:
      input.days && input.days > 0
        ? new Date(Date.now() + input.days * 86400000).toISOString()
        : undefined,
    views: [],
  };
  db.shares.push(share);
  await save(db);
  return share;
}

export async function getShare(token: string): Promise<ReportShare | undefined> {
  const db = await getDB();
  const s = db.shares.find((x) => x.token === token);
  if (!s) return undefined;
  if (s.expiresAt && s.expiresAt < new Date().toISOString()) return undefined;
  return s;
}

export async function recordShareView(token: string, ua?: string): Promise<void> {
  const db = await getDB();
  const s = db.shares.find((x) => x.token === token);
  if (!s) return;
  s.views.push({ at: new Date().toISOString(), ua });
  if (s.views.length > 200) s.views = s.views.slice(-200);
  await save(db);
}

export async function revokeShare(token: string): Promise<void> {
  const db = await getDB();
  db.shares = db.shares.filter((x) => x.token !== token);
  await save(db);
}
