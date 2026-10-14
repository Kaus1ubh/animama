"use client";

import { Loader2, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/ui/components/button";
import { Checkbox } from "@/ui/components/checkbox";
import { MemoryManagerChatPanel } from "@/ui/memory/MemoryManagerChatPanel";
import type { MemoryManagerWorkspaceController } from "@/ui/memory/useMemoryManagerWorkspace";

function pendingCountLabel(count: number) {
  return count > 99 ? "99+" : String(count);
}

/** Renders inline manager lifecycle controls and the existing conversation. */
export function MemoryManagerPanel({
  controller,
  pendingEpisodeCount,
}: {
  controller: MemoryManagerWorkspaceController;
  pendingEpisodeCount: number;
}) {
  const { t } = useTranslation("memory");
  return (
    // min-w-0 lets this row item shrink to the Work pane instead of growing
    // to the transcript's widest unbreakable content.
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="border-border/40 flex min-h-12 shrink-0 flex-wrap items-center justify-start gap-2 border-b px-3 py-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!controller.capabilities.canStartNew}
          onClick={() => void controller.startNew()}
        >
          {controller.isCompleting ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Plus className="size-4" />
          )}
          {t("manager.new")}
        </Button>
        {pendingEpisodeCount > 0 ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!controller.canStartSpecializedRun}
            onClick={() => void controller.processPending(pendingEpisodeCount)}
          >
            {controller.isProcessingEpisodes ? (
              <Loader2 className="size-4 animate-spin" />
            ) : null}
            {t("manager.processEpisodes")}
            <span className="bg-primary text-primary-foreground text-2xs rounded-full px-1.5 py-0.5">
              {pendingCountLabel(pendingEpisodeCount)}
            </span>
          </Button>
        ) : null}
        <label className="border-input bg-background hover:bg-accent hover:text-accent-foreground flex h-8 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm font-medium has-disabled:cursor-not-allowed has-disabled:opacity-50">
          <Checkbox
            checked={controller.autoApproveDiffs}
            disabled={controller.isSending || controller.hasPendingApproval}
            onCheckedChange={(checked) =>
              controller.setAutoApproveDiffs(checked === true)
            }
          />
          {t("manager.autoApprove")}
        </label>
      </div>

      <MemoryManagerChatPanel
        snapshot={controller.snapshot}
        composer={controller.composer}
        optimisticSubmission={controller.optimisticSubmission}
        animatingAssistantMessageId={controller.animatingAssistantMessageId}
        isSending={controller.isSending}
        isLoading={controller.isLoading}
        isError={controller.isError}
        isClosed={controller.capabilities.closed}
        isBusy={controller.isBusy}
        hasPendingApproval={controller.hasPendingApproval}
        episodeProcessingComposerLocked={
          controller.episodeProcessingComposerLocked
        }
        isDeciding={controller.isDeciding}
        isUndoing={controller.isUndoing}
        onComposerChange={controller.setComposer}
        onSubmit={() => void controller.submit()}
        onDecision={(approval, decision, feedback) =>
          void controller.decide(approval, decision, feedback)
        }
        onUndo={(approval) => void controller.undo(approval)}
        onRetry={() => void controller.retry()}
      />
    </div>
  );
}
