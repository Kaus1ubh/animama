import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { MemoryMarkdownPreview } from "@/ui/memory/MemoryMarkdownPreview";
import { useCrisisProtocol } from "@/ui/safety/crisisProtocol";

export const Route = createFileRoute("/safety")({
  component: SafetyRoute,
});

/**
 * Safety and crisis protocol, reachable before and after first run, in the
 * active UI Locale (machine translations; English is authoritative).
 */
function SafetyRoute() {
  const { t } = useTranslation("safety");
  const crisisProtocol = useCrisisProtocol();
  return (
    <main className="bg-background text-foreground min-h-app px-6 py-10">
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <Link
          to="/"
          className="text-muted-foreground text-sm underline underline-offset-2"
        >
          {t("protocol.back")}
        </Link>
        <MemoryMarkdownPreview value={crisisProtocol} allowImages={false} />
      </div>
    </main>
  );
}
