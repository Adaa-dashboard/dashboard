import { headers } from "next/headers";
import { getShare, recordShareView } from "@/lib/db";
import { buildWeekly } from "@/lib/weekly";
import WeeklyView from "@/app/dashboard/WeeklyView";
import "@/app/globals.css";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "الإنجاز الأسبوعي — إدارة عمليات الأداء",
};

export default async function SharedReport(ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const share = await getShare(token);

  if (!share) {
    return (
      <main className="wk-public">
        <div className="wk-gone">
          <img src="/adaa-logo.png" alt="أداء" className="wk-logo" />
          <b>الرابط غير صالح</b>
          <span>انتهت صلاحية هذا الرابط أو أُلغي. اطلب رابطًا جديدًا من إدارة عمليات الأداء.</span>
        </div>
      </main>
    );
  }

  const ua = (await headers()).get("user-agent") || undefined;
  await recordShareView(token, ua);

  // الرابط للاطّلاع فقط: يبني تقرير الأسبوع كاملاً بلا مستخدم ⇒ بلا أي حق تعديل
  const report = await buildWeekly(share.weekStart);

  return (
    <main className="wk-public">
      <WeeklyView report={report} />
      <p className="wk-ro no-print">هذه نسخة للاطّلاع فقط.</p>
    </main>
  );
}
