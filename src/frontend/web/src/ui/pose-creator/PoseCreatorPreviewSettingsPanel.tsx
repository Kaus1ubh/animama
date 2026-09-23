"use client";

import { MoreHorizontalIcon, RefreshCwIcon } from "lucide-react";

import {
  isPoseCreatorBasePose,
  POSE_CREATOR_BASE_POSE_OPTIONS,
  usePoseCreatorStore,
} from "@/stores/pose-creator-store";
import { Button } from "@/ui/components/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/components/select";
import { applyPoseCreatorBasePose } from "./poseCreatorAuthoring";
import { confirmPoseCreatorDirtyReplacement } from "./poseCreatorDirtyGuard";
import { PoseCreatorHelpersToggle } from "./PoseCreatorHelpersToggle";
import { usePoseCreatorPreview } from "./PoseCreatorPreviewProvider";

/** Floating preview configuration moved out of the document toolbar. */
export function PoseCreatorPreviewSettingsPanel({
  variant = "workspace",
}: {
  variant?: "workspace" | "mobile";
}) {
  const selectedSource = usePoseCreatorStore((state) => state.selectedSource);
  const basePose = usePoseCreatorStore((state) => state.basePose);
  const activeAvatar = usePoseCreatorStore((state) => state.activeAvatar);
  const isDirty = usePoseCreatorStore((state) => state.isDirty);
  const setBasePose = usePoseCreatorStore((state) => state.setBasePose);
  const boneHelperNodesVisible = usePoseCreatorStore(
    (state) => state.boneHelperNodesVisible,
  );
  const setBoneHelperNodesVisible = usePoseCreatorStore(
    (state) => state.setBoneHelperNodesVisible,
  );
  const {
    modelOptions,
    isModelCatalogPending,
    hasMoreModels,
    isLoadingMoreModels,
    modelCatalogError,
    selectModel,
    retryModels,
    loadMoreModels,
  } = usePoseCreatorPreview();

  const handleBasePoseChange = (value: string) => {
    if (!isPoseCreatorBasePose(value) || value === basePose) return;
    if (!confirmPoseCreatorDirtyReplacement(isDirty)) return;
    applyPoseCreatorBasePose(activeAvatar, value);
    setBasePose(value);
  };

  return (
    <div
      className={
        variant === "mobile"
          ? "bg-background pointer-events-auto flex h-full min-h-0 w-full flex-col gap-4 overflow-y-auto p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]"
          : "border-border/65 bg-background pointer-events-auto flex h-14 max-w-full min-w-0 items-center gap-1 overflow-hidden rounded-2xl border px-2 shadow-xl shadow-black/8 backdrop-blur-xl xl:gap-2 xl:px-3"
      }
    >
      {variant === "mobile" ? (
        <div>
          <h2 className="text-sm font-semibold">Preview</h2>
          <p className="text-muted-foreground mt-0.5 text-xs">
            Choose the avatar, base pose, and canvas helpers.
          </p>
        </div>
      ) : null}
      <div
        className={
          variant === "mobile"
            ? "border-border/70 flex min-w-0 flex-col gap-1 rounded-xl border p-3"
            : "flex min-w-0 items-center"
        }
      >
        <span className="text-muted-foreground shrink-0 text-xs font-medium">
          Model
        </span>
        <Select
          value={selectedSource?.key ?? ""}
          onValueChange={(key) => {
            if (key === selectedSource?.key) return;
            const source = modelOptions.find((option) => option.key === key);
            if (source) selectModel(source);
          }}
          disabled={isModelCatalogPending && modelOptions.length === 0}
        >
          <SelectTrigger
            className={
              variant === "mobile"
                ? "h-11 w-full"
                : "h-10 w-[112px] border-0 bg-transparent px-2 text-sm font-medium shadow-none focus-visible:ring-0 xl:w-[155px] 2xl:w-[220px] dark:bg-transparent"
            }
            aria-label="Avatar"
          >
            <SelectValue
              placeholder={
                isModelCatalogPending ? "Loading models…" : "Select model"
              }
            />
          </SelectTrigger>
          <SelectContent>
            {selectedSource &&
            !modelOptions.some(
              (option) => option.key === selectedSource.key,
            ) ? (
              <SelectItem value={selectedSource.key}>
                {selectedSource.displayName}
              </SelectItem>
            ) : null}
            {modelOptions.map((source) => (
              <SelectItem key={source.key} value={source.key}>
                {source.displayName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <span className="bg-border hidden h-7 w-px shrink-0 lg:block" />
      <div
        className={
          variant === "mobile"
            ? "border-border/70 flex min-w-0 flex-col gap-1 rounded-xl border p-3"
            : "flex min-w-0 items-center"
        }
      >
        <span className="text-muted-foreground shrink-0 text-xs font-medium">
          Base
        </span>
        <Select value={basePose} onValueChange={handleBasePoseChange}>
          <SelectTrigger
            className={
              variant === "mobile"
                ? "h-11 w-full"
                : "h-10 w-[88px] border-0 bg-transparent px-2 text-sm font-medium shadow-none focus-visible:ring-0 xl:w-[120px] 2xl:w-[170px] dark:bg-transparent"
            }
            aria-label="Pose base"
          >
            <SelectValue placeholder="Select pose base" />
          </SelectTrigger>
          <SelectContent>
            {POSE_CREATOR_BASE_POSE_OPTIONS.map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {variant === "mobile" ? (
        <div className="border-border/70 flex min-h-14 items-center justify-between rounded-xl border px-3">
          <div>
            <p className="text-sm font-medium">Bone helpers</p>
            <p className="text-muted-foreground text-xs">
              Show selectable joints and rotation gizmos.
            </p>
          </div>
          <PoseCreatorHelpersToggle
            checked={boneHelperNodesVisible}
            onCheckedChange={setBoneHelperNodesVisible}
          />
        </div>
      ) : null}

      {modelCatalogError ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => void retryModels()}
          aria-label="Retry loading models"
        >
          <RefreshCwIcon className="size-4" />
        </Button>
      ) : null}
      {hasMoreModels ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={isLoadingMoreModels}
          onClick={() => void loadMoreModels()}
          aria-label="Load more models"
        >
          <MoreHorizontalIcon className="size-4" />
        </Button>
      ) : null}
    </div>
  );
}
