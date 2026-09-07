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
  | "users";

export const SCOPE_GROUPS: { title: string; items: { key: Scope; label: string; note?: string }[] }[] = [
  {
    title: "الصفحات",
    items: [
      { key: "overview", label: "نظرة عامة", note: "حالة المؤشرات والأداء العام للقطاعات" },
      { key: "details", label: "المؤشرات التفصيلية", note: "قطاعاته المسندة له" },
      { key: "tasks", label: "المهام", note: "المهام المسندة له" },
      { key: "weekly", label: "الإنجاز الأسبوعي" },
      { key: "weekly:edit", label: "تحرير التقرير الأسبوعي", note: "اختيار أقسامه وكتابة خاناته" },
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
    ],
  },
];

export const ALL_SCOPES: Scope[] = SCOPE_GROUPS.flatMap((g) => g.items.map((i) => i.key));

/** ما يُقترح لموظف جديد: يشوف قطاعه ومهامه ولا شيء غيرهما */
export const DEFAULT_SCOPES: Scope[] = ["overview", "details", "tasks"];

export const scopeLabel = (k: string): string =>
  SCOPE_GROUPS.flatMap((g) => g.items).find((i) => i.key === k)?.label || k;

export function can(scopes: string[] | undefined, s: Scope): boolean {
  return Array.isArray(scopes) && scopes.includes(s);
}
