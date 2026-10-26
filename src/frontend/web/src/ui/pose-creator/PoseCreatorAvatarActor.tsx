"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { getI18n } from "react-i18next";
import type { Object3D } from "three";

import { Avatar } from "@/lib/avatar";
import { BUILT_IN_AVATAR_MOTION_CATALOG } from "@/lib/avatar/motion/AvatarMotionCatalog";
import { EMPTY_RUNTIME_MEDIA_PROVIDER } from "@/lib/runtime-content/AnimaRuntimeMediaCatalog";
import type { AnimaRuntimeCatalog } from "@/lib/runtime-content/AnimaRuntimeCatalog";
import {
  runtimeContentDeliveryUrl,
  runtimeContentDownloadUrl,
  type RuntimeContentUrlLease,
} from "@/lib/runtime-content/runtimeContentDelivery";
import { resolveRuntimeAvatarFaceParts } from "@/lib/runtime-content/runtimeAvatarFaceParts";
import type { RuntimeCatalogEntry } from "@/lib/runtime-content/types";
import {
  apiErrorLine,
  uncodedErrorText,
  WordedError,
} from "@/lib/errors/apiError";
import { createLogger } from "@/lib/logger";
import { redactUrlForLogging } from "@/lib/utils";
import { usePoseCreatorStore } from "@/stores/pose-creator-store";
import {
  applyPoseCreatorBasePose,
  applyPoseCreatorDraftsToAvatar,
} from "./poseCreatorAuthoring";
import { PoseCreatorBoneGizmo } from "./PoseCreatorBoneGizmo";
import { PoseCreatorBoneMarkers } from "./PoseCreatorBoneMarkers";
import { PoseCreatorClipPlaybackTicker } from "./PoseCreatorClipPlaybackTicker";
import { updatePoseCreatorAvatarFrame } from "./poseCreatorAvatarFrame";

type PoseCreatorAvatarActorProps = {
  entry: RuntimeCatalogEntry;
  catalog: AnimaRuntimeCatalog | null;
  onAvatarInstanceChange?: (avatar: Avatar | null) => void;
  showHumanoidTools?: boolean;
};

/**
 * The load failure shown over the canvas. Loader English stays primary in
 * English and becomes detail under the worded message elsewhere.
 */
function formatLoadError(error: unknown): string {
  if (error instanceof WordedError) return error.message;
  const t = getI18n().getFixedT(null, "pose");
  return apiErrorLine(
    uncodedErrorText(
      error instanceof Error ? error.message.trim() || null : null,
      t("avatar.renderFailed"),
    ),
  );
}

export function PoseCreatorAvatarActor({
  entry,
  catalog,
  onAvatarInstanceChange,
  showHumanoidTools = true,
}: PoseCreatorAvatarActorProps) {
  const logger = useMemo(() => createLogger("PoseCreatorAvatarActor"), []);
  const { camera, gl } = useThree();
  const viewportElement = gl.domElement;
  const editingPose = usePoseCreatorStore(
    (state) => state.authoringMode === "pose" || Boolean(state.clipInlineEdit),
  );
  const basePose = usePoseCreatorStore((state) => state.basePose);
  const boneDrafts = usePoseCreatorStore((state) => state.boneDrafts);
  const expressionDrafts = usePoseCreatorStore(
    (state) => state.expressionDrafts,
  );
  const avatarRef = useRef<Avatar | null>(null);
  const basePoseRef = useRef(basePose);
  const [sceneObject, setSceneObject] = useState<Object3D | null>(null);
  const setLoadStatus = usePoseCreatorStore((state) => state.setLoadStatus);
  const setLoadProgress = usePoseCreatorStore((state) => state.setLoadProgress);

  useEffect(() => {
    basePoseRef.current = basePose;
  }, [basePose]);

  useEffect(() => {
    let isCancelled = false;
    const controller = new AbortController();
    const avatar = new Avatar(camera, viewportElement, {
      motionCatalog: catalog ?? BUILT_IN_AVATAR_MOTION_CATALOG,
      mediaCatalog: catalog ?? EMPTY_RUNTIME_MEDIA_PROVIDER,
    });
    avatarRef.current = avatar;
    setSceneObject(null);
    onAvatarInstanceChange?.(null);
    setLoadStatus("loading");
    setLoadProgress({ phase: "setup" });

    const loadAvatar = async () => {
      const logicalUrl = runtimeContentDeliveryUrl(entry);
      let download: RuntimeContentUrlLease | null = null;
      try {
        if (!logicalUrl) {
          const t = getI18n().getFixedT(null, "pose");
          throw new WordedError(t("avatar.noRuntimeFile"));
        }
        download = await runtimeContentDownloadUrl(entry, logicalUrl, {
          signal: controller.signal,
        });
        if (!download) {
          const t = getI18n().getFixedT(null, "pose");
          throw new WordedError(t("avatar.unauthorized"));
        }
        controller.signal.throwIfAborted();
        await avatar.load(
          {
            filePath: download.url,
            sourceUrl: logicalUrl,
            sourceKey: entry.content_revision,
            // The saved face part correction, so parts match the chat's.
            ...resolveRuntimeAvatarFaceParts(entry),
          },
          (progress) => {
            if (!isCancelled) {
              setLoadProgress(progress);
            }
          },
        );

        avatar.setAutomaticAnimationPlaybackEnabled(false);
        applyPoseCreatorBasePose(avatar, basePoseRef.current);
        avatar.vrm?.update(0);

        if (isCancelled || avatar.isDisposed || !avatar.scene) {
          avatar.dispose();
          return;
        }

        avatarRef.current = avatar;
        setSceneObject(avatar.scene);
        onAvatarInstanceChange?.(avatar);
        setLoadStatus("ready");
        logger.info("Load", "Pose creator avatar loaded", {
          sourceKey: entry.content_revision,
          url: redactUrlForLogging(logicalUrl),
        });
      } catch (error) {
        if (controller.signal.aborted) return;
        logger.error("Load", "Failed to load pose creator avatar", {
          sourceKey: entry.content_revision,
          url: redactUrlForLogging(logicalUrl),
          error,
        });
        if (!isCancelled) {
          setLoadStatus("error", formatLoadError(error));
          onAvatarInstanceChange?.(null);
        }
        avatar.dispose();
      } finally {
        download?.release();
      }
    };

    void loadAvatar();

    return () => {
      isCancelled = true;
      controller.abort();
      if (avatarRef.current === avatar) {
        avatarRef.current = null;
      }
      setSceneObject(null);
      onAvatarInstanceChange?.(null);
      avatar.dispose();
    };
  }, [
    camera,
    catalog,
    entry,
    logger,
    onAvatarInstanceChange,
    setLoadProgress,
    setLoadStatus,
    viewportElement,
  ]);

  useFrame((_state, delta) => {
    updatePoseCreatorAvatarFrame(avatarRef.current, delta);
  });

  useEffect(() => {
    // Full Clip mode is rendered by PreviewSync. A late actor mount must not
    // replace the loaded document's sample with the pose scratchpad.
    if (!editingPose || !sceneObject || !avatarRef.current) return;
    applyPoseCreatorDraftsToAvatar(
      avatarRef.current,
      basePose,
      boneDrafts,
      expressionDrafts,
    );
  }, [basePose, boneDrafts, editingPose, expressionDrafts, sceneObject]);

  if (!sceneObject) return null;
  return (
    <>
      <primitive object={sceneObject} dispose={null} />
      <PoseCreatorClipPlaybackTicker />
      {showHumanoidTools ? (
        <>
          <PoseCreatorBoneMarkers avatar={avatarRef.current} />
          <PoseCreatorBoneGizmo avatar={avatarRef.current} />
        </>
      ) : null}
    </>
  );
}
