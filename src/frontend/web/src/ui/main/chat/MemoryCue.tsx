import { Link } from "@tanstack/react-router";
import { Brain } from "lucide-react";

import type { ChatMemoryCue } from "@animama/product-ui/chat";
import { Button } from "@/ui/components/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/ui/components/popover";

type MemoryCueProps = {
  cue: ChatMemoryCue;
  animaName?: string | null;
  /**
   * Opens the `MEMORIES.md` entry through a host command. Quick Chat supplies
   * this because it cannot route the main window; otherwise the cue renders an
   * in-app link to the Memory workspace.
   */
  onOpenMemoryEntry?: (entryId: string) => void;
};

/**
 * Small icon on a reply whose turn remembered something (spec R6). Click or
 * keyboard opens a popover naming what was remembered, by kind.
 */
export function MemoryCue({
  cue,
  animaName,
  onOpenMemoryEntry,
}: MemoryCueProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Memory updated"
          className="text-muted-foreground hover:text-foreground -ml-1.5 size-6"
        >
          <Brain aria-hidden="true" className="size-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        aria-label={memoryCueTitle(animaName)}
        className="w-80 max-w-[calc(100vw-2rem)] p-3 text-sm"
      >
        <MemoryCueDetails
          cue={cue}
          animaName={animaName}
          onOpenMemoryEntry={onOpenMemoryEntry}
        />
      </PopoverContent>
    </Popover>
  );
}

function memoryCueTitle(animaName: string | null | undefined) {
  return animaName ? `What ${animaName} remembered` : "What was remembered";
}

/**
 * The popover body: the episode note and/or the `MEMORIES.md` change. Only the
 * `MEMORIES.md` part links out; an episode note waits in the episode queue and
 * has no file of its own to open yet.
 */
export function MemoryCueDetails({
  cue,
  animaName,
  onOpenMemoryEntry,
}: MemoryCueProps) {
  const owner = animaName ? `${animaName}'s` : "this Anima's";
  const memories = cue.memories;
  const excerpt = memories?.excerpt.trim() ?? "";

  return (
    <div className="space-y-3">
      <dl className="space-y-3">
        {cue.episode ? (
          <div className="space-y-1">
            <dt className="text-muted-foreground text-xs font-medium">
              Noted in episodes
            </dt>
            <dd className="max-h-40 overflow-y-auto whitespace-pre-wrap">
              {cue.episode.text}
            </dd>
          </div>
        ) : null}
        {memories ? (
          <div className="space-y-1">
            <dt className="text-muted-foreground text-xs font-medium">
              {excerpt
                ? `Added to ${owner} memories`
                : `Updated ${owner} memories`}
            </dt>
            <dd className="max-h-40 overflow-y-auto whitespace-pre-wrap">
              {excerpt || "No new text was added."}
            </dd>
          </div>
        ) : null}
      </dl>
      {memories ? (
        onOpenMemoryEntry ? (
          <Button
            type="button"
            variant="link"
            size="sm"
            className="h-auto p-0"
            onClick={() => onOpenMemoryEntry(memories.entry_id)}
          >
            Open in Memories
          </Button>
        ) : (
          <Button asChild variant="link" size="sm" className="h-auto p-0">
            <Link
              to="/a/memories"
              search={{
                tab: "memory",
                mode: "manual",
                entryId: memories.entry_id,
              }}
            >
              Open in Memories
            </Link>
          </Button>
        )
      ) : null}
    </div>
  );
}
