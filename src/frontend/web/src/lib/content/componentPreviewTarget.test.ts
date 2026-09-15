import { describe, expect, it } from "vitest";

import type { PyContentPreview } from "@/lib/content/catalogTypes";
import { componentPreviewTarget } from "./componentPreviewTarget";
import { buildContentPreviewRuntime } from "@/lib/content-preview/targets";

describe("componentPreviewTarget", () => {
  it("maps private Particle texture references to authorized preview files", () => {
    const preview: PyContentPreview = {
      preview_id: "preview-particle",
      revision: "particle-revision",
      revision_sha256: "particle-revision",
      expires_at: "2026-08-11T00:05:00Z",
      files: [
        {
          file_ref: "manifest-ref",
          role: "manifest",
          ordinal: 1,
          filename: "effect.json",
          media_type: "application/json",
          size_bytes: 10,
          sha256: "a".repeat(64),
          url: "/v1/content/previews/preview-particle/manifest-ref",
        },
        {
          file_ref: "texture-ref",
          role: "texture",
          ordinal: 1,
          filename: "spark.png",
          media_type: "image/png",
          size_bytes: 10,
          sha256: "b".repeat(64),
          url: "/v1/content/previews/preview-particle/texture-ref",
        },
      ],
      metadata: {
        content_type: "particle_effect",
        content_id: "builtin:particle-effect:hearts",
        spec: { defaults: {} },
        runtime_defaults: {
          slots: {
            particle_vfx: { anchor: "head", duration_seconds: 1.5 },
          },
        },
        logical_resource_files: {
          "textures/spark.png": { role: "texture", ordinal: 1 },
        },
      },
    };
    const target = componentPreviewTarget(preview, "particle_effect", "Spark");
    expect(target.sourceType).toBe("resolved_entry");
    if (target.sourceType !== "resolved_entry") throw new Error("fixture");
    expect(target.runtimeId).toBe("hearts");
    expect(target.entry.runtime_id).toBe("hearts");
    expect(target.entry.source).toMatchObject({
      type: "authorized_files",
      logical_resource_urls: {
        "textures/spark.png": expect.stringContaining("texture-ref"),
      },
    });
    expect(target.entry.config).toMatchObject({
      anchor: "head",
      duration_seconds: 1.5,
    });
  });

  it("keeps Scene Effect control files out of browser runtime resources", () => {
    const preview: PyContentPreview = {
      preview_id: "preview-focus-lines",
      revision: "focus-revision",
      revision_sha256: "focus-revision",
      expires_at: "2026-08-11T00:05:00Z",
      files: [
        {
          file_ref: "focus-descriptor-ref",
          role: "descriptor",
          ordinal: 1,
          filename: "dark.json",
          media_type: "application/json",
          size_bytes: 10,
          sha256: "c".repeat(64),
          url: "/v1/content/previews/focus/focus-descriptor-ref",
        },
      ],
      metadata: {
        content_type: "scene_effect",
        runtime_id: "focus-lines-dark",
        definition: {
          schema: "animama/scene-effect/1",
          kind: "focus_lines",
        },
      },
    };
    const target = componentPreviewTarget(
      preview,
      "scene_effect",
      "Focus Lines Dark",
    );
    expect(target.sourceType).toBe("resolved_entry");
    if (target.sourceType !== "resolved_entry") throw new Error("fixture");
    expect(target.runtimeId).toBe("focus-lines-dark");
    expect(target.entry.source).toMatchObject({
      type: "authorized_files",
      files: [],
    });
    expect(target.entry.definition).toMatchObject({ kind: "focus_lines" });
  });

  it("mounts a private Avatar definition and its exact preview Sound", () => {
    const preview: PyContentPreview = {
      preview_id: "preview-avatar",
      revision: "avatar-revision",
      revision_sha256: "avatar-revision",
      expires_at: "2026-08-11T00:05:00Z",
      files: [
        {
          file_ref: "image-ref",
          role: "image",
          ordinal: 1,
          filename: "star.webp",
          media_type: "image/webp",
          size_bytes: 3,
          sha256: "a".repeat(64),
          url: "/v1/content/previews/preview-avatar/image-ref",
        },
        {
          file_ref: "audio-ref",
          role: "audio",
          ordinal: 1,
          filename: "cue.mp3",
          media_type: "audio/mpeg",
          size_bytes: 4,
          sha256: "b".repeat(64),
          url: "/v1/content/previews/preview-avatar/audio-ref",
        },
      ],
      metadata: {
        content_type: "avatar_effect",
        spec: { definition: { kind: "hover" } },
        definition: { kind: "hover", image: "star.webp", soundAlias: "cue" },
        reference_map: { cue: "opaque-sound" },
        logical_resource_files: {
          "star.webp": { role: "image", ordinal: 1 },
        },
        supports: [
          {
            runtime_id: "opaque-sound",
            content_type: "sound_effect",
            name: "Cue",
            config: { volume: 0.5 },
            files: [{ file_ref: "audio-ref", role: "audio", ordinal: 1 }],
          },
        ],
      },
    };
    const target = componentPreviewTarget(preview, "avatar_effect", "Eye Star");
    if (target.sourceType !== "resolved_entry") throw new Error("fixture");
    expect(target.entry.definition).toMatchObject({ image: "star.webp" });
    expect(target.entry.config.runtime_reference_map).toEqual({
      cue: "opaque-sound",
    });
    expect(target.entry.source).toMatchObject({
      type: "authorized_files",
      files: [{ role: "image", filename: "star.webp" }],
    });
    expect(target.supportEntries).toHaveLength(1);
    const runtime = buildContentPreviewRuntime(target, target.entry);
    expect(runtime.sfx[0]).toMatchObject({
      runtime_id: "opaque-sound",
      source: { type: "authorized_files" },
    });
  });
});
