# -*- coding: utf-8 -*-
"""يولّد صور شاشات الدليل من CSS المنصة نفسه، فتطابق الشكل الحقيقي."""
import os, math, json
CSS = open("/home/user/dashboard/src/app/globals.css").encoding if False else open("/home/user/dashboard/src/app/globals.css").read()

def page(name, inner, width=1200, extra=""):
    html = f'''<meta charset="utf-8"><html dir="rtl" lang="ar"><head><style>
{CSS}
{extra}
body{{background:#f4f7f6;padding:22px;font-family:"IBM Plex Sans Arabic",system-ui,"Segoe UI",Tahoma,sans-serif}}
.wrap{{width:{width-44}px;margin:0 auto}}
</style></head><body><div class="wrap">{inner}</div></body></html>'''
    open(f"{name}.html","w").write(html)
    return name

def ring(p, size=132, color="#1a9d5c"):
    r = size/2-13; c = 2*math.pi*r
    return (f'<svg class="sx-ring" width="{size}" height="{size}" viewBox="0 0 {size} {size}">'
            f'<circle cx="{size/2}" cy="{size/2}" r="{r}" fill="none" stroke="#dceae6" stroke-width="13"/>'
            f'<circle cx="{size/2}" cy="{size/2}" r="{r}" fill="none" stroke="{color}" stroke-width="13" stroke-linecap="round"'
            f' stroke-dasharray="{c*min(100,p)/100} {c}" transform="rotate(-90 {size/2} {size/2})"/>'
            f'<text x="50%" y="50%" text-anchor="middle" dominant-baseline="central" class="sx-ring-t" fill="{color}">{p}٪</text></svg>')

def sec(title, body, link="المزيد من التفاصيل ‹"):
    lk = f'<button class="sx-link">{link}</button>' if link else ""
    return (f'<h2 class="section-title sx-title" style="margin-top:0">'
            f'<button class="sec-tog"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
            f'stroke-width="3" stroke-linecap="round"><path d="M5 9l7 7 7-7"/></svg></button>{title}{lk}</h2>{body}')

SCREENS = {}

# ═══ ١) المساعد الذكي ═══
SUGG = ["أهم شي عندي الآن","ملخص الأسبوع","عطني الزبدة من الاستراتيجيات الوطنية","كم نسبة التزامي؟"]
SCREENS["ai"] = f'''
<div class="modal ai" style="position:static;max-width:640px;margin:auto">
 <div class="m-h"><span class="ai-dot">💡</span><h3>المساعد الذكي</h3><button class="mx">✕</button></div>
 <div class="ai-ask"><input value="عطني الزبدة من الاستراتيجيات الوطنية"><button class="btn btn-sm">اسأل</button></div>
 <div class="ai-sg">{"".join(f"<span>{s}</span>" for s in SUGG)}</div>
 <div class="ai-ans">
  <div class="ai-t"><span class="ic">🏛️</span><b>الاستراتيجيات الوطنية</b><button class="ai-pin">📌 تثبيت</button></div>
  <div class="ai-chips"><span class="ai-chip">الإجمالي <b>52</b></span>
   <span class="ai-chip g">معتمدة من المجلس <b>1</b></span>
   <span class="ai-chip a">قيد المراجعة <b>16</b></span>
   <span class="ai-chip">قابلية قياس مرتفعة <b>13</b></span></div>
  <ul class="ai-lines">
   <li>٥٢ استراتيجية وطنية: ٢٨ قيد الإعداد · ١٦ قيد المراجعة · ٧ معتمدة من اللجنة · ١ معتمدة من مجلس الوزراء.</li>
   <li>قابلية القياس: ١٣ مرتفعة (≥٩٠٪) · ٤ متوسطة (٧٠–٨٩٪) · ٣٥ منخفضة.</li>
   <li>المؤشرات الممثَّلة ٢٨٧ من ٦١٤ · المبادرات ٤٩١ من ٩٣٠.</li>
   <li>آخر تحديث: ٢٠٢٦-٠٩-٠٥.</li>
  </ul>
  <div class="ai-note">الإجابة محسوبة من بياناتك داخل متصفحك.</div>
 </div>
 <div class="ai-foot">الإجابات تُحسب من بياناتك داخل متصفحك — لا تخرج إلى أي خدمة خارجية.</div>
</div>'''

# ═══ ٢) الملاحظات ← التقويم ═══
CAL_DAYS = ["أحد","اثنين","ثلاثاء","أربعاء","خميس","جمعة","سبت"]
_cells = "<span></span><span></span>"
for _d in range(1,31):
    _cls = "tl-d" + (" now" if _d == 6 else "") + (" has" if _d in (7,9,14,22) else "")
    _dot = '<i style="background:#e0971a"></i>' if _d in (7,9,14,22) else ""
    _cells += '<button class="%s">%s%s</button>' % (_cls, _d, _dot)

def nt(t_, x_, m_):
    return '<div class="nt2"><div class="t">%s</div><div class="x">%s</div><div class="m">%s</div></div>' % (t_,x_,m_)

SCREENS["notes"] = ('<div class="pf" style="display:grid;grid-template-columns:1fr 320px;gap:16px;align-items:start">'
 '<div class="card2"><div class="c2h"><b>ملاحظاتي</b></div><div class="c2b"><div class="nts">'
 + nt("بكرة الساعة ٩ اجتماع الديوان", "استعراض جاهزية الاستراتيجيات الوطنية قبل الجلسة", "اليوم 08:12")
 + nt("الأربعاء ٢:٣٠ عرض تجربة المستفيد على مدير الإدارة", "١٥٤ جهازاً · ٥٤ صدر لها تقرير", "اليوم 07:40")
 + nt("بعد بكرة تسليم ملف الحصر لوزارة الصحة", "بعد اعتماد بطاقة القياس", "أمس 14:05")
 + nt("مراجعة ملاحظات المركز على استراتيجية الفضاء", "بلا تاريخ — لا يظهر في التقويم", "أمس 09:20")
 + '</div><div class="addrow">+ ملاحظة جديدة</div></div></div>'
 '<div class="tl-cal" style="position:static">'
 '<div class="tl-calh"><button>›</button><b>سبتمبر 2026</b><button>‹</button></div>'
 '<div class="tl-grid">' + "".join('<span class="tl-dn">%s</span>' % d for d in CAL_DAYS) + _cells + '</div>'
 '<div class="tl-cal-b"><div class="tl-alh">تنبيهات</div><ul>'
 '<li><i style="background:#e0971a"></i>اجتماع الديوان<span>غداً · 09:00</span></li>'
 '<li><i style="background:#e0971a"></i>تسليم ملف الحصر<span>خلال 2 أيام</span></li>'
 '<li><i style="background:#1a9d5c"></i>عرض تجربة المستفيد<span>خلال 3 أيام · 14:30</span></li>'
 '</ul></div></div></div>')

# ═══ ٣) نظرة عامة ═══
def kv(l,n,tot,tone=""):
    w = (n/tot*100) if tot else 0
    return '<div class="kv"><span class="t">%s</span><span class="mb"><i class="%s" style="width:%s%%"></i></span><b>%s</b></div>' % (l,tone,w,n)
def gc(k,v):
    return '<div class="gc"><div class="k">%s</div><div class="v">%s</div></div>' % (k,v)
def sxbox(title, body, link=True):
    lk = '<button class="lnk">التفاصيل ‹</button>' if link else ""
    return ('<div class="sx-box"><div class="hd"><button class="sec-tog">▾</button><h3>%s</h3>%s</div>'
            '<div class="bd">%s</div></div>') % (title, lk, body)

DT = '<span class="dt">2026-09-05</span>'
BANDS = ('<span class="bands"><span class="hi">13 <em>مرتفعة</em></span>'
         '<span class="mid">4 <em>متوسطة</em></span><span class="low">35 <em>منخفضة</em></span></span>')
MEAS = '<span class="meas"><span class="n hi">2٪</span><span class="bar"><i class="hi" style="width:2%"></i></span></span>'

nat_body = ('<div class="head-row"><div class="big"><b>52</b><span>استراتيجية وطنية</span></div><div class="side">'
    + kv("طور الإعداد/التحديث",28,52) + kv("قيد المراجعة",16,52)
    + kv("معتمدة من اللجنة",7,52,"g") + kv("معتمدة من مجلس الوزراء",1,52,"g")
    + '</div></div><div class="gen">'
    + gc("قابلية القياس", BANDS) + gc("مقبولة فنياً","13 <em>من 52</em>")
    + gc("المؤشرات الممثَّلة","287 <em>من 614</em>") + gc("آخر تحديث", DT) + '</div>')

inst_body = ('<div class="head-row"><div class="big"><b>43</b><span>جهة</span></div><div class="side">'
    + kv("عُقد الاجتماع التعريفي",24,43) + kv("الوثائق مستلمة",19,43)
    + kv("اكتملت الوثائق",12,43) + kv("فُعِّل القياس",1,43,"g")
    + '</div></div><div class="gen">'
    + gc("نسبة تفعيل القياس", MEAS) + gc("لم يُعقد اجتماعها","19 <em>جهة</em>")
    + gc("Phase 1 · Phase 2","24 <em>· 19</em>") + gc("آخر تحديث", DT) + '</div>')

cx_stages=[("في التهيئة",15,"#2b7fd4"),("في التخطيط",1,"#7a5cd6"),("في القياس",19,"#e0971a"),("صدر لها تقرير",54,"#1a9d5c")]
cx_bars="".join('<div class="cxc-b"><span class="l">%s</span><span class="m"><i style="width:%s%%;background:%s"></i></span><b style="color:%s">%s</b></div>'
                % (l, n/154*100, c, c, n) for l,n,c in cx_stages)
cx_body = ('<div class="card cxc"><div class="cxc-l">' + ring(78,140)
    + '<b>54 من 69 جهازاً</b><span>المحقق من المستهدف</span></div>'
    + '<div class="cxc-r"><div class="cxc-h">توزيع الأجهزة الـ154 على المراحل</div>' + cx_bars
    + '<div class="cxc-f"><span>مجموع التقارير المعتمدة <b>85</b></span>'
      '<span>احتُسبت في المؤشر <b>55</b></span>'
      '<span>الخدمات المخطط قياسها <b>2074</b> من <b>4305</b></span></div></div></div>')

SCREENS["overview"] = ('<div class="sx-two">' + sxbox("الاستراتيجيات الوطنية", nat_body)
    + sxbox("الاستراتيجيات المؤسسية", inst_body) + '</div>'
    + '<div style="margin-top:22px">' + sec("أعمال قياس تجربة المستفيد من الخدمات الحكومية", cx_body) + '</div>')

# ═══ ٤) الاستراتيجيات الوطنية — بطاقات ═══
NAT_TABS=[("معتمدة من المجلس",1),("معتمدة من اللجنة",7),("قيد المراجعة",16),("قيد الإعداد",28)]
tabs="".join('<button class="stab %s"><span class="l">%s</span><b>%s</b></button>'%("on" if i==2 else "",l,n)
             for i,(l,n) in enumerate(NAT_TABS))
NAT_TRACK=["استلام الوثيقة","استلام الحصر","المراجعة الفنية","معالجة الملاحظات"]

def natcard(name, owner, stage, tech, meas, kr, kt, ir, it_, period, appr, trk, note):
    tone = "hi" if meas>=90 else ("mid" if meas>=70 else "low")
    col  = {"hi":"#1a9d5c","mid":"#e0971a","low":"#d34a4a"}[tone]
    nums = "".join('<div class="n"><div class="k">%s</div><div class="v">%s</div></div>'%(k,v) for k,v in [
        ("المؤشرات","%s <em>من %s</em>"%(kr,kt)),
        ("المبادرات","%s <em>من %s</em>"%(ir,it_)),
        ("فترة الاستراتيجية","<em>%s</em>"%period),
        ("تاريخ الاعتماد","<em>%s</em>"%appr)])
    trkh = "".join('<button class="stg-c s%s"><i></i><span>%s</span></button>'%(trk[i],n)
                   for i,n in enumerate(NAT_TRACK))
    tg = '<span class="tg ok">مقبولة فنياً</span>' if tech else '<span class="tg no">غير مقبولة فنياً</span>'
    return ('<div class="ncard"><div class="hd">'
        '<span class="lg" style="display:inline-block;width:38px;height:38px;border-radius:8px;background:#eef7f4;border:1px solid #d9e8e4"></span>'
        '<b>%s</b>%s</div><div class="own">%s · %s</div>'
        '<div class="bd">%s<div class="nums">%s</div></div>'
        '<div class="trk">%s</div><div class="note">%s</div></div>'
        % (name, tg, owner, stage, ring(meas,104,col), nums, trkh, note))

NATS=[
 ("الاستراتيجية الوطنية لريادة الأعمال والمنشآت","الهيئة العامة للمنشآت الصغيرة والمتوسطة","قيد المراجعة",False,43,8,19,9,21,"2025 حتى 2030م","لم تعتمد",[2,2,2,1],"وجود مخرجات غير قابلة للقياس ولم تُحدَّد مستهدفاتها"),
 ("استراتيجية قطاع التنمية الاجتماعية","وزارة الموارد البشرية والتنمية الاجتماعية","قيد المراجعة",False,46,10,10,6,25,"2026 حتى 2030م","لم تعتمد",[2,2,2,1],"امتثال 46٪ من العناصر — زُوِّدت الوزارة بالملاحظات"),
 ("استراتيجية المدينة المنورة","هيئة تطوير المدينة المنورة","قيد المراجعة",False,0,0,27,0,9,"2026 حتى 2030م","لم تعتمد",[2,1,2,0],"وجود ملاحظات فنية للمؤشرات والمبادرات"),
 ("الاستراتيجية الوطنية للفضاء","وكالة الفضاء السعودية","قيد المراجعة",False,0,0,7,0,9,"-","لم تعتمد",[2,2,1,0],"تم استلام الوثيقة ونموذج الحصر وتزويدهم بملاحظات المركز"),
]
SCREENS["nat"] = ('<div class="stabs">'+tabs+'</div><div class="ncards">'
                  + "".join(natcard(*x) for x in NATS) + '</div>')

# ═══ ٥) جلسات مراجعة الأداء ═══
SESS=["تحديد الجهة","جمع البيانات","إعداد التقرير","انعقاد الجلسة","محضر وتوصيات","الإغلاق"]
def flow(done):
    return '<div class="sx-flow">' + "".join(
        '<div class="sx-st %s"><div class="d">%s</div><div class="t">%s</div></div>'
        % ("ok" if i<done else ("now" if i==done else ""), "✓" if i<done else i+1, st)
        for i,st in enumerate(SESS)) + '</div>'
def scard(name, q, cur, done):
    return ('<div class="sx-card"><div class="sx-h"><b>%s</b><span class="sx-own">%s</span>'
            '<span class="sx-pill">%s</span></div>%s</div>' % (name,q,cur,flow(done)))
SCREENS["sess"] = ('<div class="card sx-sess"><div class="sx-side">' + ring(50,132,"#00584c")
 + '<div class="ttl">إنجاز جلسات المراجعة</div>'
   '<div class="sub">3 من 6 جهات · الربع الثالث 2026</div>'
   '<div class="lgd"><span class="rw"><em class="dot done"></em>مكتملة<b>3</b></span>'
   '<span class="rw"><em class="dot live"></em>جارية<b>2</b></span>'
   '<span class="rw"><em class="dot idle"></em>لم تبدأ<b>1</b></span></div></div>'
 + '<div class="sx-list">'
 + scard("وزارة الصحة","الربع الثالث 2026","مكتملة",6)
 + scard("وزارة الموارد البشرية والتنمية الاجتماعية","الربع الثالث 2026","انعقاد الجلسة",3)
 + scard("هيئة النقل العام","الربع الثالث 2026","جمع البيانات",1)
 + '</div></div>')

# ═══ ٦) الاستراتيجيات المؤسسية ═══
INST_SECS=[("المالي والاقتصادي",8),("البنية التحتية",13),("الخدمات الاجتماعية",9),("الشؤون الحكومية",13)]
itabs="".join('<button class="stab %s"><span class="l">%s</span><b>%s</b></button>'%("on" if i==1 else "",l,n)
              for i,(l,n) in enumerate(INST_SECS))
def iw(owner, phase, cons, phone, steps, tgt):
    st="".join('<div class="iw-st %s"><i></i><div class="k">%s</div><div class="v">%s</div></div>'%(c,k,v)
               for k,v,c in steps)
    ph_cls = "p1" if phase=="Phase 1" else ""
    return ('<div class="iw"><div class="iw-h"><b>%s</b><span class="iw-ph %s">%s</span></div>'
            '<div class="iw-who"><span>الاستشاري <b>%s</b></span><span>%s</span></div>'
            '<div class="iw-steps">%s</div>'
            '<div class="iw-f"><span class="tg">مستهدف التفعيل %s</span><button class="ed">تعديل</button></div></div>'
            % (owner, ph_cls, phase, cons, phone, st, tgt))
S_OK=[("تسمية ممثل","تمت","ok"),("الاجتماع التعريفي","2026-06-18","ok"),("الوثائق","مكتمل","ok"),("تفعيل القياس","مفعل","ok")]
S_MID=[("تسمية ممثل","تمت","ok"),("الاجتماع التعريفي","2026-08-04","ok"),("الوثائق","جزئي","wt"),("تفعيل القياس","غير مفعل","wt")]
S_LOW=[("تسمية ممثل","لم يُرسل بعد","wt"),("الاجتماع التعريفي","لم يتم بعد","wt"),("الوثائق","—",""),("تفعيل القياس","غير مفعل","wt")]
SCREENS["inst"] = ('<div class="stabs">'+itabs+'</div><div class="iw-grid">'
 + iw("الهيئة العامة للطيران المدني","Phase 1","شركة الاستشارات الوطنية","0555xxxxxx",S_OK,"Q3")
 + iw("هيئة النقل العام","Phase 2","مكتب تطوير الأداء","0555xxxxxx",S_MID,"Q4")
 + iw("الهيئة السعودية للمدن الصناعية","Phase 2","—","",S_LOW,"Q4")
 + iw("هيئة تنمية الصادرات السعودية","Phase 1","شركة الاستشارات الوطنية","0555xxxxxx",S_MID,"Q3")
 + '</div>')

# ═══ ٧) الهيكل التنظيمي ═══
def orgp(name, title=None, lead=False):
    jt = '<small>%s</small>'%title if title else ""
    lb = '<b>مدير القطاع</b>' if lead else ""
    return ('<span class="org-p %s"><i class="av s">%s</i>'
            '<span class="who"><em>%s</em>%s</span>%s</span>'
            % ("lead" if lead else "", name.strip()[0], name, jt, lb))
ORG=[("قطاع البنية التحتية",[("معاذ الهقاص","مدير قطاع البنية التحتية",True),("لمى المبدل",None,False),
      ("ريما السكران",None,False),("ندى العمير",None,False),("ياسر بخاري",None,False),
      ("عمر الظاهري",None,False),("عبدالعزيز بن عون",None,False),("محمد الحميزي",None,False),("نورة النصار",None,False)]),
     ("قطاع الخدمات الاجتماعية",[("دعاء الفهمي","مدير قطاع الخدمات الاجتماعية",True),
      ("عبدالرحمن الرميح",None,False),("خالد الجرف",None,False),("هيفاء التركي",None,False)]),
     ("القطاع المالي",[("بدر الغنام","مدير القطاع المالي",True),("رؤى الحماد",None,False),
      ("فاطمة القحطاني",None,False),("فارس السحيباني",None,False),("خالد الخثلان",None,False)]),
     ("قطاع الشؤون الحكومية",[("عمر العتيق","مدير قطاع الشؤون الحكومية",True),("عبدالاله الفوزان",None,False),
      ("هشام بياري",None,False),("مشاعل الدايل",None,False),("ثامر الضبيب",None,False),
      ("حمد العويس",None,False),("وعد الشدي",None,False),("عبدالله البكر",None,False),
      ("سلطانه العرجاني",None,False),("سارة العيسى",None,False)])]
cols="".join('<div class="org-col"><div class="org-sec"><b>%s</b><span class="org-n">%s</span></div>'
             '<div class="org-people">%s</div></div>'
             % (nm, len(ppl), "".join(orgp(*p) for p in ppl)) for nm,ppl in ORG)
SCREENS["struct"] = ('<div class="org">'
 '<div class="org-head"><b>إدارة عمليات الأداء</b><span>30 موظفاً · 4 قطاعات</span></div>'
 '<div class="org-people org-head-people">'
 + orgp("عبدالله الحزامي","مدير إدارة عمليات الأداء")
 + orgp("ناصر الشايع","مساعد مدير إدارة عمليات الأداء")
 + '</div><div class="org-line"></div><div class="org-grid">' + cols + '</div>'
 '<p class="org-note">الهيكل يُبنى من الحسابات نفسها — أضيفي موظفاً من «المستخدمون والصلاحيات» '
 'وأسندي له قطاعه فيظهر هنا مباشرة.</p></div>')

# ═══ ٨) المستخدمون والصلاحيات ═══
USERS=[("عبدالله الحزامي","—","مدير إدارة عمليات الأداء","نظرة عامة · المؤشرات · المهام · التكاليف · كل الأقسام · تحرير"),
 ("عمر العتيق","الشؤون الحكومية","مدير قطاع","نظرة عامة · المؤشرات · المهام · الاستراتيجيات المؤسسية · تحرير"),
 ("دعاء الفهمي","الخدمات الاجتماعية","مدير قطاع","نظرة عامة · المؤشرات · المهام · جلسات مراجعة الأداء · تحرير"),
 ("معاذ الهقاص","البنية التحتية","مدير قطاع","نظرة عامة · المؤشرات · المهام · تجربة المستفيد · تحرير"),
 ("نورة النصار","البنية التحتية","—","نظرة عامة · المهام · طلبات التغيير · رفع الملف"),
 ("هشام بياري","الشؤون الحكومية","—","نظرة عامة · المؤشرات · المهام · الإنجاز الأسبوعي")]
rows="".join('<tr><td><span class="av s">%s</span> %s</td><td>%s</td><td class="dim">%s</td>'
             '<td style="font-size:11px;color:#6b7c77">%s</td>'
             '<td class="c"><button class="btn btn-ghost btn-sm">تعديل</button></td></tr>'
             % (n.strip()[0], n, sec_, role, sc) for n,sec_,role,sc in USERS)
SCREENS["users"] = ('<div class="toolbar"><div class="chips"><button class="chip on">الكل · 30</button>'
 '<button class="chip">مفعَّل · 1</button><button class="chip">لم يُفعَّل · 29</button></div>'
 '<div style="flex:1"></div><button class="btn btn-sm">＋ مستخدم جديد</button></div>'
 '<div class="tbl-wrap"><table class="sx-tbl"><thead><tr><th>الاسم</th><th>القطاع</th>'
 '<th>المسمّى</th><th>الصلاحيات</th><th class="c"></th></tr></thead><tbody>' + rows + '</tbody></table></div>')

# ═══ ٩) محفظتي ═══
def tk(title, boss, due, ups=""):
    lock = '<span class="lock">🔒</span>' if boss else '<span class="ac2 del2">✕</span>'
    return ('<div class="tk2c %s"><div class="ttl">%s</div>'
            '<div class="mt"><span class="from">%s</span><span class="due">%s</span></div>'
            '<div class="acts"><span class="ac2">%s</span><span class="ac2">✓ إنهاء</span>%s</div></div>'
            % ("boss" if boss else "", title, "من مديري" if boss else "ذاتية", due,
               ups or "+ تحديث", lock))
board = ('<div class="tfil"><span class="on">الكل (6)</span><span>مهام موكلة لي (3)</span><span>مهامي (3)</span></div>'
 '<div class="tkboard">'
 '<div class="tkcol"><div class="h" style="--c:#016b5f">المهام<b>3</b></div>'
 + tk("إعداد ملخّص تنفيذي لجاهزية الاستراتيجيات الوطنية", True, "2026-09-10", "1 تحديثات")
 + tk("تجهيز عرض الإنجاز الأسبوعي للإدارة", False, "بعد يومين")
 + tk("متابعة استلام وثائق الاستراتيجيات المتبقية", False, "2026-09-15") + '</div>'
 '<div class="tkcol"><div class="h" style="--c:#d34a4a">المتأخرة<b>1</b></div>'
 + tk("مراجعة الجهات ذات قابلية القياس المنخفضة", True, "متأخرة 3 يوم") + '</div>'
 '<div class="tkcol"><div class="h" style="--c:#5aaba2">المكتملة<b>2</b></div>'
 + tk("تحديث بيانات الاستراتيجيات المؤسسية", True, "متأخرة 8 يوم")
 + tk("توحيد أسماء الجهات في ملف المؤسسية", False, "متأخرة 5 يوم") + '</div></div>')

def card2(title, body, wide=False):
    return ('<div class="card2 %s"><div class="c2h"><b>%s</b></div><div class="c2b">%s</div></div>'
            % ("wide" if wide else "", title, body))
SCREENS["mypage"] = ('<div class="pf"><div class="pf-hero" style="margin-bottom:14px">'
 '<div><h2 style="margin:0;font-size:17px;color:#003b33">سلطانة العرجاني</h2>'
 '<span style="font-size:12px;color:#8a9a95">قطاع الشؤون الحكومية</span></div></div>'
 '<div class="tiles">' + card2("مهامي", board, True)
 + card2("ملاحظاتي", '<div class="nts">'
   '<div class="nt2"><div class="t">بكرة الساعة ٩ اجتماع الديوان</div>'
   '<div class="x">استعراض جاهزية الاستراتيجيات الوطنية</div><div class="m">اليوم 08:12</div></div>'
   '<div class="nt2"><div class="t">الأربعاء ٢:٣٠ عرض تجربة المستفيد</div>'
   '<div class="x">١٥٤ جهازاً · ٥٤ صدر لها تقرير</div><div class="m">اليوم 07:40</div></div>'
   '</div><div class="addrow">+ ملاحظة جديدة</div>')
 + card2("مشاريعي الاستراتيجية",
   '<div class="pf-none">تُضاف من زر «＋» — كل موظف يسجّل مشاريعه وأعماله التشغيلية هنا.</div>')
 + '</div></div>')

# ═══ ١٠) طلبات التغيير ═══
CR=[("KPI-2026-014","نسبة رضا المستفيدين عن الخدمات الرقمية","وزارة الداخلية","معتمد","ok"),
    ("KPI-2026-031","متوسط زمن إنجاز المعاملة","هيئة النقل العام","قيد المراجعة","wt"),
    ("KPI-2026-047","نسبة التحول الرقمي في الخدمات","وزارة التجارة","متأخر","no"),
    ("KPI-2026-052","عدد المستفيدين من المنصة الموحدة","وزارة الصحة","معتمد","ok")]
crr="".join('<tr><td class="ltr cr-code">%s</td><td class="cr-name">%s</td><td>%s</td>'
            '<td><span class="cr-st %s">%s</span></td></tr>' % (c,n,o,cl,st) for c,n,o,st,cl in CR)
SCREENS["changes"] = ('<div class="toolbar"><div class="chips"><button class="chip on">الكل · 128</button>'
 '<button class="chip">معتمد · 96</button><button class="chip">قيد المراجعة · 24</button>'
 '<button class="chip">متأخر · 8</button></div><div style="flex:1"></div>'
 '<button class="btn btn-sm">رفع ملف طلبات التغيير</button>'
 '<button class="btn btn-ghost btn-sm">تصدير Excel</button></div>'
 '<div class="cr-tw"><table class="cr-tbl"><thead><tr><th>رمز المؤشر</th><th>اسم المؤشر</th>'
 '<th>الجهة</th><th>الحالة</th></tr></thead><tbody>' + crr + '</tbody></table></div>')

# ═══ ١١) المؤشرات التفصيلية ═══
DT=[("نسبة رضا المستفيدين","85","78","-7","92٪","ok","▲ 3٪"),
    ("متوسط زمن إنجاز المعاملة (يوم)","5","4.2","+0.8","100٪","ok","▲ 0.4"),
    ("نسبة التحول الرقمي","70","52","-18","74٪","wt","▼ 2٪"),
    ("نسبة الالتزام بمعايير التوثيق","90","61","-29","68٪","no","▼ 5٪")]
dtr="".join('<tr><td class="dt-name">%s</td><td class="ltr">%s</td><td class="ltr">%s</td>'
            '<td class="ltr">%s</td><td class="ltr dt-ach">%s</td><td class="ltr">%s</td>'
            '<td><span class="cr-st %s">%s</span></td><td class="c">—</td></tr>'
            % (n,t_,a,g,ach,prev,cl,{"ok":"على المسار","wt":"يحتاج متابعة","no":"متعثر"}[cl])
            for n,t_,a,g,ach,cl,prev in DT)
SCREENS["details"] = ('<div class="toolbar"><div class="chips"><button class="chip on">حسب القطاع</button>'
 '<button class="chip">حسب المؤشر</button></div><div style="flex:1"></div>'
 '<button class="btn btn-ghost btn-sm">وضع تعديل المستهدفات</button>'
 '<button class="btn btn-ghost btn-sm">تصدير Excel</button></div>'
 '<div class="dt-gh" style="margin-bottom:10px"><h3>قطاع الشؤون الحكومية</h3>'
 '<span class="dt-badge">4 مؤشرات</span></div>'
 '<div class="dt-tw"><table class="dt-tbl"><thead><tr><th>المؤشر</th><th>المستهدف</th><th>الفعلي</th>'
 '<th>الفرق</th><th>الإنجاز</th><th>مقارنة بالربع السابق</th><th>الحالة</th><th>ملاحظات</th>'
 '</tr></thead><tbody>' + dtr + '</tbody></table></div>')

# ═══ ١٢) التكاليف ═══
def tcard(title, who, due, state, cls):
    return ('<button class="tk sm"><span class="tk-t">%s</span>'
            '<span class="tk-m"><span class="av s">%s</span>%s<span class="pr hi">مهمة جداً</span></span>'
            '<span class="tk-f"><span class="dt ltr">%s</span><span class="stt"><i style="background:%s"></i>%s</span></span></button>'
            % (title, who.strip()[0], who, due, cls, state))
SCREENS["asg"] = ('<div class="toolbar"><div class="chips"><button class="chip on">الكل · 3</button>'
 '<button class="chip">المكتملة · 0</button></div><div style="flex:1"></div>'
 '<button class="btn btn-sm">＋ تكليف جديد</button></div>'
 '<div class="tboard">'
 '<div class="tcol"><div class="tcol-h"><i class="gd" style="background:#016b5f"></i>التكاليف<b class="cnt">2</b></div>'
 '<div class="tcol-s">الأحدث أولاً</div>'
 + tcard("التنسيق مع وزارة الداخلية لتضمين آلية قياس كفاية أداء الخدمات العامة في المناطق","عبدالله البكر","2026-09-20","على المسار","#1a9d5c")
 + tcard("إعداد تصور لربط مؤشرات الاستراتيجيات بمنصة الرؤية","حمد العويس","2026-10-02","على المسار","#1a9d5c")
 + '</div>'
 '<div class="tcol"><div class="tcol-h"><i class="gd" style="background:#d34a4a"></i>المتأخرة<b class="cnt">1</b></div>'
 '<div class="tcol-s">تجاوزت موعدها</div>'
 + tcard("رفع تقرير جاهزية الأجهزة لقياس تجربة المستفيد","مشاعل الدايل","2026-08-28","متأخرة","#d34a4a")
 + '</div>'
 '<div class="tcol"><div class="tcol-h"><i class="gd" style="background:#5aaba2"></i>المكتملة<b class="cnt">0</b></div>'
 '<div class="tcol-s">أُغلقت</div><div class="pf-none sm">—</div></div></div>')

# ═══ ١٣) الإنجاز الأسبوعي ═══
WK=[("نسبة رضا المستفيدين عن الخدمات","92٪","ok"),("متوسط زمن إنجاز المعاملة","100٪","ok"),
    ("نسبة التحول الرقمي","74٪","wt"),("نسبة الالتزام بمعايير التوثيق","68٪","no")]
wkr="".join('<tr><td>%s</td><td class="ltr"><b>%s</b></td>'
            '<td><span class="cr-st %s">%s</span></td></tr>'
            % (n,v,c,{"ok":"على المسار","wt":"يحتاج متابعة","no":"متعثر"}[c]) for n,v,c in WK)
SCREENS["weekly"] = ('<div class="wk">'
 '<div class="wk-head"><b>تقرير الإنجاز الأسبوعي</b>'
 '<span>الأسبوع من 2026-08-30 إلى 2026-09-05 · إدارة عمليات الأداء</span></div>'
 '<div class="wk-hero">' + ring(83,124,"#1a9d5c")
 + '<div class="wk-heroT"><span class="wk-lbl">الأداء العام</span>'
   '<b class="wk-hd up">+4٪ عن الأسبوع الماضي</b>'
   '<span class="wk-sub2">4 من 4 مؤشرات مقيسة</span></div>'
   '<div class="wk-heroS"><span class="wk-lbl">مسار ستة أسابيع</span>'
   '<svg width="180" height="42" viewBox="0 0 180 42"><polyline fill="none" stroke="#1a9d5c" stroke-width="2.5" '
   'stroke-linecap="round" stroke-linejoin="round" points="4,34 38,30 72,26 106,22 140,16 176,10"/></svg></div></div>'
 '<div class="card" style="padding:14px 16px;margin-top:14px">'
 '<h3 style="margin:0 0 10px;font-size:12.5px;color:#003b33">مؤشرات الأداء</h3>'
 '<table class="sx-tbl mini"><thead><tr><th>المؤشر</th><th>الإنجاز</th><th>الحالة</th></tr></thead>'
 '<tbody>' + wkr + '</tbody></table></div>'
 '<div class="card" style="padding:14px 16px;margin-top:12px">'
 '<h3 style="margin:0 0 8px;font-size:12.5px;color:#003b33">تحديث الأقسام</h3>'
 '<ul class="ai-lines"><li>الاستراتيجيات الوطنية: ٥٢ استراتيجية · ١ معتمدة من المجلس · ١٦ قيد المراجعة.</li>'
 '<li>الاستراتيجيات المؤسسية: ٤٣ جهة · فُعِّل القياس لجهة واحدة.</li>'
 '<li>تجربة المستفيد: ١٥٤ جهازاً · ٥٤ صدر لها تقرير من مستهدف ٦٩.</li>'
 '<li>جلسات مراجعة الأداء: ٣ من ٦ جهات مكتملة.</li></ul></div>'
 '<div class="wk-foot">يُولَّد التقرير آلياً من بيانات المنصة — لا يُكتب يدوياً.</div></div>')

# ═══ ١٤) شاشة الدخول ═══
SCREENS["login"] = ('<div style="display:flex;justify-content:center;padding:26px 0">'
 '<div class="card" style="width:400px;padding:30px 28px;text-align:center">'
 '<div style="width:56px;height:56px;border-radius:14px;background:#eef7f4;border:1px solid #d9e8e4;'
 'margin:0 auto 14px"></div>'
 '<h1 style="margin:0 0 4px;font-size:17px;color:#003b33">لوحة إدارة عمليات الأداء</h1>'
 '<p style="margin:0 0 18px;font-size:12px;color:#8a9a95">سجّل الدخول باسم المستخدم وكلمة المرور المسنَدَين إليك.</p>'
 '<div style="text-align:start;margin-bottom:11px">'
 '<label style="display:block;font-size:11.5px;color:#8a9a95;margin-bottom:5px">اسم المستخدم</label>'
 '<input value="sultana" dir="ltr" style="width:100%;border:1px solid #dfe7e5;border-radius:10px;'
 'padding:10px 12px;font:inherit;font-size:13px"></div>'
 '<div style="text-align:start;margin-bottom:14px">'
 '<label style="display:block;font-size:11.5px;color:#8a9a95;margin-bottom:5px">كلمة المرور</label>'
 '<input value="••••••••" dir="ltr" style="width:100%;border:1px solid #dfe7e5;border-radius:10px;'
 'padding:10px 12px;font:inherit;font-size:13px"></div>'
 '<button class="btn" style="width:100%">دخول</button>'
 '<p style="margin:14px 0 0;font-size:11px;color:#8a9a95;line-height:1.9">'
 '«مستخدم جديد» لمن أُنشئ له حساب ولم يختر كلمة مروره بعد — يكتب اسم المستخدم ورقم جواله ثم يختار كلمة المرور.<br>'
 'ولا يُنشئ أحد حساباً لنفسه.</p>'
 '</div></div>')
