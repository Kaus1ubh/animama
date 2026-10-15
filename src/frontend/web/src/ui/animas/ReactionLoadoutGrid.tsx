import { useState, type ReactNode } from "react";
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
  reactionCellLabel,
  reactionIntensityLabel,
} from "@/ui/animas/ActionLoadoutRows";
import { LoadoutSectionDisclosure } from "@/ui/animas/LoadoutSectionDisclosure";
import {
  LoadoutPoolCellRow,
  LoadoutPoolEmotionRow,
  LoadoutPoolMemberChip,
  LoadoutPoolPicker,
  useExpandedEmotions,
  type LoadoutPoolChoice,
  type LoadoutPoolMember,
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

/** A Reaction the Add picker offers: a Library item with any suggested cell. */
export type ReactionPoolChoice = LoadoutPoolChoice & {
  emotion?: string | null;
  intensity?: number | null;
};

/** A Reaction's suggested cell, shown as a hint under its name. */
function reactionSuggestion(
  reaction: ReactionPoolChoice,
  t: TFunction<"animas">,
): string | null {
  return reaction.emotion && reaction.intensity
    ? t("reactions.suggestion", {
        emotion: storedEmotionLabel(reaction.emotion),
        intensity: reactionIntensityLabel(reaction.intensity, t),
      })
    : null;
}

/**
 * One Reaction cell's pool, shared by the Loadout and the Create Anima wizard:
 * member chips (Starter badge, Preview, Remove) and an Add picker with Local
 * and Included groups that marks Reactions already in the cell and stops at
 * four with the reason. The caller supplies the members, the choices and any
 * other cell controls, and applies the changes.
 */
export function ReactionPoolCellRow<
  Member extends LoadoutPoolMember & { item_id: string },
  Item extends ReactionPoolChoice,
>({
  emotion,
  intensity,
  id,
  members,
  isStarter,
  choices,
  loading,
  error,
  disabled,
  busy,
  unavailableText,
  controls,
  onAdd,
  onRemove,
  onPreview,
  onPreviewChoice,
  onRetry,
}: {
  emotion: string;
  intensity: number;
  /** Focus target for links to this cell. */
  id?: string;
  members: readonly Member[];
  /** Whether a member is one of the cell's starter Reactions. */
  isStarter: (member: Member) => boolean;
  /** Every Reaction the picker offers; any may join any cell. */
  choices: readonly Item[];
  loading: boolean;
  error: boolean;
  disabled: boolean;
  /** A change is applying: choices, Remove and the cell menu wait. */
  busy: boolean;
  /** How an unavailable member is marked; "Unavailable" by default. */
  unavailableText?: string;
  /** More cell controls after Add, such as the cell menu. */
  controls?: ReactNode;
  onAdd: (item: Item) => void;
  onRemove: (member: Member) => void;
  onPreview: (member: Member) => void;
  onPreviewChoice: (item: Item) => void;
  onRetry: () => void;
}) {
  const { t } = useTranslation("animas");
  const name = reactionCellLabel(emotion, intensity, t);
  const inCell = new Set(members.map((member) => member.item_id));
  const full = reactionCellFull({ members });
  const fullId = `reaction-${emotion}-${intensity}-full`;
  const { local, included } = groupReactionSelectorChoices(choices);
  return (
    <LoadoutPoolCellRow
      id={id}
      label={<ReactionIntensityBadge intensity={intensity} />}
      listLabel={name}
      emptyText={t("reactions.noReaction")}
      members={members.map((member) => (
        <LoadoutPoolMemberChip
          key={member.binding_id}
          member={member}
          unavailableText={unavailableText ?? t("reactions.unavailable")}
          removeLabel={t("reactions.remove", { name: member.name, cell: name })}
          badge={isStarter(member) ? <StarterBadge /> : null}
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
            loading={loading}
            error={error}
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
              onAdd(reaction);
              return true;
            }}
            onPreview={onPreviewChoice}
            onRetry={onRetry}
          />
          {controls}
        </div>
      }
    />
  );
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

/** One Loadout cell: its pool, with the Library link and Restore starter. */
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
  return (
    <ReactionPoolCellRow
      emotion={cell.emotion}
      intensity={cell.intensity}
      members={cell.members ?? []}
      isStarter={(member) => member.origin === "starter"}
      choices={available}
      loading={availableLoading}
      error={availableError}
      disabled={disabled}
      busy={busy}
      onAdd={(reaction) => onAdd(cell, reaction)}
      onRemove={onRemove}
      onPreview={onPreview}
      onPreviewChoice={onPreviewAvailable}
      onRetry={onRetryAvailable}
      controls={
        <ReactionCellMenu
          cell={cell}
          cellName={reactionCellLabel(cell.emotion, cell.intensity, t)}
          disabled={disabled || busy}
          onRestoreStarter={() => onRestoreStarter(cell)}
        />
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
