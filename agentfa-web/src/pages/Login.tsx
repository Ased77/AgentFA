import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, ShieldCheck, Smartphone } from "lucide-react";
import { ApiError } from "../lib/account";
import { useI18n } from "../lib/i18n";
import { formatPhone, localizeDigits, normalizePhone } from "../lib/phone";
import { useSession } from "../lib/session";

/**
 * Sign in with a mobile number and an SMS code.
 *
 * There is no password anywhere in this flow, and no separate signup: the same
 * code creates the account on a first login, so `/login` and `/signup` render
 * this page. The API never says whether a number is known, and neither does the
 * copy — "we sent a code" is true in both cases.
 */

/** Errors this flow can surface, mapped to dictionary keys. */
const ERROR_CODES = [
  "phone_required",
  "invalid_phone",
  "invalid_code",
  "code_expired",
  "too_many_attempts",
  "rate_limited",
  "sms_failed",
  "sms_not_configured",
] as const;

export default function Login() {
  const nav = useNavigate();
  const { t, lang } = useI18n();
  const { startOtp, verifyOtp, user } = useSession();

  const [step, setStep] = useState<"phone" | "code">("phone");
  const [typed, setTyped] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const [signedIn, setSignedIn] = useState(false);
  const codeRef = useRef<HTMLInputElement>(null);

  // A signed-in visitor has no business here — except during the hand-off right
  // after verifying, when the explicit redirect below already knows where to go.
  useEffect(() => {
    if (user && !signedIn) nav("/dashboard", { replace: true });
  }, [user, signedIn, nav]);

  /** Resend cooldown, ticked down once a second. */
  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setTimeout(() => setResendIn((seconds) => seconds - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);

  useEffect(() => {
    if (step === "code") codeRef.current?.focus();
  }, [step]);

  function message(err: unknown): string {
    const key = err instanceof ApiError ? err.code : "network";
    return (ERROR_CODES as readonly string[]).includes(key)
      ? t(`auth.error.${key}`)
      : t("auth.error.generic");
  }

  async function requestCode(target: string) {
    setBusy(true);
    setError("");
    try {
      const started = await startOtp(target);
      setPhone(started.phone);
      setDevCode(started.devCode ?? "");
      setResendIn(started.resendInSeconds);
      setCode("");
      setStep("code");
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  function submitPhone(event: FormEvent) {
    event.preventDefault();
    // Validate locally for instant feedback; the server normalizes again.
    const normalized = normalizePhone(typed);
    if (!normalized.ok) {
      setError(t("auth.error.invalid_phone"));
      return;
    }
    void requestCode(normalized.phone);
  }

  async function submitCode(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { isNewUser } = await verifyOtp(phone, code);
      setSignedIn(true);
      nav(isNewUser ? "/dashboard?welcome=1" : "/dashboard", { replace: true });
    } catch (err) {
      setError(message(err));
      // A code that expired or was burned cannot be retried: let the user ask
      // for a new one straight away instead of waiting out the cooldown.
      if (err instanceof ApiError && (err.code === "code_expired" || err.code === "too_many_attempts")) {
        setResendIn(0);
      }
    } finally {
      setBusy(false);
    }
  }

  const shownPhone = localizeDigits(formatPhone(phone), lang);

  return (
    <main className="auth-shell grid place-items-center p-4 sm:p-5">
      <form
        onSubmit={step === "phone" ? submitPhone : submitCode}
        className="w-full max-w-md rounded-3xl border border-white/10 bg-white/[.03] p-6 shadow-2xl sm:p-7"
      >
        <p className="eyebrow">
          <Smartphone size={14} /> {t("auth.phoneEyebrow")}
        </p>
        <h1 className="mt-3 text-2xl font-black sm:text-3xl">
          {step === "phone" ? t("auth.phoneTitle") : t("auth.codeTitle")}
        </h1>
        <p className="mt-3 text-sm leading-7 text-slate-400">
          {step === "phone"
            ? t("auth.phoneBody")
            : t("auth.codeSentTo", { phone: shownPhone })}
        </p>

        {step === "phone" ? (
          <>
            <input
              className="field mt-6 text-center tracking-widest"
              dir="ltr"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              placeholder={t("auth.phonePlaceholder")}
              aria-label={t("auth.phone")}
              required
            />
            <button className="btn mt-5 w-full justify-center" disabled={busy}>
              {busy ? t("auth.sending") : t("auth.sendCode")}
              <ArrowLeft size={17} />
            </button>
            <p className="mt-5 text-center text-xs leading-6 text-slate-500">
              {t("auth.newAccount")}
            </p>
          </>
        ) : (
          <>
            <input
              ref={codeRef}
              className="field mt-6 text-center text-xl tracking-[.4em]"
              dir="ltr"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="------"
              aria-label={t("auth.code")}
              required
            />
            {devCode && (
              // Development only: with no SMS provider the API echoes the code.
              <p className="mt-3 rounded-xl bg-amber-400/10 px-3 py-2 text-center text-xs text-amber-100">
                {t("auth.devCode", { code: devCode })}
              </p>
            )}
            <button
              className="btn mt-5 w-full justify-center"
              disabled={busy || code.length < 6}
            >
              {busy ? t("auth.verifying") : t("auth.verify")}
              <ArrowLeft size={17} />
            </button>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm">
              <button
                type="button"
                className="text-violet-300 disabled:text-slate-500"
                disabled={resendIn > 0 || busy}
                onClick={() => void requestCode(phone)}
              >
                {resendIn > 0
                  ? t("auth.resendIn", { seconds: localizeDigits(String(resendIn), lang) })
                  : t("auth.resend")}
              </button>
              <button
                type="button"
                className="text-slate-400"
                onClick={() => {
                  setStep("phone");
                  setError("");
                }}
              >
                {t("auth.changePhone")}
              </button>
            </div>
          </>
        )}

        {error && (
          <p className="mt-4 text-center text-sm text-rose-300" role="alert">
            {error}
          </p>
        )}

        <p className="mt-6 flex items-center justify-center gap-2 text-xs text-slate-500">
          <ShieldCheck size={13} /> {t("auth.secure")}
        </p>
      </form>
    </main>
  );
}
