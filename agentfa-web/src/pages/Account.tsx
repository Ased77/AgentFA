import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError } from "../lib/account";
import { useI18n } from "../lib/i18n";
import { formatPhone, localizeDigits, normalizePhone } from "../lib/phone";
import { useSession } from "../lib/session";

/**
 * Account settings.
 *
 * Phone-only login has one dangerous failure mode — lose the SIM and you lose the
 * account and everything bought with it — so moving to a new number (verified by
 * SMS, keeping the same user id) is the important thing this page offers. Account
 * deletion is here too, as the privacy pages promise.
 */
export default function Account() {
  const { t, lang, phone } = useI18n();
  const { user, refresh } = useSession();
  const nav = useNavigate();

  const [step, setStep] = useState<"idle" | "code">("idle");
  const [typed, setTyped] = useState("");
  const [pendingPhone, setPendingPhone] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  function fail(err: unknown) {
    const code = err instanceof ApiError ? err.code : "network";
    const key = `auth.error.${code}`;
    const message = t(key);
    setError(message === key ? t("auth.error.generic") : message);
  }

  async function startChange(event: FormEvent) {
    event.preventDefault();
    const normalized = normalizePhone(typed);
    if (!normalized.ok) {
      setError(t("auth.error.invalid_phone"));
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const started = await (await import("../lib/account")).api.startPhoneChange(normalized.phone);
      setPendingPhone(started.phone);
      setCode("");
      setStep("code");
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function confirmChange(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { api } = await import("../lib/account");
      await api.verifyPhoneChange(pendingPhone, code);
      await refresh();
      setNotice(t("account.changed"));
      setStep("idle");
      setTyped("");
      setCode("");
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function deleteAccount() {
    if (!window.confirm(t("account.deleteWarn"))) return;
    setBusy(true);
    setError("");
    try {
      const { api } = await import("../lib/account");
      await api.deleteAccount();
      await refresh();
      nav("/", { replace: true });
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="section max-w-2xl">
      <p className="eyebrow">{t("account.eyebrow")}</p>
      <h1 className="page-title mt-3">{t("account.title")}</h1>

      <section className="mt-9 rounded-3xl border border-white/10 bg-white/[.03] p-6">
        <h2 className="font-bold">{t("account.phone")}</h2>
        <p className="mt-3 text-lg" dir="ltr">
          {phone(user?.phone ?? "")}
        </p>

        {step === "idle" ? (
          <form onSubmit={startChange} className="mt-5">
            <label className="text-sm">
              <span className="text-slate-400">{t("account.newPhone")}</span>
              <input
                className="field mt-2"
                dir="ltr"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                placeholder={t("auth.phonePlaceholder")}
              />
            </label>
            <button className="btn mt-4" disabled={busy}>
              {t("account.sendCode")}
            </button>
          </form>
        ) : (
          <form onSubmit={confirmChange} className="mt-5">
            <p className="text-sm text-slate-400">
              {t("auth.codeSentTo", { phone: localizeDigits(formatPhone(pendingPhone), lang) })}
            </p>
            <input
              className="field mt-4 text-center text-xl tracking-[.4em]"
              dir="ltr"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="------"
            />
            <button className="btn mt-4" disabled={busy || code.length < 6}>
              {t("account.confirm")}
            </button>
          </form>
        )}

        {notice && <p className="mt-4 text-sm text-emerald-300">✓ {notice}</p>}
        {error && (
          <p className="mt-4 text-sm text-rose-300" role="alert">
            {error}
          </p>
        )}
      </section>

      <section className="mt-8 rounded-3xl border border-rose-400/25 bg-rose-500/[.06] p-6">
        <h2 className="font-bold text-rose-200">{t("account.delete")}</h2>
        <p className="mt-3 text-sm leading-7 text-slate-300">{t("account.deleteWarn")}</p>
        <button className="btn btn-soft mt-5" onClick={() => void deleteAccount()} disabled={busy}>
          {t("account.deleteConfirm")}
        </button>
      </section>
    </main>
  );
}
