import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { PyMemoryManagerRunResponse } from "@/lib/content/catalogTypes";
import { MemoryManagerPanel } from "@/ui/memory/MemoryManagerPanel";
import type { MemoryManagerWorkspaceController } from "@/ui/memory/useMemoryManagerWorkspace";

const LONG_PATH =
  "animas/anima-0f1e2d3c-4b5a-6978-8695-a4b3c2d1e0f9/MEMORIES.md";

function controller(
  snapshot: PyMemoryManagerRunResponse,
): MemoryManagerWorkspaceController {
  // Only the fields the panel reads are supplied.
  return {
    snapshot,
    composer: "",
    optimisticSubmission: null,
    animatingAssistantMessageId: null,
    autoApproveDiffs: false,
    capabilities: {
      closed: false,
      canStartNew: true,
      completeBeforeStartNew: true,
    },
    canStartSpecializedRun: true,
    specializedRunBlockReason: null,
    episodeProcessingComposerLocked: false,
    hasPendingApproval: false,
    isBusy: false,
    isSending: false,
    isProcessingEpisodes: false,
    isReflecting: false,
    isCompleting: false,
    isDeciding: false,
    isUndoing: false,
    isLoading: false,
    isError: false,
  } as unknown as MemoryManagerWorkspaceController;
}

describe("MemoryManagerPanel layout", () => {
  it("wraps long message tokens inside a shrinkable panel", () => {
    const html = renderToStaticMarkup(
      <MemoryManagerPanel
        pendingEpisodeCount={0}
        controller={controller({
          run: { id: "run-1", status: "active", kind: "general" },
          messages: [
            {
              id: "m1",
              run_id: "run-1",
              role: "assistant",
              content: `I will update ${LONG_PATH} next.`,
            },
          ],
          approvals: [],
        })}
      />,
    );
    const rootClasses = /^<div class="([^"]*)"/.exec(html)?.[1].split(" ");

    // The panel is a flex row item; without min-w-0 its min-content width
    // (the longest unbreakable token) widens it past the Work pane.
    expect(rootClasses).toContain("min-w-0");
    // The message body, not only a distant ancestor, allows breaking anywhere.
    const wrapAt = html.lastIndexOf(
      "[overflow-wrap:anywhere]",
      html.indexOf(LONG_PATH),
    );
    expect(wrapAt).toBeGreaterThan(-1);
    expect(html.slice(wrapAt, html.indexOf(LONG_PATH))).not.toContain(
      "</div></div>",
    );
  });
});
