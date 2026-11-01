"use client";

import { useProductApiClient } from "@animama/product-ui";
import { useEffect, useMemo, useState } from "react";
import { PerspectiveCamera } from "three";

import { Avatar } from "@/lib/avatar";
import { avatarItemRuntimeEntry } from "@/lib/content/avatarPreviewTarget";
import {
  avatarFileIssues,
  readAvatarFileFacts,
  type AvatarFileFacts,
} from "@/lib/avatar/diagnostics/avatarFileFacts";
import {
  buildAvatarDiagnosticsReport,
  type AvatarDiagnosticsIdentity,
  type AvatarDiagnosticsReport,
  type AvatarDiagnosticsSettings,
} from "@/lib/avatar/diagnostics/avatarDiagnosticsReport";
import {
  mergeAvatarIssues,
  type AvatarIssue,
} from "@/lib/avatar/diagnostics/issues";
import { createLogger } from "@/lib/logger";
import {
  resolveRuntimeAvatarFaceParts,
  runtimeAvatarFacePartIssues,
  runtimeAvatarItemId,
  runtimeAvatarModelSha256,
} from "@/lib/runtime-content/runtimeAvatarFaceParts";
import {
  preparedRuntimeResourceUrls,
  runtimeContentDeliveryUrl,
  runtimeContentDownloadUrl,
  type RuntimeContentUrlLease,
} from "@/lib/runtime-content/runtimeContentDelivery";
import { adaptRuntimeSnapshot } from "@/lib/runtime-content/runtimeSnapshotAdapter";
import type { RuntimeCatalogEntry } from "@/lib/runtime-content/types";
import { useAnimaLoadout } from "@/query/hooks/useAnimaLoadout";
import { useAnimaRuntimeCatalog } from "@/query/hooks/useAnimaRuntimeCatalog";
import {
  useAvatarLoadSettings,
  useAvatarSettings,
} from "@/query/hooks/useAvatarSettings";
import { useAvatarLipSyncBridgeStore } from "@/stores/avatar-lipsync-bridge-store";
import { usePreviewDockAvatarStore } from "@/stores/preview-dock-avatar-store";

const logger = createLogger("AvatarDiagnostics");

/** Whose Avatar Diagnostics describes. */
export type AvatarDiagnosticsSource =
  /**
   * An Anima's Avatar: the one on the chat canvas when that Anima is there,
   * else an off-screen load. Only an Anima has effect warnings, since they
   * depend on its Gestures and Reactions.
   */
  | { kind: "anima"; animaId: string }
  /**
   * An Avatar item: the preview dock's Avatar when the dock shows that item,
   * else an off-screen load.
   */
  | { kind: "avatar"; itemId: string; source: "included" | "local" }
  /**
   * A file chosen in Create Anima and not saved yet: file facts from the
   * file, live facts from the stage's Avatar once it has loaded (`avatar`),
   * or the load error when the stage could not load it (`failed`).
   */
  | {
      kind: "upload";
      file: File;
      avatar: Avatar | null;
      stage: "loading" | "ready" | "failed";
    };

export type AvatarDiagnosticsState =
  | { status: "loading" }
  /** The Anima has no Avatar to describe. */
  | { status: "unavailable" }
  | {
      status: "ready";
      /** The shareable report: effects named by reference, not runtime id. */
      report: AvatarDiagnosticsReport;
      /** The same findings with runtime effect ids, for wording on screen. */
      issues: readonly AvatarIssue[];
      /** True when the facts come from an Avatar already on screen. */
      live: boolean;
    };

/** What the load effect gathered; the report is built from it at render. */
type Collected =
  | { status: "loading" }
  | { status: "unavailable" }
  | {
      status: "ready";
      file: AvatarFileFacts | null;
      issues: readonly AvatarIssue[];
      avatar: Avatar | null;
      live: boolean;
    };

export type AvatarDiagnosticsView = {
  state: AvatarDiagnosticsState;
  /** Avatar Effect names by runtime id, for wording warnings on screen only. */
  effectNames: ReadonlyMap<string, string>;
};

/**
 * Diagnostics for an Avatar while `enabled`, from one of three sources (see
 * `AvatarDiagnosticsSource`). An Avatar loaded off screen (with its saved
 * face part correction and settings) is disposed when disabled. File facts
 * come from the file's bytes, so a file that does not load is still described.
 */
export function useAvatarDiagnostics(
  source: AvatarDiagnosticsSource,
  enabled: boolean,
): AvatarDiagnosticsView {
  const apiClient = useProductApiClient();
  const isAnima = source.kind === "anima";
  const animaId = isAnima ? source.animaId : null;
  const avatarItemId = source.kind === "avatar" ? source.itemId : null;
  const upload = source.kind === "upload" ? source : null;
  const runtime = useAnimaRuntimeCatalog(enabled ? animaId : null);
  const loadout = useAnimaLoadout(enabled ? animaId : null);
  const animaAvatar = useAvatarLipSyncBridgeStore((state) =>
    animaId && state.avatarAnimaId === animaId ? state.avatar : null,
  );
  const dockAvatar = usePreviewDockAvatarStore((state) =>
    avatarItemId && state.itemId === avatarItemId ? state.avatar : null,
  );
  const liveAvatar = upload ? upload.avatar : (animaAvatar ?? dockAvatar);
  const animaEntry = useMemo(
    () =>
      runtime.data ? adaptRuntimeSnapshot(runtime.data).avatar_model : null,
    [runtime.data],
  );
  const { effectNames, effectReferences } = useMemo(() => {
    const effects = runtime.data?.avatar_effects ?? [];
    return {
      effectNames: new Map(effects.map((e) => [e.runtime_id, e.name])),
      // A Local effect's runtime id is a slug of its name; reports use this.
      effectReferences: new Map(
        effects.map((e) => [
          e.runtime_id,
          `${e.source.source}:${e.source.item_id}`,
        ]),
      ),
    };
  }, [runtime.data]);
  const animaSource = loadout.data?.avatar_source ?? null;
  const itemSource = source.kind === "avatar" ? source.source : null;
  const isUpload = upload !== null;
  const identity = useMemo<AvatarDiagnosticsIdentity>(() => {
    if (isUpload) return { source: "upload", itemId: null };
    if (avatarItemId) return { source: itemSource, itemId: avatarItemId };
    return {
      source: animaSource?.source ?? null,
      itemId: animaSource?.catalog_item_id ?? null,
    };
  }, [
    isUpload,
    avatarItemId,
    itemSource,
    animaSource?.source,
    animaSource?.catalog_item_id,
  ]);
  const storedSettings = useAvatarSettings(identity.itemId).data;
  const settings = useMemo<AvatarDiagnosticsSettings>(
    () =>
      storedSettings
        ? {
            springMode: storedSettings.spring_mode,
            springModeSource: storedSettings.spring_mode_source,
            windStrength: storedSettings.wind_strength,
            windStrengthSource: storedSettings.wind_strength_source,
            materialMode: storedSettings.material_mode,
            materialModeSource: storedSettings.material_mode_source,
          }
        : null,
    [storedSettings],
  );
  // An off-screen Avatar loads with its settings, as the chat would; an
  // unsaved upload has none (Automatic).
  const { springModeRef, windStrengthRef, materialMode } =
    useAvatarLoadSettings(avatarItemId ?? runtimeAvatarItemId(animaEntry));
  const [collected, setCollected] = useState<Collected>({ status: "loading" });

  const runtimeSettled = !runtime.isPending;
  const uploadFile = upload?.file ?? null;
  const uploadStage = upload?.stage ?? null;
  useEffect(() => {
    if (!enabled) return;
    setCollected({ status: "loading" });
    if (uploadFile) {
      if (uploadStage === "loading") return;
      return collectUpload(uploadFile, liveAvatar, setCollected);
    }
    if (!materialMode) return;
    if (!avatarItemId && !animaEntry) {
      if (runtimeSettled) setCollected({ status: "unavailable" });
      return;
    }
    const controller = new AbortController();
    const { signal } = controller;
    let lease: RuntimeContentUrlLease | null = null;
    let offscreen: Avatar | null = null;
    let unsubscribe: (() => void) | null = null;

    const collect = async () => {
      const issues: AvatarIssue[] = [];
      let file: AvatarFileFacts | null = null;
      let entry = animaEntry;
      try {
        entry ??= await avatarItemRuntimeEntry(
          apiClient,
          avatarItemId!,
          signal,
        );
        issues.push(...runtimeAvatarFacePartIssues(entry));
        lease = await runtimeContentDownloadUrl(entry, undefined, { signal });
        if (!lease) throw new Error("avatar_model_download_unavailable");
        const response = await fetch(lease.url, { signal });
        if (!response.ok) throw new Error("avatar_model_fetch_failed");
        file = readAvatarFileFacts(await response.arrayBuffer());
        issues.push(...avatarFileIssues(file));
      } catch (error) {
        if (signal.aborted) return;
        logger.warn("Load", "Diagnostics could not read the Avatar file", {
          reason: "avatar_diagnostics_file_unavailable",
          error,
        });
        issues.push({ code: "file_unavailable" });
      }

      // The dock may still show an older revision of the item.
      let avatar: Avatar | null =
        liveAvatar?.vrm &&
        (animaEntry || liveAvatar.vrmSha256 === runtimeAvatarModelSha256(entry))
          ? liveAvatar
          : null;
      if (!avatar && lease && entry) {
        offscreen = new Avatar(new PerspectiveCamera());
        try {
          await loadOffscreen(offscreen, entry, lease, {
            springMode: springModeRef.current,
            windStrength: windStrengthRef.current,
            materialMode,
          });
          avatar = offscreen;
        } catch (error) {
          if (signal.aborted) return;
          logger.warn("Load", "Diagnostics could not load the Avatar", {
            reason: "avatar_diagnostics_load_failed",
            error,
          });
          issues.push({ code: "avatar_load_failed" });
        }
      }
      if (signal.aborted) return;
      // The bytes have been read (and parsed); a Local file's blob can go.
      (lease as RuntimeContentUrlLease | null)?.release();

      // A new object each time, so the report is rebuilt from the Avatar.
      const publish = () =>
        setCollected({
          status: "ready",
          file,
          issues,
          avatar,
          live: avatar !== null && avatar === liveAvatar,
        });
      publish();
      unsubscribe = avatar?.subscribeDiagnostics(publish) ?? null;
    };
    void collect();

    return () => {
      controller.abort();
      unsubscribe?.();
      (offscreen as Avatar | null)?.dispose();
      (lease as RuntimeContentUrlLease | null)?.release();
    };
  }, [
    animaEntry,
    apiClient,
    avatarItemId,
    enabled,
    liveAvatar,
    materialMode,
    runtimeSettled,
    springModeRef,
    windStrengthRef,
    uploadFile,
    uploadStage,
  ]);

  // The identity arrives with the loadout; it never reloads the Avatar.
  const state = useMemo<AvatarDiagnosticsState>(() => {
    if (collected.status !== "ready") return collected;
    const diagnostics = collected.avatar?.getDiagnostics() ?? null;
    // The Avatar on screen is reloading; its surface registers it again.
    if (collected.avatar && !diagnostics) return { status: "loading" };
    // Effect findings depend on an Anima's Gestures and Reactions; the dock
    // or creator stage may hold some from its own previews.
    const live =
      diagnostics && !isAnima
        ? {
            ...diagnostics,
            issues: diagnostics.issues.filter(
              (issue) => issue.params?.effectId === undefined,
            ),
          }
        : diagnostics;
    return {
      status: "ready",
      live: collected.live,
      issues: mergeAvatarIssues(collected.issues, live?.issues),
      report: buildAvatarDiagnosticsReport({
        avatar: identity,
        file: collected.file,
        live,
        settings,
        issues: collected.issues,
        effectReference: (effectId) => effectReferences.get(effectId),
      }),
    };
  }, [collected, identity, effectReferences, isAnima, settings]);
  return { state: enabled ? state : { status: "loading" }, effectNames };
}

/** Load an Avatar entry off screen as its surfaces would. */
async function loadOffscreen(
  avatar: Avatar,
  entry: RuntimeCatalogEntry,
  lease: RuntimeContentUrlLease,
  settings: Pick<
    Parameters<Avatar["load"]>[0],
    "springMode" | "windStrength" | "materialMode"
  >,
): Promise<void> {
  const sourceUrl = runtimeContentDeliveryUrl(entry);
  await avatar.load({
    filePath: lease.url,
    sourceUrl,
    sourceKey: sourceUrl,
    resourceUrls: preparedRuntimeResourceUrls(entry),
    ...resolveRuntimeAvatarFaceParts(entry),
    ...settings,
  });
}

/**
 * Collect an unsaved upload: the chosen file's facts, and the stage's Avatar
 * (never loaded or disposed here). Without one, the stage failed to load it.
 * Returns the effect's cleanup.
 */
function collectUpload(
  file: File,
  avatar: Avatar | null,
  setCollected: (collected: Collected) => void,
): () => void {
  let cancelled = false;
  let unsubscribe: (() => void) | null = null;
  void (async () => {
    const issues: AvatarIssue[] = [];
    let facts: AvatarFileFacts | null = null;
    try {
      facts = readAvatarFileFacts(await file.arrayBuffer());
      issues.push(...avatarFileIssues(facts));
    } catch (error) {
      logger.warn("Load", "Diagnostics could not read the chosen file", {
        reason: "avatar_diagnostics_file_unavailable",
        error,
      });
      issues.push({ code: "file_unavailable" });
    }
    if (cancelled) return;
    const loaded = avatar?.vrm ? avatar : null;
    if (!loaded) issues.push({ code: "avatar_load_failed" });
    const publish = () =>
      setCollected({
        status: "ready",
        file: facts,
        issues,
        avatar: loaded,
        live: loaded !== null,
      });
    publish();
    unsubscribe = loaded?.subscribeDiagnostics(publish) ?? null;
  })();
  return () => {
    cancelled = true;
    unsubscribe?.();
  };
}
