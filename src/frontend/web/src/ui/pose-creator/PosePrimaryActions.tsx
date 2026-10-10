"use client";

import { SaveIcon, WandSparklesIcon } from "lucide-react";
import { useIsMutating } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useRuntimeCacheKey } from "@/app/runtime/RuntimeOwnerContext";
import { queryKeys } from "@/query/keys";
import { usePoseCreatorStore } from "@/stores/pose-creator-store";
import { Button } from "@/ui/components/button";

/** Shared pose Save actions; no Gesture/Reaction document provider is required. */
export function PosePrimaryActions({ busy = false }: { busy?: boolean }) {
  const { t } = useTranslation("pose");
  const owner = useRuntimeCacheKey();
  const saving =
    useIsMutating({ mutationKey: queryKeys.poses.save(owner ?? "__anon__") }) >
    0;
  const isDirty = usePoseCreatorStore((state) => state.isDirty);
  const saved = usePoseCreatorStore((state) => state.savedPoseIdentity);
  const saveDisabled = busy || saving || Boolean(saved && !isDirty);
  const selectedSource = usePoseCreatorStore((state) => state.selectedSource);
  const activeAvatar = usePoseCreatorStore((state) => state.activeAvatar);
  return (
    <div className="col-start-3 row-start-1 flex h-11 items-center gap-1.5 lg:col-start-6 lg:h-12">
      <Button
        type="submit"
        form="pose-creator-pose-save-form"
        variant="outline"
        className="bg-background dark:bg-background dark:hover:bg-accent disabled:text-muted-foreground size-11 rounded-xl p-0 shadow-sm disabled:opacity-100 lg:h-12 lg:w-auto lg:min-w-[88px] lg:px-3"
        disabled={saveDisabled || !selectedSource}
        aria-label={t("actions.saveLabel")}
      >
        <SaveIcon className="size-4" />
        <span className="hidden lg:inline">{t("actions.save")}</span>
      </Button>
      <Button
        type="submit"
        form="pose-creator-pose-save-form"
        name="pose-creator-submit-action"
        value="save-and-branch"
        variant="default"
        className="hover:bg-primary disabled:text-muted-foreground size-11 rounded-xl p-0 shadow-sm disabled:opacity-100 lg:h-12 lg:w-auto lg:min-w-[160px] lg:px-3"
        disabled={saveDisabled || !selectedSource || !activeAvatar}
        aria-label={t("actions.saveAndBranchLabel")}
      >
        <WandSparklesIcon className="size-4" />
        <span className="hidden lg:inline">{t("actions.saveAndBranch")}</span>
      </Button>
    </div>
  );
}
