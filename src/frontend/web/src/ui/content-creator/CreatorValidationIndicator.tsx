import { AlertTriangleIcon } from "lucide-react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/ui/components/popover";

/** Quiet when healthy; actionable creator messages open by pointer or keyboard. */
export function CreatorValidationIndicator({
  messages,
}: {
  messages: readonly string[];
}) {
  const uniqueMessages = [...new Set(messages.filter(Boolean))];
  if (!uniqueMessages.length) return null;
  const label = `${uniqueMessages.length} validation ${uniqueMessages.length === 1 ? "issue" : "issues"}`;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="text-destructive focus-visible:ring-ring text-2xs flex h-6 shrink-0 items-center gap-1 rounded-sm outline-none hover:opacity-80 focus-visible:ring-2"
          aria-label={label}
          title={label}
        >
          <span>{uniqueMessages.length}</span>
          <AlertTriangleIcon className="size-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="end"
        sideOffset={8}
        collisionPadding={8}
        className="max-h-[min(24rem,var(--radix-popover-content-available-height))] w-80 max-w-[calc(100vw-1rem)] space-y-2 overflow-y-auto text-left text-xs break-words"
        aria-label="Validation issues"
      >
        {uniqueMessages.map((message) => (
          <p key={message}>{message}</p>
        ))}
      </PopoverContent>
    </Popover>
  );
}
