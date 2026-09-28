import { createFileRoute, Link } from "@tanstack/react-router";

// The canonical, public protocol document (spec R7); bundled at build time.
import crisisProtocol from "../../../../../docs/safety/crisis-protocol.md?raw";
import { MemoryMarkdownPreview } from "@/ui/memory/MemoryMarkdownPreview";

export const Route = createFileRoute("/safety")({
  component: SafetyRoute,
});

/** Safety and crisis protocol, reachable before and after first run. */
function SafetyRoute() {
  return (
    <main className="bg-background text-foreground min-h-screen px-6 py-10">
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <Link
          to="/"
          className="text-muted-foreground text-sm underline underline-offset-2"
        >
          Back to Animama
        </Link>
        <MemoryMarkdownPreview value={crisisProtocol} allowImages={false} />
      </div>
    </main>
  );
}
