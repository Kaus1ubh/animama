"use client";

import { Folder, FolderRoot, Loader2, MoveRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { PyMemoryEntryHeader } from "@/lib/content/catalogTypes";
import {
  memoryMoveDestinations,
  type MemoryMoveDestination,
} from "@/lib/memory-entries/workspace-moves";
import { Button } from "@/ui/components/button";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/ui/components/command";

type MemoryMoveEntryDialogProps = {
  source: PyMemoryEntryHeader | null;
  entries: PyMemoryEntryHeader[];
  open: boolean;
  isMoving: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (destinationParentId: string | null) => void;
};

function destinationKey(destination: MemoryMoveDestination) {
  return destination.parentId ?? "__root__";
}

/** Provides a searchable, keyboard-accessible alternative to drag and drop. */
export function MemoryMoveEntryDialog({
  source,
  entries,
  open,
  isMoving,
  onOpenChange,
  onConfirm,
}: MemoryMoveEntryDialogProps) {
  const destinations = useMemo(
    () => (source ? memoryMoveDestinations(entries, source) : []),
    [entries, source],
  );
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const firstValid = destinations.find(
      (destination) => !destination.disabled,
    );
    setSelectedKey(firstValid ? destinationKey(firstValid) : null);
  }, [destinations, open]);

  const selected = destinations.find(
    (destination) => destinationKey(destination) === selectedKey,
  );

  return (
    <CommandDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!isMoving) onOpenChange(nextOpen);
      }}
      title={source ? `Move ${source.name}` : "Move memory entry"}
      description="Choose a new parent directory for this memory entry."
      showCloseButton
      className="max-w-lg"
    >
      <Command>
        <div className="border-border/70 border-b px-4 py-3">
          <p className="text-sm font-semibold">Move {source?.name}</p>
          <p className="text-muted-foreground mt-0.5 truncate text-xs">
            {source?.path}
          </p>
        </div>
        <CommandInput placeholder="Search directories" />
        <CommandList>
          <CommandEmpty>No matching directories.</CommandEmpty>
          <CommandGroup heading="Destination">
            {destinations.map((destination) => {
              const key = destinationKey(destination);
              const selectedDestination = key === selectedKey;
              return (
                <CommandItem
                  key={key}
                  value={`${destination.label} ${destination.path ?? "Memory root"}`}
                  disabled={destination.disabled}
                  data-checked={selectedDestination || undefined}
                  title={
                    destination.reason ?? destination.path ?? "Memory root"
                  }
                  onSelect={() => setSelectedKey(key)}
                  className="items-start"
                >
                  {destination.parentId ? (
                    <Folder className="mt-0.5 size-4 text-amber-600 dark:text-amber-400" />
                  ) : (
                    <FolderRoot className="mt-0.5 size-4" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{destination.label}</span>
                    <span className="text-muted-foreground block truncate text-xs">
                      {destination.reason ?? destination.path ?? "Memory root"}
                    </span>
                  </span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        </CommandList>
        <div className="border-border/70 flex justify-end gap-2 border-t p-3">
          <Button
            type="button"
            variant="outline"
            disabled={isMoving}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!selected || selected.disabled || isMoving}
            onClick={() => {
              if (selected && !selected.disabled) {
                onConfirm(selected.parentId);
              }
            }}
          >
            {isMoving ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <MoveRight className="size-4" />
            )}
            Move here
          </Button>
        </div>
      </Command>
    </CommandDialog>
  );
}
