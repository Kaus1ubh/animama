import { describe, expect, it } from "vitest";

import type {
  RuntimeResourceKind,
  RuntimeCatalogEntry,
  RuntimeContentSlot,
} from "@/lib/runtime-content/types";
import {
  contentPreviewAvatarKey,
  buildLibraryPreviewRuntime,
  resolveLibraryPreviewAnimaContextState,
  selectLibraryPreviewAnima,
  withLibraryPreviewAnimaContext,
} from "./targets";
import {
  contentPreviewRequiresAnimaContext,
  isContentPreviewKind,
  isPhaseTwoContentPreviewKind,
  libraryContentPreviewSlot,
  type ContentPreviewKind,
  type ContentPreviewTarget,
} from "./types";

function entry(
  kind: RuntimeResourceKind,
  slot: RuntimeContentSlot,
  runtimeId: string,
): RuntimeCatalogEntry {
  return {
    slot,
    runtime_id: runtimeId,
    kind,
    display_name: runtimeId,
    description: null,
    config_schema_version: 1,
    config: {},
    content_revision: `typed:${kind}:${runtimeId}:1`,
    source: { type: "public_url", url: `/fixtures/${runtimeId}` },
  };
}

function target(
  kind: ContentPreviewKind,
  slot: RuntimeContentSlot,
  runtimeId: string,
): ContentPreviewTarget {
  const resolved = entry(kind, slot, runtimeId);
  return {
    key: resolved.content_revision,
    sourceType: "resolved_entry",
    entry: resolved,
    kind,
    displayName: resolved.display_name,
    versionLabel: "Exact typed release",
    slot,
    runtimeId,
    configSchemaVersion: 1,
    config: {},
  };
}

describe("typed content preview targets", () => {
  it("selects the remembered owned Anima with a deterministic fallback", () => {
    const animas = ["anima-a", "anima-b"].map((id) => ({
      id,
      display_name: id,
      aggregate_revision: 1,
      identity_status: "ready" as const,
      presentation: {
        anima_id: id,
        presentation_revision: `presentation:${id}`,
        display_name: id,
      },
    }));

    expect(selectLibraryPreviewAnima(animas, "anima-b")?.id).toBe("anima-b");
    expect(selectLibraryPreviewAnima(animas, "deleted")?.id).toBe("anima-a");
    expect(selectLibraryPreviewAnima([], "anima-b")).toBeNull();
  });

  it("waits for exact Anima context and blocks unavailable fallbacks", () => {
    const selected = target("animation", "gesture", "wave");
    const anima = {
      id: "anima-a",
      display_name: "Anima A",
      aggregate_revision: 1,
      identity_status: "ready" as const,
      presentation: {
        anima_id: "anima-a",
        presentation_revision: "presentation:anima-a",
        display_name: "Anima A",
      },
    };
    const state = (
      overrides: Partial<
        Parameters<typeof resolveLibraryPreviewAnimaContextState>[0]
      > = {},
    ) =>
      resolveLibraryPreviewAnimaContextState({
        target: selected,
        active: true,
        settingsLoading: false,
        animasPending: false,
        animasError: false,
        previewAnima: anima,
        runtimePending: false,
        runtimeError: false,
        runtimeAvailable: true,
        ...overrides,
      });

    expect(state()).toBe("ready");
    expect(state({ settingsLoading: true })).toBe("loading");
    expect(state({ previewAnima: null })).toBe("anima_required");
    expect(state({ animasError: true })).toBe("animas_unavailable");
    expect(state({ runtimeError: true, runtimeAvailable: false })).toBe(
      "runtime_unavailable",
    );
    expect(
      state({
        target: target("avatar_model", "primary_model", "avatar-one"),
        previewAnima: null,
        runtimeAvailable: false,
      }),
    ).toBe("not_required");
  });

  it("adds immutable Anima context without mutating the target", () => {
    const selected = target("animation", "gesture", "wave");
    const runtime = buildLibraryPreviewRuntime(selected, selected.entry);
    const contextual = withLibraryPreviewAnimaContext(
      selected,
      "anima-a",
      runtime,
    );

    expect(contextual).not.toBe(selected);
    expect(selected.animaContext).toBeUndefined();
    expect(contextual.key).toContain(
      `anima:anima-a:${runtime.effective_revision}`,
    );
    expect(contextual.animaContext).toEqual({ animaId: "anima-a", runtime });
  });

  it("retains supported player kinds and deterministic slots", () => {
    expect(isPhaseTwoContentPreviewKind("avatar_model")).toBe(true);
    expect(isPhaseTwoContentPreviewKind("animation")).toBe(true);
    expect(isPhaseTwoContentPreviewKind("anima_pose_clip")).toBe(true);
    expect(isContentPreviewKind("particle_vfx")).toBe(true);
    expect(isContentPreviewKind("avatar_vfx")).toBe(true);
    expect(isContentPreviewKind("scene_vfx")).toBe(true);
    expect(isContentPreviewKind("audio")).toBe(false);
    expect(libraryContentPreviewSlot("avatar_model")).toBe("primary_model");
    expect(libraryContentPreviewSlot("animation", "idle_animation")).toBe(
      "idle_animation",
    );
    expect(libraryContentPreviewSlot("anima_pose_clip", "reaction")).toBe(
      "reaction",
    );
    expect(libraryContentPreviewSlot("scene_vfx", "focus")).toBe(
      "scene_focus_vfx",
    );
    expect(
      contentPreviewRequiresAnimaContext(
        target("anima_pose_clip", "gesture", "wave"),
      ),
    ).toBe(true);
    expect(
      contentPreviewRequiresAnimaContext(
        target("particle_vfx", "particle_vfx", "spark"),
      ),
    ).toBe(true);
    expect(
      contentPreviewRequiresAnimaContext(
        target("avatar_model", "primary_model", "avatar-one"),
      ),
    ).toBe(false);
  });

  it("keeps the neutral Avatar stable while exact motion targets change", () => {
    const animation = target("animation", "gesture", "wave");
    const pose = target("anima_pose_clip", "pose", "pose-one");
    const animationRuntime = buildLibraryPreviewRuntime(
      animation,
      animation.entry,
    );
    const poseRuntime = buildLibraryPreviewRuntime(pose, pose.entry);

    expect(contentPreviewAvatarKey(animationRuntime)).toBe(
      contentPreviewAvatarKey(poseRuntime),
    );
    expect(animationRuntime.gestures).toEqual([animation.entry]);
    expect(poseRuntime.poses).toEqual([pose.entry]);
  });

  it("uses an exact Avatar target as the preview model", () => {
    const avatar = target("avatar_model", "primary_model", "avatar-one");
    const runtime = buildLibraryPreviewRuntime(avatar, avatar.entry);
    expect(runtime.avatar_model).toBe(avatar.entry);
  });
});
