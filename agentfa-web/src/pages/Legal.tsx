import { useI18n } from "../lib/i18n";

type Kind = "terms" | "privacy" | "contact";

/**
 * The trust pages.
 *
 * The footer linked nowhere while the product took mobile numbers and money;
 * these are the minimum a paid product needs to be honest with its users.
 */
export default function Legal({ kind }: { kind: Kind }) {
  const { t } = useI18n();
  return (
    <main className="section">
      <p className="eyebrow">{t("brand.name")}</p>
      <h1 className="page-title mt-3">{t(`legal.${kind}Title`)}</h1>
      <p className="mt-6 max-w-3xl text-base leading-8 text-ink-muted">{t(`legal.${kind}Body`)}</p>
    </main>
  );
}
