import { describe, expect, it } from "vitest";

import type { PyTypedContentPreview } from "@animama/runtime-contracts/api-types";
import { actionPreviewTarget } from "@/lib/content-preview/actionPreviewTarget";
import {
  typedActionPreview,
  typedComponentPreviewMetadata,
} from "./typedPreviewAdapters";

describe("typed preview adapters", () => {
  it("keeps dependency file paths executable when preview ordinals are closure-wide", () => {
    const digest = "a".repeat(64);
    const preview = {
      preview_id: "preview-reaction",
      revision_sha256: digest,
      expires_at: "2026-08-23T12:00:00Z",
      item: {
        kind: "reaction",
        item_id: "reaction-item",
        source: "included",
        logical_key: "builtin:reaction:admiration-3",
        name: "Admiration Reaction 3",
        description: null,
        revision_sha256: digest,
        editable: false,
        emotion: "admiration",
        intensity: 3,
        implementation: { kind: "anima_clip", file_role: "sequence" },
        config: {},
        dependencies: [
          {
            ref: "builtin:particle-effect:hearts",
            kind: "particle_effect",
            alias: "hearts",
            config: {},
          },
        ],
        files: [
          {
            file_ref: "sequence-ref",
            logical_path: "admiration-3.json",
            role: "sequence",
            ordinal: 2,
            filename: "admiration-3.json",
            media_type: "application/json",
            size_bytes: 100,
            sha256: digest,
          },
        ],
      },
      supports: [
        {
          kind: "particle_effect",
          item_id: "particle-item",
          source: "included",
          logical_key: "builtin:particle-effect:hearts",
          name: "Hearts",
          description: null,
          revision_sha256: digest,
          editable: false,
          dependencies: [],
          runtime_defaults: {
            slots: {
              particle_vfx: {
                anchor: "head",
                duration_seconds: 1.8,
                transform: { offset: { x: 0, y: 0.36, z: 0 } },
              },
            },
          },
          definition: null,
          files: [
            {
              file_ref: "manifest-ref",
              logical_path: "particle.json",
              role: "manifest",
              ordinal: 2,
              filename: "particle.json",
              media_type: "application/json",
              size_bytes: 100,
              sha256: digest,
            },
            {
              file_ref: "texture-ref",
              logical_path: "textures/heart.png",
              role: "texture",
              ordinal: 3,
              filename: "heart.png",
              media_type: "image/png",
              size_bytes: 50,
              sha256: digest,
            },
          ],
        },
      ],
      files: [
        {
          file_ref: "sequence-ref",
          logical_path: "admiration-3.json",
          role: "sequence",
          ordinal: 1,
          filename: "admiration-3.json",
          media_type: "application/json",
          size_bytes: 100,
          sha256: digest,
          url: "/v1/content/previews/preview-reaction/files/sequence-ref",
        },
        {
          file_ref: "manifest-ref",
          logical_path: "particle.json",
          role: "manifest",
          ordinal: 7,
          filename: "particle.json",
          media_type: "application/json",
          size_bytes: 100,
          sha256: digest,
          url: "/v1/content/previews/preview-reaction/files/manifest-ref",
        },
        {
          file_ref: "texture-ref",
          logical_path: "textures/heart.png",
          role: "texture",
          ordinal: 8,
          filename: "heart.png",
          media_type: "image/png",
          size_bytes: 50,
          sha256: digest,
          url: "/v1/content/previews/preview-reaction/files/texture-ref",
        },
      ],
    } as PyTypedContentPreview;

    const adapted = typedActionPreview(preview);
    expect(adapted.closure).toMatchObject({
      supports: [
        {
          config: {
            anchor: "head",
            duration_seconds: 1.8,
            transform: { offset: { x: 0, y: 0.36, z: 0 } },
          },
          logical_resource_files: {
            "textures/heart.png": { file_ref: "texture-ref" },
          },
        },
      ],
    });
    const target = actionPreviewTarget(adapted, "Admiration Reaction 3");
    if (target.sourceType !== "resolved_action") throw new Error("fixture");
    expect(target.runtimeId).toBe("admiration-3");

    expect(target.runtime.particle_vfx[0]?.source).toMatchObject({
      type: "authorized_files",
      logical_resource_urls: {
        "textures/heart.png": expect.stringContaining("texture-ref"),
      },
    });
    expect(target.runtime.particle_vfx[0]?.config).toMatchObject({
      anchor: "head",
      duration_seconds: 1.8,
      transform: { offset: { x: 0, y: 0.36, z: 0 } },
    });
    expect(target.runtime.particle_vfx[0]?.config).not.toHaveProperty("slots");

    const localTransport = structuredClone(preview);
    if (localTransport.item.kind !== "reaction") throw new Error("fixture");
    localTransport.item.source = "local";
    localTransport.item.logical_key = "local:reaction:react-0827123456";
    localTransport.item.name = "react-0827123456";
    localTransport.item.emotion = "joy";
    localTransport.item.intensity = 1;
    const localTarget = actionPreviewTarget(
      typedActionPreview(localTransport),
      "react-0827123456",
    );
    expect(localTarget.runtimeId).toBe("react-0827123456");
  });

  it("projects transitive Sound support for component and creator previews", () => {
    const digest = "b".repeat(64);
    const preview = {
      preview_id: "preview-avatar-effect",
      revision_sha256: digest,
      expires_at: "2026-08-23T12:00:00Z",
      item: {
        kind: "avatar_effect",
        item_id: "avatar-effect-item",
        source: "included",
        logical_key: "builtin:avatar-effect:star3",
        name: "Star3",
        description: null,
        revision_sha256: digest,
        editable: false,
        dependencies: [
          {
            ref: "builtin:sound-effect:bright-idea",
            kind: "sound_effect",
            alias: "Bright_Idea",
            config: {},
          },
        ],
        runtime_defaults: {},
        technical_source: null,
        definition: {
          schema: "animama/avatar-effect/2",
          region: "eyes",
          attachment: {
            kind: "face_surface",
            part: "eye_iris",
            area: "eyes",
            layout: "single",
          },
          art: { image: "star3.png" },
          soundAlias: "Bright_Idea",
        },
        files: [
          {
            file_ref: "image-ref",
            logical_path: "star3.png",
            role: "image",
            ordinal: 2,
            filename: "star3.png",
            media_type: "image/png",
            size_bytes: 50,
            sha256: digest,
          },
        ],
      },
      supports: [
        {
          kind: "sound_effect",
          item_id: "sound-item",
          source: "included",
          logical_key: "builtin:sound-effect:bright-idea",
          name: "Bright Idea",
          description: null,
          revision_sha256: digest,
          editable: false,
          dependencies: [],
          duration_seconds: 1,
          codec: "audio/mpeg",
          defaults: { volume: 0.5 },
          portability: "non-portable",
          files: [
            {
              file_ref: "audio-ref",
              logical_path: "bright-idea.mp3",
              role: "audio",
              ordinal: 2,
              filename: "bright-idea.mp3",
              media_type: "audio/mpeg",
              size_bytes: 60,
              sha256: digest,
            },
          ],
        },
      ],
      files: [
        {
          file_ref: "image-ref",
          logical_path: "star3.png",
          role: "image",
          ordinal: 1,
          filename: "star3.png",
          media_type: "image/png",
          size_bytes: 50,
          sha256: digest,
          url: "/v1/content/previews/preview-avatar-effect/files/image-ref",
        },
        {
          file_ref: "audio-ref",
          logical_path: "bright-idea.mp3",
          role: "audio",
          ordinal: 2,
          filename: "bright-idea.mp3",
          media_type: "audio/mpeg",
          size_bytes: 60,
          sha256: digest,
          url: "/v1/content/previews/preview-avatar-effect/files/audio-ref",
        },
      ],
    } as PyTypedContentPreview;

    expect(typedComponentPreviewMetadata(preview)).toMatchObject({
      dependencies: [
        {
          alias: "Bright_Idea",
          content_type: "sound_effect",
          source: {
            type: "catalog",
            catalog_item_id: "sound-item",
          },
          portability: "non-portable",
        },
      ],
      reference_map: { Bright_Idea: "bright-idea" },
      supports: [
        {
          runtime_id: "bright-idea",
          content_type: "sound_effect",
          portability: "non-portable",
          files: [{ file_ref: "audio-ref" }],
        },
      ],
    });
  });
});
