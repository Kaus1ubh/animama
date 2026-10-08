"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Object3D } from "three";

import type { RuntimeCatalogEntry } from "@/lib/runtime-content/types";
import { Avatar } from "@/lib/avatar";
import { BUILT_IN_AVATAR_MOTION_CATALOG } from "@/lib/avatar/motion/AvatarMotionCatalog";
import { createLogger } from "@/lib/logger";
import { EMPTY_RUNTIME_MEDIA_PROVIDER } from "@/lib/runtime-content/AnimaRuntimeMediaCatalog";
import type { AnimaRuntimeCatalog } from "@/lib/runtime-content/AnimaRuntimeCatalog";
import { resolveRuntimeAvatarFaceParts } from "@/lib/runtime-content/runtimeAvatarFaceParts";
import {
  runtimeContentDeliveryUrl,
  runtimeContentDownloadUrl,
  type RuntimeContentUrlLease,
} from "@/lib/runtime-content/runtimeContentDelivery";
import { redactUrlForLogging } from "@/lib/utils";

export type ContentCreatorAvatarStatus = {
  state: "idle" | "loading" | "ready" | "error";
  message: string | null;
};

/**
 * Own one exact Avatar inside an existing creator Canvas. Catalog delivery,
 * cancellation, VRM normalization, and disposal remain in the shared
 * Avatar/runtime-delivery path; no code-shipped media catalog is implied.
 */
export function useContentCreatorAvatar({
  entry,
  entryKey,
  catalog,
  onAvatarChange,
  onStatusChange,
}: {
  entry: RuntimeCatalogEntry;
  entryKey: string;
  catalog?: AnimaRuntimeCatalog | null;
  onAvatarChange?: (avatar: Avatar | null) => void;
  onStatusChange?: (status: ContentCreatorAvatarStatus) => void;
}): { avatar: Avatar | null; sceneObject: Object3D | null } {
  const logger = useMemo(() => createLogger("ContentCreatorAvatar"), []);
  const { camera, gl } = useThree();
  const viewportElement = gl.domElement;
  const avatarRef = useRef<Avatar | null>(null);
  const [sceneObject, setSceneObject] = useState<Object3D | null>(null);
  // `entryKey` is the model's identity. A new entry object for the same key
  // (for example a renewed file grant) is read at the next load instead of
  // reloading the Avatar.
  const entryRef = useRef(entry);
  entryRef.current = entry;

  useEffect(() => {
    const entry = entryRef.current;
    let cancelled = false;
    const controller = new AbortController();
    const avatar = new Avatar(camera, viewportElement, {
      motionCatalog: catalog ?? BUILT_IN_AVATAR_MOTION_CATALOG,
      mediaCatalog: catalog ?? EMPTY_RUNTIME_MEDIA_PROVIDER,
    });
    avatarRef.current = avatar;
    setSceneObject(null);
    onAvatarChange?.(null);
    onStatusChange?.({ state: "loading", message: entry.display_name });

    const load = async () => {
      const logicalUrl = runtimeContentDeliveryUrl(entry);
      let download: RuntimeContentUrlLease | null = null;
      try {
        if (!logicalUrl) {
          throw new Error("The selected Avatar Model has no runtime file.");
        }
        download = await runtimeContentDownloadUrl(entry, logicalUrl, {
          signal: controller.signal,
        });
        if (!download) {
          throw new Error("The selected Avatar Model could not be authorized.");
        }
        controller.signal.throwIfAborted();
        await avatar.load(
          {
            filePath: download.url,
            sourceUrl: logicalUrl,
            sourceKey: entry.content_revision,
            // A saved face part correction applies in creator previews too.
            ...resolveRuntimeAvatarFaceParts(entry),
          },
          (progress) => {
            if (!cancelled) {
              onStatusChange?.({
                state: "loading",
                message: progress.message ?? entry.display_name,
              });
            }
          },
        );
        avatar.setAutomaticAnimationPlaybackEnabled(false);
        avatar.vrm?.update(0);
        if (cancelled || avatar.isDisposed || !avatar.scene) {
          avatar.dispose();
          return;
        }
        avatarRef.current = avatar;
        setSceneObject(avatar.scene);
        onAvatarChange?.(avatar);
        onStatusChange?.({ state: "ready", message: entry.display_name });
        logger.info("Load", "Content Creator avatar loaded", {
          sourceKey: entry.content_revision,
          url: redactUrlForLogging(logicalUrl),
        });
      } catch (error) {
        if (controller.signal.aborted) return;
        logger.error("Load", "Failed to load Content Creator avatar", {
          sourceKey: entry.content_revision,
          url: redactUrlForLogging(logicalUrl),
          error,
        });
        if (!cancelled) {
          onStatusChange?.({
            state: "error",
            message:
              error instanceof Error
                ? error.message
                : "The selected Avatar could not be rendered.",
          });
          onAvatarChange?.(null);
        }
        avatar.dispose();
      } finally {
        download?.release();
      }
    };

    void load();
    return () => {
      cancelled = true;
      controller.abort();
      if (avatarRef.current === avatar) avatarRef.current = null;
      setSceneObject(null);
      onAvatarChange?.(null);
      avatar.dispose();
    };
  }, [
    camera,
    catalog,
    entryKey,
    logger,
    onAvatarChange,
    onStatusChange,
    viewportElement,
  ]);

  useFrame((_, delta) => {
    avatarRef.current?.vrm?.update(delta);
  });

  return { avatar: avatarRef.current, sceneObject };
}
