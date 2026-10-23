import { Link } from "@tanstack/react-router";
import { Brain } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

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
 * Small icon below a reply whose turn remembered something (spec R6). Click or
 * keyboard opens a popover naming what was remembered, by kind.
 */
export function MemoryCue({
  cue,
  animaName,
  onOpenMemoryEntry,
}: MemoryCueProps) {
  const { t } = useTranslation("chat");
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t("memoryCue.updated")}
          className="text-muted-foreground hover:text-foreground size-7"
        >
          <Brain aria-hidden="true" className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        aria-label={memoryCueTitle(t, animaName)}
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

function memoryCueTitle(
  t: TFunction<"chat">,
  animaName: string | null | undefined,
) {
  return animaName
    ? t("memoryCue.title", { name: animaName })
    : t("memoryCue.titleUnnamed");
}

/** The heading for the `MEMORIES.md` change, naming whose memories changed. */
function memoriesHeading(
  t: TFunction<"chat">,
  animaName: string | null | undefined,
  added: boolean,
) {
  if (added)
    return animaName
      ? t("memoryCue.added", { name: animaName })
      : t("memoryCue.addedUnnamed");
  return animaName
    ? t("memoryCue.changed", { name: animaName })
    : t("memoryCue.changedUnnamed");
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
  const { t } = useTranslation("chat");
  const memories = cue.memories;
  const excerpt = memories?.excerpt.trim() ?? "";

  return (
    <div className="space-y-3">
      <dl className="space-y-3">
        {cue.episode ? (
          <div className="space-y-1">
            <dt className="text-muted-foreground text-xs font-medium">
              {t("memoryCue.episodes")}
            </dt>
            <dd className="max-h-40 overflow-y-auto whitespace-pre-wrap">
              {cue.episode.text}
            </dd>
          </div>
        ) : null}
        {memories ? (
          <div className="space-y-1">
            <dt className="text-muted-foreground text-xs font-medium">
              {memoriesHeading(t, animaName, Boolean(excerpt))}
            </dt>
            <dd className="max-h-40 overflow-y-auto whitespace-pre-wrap">
              {excerpt || t("memoryCue.noText")}
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
            {t("memoryCue.open")}
          </Button>
        ) : (
          <Button asChild variant="link" size="sm" className="h-auto p-0">
            <Link
              to="/memories"
              search={{
                tab: "memory",
                mode: "manual",
                entryId: memories.entry_id,
              }}
            >
              {t("memoryCue.open")}
            </Link>
          </Button>
        )
      ) : null}
    </div>
  );
}
