import { RouterProvider } from "react-router-dom";
import { router } from "./routes";
import { SessionProvider } from "./lib/session";
import { EntitlementsProvider } from "./lib/useEntitlements";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { useI18n } from "./lib/i18n";

export default function App() {
  const { t } = useI18n();
  return (
    <ErrorBoundary
      fallback={(reset) => (
        <div className="section text-center">
          <h1 className="text-2xl font-black">{t("error.crashTitle")}</h1>
          <p className="mt-4 leading-8 text-slate-400">{t("error.crashBody")}</p>
          <button className="btn mt-6" onClick={reset}>
            {t("error.retry")}
          </button>
        </div>
      )}
    >
      <SessionProvider>
        <EntitlementsProvider>
          <RouterProvider router={router} />
        </EntitlementsProvider>
      </SessionProvider>
    </ErrorBoundary>
  );
}
