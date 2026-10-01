import { useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  EllipsisVertical,
  Filter,
  Loader2,
  Pencil,
  Play,
  RotateCcw,
  VolumeX,
} from "lucide-react";

import type { PyAnimaIdleStyle } from "@animama/runtime-contracts/api-types";
import type { PyIdleStyle } from "@/lib/content/catalogTypes";
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

/** Select or inspect a shared Style; its pools are edited in Creator Studio. */
export function IdleStyleLoadoutSection({
  style,
  available,
  availableLoading,
  disabled,
  onPreview,
  onPreviewGesture,
  onSelect,
  onRevert,
  onLeaveEmpty,
}: {
  style: PyAnimaIdleStyle;
  available: PyIdleStyle[];
  availableLoading: boolean;
  disabled: boolean;
  onPreview: () => void;
  onPreviewGesture: (gestureRef: string) => void;
  onSelect: (style: PyIdleStyle) => void;
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
    (row) => row.mode !== "inherit" || showInherited,
  );
  const styleId = style.source?.catalog_item_id;
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
          <div className="flex flex-wrap items-center gap-2">
            <ActiveStyleSelector
              style={style}
              available={available}
              disabled={disabled}
              onSelect={onSelect}
            />
            <Button
              type="button"
              size="icon-lg"
              variant="outline"
              disabled={disabled || !style.default_pool?.length}
              aria-label="Preview active Idle Style"
              onClick={onPreview}
            >
              <Play />
            </Button>
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
                {styleId ? (
                  <>
                    <DropdownMenuItem asChild>
                      <Link
                        to="/idle-styles/$idleStyleId/edit"
                        params={{ idleStyleId: styleId }}
                        search={{ duplicate: false }}
                      >
                        <Pencil /> Edit Style
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link
                        to="/idle-styles/$idleStyleId/edit"
                        params={{ idleStyleId: styleId }}
                        search={{ duplicate: true }}
                      >
                        <Copy /> Duplicate and edit
                      </Link>
                    </DropdownMenuItem>
                  </>
                ) : null}
                {style.state !== "starter" ? (
                  <DropdownMenuItem onSelect={onRevert}>
                    <RotateCcw /> Use Starter
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem
                  disabled={style.state === "empty"}
                  onSelect={onLeaveEmpty}
                >
                  <VolumeX /> No Idle Style
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {availableLoading ? (
            <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
              <Loader2 className="size-3 animate-spin" /> Loading Idle Styles…
            </p>
          ) : null}
          {styleId ? (
            <p className="text-muted-foreground text-xs">
              Pools belong to this Style. Duplicate it for a variation used only
              by this Anima, then select the saved copy here.
            </p>
          ) : null}
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-semibold">Emotion and intensity pools</h3>
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
                  Show inherited cells
                </DropdownMenuCheckboxItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {style.state === "empty" ? (
            <div className="text-muted-foreground rounded-xl border px-4 py-8 text-center text-sm">
              No scheduled idle Gestures. Procedural breathing and resting
              continue.
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border">
              {visibleRows.map((row) => {
                const expanded = expandedPools.has(row.key);
                return (
                  <div key={row.key} className="border-b last:border-b-0">
                    <button
                      type="button"
                      className="hover:bg-muted/30 focus-visible:ring-ring flex w-full items-center gap-3 px-4 py-3 text-left focus-visible:ring-2 focus-visible:ring-inset"
                      aria-expanded={expanded}
                      onClick={() => toggle(row.key)}
                    >
                      <span className="flex-1 text-sm font-semibold">
                        {row.label}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {row.mode === "none"
                          ? "No idle"
                          : row.mode === "inherit"
                            ? "Uses Default"
                            : row.gestureRefs.length
                              ? `${row.gestureRefs.length} ${row.gestureRefs.length === 1 ? "Gesture" : "Gestures"}`
                              : "No scheduled idle"}
                      </span>
                      {expanded ? (
                        <ChevronDown className="size-4" />
                      ) : (
                        <ChevronRight className="size-4" />
                      )}
                    </button>
                    {expanded ? (
                      <div className="border-t">
                        {row.gestureRefs.map((ref, index) => (
                          <div
                            key={ref}
                            className="flex min-w-0 items-center gap-3 px-4 py-3"
                          >
                            <span className="min-w-0 flex-1 truncate text-sm">
                              {row.gestureNames[index]}
                            </span>
                            <Button
                              type="button"
                              variant="outline"
                              size="icon-sm"
                              disabled={disabled}
                              aria-label={`Preview ${row.gestureNames[index]}`}
                              onClick={() => onPreviewGesture(ref)}
                            >
                              <Play />
                            </Button>
                          </div>
                        ))}
                        {!row.gestureRefs.length ? (
                          <p className="text-muted-foreground px-4 py-3 text-sm">
                            No scheduled idle Gesture for this cell.
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </LoadoutSectionDisclosure>
  );
}
