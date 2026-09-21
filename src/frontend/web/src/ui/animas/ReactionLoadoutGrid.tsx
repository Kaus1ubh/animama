import { useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  ChevronDown,
  ChevronRight,
  EllipsisVertical,
  Loader2,
  Play,
} from "lucide-react";

import type { PyReactionCell } from "@animama/runtime-contracts/api-types";
import type { PyReaction } from "@/lib/content/catalogTypes";
import {
  groupReactionSelectorChoices,
  type ReactionLoadoutRow,
} from "@/lib/loadout/reactionLoadoutGrid";
import { LoadoutSectionDisclosure } from "@/ui/animas/LoadoutSectionDisclosure";
import { StarterBadge } from "@/ui/animas/StarterBadge";
import {
  ReactionIntensityBadge,
  reactionIntensityLabel,
} from "@/ui/animas/ActionLoadoutRows";
import { Button } from "@/ui/components/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/ui/components/command";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/ui/components/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/ui/components/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/ui/components/tooltip";

const LIBRARY_REACTIONS = {
  section: "actions" as const,
  action: "reactions" as const,
};

function reactionSourceKey(
  source: PyReaction["source"] | PyReactionCell["source"],
): string | null {
  if (!source) return null;
  if ("catalog_item_id" in source) return `catalog:${source.catalog_item_id}`;
  return source.type === "builtin"
    ? `builtin:${source.content_id}:${source.version}`
    : null;
}

function ReactionChoice({
  reaction,
  selected,
  disabled,
  onSelect,
  onPreview,
}: {
  reaction: PyReaction;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
  onPreview: () => void;
}) {
  return (
    <CommandItem
      value={`${reaction.name} ${reaction.description ?? ""} ${reaction.emotion} ${reactionIntensityLabel(reaction.intensity ?? 1)} ${reaction.origin}`}
      data-checked={selected}
      disabled={disabled}
      onSelect={onSelect}
      className="min-h-10"
    >
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{reaction.name}</span>
        <span className="text-muted-foreground truncate text-[11px] capitalize">
          {reaction.emotion} · {reactionIntensityLabel(reaction.intensity ?? 1)}
        </span>
      </span>
      {reaction.origin === "builtin" ? <StarterBadge /> : null}
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        aria-label={`Preview ${reaction.name}`}
        onPointerDown={(event) => event.preventDefault()}
        onClick={(event) => {
          event.stopPropagation();
          onPreview();
        }}
      >
        <Play />
      </Button>
    </CommandItem>
  );
}

/** Searchable all-Reaction selector that assigns a choice to the target cell. */
function ReactionSelector({
  cell,
  available,
  availableLoading,
  availableError,
  disabled,
  onSelect,
  onPreview,
  onRetry,
}: {
  cell: PyReactionCell;
  available: PyReaction[];
  availableLoading: boolean;
  availableError: boolean;
  disabled: boolean;
  onSelect: (reaction: PyReaction) => void;
  onPreview: (reaction: PyReaction) => void;
  onRetry: () => void;
}) {
  const [open, setOpen] = useState(false);
  const currentSourceKey = reactionSourceKey(cell.source);
  const { local, included } = groupReactionSelectorChoices(available);

  const choice = (reaction: PyReaction) => {
    const selected = reactionSourceKey(reaction.source) === currentSourceKey;
    return (
      <ReactionChoice
        key={`${reaction.origin}:${reaction.item_id}`}
        reaction={reaction}
        selected={selected}
        disabled={disabled}
        onPreview={() => onPreview(reaction)}
        onSelect={() => {
          setOpen(false);
          if (!selected) onSelect(reaction);
        }}
      />
    );
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={`Change ${reactionIntensityLabel(cell.intensity)} ${cell.emotion} Reaction`}
          disabled={disabled}
          className="h-9 min-w-0 flex-1 justify-between gap-2 rounded-lg px-3 font-normal"
        >
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate">{cell.name ?? "No Reaction"}</span>
            {cell.state === "starter" ? <StarterBadge /> : null}
          </span>
          <ChevronDown className="text-muted-foreground size-4 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-(--radix-popover-trigger-width) min-w-80 p-0"
      >
        <Command>
          <CommandInput placeholder="Search reactions" autoFocus />
          <CommandList>
            <CommandEmpty>
              {availableError
                ? "Reaction catalog unavailable."
                : availableLoading
                  ? "Loading Reactions…"
                  : "No Reactions found."}
            </CommandEmpty>
            {local.length ? (
              <CommandGroup heading="Local">{local.map(choice)}</CommandGroup>
            ) : null}
            {included.length ? (
              <CommandGroup heading="Included">
                {included.map(choice)}
              </CommandGroup>
            ) : null}
          </CommandList>
          {availableLoading || availableError ? (
            <div className="border-t p-2">
              {availableError ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-full"
                  onClick={onRetry}
                >
                  Retry catalog
                </Button>
              ) : (
                <p className="text-muted-foreground flex items-center justify-center gap-2 py-1 text-xs">
                  <Loader2 className="size-3.5 animate-spin" />
                  Loading Reactions…
                </p>
              )}
            </div>
          ) : null}
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function CellActions({
  cell,
  mutationsDisabled,
  onPreview,
  onRevert,
  onLeaveEmpty,
}: {
  cell: PyReactionCell;
  mutationsDisabled: boolean;
  onPreview: () => void;
  onRevert: () => void;
  onLeaveEmpty: () => void;
}) {
  const reactionName =
    cell.name ?? `${cell.emotion} ${reactionIntensityLabel(cell.intensity)}`;

  return (
    <div className="flex shrink-0 items-center gap-1">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            size="icon-sm"
            variant="outline"
            disabled={!cell.source}
            aria-label={`Preview ${reactionName}`}
            onClick={onPreview}
          >
            <Play />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={6}>
          {cell.source ? "Preview" : "Preview unavailable"}
        </TooltipContent>
      </Tooltip>

      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label={`More actions for ${reactionName}`}
              >
                <EllipsisVertical />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={6}>
            More actions
          </TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <Link to="/a/library" search={LIBRARY_REACTIONS}>
              Choose from Library
            </Link>
          </DropdownMenuItem>
          {cell.state === "custom" || cell.state === "empty" ? (
            <DropdownMenuItem disabled={mutationsDisabled} onSelect={onRevert}>
              Revert to Starter
            </DropdownMenuItem>
          ) : null}
          {cell.state !== "empty" ? (
            <DropdownMenuItem
              className="text-destructive"
              disabled={mutationsDisabled}
              onSelect={onLeaveEmpty}
            >
              Leave empty
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function ReactionLevelRow({
  cell,
  available,
  availableLoading,
  availableError,
  mutationsDisabled,
  onPreview,
  onPreviewAvailable,
  onSelect,
  onRevert,
  onLeaveEmpty,
  onRetryAvailable,
}: {
  cell: PyReactionCell;
  available: PyReaction[];
  availableLoading: boolean;
  availableError: boolean;
  mutationsDisabled: boolean;
  onPreview: () => void;
  onPreviewAvailable: (reaction: PyReaction) => void;
  onSelect: (reaction: PyReaction) => void;
  onRevert: () => void;
  onLeaveEmpty: () => void;
  onRetryAvailable: () => void;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3 border-b px-4 py-3.5 last:border-b-0">
      <ReactionIntensityBadge intensity={cell.intensity} />
      <ReactionSelector
        cell={cell}
        available={available}
        availableLoading={availableLoading}
        availableError={availableError}
        disabled={mutationsDisabled}
        onSelect={onSelect}
        onPreview={onPreviewAvailable}
        onRetry={onRetryAvailable}
      />
      <CellActions
        cell={cell}
        mutationsDisabled={mutationsDisabled}
        onPreview={onPreview}
        onRevert={onRevert}
        onLeaveEmpty={onLeaveEmpty}
      />
    </div>
  );
}

/** Reaction loadout with independently expandable emotion groups. */
export function ReactionLoadoutGrid({
  rows,
  available,
  availableLoading,
  availableError,
  mutationsDisabled,
  onPreview,
  onPreviewAvailable,
  onSelect,
  onRevert,
  onLeaveEmpty,
  onRetryAvailable,
}: {
  rows: ReactionLoadoutRow[];
  available: PyReaction[];
  availableLoading: boolean;
  availableError: boolean;
  mutationsDisabled: boolean;
  onPreview: (cell: PyReactionCell) => void;
  onPreviewAvailable: (reaction: PyReaction) => void;
  onSelect: (cell: PyReactionCell, reaction: PyReaction) => void;
  onRevert: (cell: PyReactionCell) => void;
  onLeaveEmpty: (cell: PyReactionCell) => void;
  onRetryAvailable: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [expandedEmotions, setExpandedEmotions] = useState<
    Set<ReactionLoadoutRow["emotion"]>
  >(() => new Set(rows[0] ? [rows[0].emotion] : []));
  return (
    <LoadoutSectionDisclosure
      title="Reactions"
      headingId="reaction-loadout-heading"
      contentId="reaction-loadout-content"
      expanded={expanded}
      onToggle={() => setExpanded((current) => !current)}
      sticky
    >
      <div className="overflow-hidden rounded-xl border">
        {rows.map((row) => {
          const expanded = expandedEmotions.has(row.emotion);
          const panelId = `reaction-${row.emotion}-levels`;

          return (
            <div
              key={row.emotion}
              className={`border-b last:border-b-0 ${
                expanded
                  ? "border-l-primary border-l-2"
                  : "border-l-2 border-l-transparent"
              }`}
            >
              <button
                type="button"
                aria-expanded={expanded}
                aria-controls={panelId}
                onClick={() =>
                  setExpandedEmotions((current) => {
                    const next = new Set(current);
                    if (expanded) next.delete(row.emotion);
                    else next.add(row.emotion);
                    return next;
                  })
                }
                className={`focus-visible:ring-ring flex w-full items-center justify-between gap-4 px-4 py-3.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset ${
                  expanded
                    ? "bg-primary/5 hover:bg-primary/8"
                    : "hover:bg-muted/30"
                }`}
              >
                <span className="truncate text-sm font-semibold capitalize">
                  {row.emotion}
                </span>
                {expanded ? (
                  <ChevronDown className="text-foreground size-4 shrink-0" />
                ) : (
                  <ChevronRight className="text-foreground size-4 shrink-0" />
                )}
              </button>

              {expanded ? (
                <div
                  id={panelId}
                  role="region"
                  aria-label={`${row.emotion} Reaction levels`}
                  className="border-t"
                >
                  {row.cells.map((cell) => (
                    <ReactionLevelRow
                      key={cell.intensity}
                      cell={cell}
                      available={available}
                      availableLoading={availableLoading}
                      availableError={availableError}
                      mutationsDisabled={mutationsDisabled}
                      onPreview={() => onPreview(cell)}
                      onPreviewAvailable={onPreviewAvailable}
                      onSelect={(reaction) => onSelect(cell, reaction)}
                      onRevert={() => onRevert(cell)}
                      onLeaveEmpty={() => onLeaveEmpty(cell)}
                      onRetryAvailable={onRetryAvailable}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </LoadoutSectionDisclosure>
  );
}
