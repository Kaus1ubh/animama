"use client";

import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";

import type { Avatar } from "@/lib/avatar";
import { usePoseCreatorStore } from "@/stores/pose-creator-store";
import { AvatarPreviewSurface } from "@/ui/avatar-preview/AvatarPreviewSurface";
import { Button } from "@/ui/components/button";
import { DEFAULT_AVATAR_TRANSFORM } from "@/ui/main/canvas/transform-state";
import { SceneVFXLifecycleBridge } from "@/ui/main/scene-vfx/SceneVFXLifecycleBridge";
import { SceneVFXOverlayHost } from "@/ui/main/scene-vfx/SceneVFXOverlayHost";
import { SceneVFXUnderlayHost } from "@/ui/main/scene-vfx/SceneVFXUnderlayHost";
import { ActionEditorAvatarActor } from "./ActionEditorPrimitives";
import type { ActionEditorCapabilities } from "./actionEditorCapabilities";
import { useActionEditorPreview } from "./ActionEditorPreviewProvider";

/** Host the editable Avatar on the same preview shell used by product previews. */
export function ActionEditorScene({
  capabilities,
}: {
  capabilities: ActionEditorCapabilities;
}) {
  const { t } = useTranslation("actionEditor");
  const activeAvatar = usePoseCreatorStore((state) => state.activeAvatar);
  const loadStatus = usePoseCreatorStore((state) => state.loadStatus);
  const loadError = usePoseCreatorStore((state) => state.loadError);
  const setActiveAvatar = usePoseCreatorStore((state) => state.setActiveAvatar);
  const preview = useActionEditorPreview();
  const handleAvatarChange = useCallback(
    (avatar: Avatar | null) => setActiveAvatar(avatar),
    [setActiveAvatar],
  );
  const visibleError =
    loadError ??
    preview.modelError ??
    preview.runtimeError ??
    preview.animaError;
  const isPreparing =
    !preview.modelEntry &&
    (preview.isAnimaPending ||
      preview.isRuntimePending ||
      Boolean(preview.selectedModel));
  const retry = preview.animaError
    ? preview.retryAnima
    : preview.runtimeError
      ? preview.retryRuntime
      : preview.retrySelectedModel;
  const actorKey = useMemo(
    () =>
      preview.modelEntry
        ? `${preview.modelEntryKey ?? preview.modelEntry.content_revision}:${preview.catalog?.revision ?? "built-in"}`
        : "empty",
    [preview.catalog?.revision, preview.modelEntry, preview.modelEntryKey],
  );

  return (
    <div className="relative size-full overflow-hidden">
      <SceneVFXLifecycleBridge />
      <AvatarPreviewSurface
        activeAvatar={activeAvatar}
        cameraProfile={capabilities.cameraProfile}
        canvasTestId="action-editor-canvas"
        className="bg-transparent"
        lifecycleOwner="creator"
        minDistance={capabilities.intent === "reaction" ? 0.45 : 0.75}
        maxDistance={capabilities.intent === "reaction" ? 4 : 6}
        showSceneVFX={false}
        underlay={
          <SceneVFXUnderlayHost
            allowBackgroundLayers
            backgroundScope="viewport"
          />
        }
        overlay={<SceneVFXOverlayHost className="z-20" />}
      >
        {preview.modelEntry ? (
          <group
            position={[
              DEFAULT_AVATAR_TRANSFORM.position.x,
              DEFAULT_AVATAR_TRANSFORM.position.y,
              DEFAULT_AVATAR_TRANSFORM.position.z,
            ]}
          >
            <ActionEditorAvatarActor
              key={actorKey}
              entry={preview.modelEntry}
              catalog={preview.catalog}
              onAvatarInstanceChange={handleAvatarChange}
              showHumanoidTools={capabilities.allowsHumanoid}
            />
          </group>
        ) : null}
      </AvatarPreviewSurface>
      {!activeAvatar ? (
        <div className="pointer-events-none absolute inset-0 z-40 grid place-items-center p-6">
          <div
            className="bg-background border-border pointer-events-auto max-w-sm rounded-xl border p-4 text-center shadow-lg backdrop-blur-sm"
            role={visibleError ? "alert" : "status"}
          >
            <p className="text-sm font-medium">
              {visibleError
                ? t("scene.unavailable")
                : isPreparing || loadStatus === "loading"
                  ? t("scene.loading")
                  : t("scene.selectAvatar")}
            </p>
            {visibleError ? (
              <p className="text-muted-foreground mt-1 text-xs">
                {visibleError}
              </p>
            ) : null}
            {visibleError ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mt-3"
                onClick={() => void retry()}
              >
                {t("scene.retry")}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
