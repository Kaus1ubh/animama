import { Link } from "@tanstack/react-router";
import { FileText } from "lucide-react";

import { memoryEntryErrorMessage } from "@/lib/memory-entries/errors";
import {
  useAnimaIdentities,
  useMemoryEntry,
} from "@/query/hooks/useMemoryEntries";
import { useRepairAnimaMemories } from "@/query/mutations/useRepairAnimaMemories";
import { Button } from "@/ui/components/button";
import { MemoryMarkdownPreview } from "@/ui/memory/MemoryMarkdownPreview";

/** Read the selected Anima's relationship file using its stable entry ID. */
export function AnimaMemoriesSection({ animaId }: { animaId: string }) {
  const identities = useAnimaIdentities();
  const anima = identities.data?.identities?.find(
    (item) => item.anima_id === animaId,
  );
  const entryId = anima?.memories_entry?.id;
  const entry = useMemoryEntry(entryId);
  const repair = useRepairAnimaMemories();

  if (identities.isPending || (entryId && entry.isPending)) {
    return (
      <p className="text-muted-foreground py-8 text-center text-sm">
        Loading memories…
      </p>
    );
  }

  if (
    identities.isError ||
    !anima ||
    (entryId && (entry.isError || !entry.data))
  ) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-destructive text-sm">
          The current memories file could not be loaded.
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            void identities.refetch();
            if (entryId) void entry.refetch();
          }}
        >
          Retry
        </Button>
      </div>
    );
  }

  if (!entryId) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-muted-foreground text-sm">MEMORIES.md is missing.</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={repair.isPending}
          onClick={() => repair.mutate({ animaId })}
        >
          {repair.isPending ? "Repairing memories…" : "Repair memories"}
        </Button>
        {repair.isError ? (
          <p role="alert" className="text-destructive text-sm">
            {memoryEntryErrorMessage(repair.error)}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <MemoryMarkdownPreview
      value={entry.data?.content ?? ""}
      emptyText="_No memories recorded yet._"
      className="text-foreground/90 [overflow-wrap:anywhere]"
    >
      <div className="not-prose float-right mb-3 ml-4 flex justify-end">
        <Button
          asChild
          size="sm"
          variant="outline"
          className="bg-background/92 shadow-sm backdrop-blur-sm"
        >
          <Link
            to="/a/memories"
            search={{ tab: "memory", mode: "manual", entryId }}
          >
            <FileText className="size-4" />
            Edit memories
          </Link>
        </Button>
      </div>
    </MemoryMarkdownPreview>
  );
}
