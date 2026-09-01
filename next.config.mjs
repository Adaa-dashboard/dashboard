/** @type {import('next').NextConfig} */

// اللوحة تُنشر ملفات ثابتة على GitHub Pages تحت مسار فرعي،
// لأن نطاقات الاستضافة التي تشغّل خواديم محجوبة في شبكة العمل.
// BASE_PATH يُمرَّر وقت البناء فيتغيّر المسار بلا تعديل الكود.
const basePath = process.env.BASE_PATH || "";

const nextConfig = {
  reactStrictMode: true,
  output: "export",
  basePath,
  assetPrefix: basePath || undefined,
  images: { unoptimized: true },
  trailingSlash: true,
};

export default nextConfig;
