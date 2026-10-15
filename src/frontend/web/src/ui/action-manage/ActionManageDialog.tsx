"use client";

import { useProductApiClient } from "@animama/product-ui";

import { useId, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { Check, ExternalLink, Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";

import {
  commitGestureV1AnimasAnimaIdGesturesCommitPost,
  getAnimaLoadoutV1AnimasAnimaIdLoadoutGet,
  planGestureV1AnimasAnimaIdGesturesPlanPost,
} from "@animama/runtime-contracts/sdk";
import type {
  PyAnimaLoadout,
  PyGestureIntent,
} from "@animama/runtime-contracts/api-types";
import { REACTION_INTENSITIES } from "@/lib/avatar/reactionPools";
import type { PyExactContentSource } from "@/lib/content/catalogTypes";
import { TRACKED_EMOTIONS } from "@/lib/emotion";
import { emotionLabel } from "@/lib/emotion/presentation";
import {
  loadoutFailureText,
  loadoutWarningText,
  poolChangeFailureText,
} from "@/lib/errors/loadoutErrors";
import { reactionAddIntent } from "@/lib/loadout/reactionLoadoutGrid";
import { useRuntimeCacheKey } from "@/app/runtime/RuntimeOwnerContext";
import { invalidateAnimaLoadoutAndRuntime } from "@/query/animaLoadoutInvalidation";
import { useAnimas } from "@/query/hooks/useAnimas";
import { queryKeys } from "@/query/keys";
import { useAnimaLoadoutMutations } from "@/query/mutations/useAnimaLoadoutMutations";
import {
  reactionCellLabel,
  reactionIntensityLabel,
} from "@/ui/animas/ActionLoadoutRows";
import { Button } from "@/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/components/dialog";
import { Label } from "@/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/components/select";
import {
  actionManageLoadoutSource,
  actionManageReactionCell,
  actionManageReactionMember,
  actionManageRowState,
  type ReactionCellKey,
} from "./actionManageTarget";

export type ManageActionTarget = {
  kind: "gesture" | "reaction";
  itemId: string;
  name: string;
  description: string;
  source?: PyExactContentSource | null;
  semanticKey?: string;
  /** A Reaction's suggested cell, where the dialog starts. */
  emotion?: string;
  intensity?: number;
  includedCount?: number;
};

/** The Animas the dialog lists, as the roster query returns them. */
type ManagedAnima = { id: string; presentation: { display_name: string } };

/**
 * One Anima's row: its name, how the item stands in its Loadout, and the
 * change button. The status line can explain a disabled button.
 */
function ManageRow({
  name,
  equipped,
  status,
  statusId,
  children,
}: {
  name: string;
  equipped: boolean;
  status: string;
  statusId?: string;
  children: ReactNode;
}) {
  return (
    <div
      role="group"
      aria-label={name}
      className="border-border/70 flex items-center gap-3 rounded-lg border p-3"
    >
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          {equipped ? <Check className="text-primary size-4" /> : null}
          <span className="truncate">{name}</span>
        </span>
        <span id={statusId} className="text-muted-foreground block text-xs">
          {status}
        </span>
      </span>
      {children}
    </div>
  );
}

/** The Reaction cell the dialog edits: a tracked emotion and an intensity. */
function ReactionCellChooser({
  cell,
  onChange,
}: {
  cell: ReactionCellKey;
  onChange: (cell: ReactionCellKey) => void;
}) {
  const { t } = useTranslation("animas");
  const emotionId = useId();
  const intensityId = useId();
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="min-w-0 space-y-1.5">
        <Label htmlFor={emotionId}>{t("manage.reaction.emotion")}</Label>
        <Select
          value={cell.emotion}
          onValueChange={(emotion) => onChange({ ...cell, emotion })}
        >
          <SelectTrigger id={emotionId} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TRACKED_EMOTIONS.map((emotion) => (
              <SelectItem key={emotion} value={emotion}>
                {emotionLabel(emotion)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="min-w-0 space-y-1.5">
        <Label htmlFor={intensityId}>{t("manage.reaction.intensity")}</Label>
        <Select
          value={String(cell.intensity)}
          onValueChange={(value) => {
            const intensity = REACTION_INTENSITIES.find(
              (level) => String(level) === value,
            );
            if (intensity) onChange({ ...cell, intensity });
          }}
        >
          <SelectTrigger id={intensityId} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {REACTION_INTENSITIES.map((intensity) => (
              <SelectItem key={intensity} value={String(intensity)}>
                {reactionIntensityLabel(intensity, t)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

/**
 * One Anima's pool for the chosen cell: Add the Reaction to it, or Remove the
 * Reaction from it, through the same `changeReaction` mutation as the
 * Loadout. Other members of the cell never change; a full cell takes no more.
 */
function ReactionPoolRow({
  anima,
  loadout,
  pending,
  target,
  cell,
}: {
  anima: ManagedAnima;
  loadout: PyAnimaLoadout | undefined;
  pending: boolean;
  target: ManageActionTarget;
  cell: ReactionCellKey;
}) {
  const { t } = useTranslation(["animas", "errors"]);
  const statusId = useId();
  const { changeReaction } = useAnimaLoadoutMutations(anima.id);
  const name = anima.presentation.display_name;
  const { equipped, full } = loadout
    ? actionManageRowState(target, loadout, cell)
    : { equipped: false, full: false };
  const blocked = !equipped && full;
  const cellName = reactionCellLabel(cell.emotion, cell.intensity, t);
  const change = async () => {
    if (!loadout) return;
    const member = actionManageReactionMember(target, loadout, cell);
    const source = actionManageLoadoutSource(target);
    if (!member && !source) {
      toast.error(t("manage.notLocal"));
      return;
    }
    const values = { name: target.name, anima: name, cell: cellName };
    try {
      const result = await changeReaction.mutateAsync({
        expected_revision: loadout.revision,
        intent: member
          ? { operation: "remove", binding_id: member.binding_id }
          : reactionAddIntent(cell, source!),
      });
      for (const warning of result.warnings)
        toast.warning(loadoutWarningText(warning));
      toast.success(
        member
          ? t("manage.reaction.removed", values)
          : t("manage.reaction.added", values),
      );
    } catch (error) {
      const text = poolChangeFailureText(
        error,
        t("reactions.changedElsewhere"),
        t("errors:loadout.equipFailed"),
      );
      toast.error(text.message, { description: text.detail ?? undefined });
    }
  };
  return (
    <ManageRow
      name={name}
      equipped={equipped}
      statusId={statusId}
      status={
        equipped
          ? t("manage.reaction.inCell")
          : full
            ? t("manage.reaction.full")
            : t("manage.reaction.notInCell")
      }
    >
      <Button
        type="button"
        size="sm"
        variant={equipped ? "outline" : "default"}
        disabled={pending || !loadout || changeReaction.isPending || blocked}
        aria-label={
          equipped
            ? t("manage.reaction.removeFrom", { anima: name, cell: cellName })
            : t("manage.reaction.addTo", { anima: name, cell: cellName })
        }
        aria-describedby={blocked ? statusId : undefined}
        onClick={() => void change()}
      >
        {changeReaction.isPending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : equipped ? (
          <>
            <X className="size-4" /> {t("actions.remove")}
          </>
        ) : (
          <>
            <Plus className="size-4" /> {t("reactions.add")}
          </>
        )}
      </Button>
    </ManageRow>
  );
}

/**
 * Equip one editable catalog item directly; the next chat gets a fresh mount.
 * A Gesture is equipped to or removed from each Anima. A Reaction is added to
 * or removed from each Anima's pool for a chosen cell, which starts at the
 * Reaction's suggestion (Joy, Mild without one).
 */
export function ActionManageDialog({
  open,
  onOpenChange,
  target,
  onPreview,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: ManageActionTarget | null;
  onPreview?: () => void;
}) {
  const apiClient = useProductApiClient();
  const { t } = useTranslation(["animas", "errors"]);

  const userId = useRuntimeCacheKey() ?? "__anon__";
  const animas = useAnimas();
  const queryClient = useQueryClient();
  const [busyAnimaId, setBusyAnimaId] = useState<string | null>(null);
  // The cell chosen for this Reaction while the dialog is open.
  const [chosen, setChosen] = useState<{
    itemId: string;
    cell: ReactionCellKey;
  } | null>(null);
  const loadouts = useQueries({
    queries: (animas.data ?? []).map((anima) => ({
      queryKey: queryKeys.animaLoadouts.detail(userId, anima.id),
      enabled: open,
      queryFn: async () =>
        (
          await getAnimaLoadoutV1AnimasAnimaIdLoadoutGet({
            client: apiClient,
            path: { anima_id: anima.id },
            responseValidator: undefined,
            throwOnError: true,
          })
        ).data,
    })),
  });
  const rows = useMemo(
    () =>
      (animas.data ?? []).map((anima, index) => ({
        anima,
        loadout: loadouts[index]?.data,
        pending: Boolean(loadouts[index]?.isPending),
      })),
    [animas.data, loadouts],
  );
  if (!target) return null;
  const cell =
    target.kind !== "reaction"
      ? null
      : chosen?.itemId === target.itemId
        ? chosen.cell
        : actionManageReactionCell(target);
  const changeOpen = (next: boolean) => {
    // Each opening starts again from the Reaction's suggested cell.
    if (!next) setChosen(null);
    onOpenChange(next);
  };
  const toggleGesture = async (
    animaId: string,
    loadout: PyAnimaLoadout,
    equipped: boolean,
  ) => {
    const source = actionManageLoadoutSource(target);
    if (!equipped && !source) {
      toast.error(t("manage.notLocal"));
      return;
    }
    setBusyAnimaId(animaId);
    try {
      const binding = loadout.gestures.find(
        (candidate) => candidate.source.catalog_item_id === target.itemId,
      );
      const intent: PyGestureIntent = equipped
        ? binding?.origin === "starter"
          ? {
              operation: "disable_starter",
              starter_id: binding.semantic_key,
              config_overrides: {},
            }
          : {
              operation: "remove",
              binding_id: binding?.binding_id,
              config_overrides: {},
            }
        : { operation: "add", source, config_overrides: {} };
      const plan = (
        await planGestureV1AnimasAnimaIdGesturesPlanPost({
          client: apiClient,
          path: { anima_id: animaId },
          body: { expected_revision: loadout.revision, intent },
          responseValidator: undefined,
          throwOnError: true,
        })
      ).data;
      await commitGestureV1AnimasAnimaIdGesturesCommitPost({
        client: apiClient,
        path: { anima_id: animaId },
        body: {
          expected_revision: loadout.revision,
          intent,
          plan_digest: plan.plan_digest,
          idempotency_key: crypto.randomUUID(),
        },
        responseValidator: undefined,
        throwOnError: true,
      });
      await invalidateAnimaLoadoutAndRuntime(queryClient, userId, animaId);
      const anima =
        rows.find((row) => row.anima.id === animaId)?.anima.presentation
          .display_name ?? t("manage.animaFallback");
      toast.success(
        equipped
          ? t("manage.removedFrom", { name: target.name, anima })
          : t("manage.equippedTo", { name: target.name, anima }),
      );
    } catch (error) {
      const text = loadoutFailureText(error, t("errors:loadout.equipFailed"));
      toast.error(text.message, { description: text.detail ?? undefined });
    } finally {
      setBusyAnimaId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("manage.title", { name: target.name })}</DialogTitle>
          <DialogDescription>
            {target.kind === "gesture"
              ? t("manage.description.gesture")
              : t("manage.description.reaction")}
          </DialogDescription>
        </DialogHeader>
        {cell ? (
          <ReactionCellChooser
            cell={cell}
            onChange={(next) =>
              setChosen({ itemId: target.itemId, cell: next })
            }
          />
        ) : null}
        <div className="space-y-2 py-2">
          {rows.map(({ anima, loadout, pending }) => {
            if (cell)
              return (
                <ReactionPoolRow
                  key={anima.id}
                  anima={anima}
                  loadout={loadout}
                  pending={pending}
                  target={target}
                  cell={cell}
                />
              );
            const { equipped, replacing } = loadout
              ? actionManageRowState(target, loadout)
              : { equipped: false, replacing: false };
            const busy = busyAnimaId === anima.id;
            return (
              <ManageRow
                key={anima.id}
                name={anima.presentation.display_name}
                equipped={equipped}
                status={
                  equipped
                    ? t("actions.equipped")
                    : replacing
                      ? t("manage.willReplace.gesture")
                      : t("manage.notEquipped")
                }
              >
                <Button
                  type="button"
                  size="sm"
                  variant={equipped ? "outline" : "default"}
                  disabled={pending || !loadout || busy}
                  onClick={() =>
                    loadout && void toggleGesture(anima.id, loadout, equipped)
                  }
                >
                  {busy ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : equipped ? (
                    <>
                      <X className="size-4" /> {t("actions.remove")}
                    </>
                  ) : (
                    <>
                      <Plus className="size-4" />{" "}
                      {replacing ? t("actions.replace") : t("actions.equip")}
                    </>
                  )}
                </Button>
              </ManageRow>
            );
          })}
        </div>
        <DialogFooter>
          {onPreview ? (
            <Button type="button" variant="outline" onClick={onPreview}>
              <ExternalLink className="size-4" /> {t("actions.preview")}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            onClick={() => changeOpen(false)}
          >
            {t("actions.done")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
