import { useState } from "react";

import crisisProtocol from "../../../../../../docs/safety/crisis-protocol.md?raw";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/ui/components/dialog";
import { MemoryMarkdownPreview } from "@/ui/memory/MemoryMarkdownPreview";

/**
 * Opens the canonical crisis protocol in place, so reading it never leaves the
 * chat, aborts a reply or loses the crisis card (spec R4, R7).
 */
export function SafetyProtocolDialog({ className }: { className?: string }) {
  // In canvas fullscreen only the fullscreen element is displayed, so the
  // dialog must portal into it to be visible.
  const [container, setContainer] = useState<HTMLElement | null>(null);
  return (
    <Dialog
      onOpenChange={(open) => {
        if (open) {
          const fullscreen = document.fullscreenElement;
          setContainer(fullscreen instanceof HTMLElement ? fullscreen : null);
        }
      }}
    >
      <DialogTrigger asChild>
        <button type="button" className={className}>
          Safety and crisis protocol
        </button>
      </DialogTrigger>
      <DialogContent
        portalContainer={container}
        className="max-h-[85vh] overflow-y-auto sm:max-w-2xl"
      >
        <DialogTitle className="sr-only">
          Safety and crisis protocol
        </DialogTitle>
        <MemoryMarkdownPreview
          value={crisisProtocol}
          allowImages={false}
          externalLinks
        />
      </DialogContent>
    </Dialog>
  );
}
