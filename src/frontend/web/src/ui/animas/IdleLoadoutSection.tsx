import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

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
import {
  LoadoutPoolCellRow,
  LoadoutPoolEmotionRow,
  LoadoutPoolMemberChip,
  LoadoutPoolPicker,
  useExpandedEmotions,
  type LoadoutPoolChoiceStatus,
  type LoadoutPoolPickerCopy,
} from "@/ui/animas/LoadoutPool";

type CellLabel = (cell: IdleLoadoutCell) => string;

/** The Idle picker's wording. */
function idlePickerCopy(t: TFunction<"animas">): LoadoutPoolPickerCopy {
  return {
    add: t("idle.add"),
    search: t("idle.search"),
    local: t("idle.local"),
    included: t("idle.included"),
    loading: t("idle.loading"),
    noResults: t("idle.noResults"),
    catalogUnavailable: t("idle.catalogUnavailable"),
    retryCatalog: t("idle.retryCatalog"),
  };
}

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
  const statusFor = (gesture: PyGesture): LoadoutPoolChoiceStatus | null => {
    const outcome =
      outcomes[revisionKey(gesture)] ??
      playback.known(gesture.item_id, gesture.revision_sha256 ?? "");
    if (outcome === "failed")
      return {
        text: t("idle.ineligible.checkFailed"),
        tone: "error",
        disabled: false,
      };
    if (outcome && !outcome.eligible)
      return {
        text: idleIneligibilityMessage(t, outcome.reason),
        tone: "error",
        disabled: true,
      };
    return checking === gesture.item_id
      ? { text: t("idle.checking"), tone: "muted", disabled: false }
      : null;
  };

  /** Add an eligible Gesture and close; keep the picker open otherwise. */
  const choose = async (gesture: PyGesture): Promise<boolean> => {
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
        onAdd(gesture);
        return true;
      }
      setOutcomes((current) => ({
        ...current,
        [revisionKey(gesture)]: { eligible: false, reason: facts.reason },
      }));
    } catch {
      // A transient failure stays retryable: choosing the Gesture checks again.
      setOutcomes((current) => ({
        ...current,
        [revisionKey(gesture)]: "failed",
      }));
    } finally {
      setChecking(null);
    }
    return false;
  };

  return (
    <LoadoutPoolPicker
      addLabel={t("idle.addTo", { cell: cellLabel })}
      copy={idlePickerCopy(t)}
      local={local}
      included={included}
      loading={availableLoading}
      error={availableError}
      disabled={disabled}
      busy={busy}
      selecting={checking !== null}
      status={statusFor}
      onSelect={choose}
      onPreview={onPreview}
      onRetry={onRetry}
    />
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
    <LoadoutPoolCellRow
      label={label}
      listLabel={name}
      emptyText={emptyText}
      members={cell.gestures.map((member) => (
        <LoadoutPoolMemberChip
          key={member.binding_id}
          member={member}
          unavailableText={t("idle.unavailable")}
          removeLabel={t("idle.remove", { name: member.name, cell: name })}
          disabled={disabled || busy}
          onPreview={() => onPreview(member)}
          onRemove={() => onRemove(member)}
        />
      ))}
      extra={
        cell.inherited.length ? (
          <ul
            className="flex flex-wrap gap-1.5"
            aria-label={t("idle.inheritedIn", { cell: name })}
          >
            {cell.inherited.map(({ member, intensity }) => (
              <LoadoutPoolMemberChip
                key={member.binding_id}
                member={member}
                unavailableText={t("idle.unavailable")}
                removeLabel={t("idle.remove", {
                  name: member.name,
                  cell: name,
                })}
                inheritedFrom={t("idle.inheritedFrom", {
                  intensity: reactionIntensityLabel(intensity, t),
                })}
                onPreview={() => onPreview(member)}
              />
            ))}
          </ul>
        ) : null
      }
      controls={
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
      }
    />
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
  const emotions = useExpandedEmotions();
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
        {grid.rows.map((row) => (
          <LoadoutPoolEmotionRow
            key={row.emotion}
            label={storedEmotionLabel(row.emotion)}
            summary={
              row.gestureCount
                ? t("idle.gestureCount", { count: row.gestureCount })
                : t("idle.defaultOnly")
            }
            panelId={`idle-${row.emotion}-levels`}
            regionLabel={t("idle.levels", {
              emotion: storedEmotionLabel(row.emotion),
            })}
            open={emotions.expanded.has(row.emotion)}
            onToggle={() => emotions.toggle(row.emotion)}
          >
            {row.cells.map((cell) => (
              <IdleCellRow
                key={cell.key}
                {...rowProps}
                cell={cell}
                label={<ReactionIntensityBadge intensity={cell.intensity!} />}
                emptyText={t("idle.defaultOnly")}
              />
            ))}
          </LoadoutPoolEmotionRow>
        ))}
      </div>
    </LoadoutSectionDisclosure>
  );
}
