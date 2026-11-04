import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { Avatar } from "@/lib/avatar";
import { usePoseCreatorStore } from "@/stores/pose-creator-store";
import { AvatarPreviewSurface } from "@/ui/avatar-preview/AvatarPreviewSurface";
import { Button } from "@/ui/components/button";
import { PoseCreatorAvatarActor } from "@/ui/pose-creator/PoseCreatorAvatarActor";
import { usePoseCreatorPreview } from "@/ui/pose-creator/PoseCreatorPreviewProvider";

/** Render one full-body editing Avatar without an Action document or timeline. */
export function PoseEditorScene({ editable }: { editable: boolean }) {
  const { t } = useTranslation("pose");
  const preview = usePoseCreatorPreview();
  const activeAvatar = usePoseCreatorStore((state) => state.activeAvatar);
  const loadError = usePoseCreatorStore((state) => state.loadError);
  const setActiveAvatar = usePoseCreatorStore((state) => state.setActiveAvatar);
  const onAvatarChange = useCallback(
    (avatar: Avatar | null) => setActiveAvatar(avatar),
    [setActiveAvatar],
  );
  const error =
    loadError ??
    preview.modelError ??
    preview.runtimeError ??
    preview.animaError;
  const retry = preview.animaError
    ? preview.retryAnima
    : preview.runtimeError
      ? preview.retryRuntime
      : preview.retrySelectedModel;
  return (
    <div className="relative size-full min-h-0 overflow-hidden">
      <AvatarPreviewSurface
        activeAvatar={activeAvatar}
        cameraProfile="full-body"
        canvasTestId="pose-editor-canvas"
        lifecycleOwner="creator"
        showSceneVFX={false}
        minDistance={0.75}
        maxDistance={6}
      >
        {preview.modelEntry ? (
          <PoseCreatorAvatarActor
            key={`${preview.modelEntryKey ?? preview.modelEntry.content_revision}:${preview.catalog?.revision ?? "pose"}`}
            showHumanoidTools={editable}
            entry={preview.modelEntry}
            catalog={preview.catalog}
            onAvatarInstanceChange={onAvatarChange}
          />
        ) : null}
      </AvatarPreviewSurface>
      {!activeAvatar ? (
        <div className="pointer-events-none absolute inset-0 grid place-items-center p-4">
          <div
            className="bg-background/95 border-border pointer-events-auto max-w-sm rounded-xl border p-4 text-center shadow-sm"
            role={error ? "alert" : "status"}
          >
            <p className="text-sm font-medium">
              {error
                ? t("scene.unavailable")
                : preview.selectedModel ||
                    preview.isAnimaPending ||
                    preview.isRuntimePending
                  ? t("scene.loading")
                  : t("scene.select")}
            </p>
            {error ? (
              <>
                <p className="text-muted-foreground mt-2 text-xs">{error}</p>
                <Button
                  className="mt-3"
                  variant="outline"
                  onClick={() => void retry()}
                >
                  {t("scene.retry")}
                </Button>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
