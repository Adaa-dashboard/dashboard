"use client";

/* ============================================================
   الصلاحيات — نفس القائمة المعرَّفة في supabase/perf-changes.sql.
   لا يوجد تجاوز ضمني للدور: ما لم يُمنح لا يظهر ولا يُكتب.
   الواجهة تخفي ما لا يُمنح، والحارس الفعلي سياسات RLS ودوال القاعدة.
   ============================================================ */

export type Scope =
  | "overview"
  | "assignments"
  | "changes"
  | "changes:upload"
  | "details"
  | "details:all"
  | "sessions"
  | "natstrat"
  | "inststrat"
  | "outputs"
  | "projects"
  | "cx"
  | "sessions:edit"
  | "natstrat:edit"
  | "inststrat:edit"
  | "outputs:edit"
  | "cx:edit"
  | "projects:edit"
  | "structure"
  | "tasks"
  | "tasks:all"
  | "targets"
  | "weekly"
  | "weekly:edit"
  | "users"
  | "sticky"
  | "audit"
  | "docs"
  | "docs:edit";

export const SCOPE_GROUPS: { title: string; items: { key: Scope; label: string; note?: string }[] }[] = [
  {
    title: "الصفحات",
    items: [
      { key: "overview", label: "نظرة عامة", note: "حالة المؤشرات والأداء العام للقطاعات" },
      { key: "details", label: "المؤشرات التفصيلية", note: "قطاعاته المسندة له" },
      { key: "tasks", label: "المهام", note: "المهام المسندة له" },
      { key: "weekly", label: "الإنجاز الأسبوعي" },
      { key: "weekly:edit", label: "تحرير التقرير الأسبوعي", note: "اختيار أقسامه وكتابة خاناته" },
      { key: "docs", label: "منهجيات أداء", note: "مكتبة المنهجيات والنماذج" },
      { key: "docs:edit", label: "رفع المنهجيات", note: "إضافة الوثائق وحذفها" },
    ],
  },
  {
    title: "الأقسام المتفرّعة من المؤشرات",
    items: [
      { key: "sessions", label: "جلسات مراجعة الأداء" },
      { key: "natstrat", label: "الاستراتيجيات الوطنية" },
      { key: "inststrat", label: "الاستراتيجيات المؤسسية" },
      { key: "outputs", label: "المخرجات الوطنية" },
      { key: "projects", label: "المشاريع الاستراتيجية" },
      { key: "cx", label: "أعمال قياس تجربة المستفيد", note: "من الخدمات الحكومية" },
    ],
  },
  {
    /* التحرير صلاحية مستقلة لكل قسم: الاطّلاع على قسمٍ لا يعني
       تحريره. فمدير القطاع يرى الأقسام كلها ولا يحدّث إلا قسمه. */
    title: "تحرير بيانات الأقسام",
    items: [
      { key: "sessions:edit", label: "تحرير جلسات مراجعة الأداء" },
      { key: "natstrat:edit", label: "تحرير الاستراتيجيات الوطنية" },
      { key: "inststrat:edit", label: "تحرير الاستراتيجيات المؤسسية" },
      { key: "outputs:edit", label: "تحرير المخرجات الوطنية" },
      { key: "cx:edit", label: "تحرير أعمال قياس تجربة المستفيد" },
      { key: "projects:edit", label: "تحرير المشاريع الاستراتيجية" },
    ],
  },
  {
    title: "بنود نظرة عامة",
    items: [
      { key: "assignments", label: "التكاليف", note: "الواردة من جهة أعلى" },
      { key: "changes", label: "طلبات التغيير", note: "عرض ونسخ وتصدير" },
      { key: "changes:upload", label: "رفع ملف طلبات التغيير", note: "لمن يسحب الملف من منصة الرؤية" },
    ],
  },
  {
    title: "توسعة",
    items: [
      { key: "details:all", label: "كل القطاعات", note: "بدل قطاعاته وحدها" },
      { key: "targets", label: "تعديل المستهدفات", note: "في قطاعاته — لمدير القطاع" },
      { key: "tasks:all", label: "كل المهام", note: "بدل مهامه وحدها" },
    ],
  },
  {
    title: "الإعدادات",
    items: [
      { key: "structure", label: "الهيكل التنظيمي", note: "القطاعات وموظفوها" },
      { key: "users", label: "المستخدمون والصلاحيات" },
      { key: "sticky", label: "كتابة الملاحظات اللاصقة", note: "القلم في زاوية كل صفحة" },
      { key: "audit", label: "سجل النشاط", note: "من عدّل ماذا ومتى" },
    ],
  },
];

export const ALL_SCOPES: Scope[] = SCOPE_GROUPS.flatMap((g) => g.items.map((i) => i.key));

/* ============================================================
   شاشة الصلاحيات: صفٌّ لكل صفحة بدل خانةٍ لكل صلاحية.
   الاطّلاع والتعديل صلاحيتان في القاعدة، لكن المستخدم لا يفكّر
   بهما إلا سؤالاً واحداً: «يفتحها؟ ويعدّل فيها؟» — فيُعرضان معاً.
   ============================================================ */
export type PageRow = {
  view: Scope;
  label: string;
  note?: string;
  /** صلاحية التعديل إن كان للصفحة تعديل */
  edit?: Scope;
  editLabel?: string;
  /** خيار إضافي يوسّع نطاق الصفحة */
  extra?: { key: Scope; label: string };
};

export const PAGE_ROWS: { title: string; rows: PageRow[] }[] = [
  {
    title: "الصفحات العامة",
    rows: [
      { view: "overview", label: "نظرة عامة", note: "ملخّص كل الأقسام" },
      {
        view: "details", label: "المؤشرات التفصيلية", note: "قطاعاته المسندة له",
        edit: "targets", editLabel: "تعديل المستهدفات",
        extra: { key: "details:all", label: "كل القطاعات" },
      },
      {
        view: "tasks", label: "المهام", note: "مهامه في محفظتي · والصفحة المستقلة لمن يُسند",
        extra: { key: "tasks:all", label: "كل المهام" },
      },
      {
        view: "weekly", label: "الإنجاز الأسبوعي", note: "للمدراء ومدير الإدارة",
        edit: "weekly:edit", editLabel: "اختيار أقسامه وكتابة خاناته",
      },
      {
        view: "docs", label: "منهجيات أداء", note: "المنهجيات والنماذج — ومنها يجيب المساعد",
        edit: "docs:edit", editLabel: "رفع الوثائق وحذفها",
      },
    ],
  },
  {
    title: "العناوين الأساسية",
    rows: [
      { view: "sessions", label: "جلسات مراجعة الأداء", edit: "sessions:edit" },
      { view: "natstrat", label: "الاستراتيجيات الوطنية", edit: "natstrat:edit" },
      { view: "inststrat", label: "الاستراتيجيات المؤسسية", edit: "inststrat:edit" },
      { view: "outputs", label: "المخرجات الوطنية", edit: "outputs:edit" },
      { view: "cx", label: "أعمال قياس تجربة المستفيد", edit: "cx:edit" },
      { view: "projects", label: "المشاريع الاستراتيجية", edit: "projects:edit" },
    ],
  },
  {
    title: "بنود نظرة عامة والإعدادات",
    rows: [
      { view: "assignments", label: "التكاليف", note: "الواردة من جهة أعلى" },
      { view: "changes", label: "طلبات التغيير", edit: "changes:upload", editLabel: "رفع الملف اليومي" },
      { view: "structure", label: "الهيكل التنظيمي" },
      { view: "users", label: "المستخدمون والصلاحيات" },
      { view: "sticky", label: "كتابة الملاحظات اللاصقة", note: "القلم في زاوية كل صفحة" },
      { view: "audit", label: "سجل النشاط", note: "من عدّل ماذا ومتى" },
    ],
  },
];

/* الموظف الجديد: نظرة عامة ومهامه في محفظتي ولا شيء غيرهما —
   والإنجاز الأسبوعي وصفحات الأقسام تُمنح لمن يخصّه */
export const DEFAULT_SCOPES: Scope[] = ["overview", "tasks", "docs"];

export const scopeLabel = (k: string): string =>
  SCOPE_GROUPS.flatMap((g) => g.items).find((i) => i.key === k)?.label || k;

export function can(scopes: string[] | undefined, s: Scope): boolean {
  return Array.isArray(scopes) && scopes.includes(s);
}
