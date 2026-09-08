import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  EllipsisVertical,
  Filter,
  Loader2,
  Play,
  Plus,
  RotateCcw,
  VolumeX,
  X,
} from "lucide-react";

import type {
  PyAnimaIdleStyle,
  PyIdleAnimationSummary,
} from "@animama/runtime-contracts/api-types";
import type { PyIdleStyle } from "@/lib/content/catalogTypes";
import type { IdleStyleAssignment } from "@/lib/loadout/idleStylePresentation";
import { presentIdleStyle } from "@/lib/loadout/idleStylePresentation";
import { LoadoutSectionDisclosure } from "@/ui/animas/LoadoutSectionDisclosure";
import { StarterBadge } from "@/ui/animas/StarterBadge";
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
  DropdownMenuCheckboxItem,
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

function sourceKey(
  source: PyIdleStyle["source"] | PyAnimaIdleStyle["source"] | undefined,
): string | null {
  if (!source) return null;
  if ("catalog_item_id" in source) return `catalog:${source.catalog_item_id}`;
  return source.type === "builtin"
    ? `builtin:${source.content_id}:${source.version}`
    : null;
}

function ActiveStyleSelector({
  style,
  available,
  disabled,
  onSelect,
}: {
  style: PyAnimaIdleStyle;
  available: PyIdleStyle[];
  disabled: boolean;
  onSelect: (style: PyIdleStyle) => void;
}) {
  const [open, setOpen] = useState(false);
  const currentSource = sourceKey(style.source);
  const ready = available.filter(
    (candidate) => candidate.state === "ready" && candidate.source,
  );
  const mine = ready.filter((candidate) => candidate.origin === "owned");
  const starters = ready.filter((candidate) => candidate.origin === "builtin");
  const choices = (items: PyIdleStyle[]) =>
    items.map((candidate) => {
      const selected = sourceKey(candidate.source) === currentSource;
      return (
        <CommandItem
          key={`${candidate.origin}:${candidate.item_id}`}
          value={`${candidate.name} ${candidate.description ?? ""}`}
          data-checked={selected}
          disabled={disabled}
          onSelect={() => {
            setOpen(false);
            if (!selected) onSelect(candidate);
          }}
        >
          <span className="min-w-0 flex-1 truncate">{candidate.name}</span>
          {candidate.origin === "builtin" ? <StarterBadge /> : null}
        </CommandItem>
      );
    });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="h-11 min-w-0 flex-1 justify-between rounded-lg px-4 font-normal"
        >
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate">
              {style.name ?? "Choose an Idle Style"}
            </span>
            {style.state === "starter" ? <StarterBadge /> : null}
          </span>
          <ChevronDown className="text-muted-foreground size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-(--radix-popover-trigger-width) min-w-80 p-0"
      >
        <Command>
          <CommandInput placeholder="Search Idle Styles" autoFocus />
          <CommandList>
            <CommandEmpty>No Idle Styles found.</CommandEmpty>
            {mine.length ? (
              <CommandGroup heading="Mine">{choices(mine)}</CommandGroup>
            ) : null}
            {starters.length ? (
              <CommandGroup heading="Starter">{choices(starters)}</CommandGroup>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function AddAnimationControl({
  row,
  animations,
  disabled,
  onAdd,
}: {
  row: IdleStyleAssignment;
  animations: PyIdleAnimationSummary[];
  disabled: boolean;
  onAdd: (animationId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const available = animations.filter(
    (animation) => !row.animationIds.includes(animation.animation_id),
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || available.length === 0}
        >
          <Plus /> Add animation
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className="w-72 p-0">
        <Command>
          <CommandInput placeholder="Search animations" autoFocus />
          <CommandList>
            <CommandEmpty>No more animations available.</CommandEmpty>
            <CommandGroup>
              {available.map((animation) => (
                <CommandItem
                  key={animation.animation_id}
                  value={`${animation.name} ${animation.description ?? ""}`}
                  onSelect={() => {
                    setOpen(false);
                    onAdd(animation.animation_id);
                  }}
                >
                  <span className="truncate">{animation.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function AssignmentPool({
  row,
  animations,
  expanded,
  disabled,
  hasOverride,
  onToggle,
  onPreviewAnimation,
  onUpdatePool,
  onRestorePool,
}: {
  row: IdleStyleAssignment;
  animations: PyIdleAnimationSummary[];
  expanded: boolean;
  disabled: boolean;
  hasOverride: boolean;
  onToggle: () => void;
  onPreviewAnimation: (animationId: string) => void;
  onUpdatePool: (animationIds: string[]) => void;
  onRestorePool: () => void;
}) {
  const names = new Map(
    animations.map((animation) => [animation.animation_id, animation.name]),
  );
  const countLabel = `${row.animationIds.length} ${
    row.animationIds.length === 1 ? "animation" : "animations"
  }`;

  return (
    <div
      className={`border-b border-l-2 last:border-b-0 ${
        expanded ? "border-l-primary" : "border-l-transparent"
      }`}
    >
      <div
        className={`flex items-center gap-2 pr-2 ${
          expanded ? "bg-primary/5 hover:bg-primary/8" : "hover:bg-muted/30"
        }`}
      >
        <button
          type="button"
          className="focus-visible:ring-ring flex min-w-0 flex-1 items-center gap-3 px-4 py-3.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset"
          aria-expanded={expanded}
          onClick={onToggle}
        >
          <span className="truncate text-sm font-semibold">{row.label}</span>
          <span className="text-muted-foreground shrink-0 text-xs">
            {countLabel}
          </span>
        </button>
        {expanded ? (
          <>
            {row.key !== "default" && hasOverride ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    disabled={disabled}
                    aria-label={`Use Default animations for ${row.label}`}
                    onClick={onRestorePool}
                  >
                    <RotateCcw />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Use Default pool</TooltipContent>
              </Tooltip>
            ) : null}
            <AddAnimationControl
              row={row}
              animations={animations}
              disabled={disabled}
              onAdd={(animationId) =>
                onUpdatePool([...row.animationIds, animationId])
              }
            />
          </>
        ) : null}
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label={`${expanded ? "Collapse" : "Expand"} ${row.label}`}
          aria-expanded={expanded}
          onClick={onToggle}
        >
          {expanded ? (
            <ChevronDown className="text-foreground size-4" />
          ) : (
            <ChevronRight className="text-foreground size-4" />
          )}
        </Button>
      </div>
      {expanded ? (
        <div className="border-t">
          {row.animationIds.map((animationId) => {
            const name = names.get(animationId) ?? animationId;
            const finalAnimation = row.animationIds.length === 1;
            return (
              <div
                key={animationId}
                className="flex min-w-0 items-center gap-3 border-b px-4 py-3.5 last:border-b-0"
              >
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {name}
                </span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="outline"
                      aria-label={`Preview ${name}`}
                      onClick={() => onPreviewAnimation(animationId)}
                    >
                      <Play />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Preview animation</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        disabled={disabled || finalAnimation}
                        aria-label={`Remove ${name} from ${row.label}`}
                        onClick={() =>
                          onUpdatePool(
                            row.animationIds.filter((id) => id !== animationId),
                          )
                        }
                      >
                        <X />
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    {finalAnimation
                      ? "Each pool needs at least one animation"
                      : "Remove from pool"}
                  </TooltipContent>
                </Tooltip>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/** Inline Idle Style selection and emotion-specific animation pool editor. */
export function IdleStyleLoadoutSection({
  style,
  available,
  availableLoading,
  disabled,
  onPreview,
  onPreviewAnimation,
  onSelect,
  onUpdatePool,
  onRestorePool,
  onRevert,
  onLeaveEmpty,
}: {
  style: PyAnimaIdleStyle;
  available: PyIdleStyle[];
  availableLoading: boolean;
  disabled: boolean;
  onPreview: () => void;
  onPreviewAnimation: (emotion: string, animationId: string) => void;
  onSelect: (style: PyIdleStyle) => void;
  onUpdatePool: (emotion: string, animationIds: string[]) => void;
  onRestorePool: (emotion: string) => void;
  onRevert: () => void;
  onLeaveEmpty: () => void;
}) {
  const [sectionExpanded, setSectionExpanded] = useState(false);
  const [expandedPools, setExpandedPools] = useState<Set<string>>(
    () => new Set(["default"]),
  );
  const [showInherited, setShowInherited] = useState(false);
  const rows = presentIdleStyle(style);
  const visibleRows = rows.filter(
    (row) => row.key === "default" || showInherited || !row.fallsBackToDefault,
  );
  const toggle = (key: string) =>
    setExpandedPools((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <LoadoutSectionDisclosure
      title="Idle Style"
      headingId="idle-style-heading"
      contentId="idle-style-content"
      expanded={sectionExpanded}
      onToggle={() => setSectionExpanded((current) => !current)}
      sticky
    >
      <div className="space-y-5">
        <div className="space-y-2">
          <p className="text-muted-foreground text-sm font-medium">
            Active style
          </p>
          <div className="flex items-center gap-2">
            <ActiveStyleSelector
              style={style}
              available={available}
              disabled={disabled}
              onSelect={onSelect}
            />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  size="icon-lg"
                  variant="outline"
                  disabled={style.state === "empty"}
                  aria-label="Preview active Idle Style"
                  onClick={onPreview}
                >
                  <Play />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Preview Idle Style</TooltipContent>
            </Tooltip>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  size="icon-lg"
                  variant="ghost"
                  disabled={disabled}
                  aria-label="Idle Style actions"
                >
                  <EllipsisVertical />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {style.state !== "starter" ? (
                  <DropdownMenuItem onSelect={onRevert}>
                    <RotateCcw /> Use Starter
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem
                  disabled={style.state === "empty"}
                  onSelect={onLeaveEmpty}
                >
                  <VolumeX /> Leave empty
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {availableLoading ? (
            <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
              <Loader2 className="size-3 animate-spin" /> Loading Idle Styles…
            </p>
          ) : null}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-semibold">Emotion assignments</h3>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="outline"
                  aria-label="Filter emotion assignments"
                >
                  <Filter />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuCheckboxItem
                  checked={showInherited}
                  onCheckedChange={(checked) =>
                    setShowInherited(checked === true)
                  }
                >
                  Show inherited emotions
                </DropdownMenuCheckboxItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {style.state === "empty" ? (
            <div className="text-muted-foreground rounded-xl border px-4 py-8 text-center text-sm">
              Choose an Idle Style to assign emotion animations.
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border">
              {visibleRows.map((row) => (
                <AssignmentPool
                  key={row.key}
                  row={row}
                  animations={style.animations ?? []}
                  expanded={expandedPools.has(row.key)}
                  disabled={disabled}
                  hasOverride={Boolean(style.pool_overrides?.[row.key])}
                  onToggle={() => toggle(row.key)}
                  onPreviewAnimation={(animationId) =>
                    onPreviewAnimation(row.key, animationId)
                  }
                  onUpdatePool={(animationIds) =>
                    onUpdatePool(row.key, animationIds)
                  }
                  onRestorePool={() => onRestorePool(row.key)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </LoadoutSectionDisclosure>
  );
}
