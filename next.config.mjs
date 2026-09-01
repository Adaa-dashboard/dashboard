/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // إخراج مستقل لتشغيل أخف داخل Docker (Render).
  // على Vercel لا يُستخدم — المنصّة تبني دوالّها بنفسها، وتركه يطبع تحذيراً.
  output: process.env.VERCEL ? undefined : "standalone",
};

export default nextConfig;
