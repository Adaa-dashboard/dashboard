import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "إدارة عمليات الأداء",
  description: "لوحة قياس أداء القطاعات — المستهدف والمنجز أسبوعيًا",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: "#00584c",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ar" dir="rtl">
      <head>
        <link rel="icon" href={`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/adaa-logo.png`} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Noto+Kufi+Arabic:wght@400;600;700;800&family=Noto+Sans+Arabic:wght@400;500;600;700&display=swap"
        />
        {/* الوضع الداكن قبل أول رسم — بدونه تُفتح الصفحة بيضاء ثم تقلب
            بعد التحميل، فتومض في وجه من اختاره */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              'try{var s=localStorage;if(s.getItem("theme")==="dark")' +
              'document.documentElement.setAttribute("data-theme","dark");' +
              'var l=s.getItem("lang");if(l==="en"){document.documentElement.setAttribute("lang","en");' +
              'document.documentElement.setAttribute("dir","ltr");}}catch(e){}',
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
