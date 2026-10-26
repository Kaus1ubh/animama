"use client";

import { useEffect, useMemo, useState } from "react";
import { PerspectiveCamera } from "three";

import { Avatar } from "@/lib/avatar";
import {
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
} from "@/lib/runtime-content/runtimeAvatarFaceParts";
import {
  preparedRuntimeResourceUrls,
  runtimeContentDeliveryUrl,
  runtimeContentDownloadUrl,
  type RuntimeContentUrlLease,
} from "@/lib/runtime-content/runtimeContentDelivery";
import { adaptRuntimeSnapshot } from "@/lib/runtime-content/runtimeSnapshotAdapter";
import { useAnimaLoadout } from "@/query/hooks/useAnimaLoadout";
import { useAnimaRuntimeCatalog } from "@/query/hooks/useAnimaRuntimeCatalog";
import {
  useAvatarLoadSettings,
  useAvatarSettings,
} from "@/query/hooks/useAvatarSettings";
import { useAvatarLipSyncBridgeStore } from "@/stores/avatar-lipsync-bridge-store";

const logger = createLogger("AvatarDiagnostics");

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
      /** True when the facts come from the Avatar on the chat canvas. */
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
 * Diagnostics for an Anima's Avatar while `enabled`. It reads the Avatar on
 * the chat canvas when that Anima is there, else loads the Avatar off screen
 * (with its saved face part correction) and disposes it when disabled. File
 * facts come from the file's bytes, so a file that does not load is still
 * described.
 */
export function useAvatarDiagnostics(
  animaId: string,
  enabled: boolean,
): AvatarDiagnosticsView {
  const runtime = useAnimaRuntimeCatalog(enabled ? animaId : null);
  const loadout = useAnimaLoadout(enabled ? animaId : null);
  const liveAvatar = useAvatarLipSyncBridgeStore((state) =>
    state.avatarAnimaId === animaId ? state.avatar : null,
  );
  const entry = useMemo(
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
  const avatarSource = loadout.data?.avatar_source ?? null;
  const identity = useMemo<AvatarDiagnosticsIdentity>(
    () => ({
      source: avatarSource?.source ?? null,
      itemId: avatarSource?.catalog_item_id ?? null,
    }),
    [avatarSource?.source, avatarSource?.catalog_item_id],
  );
  const storedSettings = useAvatarSettings(identity.itemId).data;
  const settings = useMemo<AvatarDiagnosticsSettings>(
    () =>
      storedSettings
        ? {
            springMode: storedSettings.spring_mode,
            springModeSource: storedSettings.spring_mode_source,
            materialMode: storedSettings.material_mode,
            materialModeSource: storedSettings.material_mode_source,
          }
        : null,
    [storedSettings],
  );
  // An off-screen Avatar loads with its settings, as the chat would.
  const { springModeRef, materialMode } = useAvatarLoadSettings(
    runtimeAvatarItemId(entry),
  );
  const [collected, setCollected] = useState<Collected>({ status: "loading" });

  const runtimeSettled = !runtime.isPending;
  useEffect(() => {
    if (!enabled) return;
    if (!materialMode) {
      setCollected({ status: "loading" });
      return;
    }
    if (!entry) {
      setCollected(
        runtimeSettled ? { status: "unavailable" } : { status: "loading" },
      );
      return;
    }
    setCollected({ status: "loading" });
    const controller = new AbortController();
    const { signal } = controller;
    let lease: RuntimeContentUrlLease | null = null;
    let offscreen: Avatar | null = null;
    let unsubscribe: (() => void) | null = null;

    const collect = async () => {
      const issues: AvatarIssue[] = runtimeAvatarFacePartIssues(entry);
      let file: AvatarFileFacts | null = null;
      try {
        lease = await runtimeContentDownloadUrl(entry, undefined, { signal });
        if (!lease) throw new Error("avatar_model_download_unavailable");
        const response = await fetch(lease.url, { signal });
        if (!response.ok) throw new Error("avatar_model_fetch_failed");
        file = readAvatarFileFacts(await response.arrayBuffer());
        if (!file) issues.push({ code: "file_unreadable" });
      } catch (error) {
        if (signal.aborted) return;
        logger.warn("Load", "Diagnostics could not read the Avatar file", {
          reason: "avatar_diagnostics_file_unavailable",
          error,
        });
        issues.push({ code: "file_unavailable" });
      }

      let avatar: Avatar | null = liveAvatar?.vrm ? liveAvatar : null;
      if (!avatar && lease) {
        offscreen = new Avatar(new PerspectiveCamera());
        try {
          const sourceUrl = runtimeContentDeliveryUrl(entry);
          await offscreen.load({
            filePath: lease.url,
            sourceUrl,
            sourceKey: sourceUrl,
            resourceUrls: preparedRuntimeResourceUrls(entry),
            ...resolveRuntimeAvatarFaceParts(entry),
            springMode: springModeRef.current,
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
  }, [enabled, entry, liveAvatar, materialMode, runtimeSettled, springModeRef]);

  // The identity arrives with the loadout; it never reloads the Avatar.
  const state = useMemo<AvatarDiagnosticsState>(() => {
    if (collected.status !== "ready") return collected;
    const live = collected.avatar?.getDiagnostics() ?? null;
    // The chat stage is reloading its Avatar; the store re-registers it.
    if (collected.avatar && !live) return { status: "loading" };
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
  }, [collected, identity, effectReferences, settings]);
  return { state: enabled ? state : { status: "loading" }, effectNames };
}
