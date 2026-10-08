import { ExternalLink } from "lucide-react";

/**
 * A compact link to a model's public source page. Desktop opens external
 * links in the system browser.
 */
export function ModelSourceLink({
  href,
  label,
}: {
  href: string;
  label: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex items-center gap-1 rounded-sm text-xs underline-offset-2 transition-colors duration-150 hover:underline focus-visible:ring-2 focus-visible:outline-none"
    >
      {label}
      <ExternalLink className="size-3" aria-hidden />
      <span className="sr-only"> (opens in a new window)</span>
    </a>
  );
}
