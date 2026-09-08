import type { AnimaCreationDiagnostic, AnimaSpecInput } from "@animama/runtime-contracts/sdk";
import type { AnimaCreationSources } from "@/query/hooks/useAnimaCreation";
import { Button } from "@/ui/components/button";
import { MemoryMarkdownPreview } from "@/ui/memory/MemoryMarkdownPreview";
import {
  reactionCount,
  type CreateAnimaDraft,
  type CreationStep,
} from "./createAnimaDraft";

export function CreateAnimaReviewStep({
  draft,
  sources,
  spec,
  warnings,
  busy,
  onEdit,
}: {
  draft: CreateAnimaDraft;
  sources: AnimaCreationSources;
  spec: AnimaSpecInput | null;
  warnings: AnimaCreationDiagnostic[];
  busy: boolean;
  onEdit: (step: CreationStep) => void;
}) {
  const avatar = sources.avatars.data?.find(
    (item) => item.item_id === draft.avatar?.item_id,
  );
  const count = reactionCount(draft);
  const visibleWarnings = warnings.filter(
    (warning) => warning.path !== "/appearance/profile",
  );
  return (
    <div className="space-y-4">
      <div className="rounded-xl border p-4">
        <div className="min-w-0">
          <h3 className="text-xl font-semibold break-words">
            {draft.display_name.trim()}
          </h3>
          <p className="text-muted-foreground mt-1 text-sm">
            {avatar?.name ?? draft.avatar?.item_id ?? "Avatar missing"}
          </p>
        </div>
      </div>
      <section className="rounded-xl border p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-medium">Identity</h3>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onEdit(1)}
            disabled={busy}
          >
            Edit Identity
          </Button>
        </div>
        <MemoryMarkdownPreview
          value={spec?.identity_markdown ?? draft.identity_markdown}
          allowImages={false}
          className="mt-3 text-sm break-words"
        />
      </section>
      <section className="space-y-3 rounded-xl border p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-medium">Actions</h3>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onEdit(2)}
            disabled={busy}
          >
            Edit Actions
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-muted/30 rounded-lg p-3">
            <p className="text-xl font-semibold">{draft.gestures.length}</p>
            <p className="text-muted-foreground text-xs">Gestures selected</p>
          </div>
          <div className="bg-muted/30 rounded-lg p-3">
            <p className="text-xl font-semibold">
              {count} <span className="text-sm font-normal">/ 72</span>
            </p>
            <p className="text-muted-foreground text-xs">
              Reaction cells assigned
            </p>
          </div>
        </div>
      </section>
      {visibleWarnings.length ? (
        <div role="status" className="space-y-2 rounded-xl border p-4">
          <h3 className="text-sm font-medium">Good to know</h3>
          <ul className="text-muted-foreground list-disc space-y-1 pl-4 text-sm">
            {visibleWarnings.map((warning, index) => (
              <li key={`${warning.code}:${index}`}>{warning.message}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
