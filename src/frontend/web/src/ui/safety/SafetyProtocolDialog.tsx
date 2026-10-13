import { useState } from "react";
import { useTranslation } from "react-i18next";

import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/ui/components/dialog";
import { MemoryMarkdownPreview } from "@/ui/memory/MemoryMarkdownPreview";
import { useCrisisProtocol } from "./crisisProtocol";

/**
 * Opens the canonical crisis protocol in place, so reading it never leaves the
 * chat, aborts a reply or loses the crisis card (spec R4, R7). The protocol
 * follows the active UI Locale (machine translations; English is authoritative).
 */
export function SafetyProtocolDialog({ className }: { className?: string }) {
  const { t } = useTranslation("safety");
  const crisisProtocol = useCrisisProtocol();
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
          {t("protocol.title")}
        </button>
      </DialogTrigger>
      <DialogContent
        portalContainer={container}
        className="max-h-[85vh] overflow-y-auto sm:max-w-2xl"
      >
        <DialogTitle className="sr-only">{t("protocol.title")}</DialogTitle>
        <MemoryMarkdownPreview
          value={crisisProtocol}
          allowImages={false}
          externalLinks
        />
      </DialogContent>
    </Dialog>
  );
}
