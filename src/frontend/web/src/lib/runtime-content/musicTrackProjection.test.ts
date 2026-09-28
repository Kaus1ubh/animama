import { describe, expect, it } from "vitest";

import type {
  PyAnimaRuntime,
  PyRuntimeAvatar,
} from "@/lib/content/catalogTypes";
import { AnimaRuntimeCatalog } from "./AnimaRuntimeCatalog";
import { adaptRuntimeSnapshot } from "./runtimeSnapshotAdapter";

function avatar(): PyRuntimeAvatar {
  return {
    source: {
      type: "catalog_item",
      item_id: "avatar-test",
      source: "included",
      revision: "builtin:avatar-test:1",
    },
    avatar_id: "avatar-test",
    revision: "builtin:avatar-test:1",
    files: [],
  };
}

function descriptor(): PyAnimaRuntime["content_descriptor"] {
  return {
    revision: "rcd1-test",
    total_bytes: 0,
    roots: [],
    entries: [],
    members: [],
    diagnostics: [],
  };
}

describe("retired Music Track projection", () => {
  it("ignores historical built-in and Local Music without reclassifying it as SFX", () => {
    const runtime = adaptRuntimeSnapshot({
      catalog_version: 1,
      loadout_revision: 2,
      effective_revision: "music-revision",
      lease_expires_at: "2026-08-12T00:00:00Z",
      content_descriptor: descriptor(),
      avatar: avatar(),
      gestures: [],
      reactions: [],
      idle_style: null,
      particle_effects: [],
      avatar_effects: [],
      scene_effects: [],
      sound_effects: [],
      music_tracks: [
        {
          binding_id: "builtin-binding",
          runtime_id: "builtin-binding",
          name: "Background Track 1",
          source: {
            type: "catalog_item",
            item_id: "builtin:music-track:one",
            source: "included",
            revision: "builtin:music-track:one:1",
          },
          revision: "builtin:music-track:one:1",
          duration_seconds: 90,
          codec: "mp3",
          config: { loop: true, volume: 0.8, autoplay: true },
          files: [
            {
              file_ref: "included-bgm",
              role: "audio",
              ordinal: 1,
              filename: "bgm_sample_1.mp3",
              media_type: "audio/mpeg",
              size_bytes: 100,
              sha256: "d".repeat(64),
              url: "/v1/content/files/included-bgm",
            },
          ],
        },
        {
          binding_id: "private-binding",
          runtime_id: "private-binding",
          name: "Private Track",
          source: {
            type: "catalog_item",
            item_id: "music-item",
            source: "local",
            revision: "music-release-digest",
          },
          revision: "music-release-digest",
          duration_seconds: 42,
          codec: "mp3",
          config: { loop: false, volume: 0.5, autoplay: false },
          files: [
            {
              file_ref: "rf-private",
              role: "audio",
              ordinal: 1,
              filename: "private.mp3",
              media_type: "audio/mpeg",
              size_bytes: 100,
              sha256: "e".repeat(64),
              url: "/v1/animas/a/runtime/revisions/music-revision/files/rf-private",
            },
          ],
        },
      ],
      warnings: [],
    } as unknown as PyAnimaRuntime);
    expect(runtime).not.toHaveProperty("bgm");
    const catalog = new AnimaRuntimeCatalog(runtime);
    expect(catalog.listAudio("sfx")).toEqual([]);
    expect(
      runtime.warnings.some((warning) => warning.code.includes("music")),
    ).toBe(false);
  });
});
