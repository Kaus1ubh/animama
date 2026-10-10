"use client";

import { useProductApiClient } from "@animama/product-ui";

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { Check, ExternalLink, Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";

import {
  commitGestureV1AnimasAnimaIdGesturesCommitPost,
  commitReactionV1AnimasAnimaIdReactionsCommitPost,
  getAnimaLoadoutV1AnimasAnimaIdLoadoutGet,
  planGestureV1AnimasAnimaIdGesturesPlanPost,
  planReactionV1AnimasAnimaIdReactionsPlanPost,
} from "@animama/runtime-contracts/sdk";
import type {
  PyAnimaLoadout,
  PyGestureIntent,
  PyReactionIntent,
} from "@animama/runtime-contracts/api-types";
import type { PyExactContentSource } from "@/lib/content/catalogTypes";
import { loadoutFailureText } from "@/lib/errors/loadoutErrors";
import { useRuntimeCacheKey } from "@/app/runtime/RuntimeOwnerContext";
import { invalidateAnimaLoadoutAndRuntime } from "@/query/animaLoadoutInvalidation";
import { useAnimas } from "@/query/hooks/useAnimas";
import { queryKeys } from "@/query/keys";
import { Button } from "@/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/components/dialog";
import {
  actionManageLoadoutSource,
  actionManageRowState,
} from "./actionManageTarget";

export type ManageActionTarget = {
  kind: "gesture" | "reaction";
  itemId: string;
  name: string;
  description: string;
  source?: PyExactContentSource | null;
  semanticKey?: string;
  emotion?: string;
  intensity?: number;
  includedCount?: number;
};

/** Equip one editable catalog item directly; the next chat gets a fresh mount. */
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
        pending: loadouts[index]?.isPending,
      })),
    [animas.data, loadouts],
  );
  if (!target) return null;
  const toggle = async (
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
      if (target.kind === "gesture") {
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
      } else {
        const emotion = target.emotion ?? "joy";
        const intensity =
          target.intensity === 2 || target.intensity === 3
            ? target.intensity
            : 1;
        const cell = loadout.reactions.find(
          (candidate) =>
            candidate.emotion === emotion && candidate.intensity === intensity,
        );
        const intent: PyReactionIntent = equipped
          ? {
              operation: cell?.state === "starter" ? "leave_empty" : "revert",
              emotion,
              intensity,
              config_overrides: {},
            }
          : {
              operation: "replace",
              emotion,
              intensity,
              source,
              config_overrides: {},
            };
        const plan = (
          await planReactionV1AnimasAnimaIdReactionsPlanPost({
            client: apiClient,
            path: { anima_id: animaId },
            body: { expected_revision: loadout.revision, intent },
            responseValidator: undefined,
            throwOnError: true,
          })
        ).data;
        await commitReactionV1AnimasAnimaIdReactionsCommitPost({
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
      }
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("manage.title", { name: target.name })}</DialogTitle>
          <DialogDescription>
            {target.kind === "gesture"
              ? t("manage.description.gesture")
              : t("manage.description.reaction")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          {rows.map(({ anima, loadout, pending }) => {
            const { equipped, replacing } = loadout
              ? actionManageRowState(target, loadout)
              : { equipped: false, replacing: false };
            const busy = busyAnimaId === anima.id;
            return (
              <div
                key={anima.id}
                className="border-border/70 flex items-center gap-3 rounded-lg border p-3"
              >
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    {equipped ? (
                      <Check className="text-primary size-4" />
                    ) : null}
                    {anima.presentation.display_name}
                  </span>
                  <span className="text-muted-foreground block text-xs">
                    {equipped
                      ? t("actions.equipped")
                      : replacing
                        ? target.kind === "gesture"
                          ? t("manage.willReplace.gesture")
                          : t("manage.willReplace.reaction")
                        : t("manage.notEquipped")}
                  </span>
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant={equipped ? "outline" : "default"}
                  disabled={pending || !loadout || busy}
                  onClick={() =>
                    loadout && void toggle(anima.id, loadout, equipped)
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
              </div>
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
            onClick={() => onOpenChange(false)}
          >
            {t("actions.done")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
