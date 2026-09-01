"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [lang, setLang] = useState<"ar" | "en">("ar");
  const t = (ar: string, en: string) => (lang === "en" ? en : ar);
  useEffect(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem("theme") : null;
    if (saved) document.documentElement.setAttribute("data-theme", saved);
    const sl = typeof window !== "undefined" ? localStorage.getItem("lang") : null;
    if (sl === "en" || sl === "ar") setLang(sl);
  }, []);
  useEffect(() => {
    document.documentElement.setAttribute("lang", lang);
    document.documentElement.setAttribute("dir", lang === "en" ? "ltr" : "rtl");
    try {
      localStorage.setItem("lang", lang);
    } catch {
      /* ignore */
    }
  }, [lang]);
  // الطريقة المعتمدة: اسم المستخدم وكلمة المرور. الدخول بالجوال يبقى متاحاً
  // للحسابات التي لم تُضبط لها كلمة مرور بعد، فلا يُقفَل أحد خارج اللوحة.
  // choose = شاشة الاختيار · password = تسجيل دخول · activate = مستخدم جديد
  // أو نسيت كلمة المرور (نفس النموذج) · otp = الدخول بالجوال (مسار احتياطي)
  const [mode, setMode] = useState<"choose" | "password" | "otp" | "activate">("choose");
  const [isReset, setIsReset] = useState(false); // نسيت كلمة المرور، لا مستخدم جديد
  const [remember, setRemember] = useState(true);
  const [sectors, setSectors] = useState<{ id: string; name: string }[]>([]);
  const [sectorId, setSectorId] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [last4, setLast4] = useState("");
  const [pw2, setPw2] = useState("");
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setInfo("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, remember }),
      });
      const data = await res.json();
      if (data.needsActivation) {
        setMode("activate");
        setIsReset(false);
        setPassword("");
        setInfo(
          t(
            "أول دخول لك — اختر كلمة مرورك الآن.",
            "First sign-in — choose your password now."
          )
        );
      } else if (!res.ok) setError(data.error || "تعذّر الدخول");
      else {
        router.push("/dashboard");
        router.refresh();
      }
    } catch {
      setError("تعذّر الاتصال بالخادم");
    } finally {
      setLoading(false);
    }
  }

  // قائمة القطاعات تُجلب عند فتح نموذج التسجيل فقط
  useEffect(() => {
    if (mode !== "activate" || isReset || sectors.length) return;
    fetch("/api/sectors/public")
      .then((r) => r.json())
      .then((d) => setSectors(d.sectors || []))
      .catch(() => setSectors([]));
  }, [mode, isReset, sectors.length]);

  async function activate(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password !== pw2) {
      setError(t("الكلمتان غير متطابقتين", "Passwords do not match"));
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          last4,
          password,
          remember,
          sectorIds: !isReset && sectorId ? [sectorId] : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error || "تعذّر التفعيل");
      else {
        router.push("/dashboard");
        router.refresh();
      }
    } catch {
      setError("تعذّر الاتصال بالخادم");
    } finally {
      setLoading(false);
    }
  }

  async function requestCode(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setInfo("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/request-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "حدث خطأ");
      } else {
        setStep("code");
        if (data.devCode) {
          setInfo(t(`وضع التجربة: رمزك هو ${data.devCode}`, `Demo mode: your code is ${data.devCode}`));
        } else {
          setInfo(t("تم إرسال رمز الدخول برسالة إلى جوالك.", "A login code has been sent to your phone."));
        }
      }
    } catch {
      setError("تعذّر الاتصال بالخادم");
    } finally {
      setLoading(false);
    }
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, code }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "الرمز غير صحيح");
      } else {
        router.push("/dashboard");
        router.refresh();
      }
    } catch {
      setError("تعذّر الاتصال بالخادم");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="card auth-card">
        <div style={{ textAlign: lang === "en" ? "right" : "left", marginBottom: 4 }}>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setLang(lang === "ar" ? "en" : "ar")}
          >
            {lang === "ar" ? "English" : "عربي"}
          </button>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className="auth-logo"
          src="/adaa-logo.png"
          alt="أداء — المركز الوطني لقياس أداء الأجهزة العامة"
        />
        <h1>{t("لوحة إدارة عمليات الأداء", "Performance Operations Dashboard")}</h1>
        <p className="sub">
          {mode === "choose"
            ? t(
                "لوحة متابعة أداء الإدارة — اختر كيف تريد الدخول.",
                "Performance dashboard — choose how to sign in."
              )
            : mode === "activate"
            ? isReset
              ? t(
                  "لاستعادة الدخول: اكتب اسم المستخدم وآخر أربعة أرقام من جوالك، ثم اختر كلمة مرور جديدة.",
                  "To recover access: enter your username and the last four digits of your phone, then choose a new password."
                )
              : t(
                  "أول دخول: اكتب اسم المستخدم وآخر أربعة أرقام من جوالك، ثم اختر كلمة مرورك.",
                  "First sign-in: enter your username and the last four digits of your phone, then choose a password."
                )
            : mode === "password"
            ? t(
                "سجّل الدخول باسم المستخدم وكلمة المرور المسنَدَين إليك.",
                "Sign in with the username and password assigned to you."
              )
            : t(
                "سجّل الدخول برقم جوالك المصرّح به. سيصلك رمز مكوّن من 6 أرقام برسالة نصية.",
                "Sign in with your authorized phone number. A 6-digit code will be sent to you by SMS."
              )}
        </p>

        {error && <div className="alert alert-error">{error}</div>}
        {info && <div className="alert alert-info">{info}</div>}

        {mode === "choose" ? (
          <div className="auth-choose">
            <button
              className="btn"
              onClick={() => {
                setMode("password");
                setError("");
                setInfo("");
              }}
            >
              {t("تسجيل الدخول", "Sign in")}
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => {
                setMode("activate");
                setIsReset(false);
                setError("");
                setInfo("");
                setPassword("");
                setPw2("");
              }}
            >
              {t("مستخدم جديد", "New user")}
            </button>
            <p className="auth-hint">
              {t(
                "«مستخدم جديد» لمن أُنشئ له حساب ولم يختر كلمة مروره بعد.",
                "“New user” is for an account that has been created but has no password yet."
              )}
            </p>
          </div>
        ) : mode === "activate" ? (
          <form onSubmit={activate}>
            <div className="field">
              <label>{t("اسم المستخدم", "Username")}</label>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                required
                dir="ltr"
                style={{ textAlign: "left" }}
              />
            </div>
            <div className="field">
              <label>{t("آخر ٤ أرقام من جوالك", "Last 4 digits of your phone")}</label>
              <input
                inputMode="numeric"
                maxLength={4}
                value={last4}
                onChange={(e) => setLast4(e.target.value.replace(/\D/g, ""))}
                required
                dir="ltr"
                style={{ textAlign: "center", letterSpacing: "6px" }}
              />
            </div>
            {!isReset && sectors.length > 0 && (
              <div className="field">
                <label>
                  {t("القطاع الذي تتبع له", "Your sector")}{" "}
                  <span className="opt">{t("(يحدّده مدير الإدارة لاحقاً إن لم تكن متأكداً)", "(the admin can set it later)")}</span>
                </label>
                <select value={sectorId} onChange={(e) => setSectorId(e.target.value)}>
                  <option value="">{t("— اختر القطاع —", "— Choose a sector —")}</option>
                  {sectors.map((sc) => (
                    <option key={sc.id} value={sc.id}>
                      {sc.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="field">
              <label>{t("كلمة المرور الجديدة", "New password")}</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                minLength={6}
                required
                dir="ltr"
                style={{ textAlign: "left" }}
              />
            </div>
            <div className="field">
              <label>{t("تأكيد كلمة المرور", "Confirm password")}</label>
              <input
                type="password"
                value={pw2}
                onChange={(e) => setPw2(e.target.value)}
                autoComplete="new-password"
                minLength={6}
                required
                dir="ltr"
                style={{ textAlign: "left" }}
              />
            </div>
            <label className="auth-remember">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              {t("تذكّر هذا الجهاز", "Remember this device")}
            </label>
            <button className="btn" style={{ width: "100%" }} disabled={loading}>
              {loading
                ? t("جارٍ الحفظ...", "Saving...")
                : isReset
                ? t("حفظ كلمة المرور والدخول", "Save password & sign in")
                : t("تفعيل الحساب والدخول", "Activate & sign in")}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ width: "100%", marginTop: "10px" }}
              onClick={() => {
                setMode("choose");
                setError("");
                setInfo("");
                setPassword("");
                setPw2("");
                setLast4("");
              }}
            >
              {t("رجوع", "Back")}
            </button>
          </form>
        ) : mode === "password" ? (
          <form onSubmit={signIn}>
            <div className="field">
              <label>{t("اسم المستخدم", "Username")}</label>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                required
                dir="ltr"
                style={{ textAlign: "left" }}
              />
            </div>
            <div className="field">
              <label>{t("كلمة المرور", "Password")}</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
                dir="ltr"
                style={{ textAlign: "left" }}
              />
            </div>
            <label className="auth-remember">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              {t("تذكّر هذا الجهاز", "Remember this device")}
            </label>
            <button className="btn" style={{ width: "100%" }} disabled={loading}>
              {loading ? t("جارٍ الدخول...", "Signing in...") : t("دخول", "Sign in")}
            </button>
            <button
              type="button"
              className="auth-link"
              onClick={() => {
                setMode("activate");
                setIsReset(true);
                setError("");
                setInfo("");
                setPassword("");
                setPw2("");
              }}
            >
              {t("نسيت كلمة المرور؟", "Forgot your password?")}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ width: "100%", marginTop: "6px" }}
              onClick={() => {
                setMode("choose");
                setError("");
                setInfo("");
              }}
            >
              {t("رجوع", "Back")}
            </button>
          </form>
        ) : step === "phone" ? (
          <form onSubmit={requestCode}>
            <div className="field">
              <label>{t("رقم الجوال", "Phone number")}</label>
              <input
                type="tel"
                inputMode="tel"
                placeholder="05XXXXXXXX"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
                dir="ltr"
                style={{ textAlign: "left" }}
              />
            </div>
            <button className="btn" style={{ width: "100%" }} disabled={loading}>
              {loading ? t("جارٍ الإرسال...", "Sending...") : t("إرسال رمز الدخول", "Send login code")}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ width: "100%", marginTop: "10px" }}
              onClick={() => {
                setMode("choose");
                setError("");
                setInfo("");
              }}
            >
              {t("رجوع", "Back")}
            </button>
          </form>
        ) : (
          <form onSubmit={verifyCode}>
            <div className="field">
              <label>{t("رمز الدخول", "Login code")}</label>
              <input
                inputMode="numeric"
                maxLength={6}
                placeholder="------"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                required
                dir="ltr"
                style={{ textAlign: "center", letterSpacing: "8px", fontSize: "22px" }}
              />
            </div>
            <button className="btn" style={{ width: "100%" }} disabled={loading}>
              {loading ? t("جارٍ التحقق...", "Verifying...") : t("دخول", "Sign in")}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ width: "100%", marginTop: "10px" }}
              onClick={() => {
                setStep("phone");
                setCode("");
                setError("");
                setInfo("");
              }}
            >
              {t("تغيير الرقم", "Change number")}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
