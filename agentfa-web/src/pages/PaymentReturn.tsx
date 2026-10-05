import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Check, Clock, X } from "lucide-react";
import { api, ApiError, type TransactionRow } from "../lib/account";
import { useI18n } from "../lib/i18n";
import { useEntitlements } from "../lib/useEntitlements";

type Phase = "loading" | "ok" | "pending" | "failed" | "missing";

/**
 * Where the payment gateway sends the payer back.
 *
 * The server redirects here with `?transaction=…&status=…`, but the query string
 * is only a hint: the transaction status is read from the API and the wallet and
 * entitlements are refreshed, so the page reports what actually happened rather
 * than what the URL claims.
 */
export default function PaymentReturn() {
  const [params] = useSearchParams();
  const { t, toman } = useI18n();
  const { refresh } = useEntitlements();
  const transactionId = params.get("transaction");
  const statusHint = params.get("status");
  const [row, setRow] = useState<TransactionRow | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");

  useEffect(() => {
    let alive = true;

    async function load() {
      if (!transactionId) {
        if (alive) setPhase("missing");
        return;
      }
      try {
        const transaction = await api.transaction(transactionId);
        if (!alive) return;
        setRow(transaction);
        setPhase(
          transaction.status === "success" ? "ok" : transaction.status === "failed" ? "failed" : "pending",
        );
        await refresh();
      } catch (err) {
        if (!alive) return;
        // A 401/404 means we cannot show it; anything else is still settling.
        setPhase(err instanceof ApiError && (err.status === 401 || err.status === 404) ? "missing" : "pending");
      }
    }

    void load();
    return () => {
      alive = false;
    };
  }, [transactionId, statusHint, refresh]);

  const copy = {
    loading: { title: t("pay.loading"), body: "" },
    ok: { title: t("pay.okTitle"), body: t("pay.okBody") },
    pending: { title: t("pay.pendingTitle"), body: t("pay.pendingBody") },
    failed: { title: t("pay.failedTitle"), body: t("pay.failedBody") },
    missing: { title: t("pay.missing"), body: "" },
  }[phase];

  const Icon = phase === "ok" ? Check : phase === "failed" ? X : Clock;
  const tone =
    phase === "ok" ? "text-emerald-300" : phase === "failed" ? "text-rose-300" : "text-amber-300";

  return (
    <main className="section grid min-h-[60vh] place-items-center text-center">
      <div className="w-full max-w-lg rounded-3xl border border-line bg-surface p-8">
        <Icon className={`mx-auto ${tone}`} size={40} />
        <h1 className="mt-5 text-2xl font-black">{copy.title}</h1>
        {copy.body && <p className="mt-4 leading-8 text-ink-muted">{copy.body}</p>}
        {row && (
          <p className="mt-4 text-sm text-ink-muted">
            {toman(row.amount)}
            {row.agentId ? "" : row.tokens ? ` · ${row.tokens} ${t("common.token")}` : ""}
          </p>
        )}
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <Link className="btn btn-soft" to="/dashboard">
            {t("pay.goDashboard")}
          </Link>
          <Link className="btn btn-soft" to="/">
            {t("pay.backHome")}
          </Link>
        </div>
      </div>
    </main>
  );
}
