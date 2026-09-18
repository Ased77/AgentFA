import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Sparkles } from "lucide-react";
import { useI18n } from "../lib/i18n";
import { useSession } from "../lib/session";
import { ApiError } from "../lib/account";

export default function Login({ signup = false }: { signup?: boolean }) {
  const nav = useNavigate();
  const { t } = useI18n();
  const { login, register } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (signup) await register(email, password);
      else await login(email, password);
      nav("/dashboard");
    } catch (err) {
      setError(err instanceof ApiError ? err.code : "network");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-[calc(100vh-73px)] place-items-center p-5">
      <form
        onSubmit={submit}
        className="w-full max-w-md rounded-3xl border border-white/10 bg-white/[.03] p-7 shadow-2xl"
      >
        <p className="eyebrow">{t("auth.welcome")}</p>
        <h1 className="mt-3 text-3xl font-black">
          {signup ? t("auth.signupTitle") : t("auth.loginTitle")}
        </h1>
        <input
          className="field mt-8"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t("auth.email")}
          required
        />
        <input
          className="field mt-4"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={t("auth.password")}
          minLength={8}
          required
        />
        {error && (
          <p className="mt-4 text-sm text-rose-300" role="alert">
            {error}
          </p>
        )}
        <button className="btn mt-6 w-full justify-center" disabled={busy}>
          {signup ? t("auth.signupBtn") : t("auth.loginBtn")}
          <ArrowLeft size={17} />
        </button>
        <p className="mt-6 text-center text-sm text-slate-400">
          {signup ? (
            <>
              {t("auth.haveAccount")}{" "}
              <Link className="text-violet-300" to="/login">
                {t("auth.enter")}
              </Link>
            </>
          ) : (
            <>
              {t("auth.noAccount")}{" "}
              <Link className="text-violet-300" to="/signup">
                {t("auth.join")}
              </Link>
            </>
          )}
        </p>
        <p className="mt-6 flex items-center justify-center gap-2 text-xs text-slate-500">
          <Sparkles size={13} /> {t("auth.secure")}
        </p>
      </form>
    </main>
  );
}