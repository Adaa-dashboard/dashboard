/** @type {import('next').NextConfig} */

// اللوحة تُنشر ملفات ثابتة على GitHub Pages تحت مسار فرعي،
// لأن نطاقات الاستضافة التي تشغّل خواديم محجوبة في شبكة العمل.
// BASE_PATH يُمرَّر وقت البناء فيتغيّر المسار بلا تعديل الكود.
const basePath = process.env.BASE_PATH || "";

const nextConfig = {
  reactStrictMode: true,
  // نمرّرها للمتصفح من نفس المتغيّر: asset() تقرأ NEXT_PUBLIC_BASE_PATH،
  // وتمرير BASE_PATH وحده كان يبني الصور بمسار الجذر فيختفي الشعار.
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
  output: "export",
  basePath,
  assetPrefix: basePath || undefined,
  images: { unoptimized: true },
  trailingSlash: true,
};

export default nextConfig;
