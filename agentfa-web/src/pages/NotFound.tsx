import { Link } from "react-router-dom";
import { useI18n } from "../lib/i18n";
import { ForwardArrow } from "../components/ForwardArrow";

/** Rendered for unknown routes and unknown agent slugs. */
export default function NotFound() {
  const { t } = useI18n();
  return (
    <main className="section grid min-h-[50vh] place-items-center text-center">
      <div className="max-w-lg">
        <h1 className="page-title">{t("notFound.title")}</h1>
        <p className="mt-5 leading-8 text-slate-400">{t("notFound.body")}</p>
        <Link className="btn mt-7" to="/marketplace">
          {t("notFound.cta")} <ForwardArrow size={16} />
        </Link>
      </div>
    </main>
  );
}
