import type { ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";

/**
 * A model's name linked to its public source page, for use inside a sentence
 * (as a `<Trans>` component, which supplies the name). Desktop opens external
 * links in the system browser.
 */
export function ModelLink({
  href,
  children,
}: {
  href: string;
  children?: ReactNode;
}) {
  const { t } = useTranslation("setup");
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-foreground decoration-foreground/40 hover:decoration-foreground focus-visible:ring-ring inline-flex items-baseline gap-0.5 rounded-sm font-medium underline underline-offset-2 transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
    >
      {children}
      <ExternalLink className="size-3 self-center" aria-hidden />
      <span className="sr-only"> {t("links.opensInNewWindow")}</span>
    </a>
  );
}
