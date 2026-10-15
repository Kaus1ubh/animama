import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  ChevronRight,
  Loader2,
  Play,
  Plus,
  X,
} from "lucide-react";

import type {
  PyAnimaIdle,
  PyIdleMember,
} from "@animama/runtime-contracts/api-types";
import type { PyGesture } from "@/lib/content/catalogTypes";
import { storedEmotionLabel } from "@/lib/emotion/presentation";
import { idleIneligibilityMessage } from "@/lib/loadout/idleEligibility";
import {
  buildIdleLoadoutGrid,
  idleGestureChoices,
  type IdleLoadoutCell,
} from "@/lib/loadout/idleLoadoutGrid";
import { useIdleGesturePlaybackCheck } from "@/query/hooks/useIdleGesturePlayback";
import {
  ReactionIntensityBadge,
  reactionIntensityLabel,
} from "@/ui/animas/ActionLoadoutRows";
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/ui/components/popover";

type CellLabel = (cell: IdleLoadoutCell) => string;

/** Searchable Gesture picker that checks finite idle playback before adding. */
function IdleGesturePicker({
  cell,
  cellLabel,
  available,
  availableLoading,
  availableError,
  disabled,
  busy,
  onAdd,
  onPreview,
  onRetry,
}: {
  cell: IdleLoadoutCell;
  cellLabel: string;
  available: PyGesture[];
  availableLoading: boolean;
  availableError: boolean;
  disabled: boolean;
  /** A change is applying: choices wait, but the trigger keeps keyboard focus. */
  busy: boolean;
  onAdd: (gesture: PyGesture) => void;
  onPreview: (gesture: PyGesture) => void;
  onRetry: () => void;
}) {
  const { t } = useTranslation("animas");
  const [open, setOpen] = useState(false);
  const [checking, setChecking] = useState<string | null>(null);
  // Results for an exact Gesture revision: ineligible facts, or a failed check.
  // Cached facts from earlier checks also come from `known`.
  const [outcomes, setOutcomes] = useState<
    Record<string, { eligible: false; reason?: string | null } | "failed">
  >({});
  const playback = useIdleGesturePlaybackCheck();
  const { local, included } = idleGestureChoices(available, cell);
  const revisionKey = (gesture: PyGesture) =>
    `${gesture.item_id}:${gesture.revision_sha256 ?? ""}`;

  /** Why a Gesture cannot be added; only a known ineligible result disables it. */
  const statusFor = (
    gesture: PyGesture,
  ): { text: string; ineligible: boolean } | null => {
    const outcome =
      outcomes[revisionKey(gesture)] ??
      playback.known(gesture.item_id, gesture.revision_sha256 ?? "");
    if (outcome === "failed")
      return { text: t("idle.ineligible.checkFailed"), ineligible: false };
    return outcome && !outcome.eligible
      ? { text: idleIneligibilityMessage(t, outcome.reason), ineligible: true }
      : null;
  };

  const choose = async (gesture: PyGesture) => {
    setChecking(gesture.item_id);
    try {
      const facts = await playback.check(
        gesture.item_id,
        gesture.revision_sha256 ?? "",
      );
      if (facts.eligible) {
        // A passed retry replaces an earlier failed check for this revision.
        setOutcomes((current) => {
          const next = { ...current };
          delete next[revisionKey(gesture)];
          return next;
        });
        setOpen(false);
        onAdd(gesture);
      } else {
        setOutcomes((current) => ({
          ...current,
          [revisionKey(gesture)]: { eligible: false, reason: facts.reason },
        }));
      }
    } catch {
      // A transient failure stays retryable: choosing the Gesture checks again.
      setOutcomes((current) => ({
        ...current,
        [revisionKey(gesture)]: "failed",
      }));
    } finally {
      setChecking(null);
    }
  };

  const choice = (gesture: PyGesture) => {
    const status = statusFor(gesture);
    const reason = status?.text;
    return (
      <CommandItem
        key={`${gesture.origin}:${gesture.item_id}`}
        value={`${gesture.name} ${gesture.description ?? ""} ${gesture.origin}`}
        disabled={
          disabled || busy || Boolean(status?.ineligible) || checking !== null
        }
        onSelect={() => void choose(gesture)}
        className="min-h-10"
      >
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate">{gesture.name}</span>
          {reason ? (
            <span className="text-destructive text-2xs whitespace-normal">
              {reason}
            </span>
          ) : checking === gesture.item_id ? (
            <span className="text-muted-foreground text-2xs">
              {t("idle.checking")}
            </span>
          ) : null}
        </span>
        {gesture.origin === "builtin" ? <StarterBadge /> : null}
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label={t("actions.previewNamed", { name: gesture.name })}
          onPointerDown={(event) => event.preventDefault()}
          onClick={(event) => {
            event.stopPropagation();
            onPreview(gesture);
          }}
        >
          <Play />
        </Button>
      </CommandItem>
    );
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled}
          aria-label={t("idle.addTo", { cell: cellLabel })}
          className="shrink-0"
        >
          <Plus />
          {t("idle.add")}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className="w-80 p-0">
        <Command>
          <CommandInput placeholder={t("idle.search")} autoFocus />
          <CommandList>
            <CommandEmpty>
              {availableError
                ? t("idle.catalogUnavailable")
                : availableLoading
                  ? t("idle.loading")
                  : t("idle.noResults")}
            </CommandEmpty>
            {local.length ? (
              <CommandGroup heading={t("idle.local")}>
                {local.map(choice)}
              </CommandGroup>
            ) : null}
            {included.length ? (
              <CommandGroup heading={t("idle.included")}>
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
                  {t("idle.retryCatalog")}
                </Button>
              ) : (
                <p className="text-muted-foreground flex items-center justify-center gap-2 py-1 text-xs">
                  <Loader2 className="size-3.5 animate-spin" />
                  {t("idle.loading")}
                </p>
              )}
            </div>
          ) : null}
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** One member of a cell with Preview, and Remove unless it is inherited. */
function IdleMemberChip({
  member,
  cellLabel,
  from,
  disabled,
  onPreview,
  onRemove,
}: {
  member: PyIdleMember;
  cellLabel: string;
  /** The lower intensity an inherited member comes from; it is removed there. */
  from?: string;
  disabled?: boolean;
  onPreview: () => void;
  /** Absent for an inherited member, which shows no Remove. */
  onRemove?: () => void;
}) {
  const { t } = useTranslation("animas");
  return (
    <li
      className={`flex min-w-0 items-center gap-1 rounded-md border py-0.5 pr-0.5 pl-2 text-sm ${
        from ? "text-muted-foreground border-dashed" : "bg-muted/40"
      }`}
    >
      <span
        className={`truncate ${member.available ? "" : "text-muted-foreground line-through"}`}
      >
        {member.name}
      </span>
      {member.available ? null : (
        <span className="text-destructive text-2xs shrink-0">
          {t("idle.unavailable")}
        </span>
      )}
      {from ? (
        <span className="text-2xs shrink-0">
          {t("idle.inheritedFrom", { intensity: from })}
        </span>
      ) : null}
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        className="size-6"
        disabled={!member.available}
        aria-label={t("actions.previewNamed", { name: member.name })}
        onClick={onPreview}
      >
        <Play />
      </Button>
      {onRemove ? (
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          className="size-6"
          disabled={disabled}
          aria-label={t("idle.remove", { name: member.name, cell: cellLabel })}
          onClick={onRemove}
        >
          <X />
        </Button>
      ) : null}
    </li>
  );
}

/**
 * A cell row: its label, its own Gestures, those it inherits from lower
 * intensities (or that it plays Default only) and the Add picker.
 */
function IdleCellRow({
  cell,
  cellLabel,
  label,
  emptyText,
  available,
  availableLoading,
  availableError,
  disabled,
  busy,
  onAdd,
  onRemove,
  onPreview,
  onPreviewAvailable,
  onRetryAvailable,
}: {
  cell: IdleLoadoutCell;
  cellLabel: CellLabel;
  label: ReactNode;
  emptyText: string;
  available: PyGesture[];
  availableLoading: boolean;
  availableError: boolean;
  disabled: boolean;
  busy: boolean;
  onAdd: (cell: IdleLoadoutCell, gesture: PyGesture) => void;
  onRemove: (member: PyIdleMember) => void;
  onPreview: (member: PyIdleMember) => void;
  onPreviewAvailable: (gesture: PyGesture) => void;
  onRetryAvailable: () => void;
}) {
  const { t } = useTranslation("animas");
  const name = cellLabel(cell);
  return (
    <div className="flex min-w-0 items-start gap-3 border-b px-4 py-3 last:border-b-0">
      {label}
      <div className="min-w-0 flex-1 space-y-1.5 pt-1.5">
        {cell.gestures.length ? (
          <ul className="flex flex-wrap gap-1.5" aria-label={name}>
            {cell.gestures.map((member) => (
              <IdleMemberChip
                key={member.binding_id}
                member={member}
                cellLabel={name}
                disabled={disabled || busy}
                onPreview={() => onPreview(member)}
                onRemove={() => onRemove(member)}
              />
            ))}
          </ul>
        ) : null}
        {cell.inherited.length ? (
          <ul
            className="flex flex-wrap gap-1.5"
            aria-label={t("idle.inheritedIn", { cell: name })}
          >
            {cell.inherited.map(({ member, intensity }) => (
              <IdleMemberChip
                key={member.binding_id}
                member={member}
                cellLabel={name}
                from={reactionIntensityLabel(intensity, t)}
                onPreview={() => onPreview(member)}
              />
            ))}
          </ul>
        ) : null}
        {cell.gestures.length || cell.inherited.length ? null : (
          <p className="text-muted-foreground text-sm">{emptyText}</p>
        )}
      </div>
      <IdleGesturePicker
        cell={cell}
        cellLabel={name}
        available={available}
        availableLoading={availableLoading}
        availableError={availableError}
        disabled={disabled}
        busy={busy}
        onAdd={(gesture) => onAdd(cell, gesture)}
        onPreview={onPreviewAvailable}
        onRetry={onRetryAvailable}
      />
    </div>
  );
}

/**
 * The Anima's built-in Idle pool, edited in place: a Default row, then one
 * expandable row per emotion with its three intensities. Changes apply at once.
 */
export function IdleLoadoutSection({
  idle,
  available,
  availableLoading,
  availableError,
  disabled,
  busy,
  onAdd,
  onRemove,
  onPreview,
  onPreviewAvailable,
  onRetryAvailable,
}: {
  idle: PyAnimaIdle;
  available: PyGesture[];
  availableLoading: boolean;
  availableError: boolean;
  disabled: boolean;
  /** An Idle change is applying; edits wait without moving keyboard focus. */
  busy: boolean;
  onAdd: (cell: IdleLoadoutCell, gesture: PyGesture) => void;
  onRemove: (member: PyIdleMember) => void;
  onPreview: (member: PyIdleMember) => void;
  onPreviewAvailable: (gesture: PyGesture) => void;
  onRetryAvailable: () => void;
}) {
  const { t } = useTranslation("animas");
  const [expanded, setExpanded] = useState(false);
  const [expandedEmotions, setExpandedEmotions] = useState<Set<string>>(
    () => new Set(),
  );
  const grid = buildIdleLoadoutGrid(idle);
  const cellLabel: CellLabel = (cell) =>
    cell.emotion && cell.intensity
      ? t("idle.cell", {
          emotion: storedEmotionLabel(cell.emotion),
          intensity: reactionIntensityLabel(cell.intensity, t),
        })
      : t("idle.defaultPool");
  const rowProps = {
    cellLabel,
    available,
    availableLoading,
    availableError,
    disabled,
    busy,
    onAdd,
    onRemove,
    onPreview,
    onPreviewAvailable,
    onRetryAvailable,
  };

  return (
    <LoadoutSectionDisclosure
      title={t("idle.title")}
      headingId="idle-loadout-heading"
      contentId="idle-loadout-content"
      expanded={expanded}
      onToggle={() => setExpanded((current) => !current)}
      sticky
    >
      <div className="overflow-hidden rounded-xl border">
        <div className="border-b">
          <IdleCellRow
            {...rowProps}
            cell={grid.defaultCell}
            label={
              <span className="inline-flex h-8 w-20 shrink-0 items-center text-sm font-semibold">
                {t("idle.defaultPool")}
              </span>
            }
            emptyText={t("idle.emptyDefault")}
          />
        </div>
        {grid.rows.map((row) => {
          const open = expandedEmotions.has(row.emotion);
          const panelId = `idle-${row.emotion}-levels`;
          return (
            <div
              key={row.emotion}
              className={`border-b last:border-b-0 ${
                open
                  ? "border-l-primary border-l-2"
                  : "border-l-2 border-l-transparent"
              }`}
            >
              <button
                type="button"
                aria-expanded={open}
                aria-controls={panelId}
                onClick={() =>
                  setExpandedEmotions((current) => {
                    const next = new Set(current);
                    if (open) next.delete(row.emotion);
                    else next.add(row.emotion);
                    return next;
                  })
                }
                className={`focus-visible:ring-ring flex w-full items-center justify-between gap-4 px-4 py-3.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset ${
                  open ? "bg-primary/5 hover:bg-primary/8" : "hover:bg-muted/30"
                }`}
              >
                <span className="truncate text-sm font-semibold capitalize">
                  {storedEmotionLabel(row.emotion)}
                </span>
                <span className="text-muted-foreground flex shrink-0 items-center gap-3 text-xs">
                  {row.gestureCount
                    ? t("idle.gestureCount", { count: row.gestureCount })
                    : t("idle.defaultOnly")}
                  {open ? (
                    <ChevronDown className="text-foreground size-4" />
                  ) : (
                    <ChevronRight className="text-foreground size-4" />
                  )}
                </span>
              </button>
              {open ? (
                <div
                  id={panelId}
                  role="region"
                  aria-label={t("idle.levels", {
                    emotion: storedEmotionLabel(row.emotion),
                  })}
                  className="border-t"
                >
                  {row.cells.map((cell) => (
                    <IdleCellRow
                      key={cell.key}
                      {...rowProps}
                      cell={cell}
                      label={
                        <ReactionIntensityBadge intensity={cell.intensity!} />
                      }
                      emptyText={t("idle.defaultOnly")}
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
