import { describe, expect, it } from "vitest";

import type {
  PyContentDependency,
  PyContentPreview,
} from "@/lib/content/catalogTypes";
import { AnimaRuntimeCatalog } from "@/lib/runtime-content/AnimaRuntimeCatalog";
import type { AnimaRuntimeCatalogSnapshot } from "@/lib/runtime-content/types";
import {
  actionComponentSandboxEntries,
  withActionComponentSandbox,
} from "./actionComponentSandbox";

const dependency: PyContentDependency = {
  alias: "hearts",
  content_type: "particle_effect",
  source: {
    type: "builtin",
    content_id: "builtin:particle-effect:hearts",
    version: 1,
  },
};

const preview: PyContentPreview = {
  preview_id: "builtin:particle_effect:hearts:1",
  revision: "builtin-v1",
  revision_sha256: "builtin-v1",
  expires_at: "2026-08-17T12:00:00Z",
  files: [],
  metadata: {
    content_type: "particle_effect",
    content_id: "builtin:particle-effect:hearts",
    version: 1,
    name: "Hearts",
    implementation: {
      technical_source: {
        type: "public_url",
        url: "/effects/vfx/quark/hearts.json",
      },
    },
  },
};

function runtime(): AnimaRuntimeCatalogSnapshot {
  return {
    schema_version: 1,
    effective_revision: "base",
    loadout_revision: 1,
    app_catalog_version: 1,
    avatar_model: {
      slot: "primary_model",
      runtime_id: "avatar",
      kind: "avatar_model",
      display_name: "Avatar",
      description: null,
      config_schema_version: 1,
      config: {},
      content_revision: "avatar-v1",
      source: { type: "public_url", url: "/avatar.vrm" },
    },
    idle_animations: [],
    gestures: [],
    poses: [],
    reactions: [],
    particle_vfx: [],
    avatar_vfx: [],
    scene_background_vfx: [],
    scene_focus_vfx: [],
    background_image: null,
    profile_image: null,
    sfx: [],
    bgm: [],
    warnings: [],
  };
}

describe("action component sandbox", () => {
  it("mounts the exact component under its document-local alias", () => {
    const entries = actionComponentSandboxEntries(preview, dependency);
    expect(entries[0]).toMatchObject({
      slot: "particle_vfx",
      runtime_id: "hearts",
      kind: "particle_vfx",
    });

    const mounted = withActionComponentSandbox(runtime(), entries);
    expect(mounted?.particle_vfx).toEqual([
      expect.objectContaining({ runtime_id: "hearts" }),
    ]);
    expect(mounted?.avatar_model?.runtime_id).toBe("avatar");
  });

  it("keeps transitive Avatar VFX sounds in the local catalog", () => {
    const avatarDependency: PyContentDependency = {
      alias: "eye_stars",
      content_type: "avatar_effect",
      source: {
        type: "catalog",
        catalog_item_id: "avatar-vfx-item",
        logical_key: "local:avatar-effect:eye-stars",
      },
    };
    const avatarPreview: PyContentPreview = {
      preview_id: "preview-avatar-vfx",
      revision: "avatar-vfx-v1",
      revision_sha256: "avatar-vfx-v1",
      expires_at: "2026-08-17T12:00:00Z",
      files: [
        {
          file_ref: "image-ref",
          role: "image",
          ordinal: 1,
          filename: "stars.webp",
          media_type: "image/webp",
          size_bytes: 12,
          sha256: "a".repeat(64),
          url: "/v1/content/previews/preview-avatar-vfx/image-ref",
        },
        {
          file_ref: "sound-ref",
          role: "audio",
          ordinal: 1,
          filename: "sparkle.mp3",
          media_type: "audio/mpeg",
          size_bytes: 18,
          sha256: "b".repeat(64),
          url: "/v1/content/previews/preview-avatar-vfx/sound-ref",
        },
      ],
      metadata: {
        content_type: "avatar_effect",
        definition: { kind: "hover", soundAlias: "sparkle" },
        reference_map: { sparkle: "opaque-sparkle" },
        logical_resource_files: {
          "stars.webp": { role: "image", ordinal: 1 },
        },
        supports: [
          {
            runtime_id: "opaque-sparkle",
            content_type: "sound_effect",
            name: "Sparkle",
            files: [{ file_ref: "sound-ref", role: "audio", ordinal: 1 }],
          },
        ],
      },
    };

    const entries = actionComponentSandboxEntries(
      avatarPreview,
      avatarDependency,
    );
    const mounted = withActionComponentSandbox(runtime(), entries);

    expect(mounted?.avatar_vfx[0]).toMatchObject({
      runtime_id: "eye_stars",
      config: {
        runtime_reference_map: { sparkle: "opaque-sparkle" },
      },
    });
    expect(mounted?.sfx[0]).toMatchObject({
      runtime_id: "opaque-sparkle",
      kind: "audio",
    });
  });

  it("mounts and resolves a private Scene VFX under its document alias", async () => {
    const sceneDependency: PyContentDependency = {
      alias: "lavender_sparks",
      content_type: "scene_effect",
      source: {
        type: "catalog",
        catalog_item_id: "scene-vfx-item",
        logical_key: "local:scene-effect:lavender-sparks",
      },
    };
    const scenePreview: PyContentPreview = {
      preview_id: "preview-scene-vfx",
      revision: "scene-vfx-v1",
      revision_sha256: "scene-vfx-v1",
      expires_at: "2026-08-17T12:00:00Z",
      files: [],
      metadata: {
        content_type: "scene_effect",
        item_id: "content-scene-vfx",
        definition: {
          schema: "animama/scene-effect/1",
          kind: "background_layers",
          durationMs: 1200,
          coverUiOverlays: false,
          dismissOnInput: false,
          solid: { enabled: true, color: "#c4b5fd" },
          pattern: {
            enabled: false,
            pattern: "none",
            color: "#000000",
            size: 16,
            spacing: 8,
            opacity: 0,
          },
          marquee: {
            enabled: false,
            items: [],
            itemSize: 64,
            gap: 8,
            rowGap: 8,
            direction: "left",
            itemRotationMode: "upright",
            itemRotationOffsetDeg: 0,
            speedPxPerSec: 80,
            opacity: 1,
          },
        },
      },
    };

    const entries = actionComponentSandboxEntries(
      scenePreview,
      sceneDependency,
    );
    const mounted = withActionComponentSandbox(runtime(), entries);

    expect(mounted?.scene_background_vfx[0]).toMatchObject({
      runtime_id: "lavender_sparks",
      kind: "scene_vfx",
    });

    const catalog = new AnimaRuntimeCatalog(mounted!);
    await expect(
      catalog.loadSceneVFX("background_layers", "lavender_sparks"),
    ).resolves.toMatchObject({
      id: "lavender_sparks",
      kind: "background_layers",
    });
    expect(
      catalog.listSceneVFX("background_layers").map((entry) => entry.id),
    ).toContain("lavender_sparks");
    catalog.dispose();
  });
});
