import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Link } from "@tanstack/react-router";
import { EllipsisVertical } from "lucide-react";

import type {
  PyReactionCell,
  PyReactionMember,
} from "@animama/runtime-contracts/api-types";
import type { PyReaction } from "@/lib/content/catalogTypes";
import { storedEmotionLabel } from "@/lib/emotion/presentation";
import {
  groupReactionSelectorChoices,
  reactionCellFull,
  type ReactionLoadoutRow,
} from "@/lib/loadout/reactionLoadoutGrid";
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
  type LoadoutPoolPickerCopy,
} from "@/ui/animas/LoadoutPool";
import { StarterBadge } from "@/ui/animas/StarterBadge";
import { Button } from "@/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/ui/components/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/ui/components/tooltip";

const LIBRARY_REACTIONS = {
  section: "actions" as const,
  action: "reactions" as const,
};

/** The Reaction picker's wording. */
function reactionPickerCopy(t: TFunction<"animas">): LoadoutPoolPickerCopy {
  return {
    add: t("reactions.add"),
    search: t("reactions.search"),
    local: t("reactions.local"),
    included: t("reactions.included"),
    loading: t("reactions.loading"),
    noResults: t("reactions.noResults"),
    catalogUnavailable: t("reactions.catalogUnavailable"),
    retryCatalog: t("reactions.retryCatalog"),
  };
}

/** A Reaction's suggested cell, shown as a hint under its name. */
function reactionSuggestion(
  reaction: PyReaction,
  t: TFunction<"animas">,
): string | null {
  return reaction.emotion && reaction.intensity
    ? t("reactions.suggestion", {
        emotion: storedEmotionLabel(reaction.emotion),
        intensity: reactionIntensityLabel(reaction.intensity, t),
      })
    : null;
}

/** The cell menu: open the Library, or restore the cell's starter pool. */
function ReactionCellMenu({
  cell,
  cellName,
  disabled,
  onRestoreStarter,
}: {
  cell: PyReactionCell;
  cellName: string;
  disabled: boolean;
  onRestoreStarter: () => void;
}) {
  const { t } = useTranslation("animas");
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label={t("actions.moreActionsFor", { name: cellName })}
            >
              <EllipsisVertical />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={6}>
          {t("actions.moreActions")}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <Link to="/library" search={LIBRARY_REACTIONS}>
            {t("reactions.chooseFromLibrary")}
          </Link>
        </DropdownMenuItem>
        {cell.state !== "starter" ? (
          <DropdownMenuItem disabled={disabled} onSelect={onRestoreStarter}>
            {t("reactions.restoreStarter")}
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type ReactionCellHandlers = {
  available: PyReaction[];
  availableLoading: boolean;
  availableError: boolean;
  disabled: boolean;
  busy: boolean;
  onAdd: (cell: PyReactionCell, reaction: PyReaction) => void;
  onRemove: (member: PyReactionMember) => void;
  onRestoreStarter: (cell: PyReactionCell) => void;
  onPreview: (member: PyReactionMember) => void;
  onPreviewAvailable: (reaction: PyReaction) => void;
  onRetryAvailable: () => void;
};

/**
 * One cell's pool: member chips (Starter badge, Preview, Remove), the Add
 * picker, which marks members already in the cell and stops at four, and the
 * cell menu.
 */
function ReactionCellRow({
  cell,
  available,
  availableLoading,
  availableError,
  disabled,
  busy,
  onAdd,
  onRemove,
  onRestoreStarter,
  onPreview,
  onPreviewAvailable,
  onRetryAvailable,
}: ReactionCellHandlers & { cell: PyReactionCell }) {
  const { t } = useTranslation("animas");
  const name = t("reactions.cell", {
    emotion: storedEmotionLabel(cell.emotion),
    intensity: reactionIntensityLabel(cell.intensity, t),
  });
  const members = cell.members ?? [];
  const inCell = new Set(members.map((member) => member.item_id));
  const full = reactionCellFull(cell);
  const fullId = `reaction-${cell.emotion}-${cell.intensity}-full`;
  const { local, included } = groupReactionSelectorChoices(available);
  return (
    <LoadoutPoolCellRow
      label={<ReactionIntensityBadge intensity={cell.intensity} />}
      listLabel={name}
      emptyText={t("reactions.noReaction")}
      members={members.map((member) => (
        <LoadoutPoolMemberChip
          key={member.binding_id}
          member={member}
          unavailableText={t("reactions.unavailable")}
          removeLabel={t("reactions.remove", { name: member.name, cell: name })}
          badge={member.origin === "starter" ? <StarterBadge /> : null}
          disabled={disabled || busy}
          onPreview={() => onPreview(member)}
          onRemove={() => onRemove(member)}
        />
      ))}
      extra={
        full ? (
          <p id={fullId} className="text-muted-foreground text-xs">
            {t("reactions.full")}
          </p>
        ) : null
      }
      controls={
        <div className="flex shrink-0 items-center gap-1">
          <LoadoutPoolPicker
            addLabel={t("reactions.addTo", { cell: name })}
            copy={reactionPickerCopy(t)}
            local={local}
            included={included}
            loading={availableLoading}
            error={availableError}
            disabled={disabled || full}
            describedBy={full ? fullId : undefined}
            busy={busy}
            status={(reaction) =>
              inCell.has(reaction.item_id)
                ? { text: t("reactions.inCell"), tone: "muted", disabled: true }
                : null
            }
            detail={(reaction) => reactionSuggestion(reaction, t)}
            onSelect={(reaction) => {
              onAdd(cell, reaction);
              return true;
            }}
            onPreview={onPreviewAvailable}
            onRetry={onRetryAvailable}
          />
          <ReactionCellMenu
            cell={cell}
            cellName={name}
            disabled={disabled || busy}
            onRestoreStarter={() => onRestoreStarter(cell)}
          />
        </div>
      }
    />
  );
}

/**
 * The Anima's Reaction pools, edited in place: one expandable row per emotion
 * with its four intensities, each a pool of up to four Reactions. Changes
 * apply at once.
 */
export function ReactionLoadoutGrid({
  rows,
  ...handlers
}: ReactionCellHandlers & {
  rows: ReactionLoadoutRow[];
}) {
  const { t } = useTranslation("animas");
  const [expanded, setExpanded] = useState(false);
  const emotions = useExpandedEmotions(rows[0] ? [rows[0].emotion] : []);
  return (
    <LoadoutSectionDisclosure
      title={t("reactions.title")}
      headingId="reaction-loadout-heading"
      contentId="reaction-loadout-content"
      expanded={expanded}
      onToggle={() => setExpanded((current) => !current)}
      sticky
    >
      <div className="overflow-hidden rounded-xl border">
        {rows.map((row) => (
          <LoadoutPoolEmotionRow
            key={row.emotion}
            label={storedEmotionLabel(row.emotion)}
            summary={
              row.reactionCount
                ? t("reactions.reactionCount", { count: row.reactionCount })
                : t("reactions.noReaction")
            }
            panelId={`reaction-${row.emotion}-levels`}
            regionLabel={t("reactions.levels", {
              emotion: storedEmotionLabel(row.emotion),
            })}
            open={emotions.expanded.has(row.emotion)}
            onToggle={() => emotions.toggle(row.emotion)}
          >
            {row.cells.map((cell) => (
              <ReactionCellRow key={cell.intensity} cell={cell} {...handlers} />
            ))}
          </LoadoutPoolEmotionRow>
        ))}
      </div>
    </LoadoutSectionDisclosure>
  );
}
