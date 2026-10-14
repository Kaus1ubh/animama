"use client";

import { Folder, FolderRoot, Loader2, MoveRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation("memory");
  const destinations = useMemo(
    () => (source ? memoryMoveDestinations(entries, source, t) : []),
    [entries, source, t],
  );
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  // Opening the dialog, or a different source, starts from the first valid
  // destination.
  useEffect(() => {
    if (open) setSelectedKey(null);
  }, [open, source]);

  // Recomputed destinations (new entries, or labels after a locale switch)
  // keep a choice that is still valid.
  useEffect(() => {
    if (!open) return;
    setSelectedKey((current) => {
      const kept = destinations.find(
        (destination) =>
          destinationKey(destination) === current && !destination.disabled,
      );
      if (kept) return current;
      const firstValid = destinations.find(
        (destination) => !destination.disabled,
      );
      return firstValid ? destinationKey(firstValid) : null;
    });
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
      title={
        source
          ? t("move.title", { name: source.name })
          : t("move.fallbackTitle")
      }
      description={t("move.description")}
      showCloseButton
      className="max-w-lg"
    >
      <Command>
        <div className="border-border/70 border-b px-4 py-3">
          <p className="text-sm font-semibold">
            {t("move.title", { name: source?.name ?? "" })}
          </p>
          <p className="text-muted-foreground mt-0.5 truncate text-xs">
            {source?.path}
          </p>
        </div>
        <CommandInput placeholder={t("move.search")} />
        <CommandList>
          <CommandEmpty>{t("move.empty")}</CommandEmpty>
          <CommandGroup heading={t("move.destination")}>
            {destinations.map((destination) => {
              const key = destinationKey(destination);
              const selectedDestination = key === selectedKey;
              const location = destination.path ?? t("move.root");
              return (
                <CommandItem
                  key={key}
                  value={`${destination.label} ${location}`}
                  disabled={destination.disabled}
                  data-checked={selectedDestination || undefined}
                  title={destination.reason ?? location}
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
                      {destination.reason ?? location}
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
            {t("shared.cancel")}
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
            {t("move.submit")}
          </Button>
        </div>
      </Command>
    </CommandDialog>
  );
}
