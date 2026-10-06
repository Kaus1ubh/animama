import { describe, expect, it, vi } from "vitest";

import { AVATAR_PARTICLE_VFX_CATALOG } from "@/lib/avatar/particle-vfx/catalog";
import { getSceneBackgroundLayerPresetIds } from "@/lib/scene-vfx/catalog";
import type { RuntimeCatalogEntry, RuntimeContentSlot } from "./types";
import { AnimaRuntimeMediaCatalog } from "./AnimaRuntimeMediaCatalog";

function authorizedDownload(sourceUrl: string): Response {
  void sourceUrl;
  return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 });
}

function authorizedSource(input: RequestInfo | URL): string {
  return String(input);
}

function builtInEntry(args: {
  kind: RuntimeCatalogEntry["kind"];
  slot: RuntimeContentSlot;
  runtimeId: string;
  source: RuntimeCatalogEntry["source"];
  displayName?: string;
  config?: Record<string, unknown>;
}): RuntimeCatalogEntry {
  return {
    slot: args.slot,
    runtime_id: args.runtimeId,
    kind: args.kind,
    display_name: args.displayName ?? args.runtimeId,
    description: null,
    config_schema_version: 1,
    config: args.config ?? {},
    content_revision: `builtin:${args.runtimeId}:1`,
    source: args.source,
  };
}

function privateEntry(args: {
  slot:
    | "particle_vfx"
    | "avatar_vfx"
    | "scene_background_vfx"
    | "scene_focus_vfx"
    | "sfx";
  runtimeId: string;
  kind: "particle_vfx" | "avatar_vfx" | "scene_vfx" | "audio";
  files: Array<{
    role: string;
    ordinal: number;
    filename: string;
    contentType: string;
    bytes: number;
    url: string;
  }>;
  logicalResourceUrls?: Record<string, string>;
  config?: Record<string, unknown>;
  definition?: Record<string, unknown>;
  sourceType?: "authorized_files" | "prepared_files";
}): RuntimeCatalogEntry {
  return {
    slot: args.slot,
    runtime_id: args.runtimeId,
    kind: args.kind,
    display_name: args.runtimeId,
    description: null,
    config_schema_version: 1,
    config: args.config ?? {},
    definition: args.definition,
    content_revision: `content:${args.runtimeId}`,
    source: {
      type: args.sourceType ?? "authorized_files",
      files: args.files.map((file) => ({
        role: file.role,
        ordinal: file.ordinal,
        filename: file.filename,
        content_type: file.contentType,
        size_bytes: file.bytes,
        content_revision: `file:${file.role}:${file.ordinal}`,
        url: file.url,
      })),
      logical_resource_urls: args.logicalResourceUrls ?? {},
    },
  };
}

function mediaCatalog(args: {
  particleVfx?: RuntimeCatalogEntry[];
  avatarVfx?: RuntimeCatalogEntry[];
  sceneBackgroundVfx?: RuntimeCatalogEntry[];
  sceneFocusVfx?: RuntimeCatalogEntry[];
  sfx?: RuntimeCatalogEntry[];
}) {
  return {
    particleVfx: args.particleVfx ?? [],
    avatarVfx: args.avatarVfx ?? [],
    sceneBackgroundVfx: args.sceneBackgroundVfx ?? [],
    sceneFocusVfx: args.sceneFocusVfx ?? [],
    sfx: args.sfx ?? [],
  };
}

describe("AnimaRuntimeMediaCatalog", () => {
  it("has no bundled Avatar VFX registry for runtime_catalog sources", async () => {
    const avatarVfx = builtInEntry({
      kind: "avatar_vfx",
      slot: "avatar_vfx",
      runtimeId: "opaque-avatar-vfx",
      source: { type: "runtime_catalog", catalog: "avatar_vfx", key: "star" },
    });
    const catalog = new AnimaRuntimeMediaCatalog(
      mediaCatalog({ avatarVfx: [avatarVfx] }),
    );

    expect(catalog.resolveAvatarVFX("opaque-avatar-vfx")).toBeNull();
    await expect(
      catalog.loadAvatarVFX("opaque-avatar-vfx"),
    ).resolves.toBeNull();
    expect(catalog.listAvatarVFX()).toEqual([]);
  });

  it("resolves only exact mounted built-in entries for every media family", async () => {
    const particleFixture = AVATAR_PARTICLE_VFX_CATALOG[0];
    const sceneFixtureId = getSceneBackgroundLayerPresetIds()[0];
    if (!particleFixture || !sceneFixtureId) {
      throw new Error("Missing built-in media fixtures");
    }
    const particle = builtInEntry({
      kind: "particle_vfx",
      slot: "particle_vfx",
      runtimeId: "mounted-particle",
      source: { type: "public_url", url: particleFixture.assetPath },
    });
    const sceneVfx = builtInEntry({
      kind: "scene_vfx",
      slot: "scene_background_vfx",
      runtimeId: "mounted-scene-vfx",
      source: {
        type: "runtime_catalog",
        catalog: "scene_background_presets",
        key: sceneFixtureId,
      },
    });
    const sfx = builtInEntry({
      kind: "audio",
      slot: "sfx",
      runtimeId: "mounted-sfx",
      source: { type: "public_url", url: "/audio/sfx/sfx_sample_1.mp3" },
      config: { volume: 0.4, loop: false, autoplay: false },
    });
    const catalog = new AnimaRuntimeMediaCatalog(
      mediaCatalog({
        particleVfx: [particle],
        sceneBackgroundVfx: [sceneVfx],
        sfx: [sfx],
      }),
    );

    await expect(
      catalog.resolveParticleVFX("mounted-particle"),
    ).resolves.toMatchObject({
      id: "mounted-particle",
    });
    await expect(catalog.resolveParticleVFX("hearts")).resolves.toBeNull();
    expect(
      catalog.resolveSceneVFX("background_layers", "mounted-scene-vfx")?.id,
    ).toBe("mounted-scene-vfx");
    expect(catalog.listSceneVFX("background_layers")).toEqual([
      expect.objectContaining({ id: "mounted-scene-vfx" }),
    ]);
    expect(catalog.listSceneVFX("focus_lines")).toEqual([]);
    expect(
      catalog.resolveSceneVFX("background_layers", sceneFixtureId),
    ).toBeNull();
    expect(catalog.listAudio("sfx")).toEqual([
      expect.objectContaining({
        runtimeId: "mounted-sfx",
        volume: 0.4,
      }),
    ]);
    await expect(catalog.resolveAudio("sfx", "mounted-sfx")).resolves.toEqual(
      expect.objectContaining({ runtimeId: "mounted-sfx" }),
    );
    await expect(
      catalog.resolveAudio("sfx", "sfx_sample_1"),
    ).resolves.toBeNull();
  });

  it("fetches private audio once with authorization and revokes its Blob URL", async () => {
    const audioBytes = new Uint8Array([1, 2, 3, 4]);
    const entry = privateEntry({
      slot: "sfx",
      runtimeId: "private-cue",
      kind: "audio",
      files: [
        {
          role: "audio",
          ordinal: 1,
          filename: "cue.mp3",
          contentType: "audio/mpeg",
          bytes: audioBytes.byteLength,
          url: "/runtime/audio",
        },
      ],
      config: { volume: 0.5, loop: false },
    });
    const fetcher = vi.fn(async (input: RequestInfo | URL) =>
      authorizedSource(input)
        ? new Response(audioBytes, {
            status: 200,
            headers: { "content-length": String(audioBytes.byteLength) },
          })
        : authorizedDownload(String(input)),
    );
    const createObjectURL = vi.fn(() => "blob:private-audio");
    const revokeObjectURL = vi.fn();
    const catalog = new AnimaRuntimeMediaCatalog(
      mediaCatalog({ sfx: [entry] }),
      {
        fetcher,
        createObjectURL,
        revokeObjectURL,
      },
    );

    const [first, second] = await Promise.all([
      catalog.resolveAudio("sfx", "private-cue"),
      catalog.resolveAudio("sfx", "private-cue"),
    ]);
    expect(first).toEqual(second);
    expect(first).toMatchObject({ url: "blob:private-audio", volume: 0.5 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
      "/runtime/audio",
      expect.objectContaining({
        cache: "no-cache",
        redirect: "error",
        signal: expect.any(AbortSignal),
      }),
    );
    catalog.dispose();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:private-audio");
  });

  it("loads prepared audio from its mount Blob without an authorization exchange", async () => {
    const audioBytes = new Uint8Array([1, 2, 3, 4]);
    const entry = privateEntry({
      slot: "sfx",
      runtimeId: "prepared-cue",
      kind: "audio",
      sourceType: "prepared_files",
      files: [
        {
          role: "audio",
          ordinal: 1,
          filename: "cue.mp3",
          contentType: "audio/mpeg",
          bytes: audioBytes.byteLength,
          url: "blob:mounted-audio",
        },
      ],
    });
    const fetcher = vi.fn(async () => new Response(audioBytes));
    const catalog = new AnimaRuntimeMediaCatalog(
      mediaCatalog({ sfx: [entry] }),
      {
        fetcher,
        createObjectURL: () => "blob:decoded-audio",
      },
    );

    await expect(
      catalog.resolveAudio("sfx", "prepared-cue"),
    ).resolves.toMatchObject({ url: "blob:decoded-audio" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
      "blob:mounted-audio",
      expect.objectContaining({ cache: "no-cache" }),
    );
  });

  it("retains resolved audio and the shared preload budget across incremental admissions", async () => {
    const audio = (id: string) =>
      privateEntry({
        slot: "sfx",
        runtimeId: id,
        kind: "audio",
        sourceType: "prepared_files",
        files: [
          {
            role: "audio",
            ordinal: 1,
            filename: `${id}.mp3`,
            contentType: "audio/mpeg",
            bytes: 4,
            url: `blob:${id}`,
          },
        ],
      });
    const particle = (id: string) =>
      privateEntry({
        slot: "particle_vfx",
        runtimeId: id,
        kind: "particle_vfx",
        sourceType: "prepared_files",
        config: { preload_tier: "tier_a" },
        files: [
          {
            role: "manifest",
            ordinal: 1,
            filename: `${id}.json`,
            contentType: "application/json",
            bytes: 4,
            url: `blob:${id}`,
          },
        ],
      });
    const first = audio("first");
    const second = audio("second");
    const fetcher = vi.fn(
      async () => new Response(new Uint8Array([1, 2, 3, 4])),
    );
    const revokeObjectURL = vi.fn();
    const reserveEagerPreloadBytes = vi
      .fn()
      .mockReturnValueOnce(true)
      .mockReturnValue(false);
    const catalog = new AnimaRuntimeMediaCatalog(
      mediaCatalog({ sfx: [first], particleVfx: [particle("a")] }),
      {
        fetcher,
        createObjectURL: () => "blob:decoded-first",
        revokeObjectURL,
        reserveEagerPreloadBytes,
      },
    );
    const resolved = await catalog.resolveAudio("sfx", "first");
    const next = mediaCatalog({
      sfx: [first, second],
      particleVfx: [particle("a"), particle("b")],
    });
    expect(catalog.admitPrepared(next)).toBe(true);
    expect(catalog.admitPrepared(next)).toBe(false);
    expect(await catalog.resolveAudio("sfx", "first")).toBe(resolved);
    expect(catalog.listAudio("sfx").map((entry) => entry.runtimeId)).toEqual([
      "first",
      "second",
    ]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(reserveEagerPreloadBytes).toHaveBeenCalledTimes(2);
    expect(catalog.getParticlePreloadIds("tierA")).toEqual(["a"]);
    catalog.dispose();
    catalog.dispose();
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith(
      "blob:decoded-first",
    );
  });

  it("loads a private Avatar VFX image once and rewrites its exact Sound alias", async () => {
    const image = new Uint8Array([1, 2, 3]);
    const entry = privateEntry({
      slot: "avatar_vfx",
      runtimeId: "private-avatar-effect",
      kind: "avatar_vfx",
      files: [
        {
          role: "image",
          ordinal: 1,
          filename: "star.webp",
          contentType: "image/webp",
          bytes: image.byteLength,
          url: "/runtime/avatar-image",
        },
      ],
      logicalResourceUrls: { "star.webp": "/runtime/avatar-image" },
      config: { runtime_reference_map: { cue: "opaque-sound" } },
      definition: {
        schema: "animama/avatar-effect/1",
        kind: "hover",
        region: "eyes",
        image: "star.webp",
        transform: {
          offset: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
          rotation: { x: 0, y: 0, z: 0 },
        },
        hoverKind: "eye_hover",
        soundAlias: "cue",
      },
    });
    const fetcher = vi.fn(async (input: RequestInfo | URL) =>
      authorizedSource(input)
        ? new Response(image, {
            headers: { "content-length": String(image.byteLength) },
          })
        : authorizedDownload(String(input)),
    );
    const revokeObjectURL = vi.fn();
    const catalog = new AnimaRuntimeMediaCatalog(
      mediaCatalog({ avatarVfx: [entry] }),
      {
        fetcher,
        createObjectURL: () => "blob:avatar-star",
        revokeObjectURL,
      },
    );

    const [first, second] = await Promise.all([
      catalog.loadAvatarVFX(entry.runtime_id),
      catalog.loadAvatarVFX(entry.runtime_id),
    ]);
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      id: entry.runtime_id,
      assetPath: "blob:avatar-star",
      sound: { onApply: "opaque-sound" },
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    catalog.dispose();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:avatar-star");
  });

  it("keeps identical private Avatar image names scoped to their exact catalog entries", async () => {
    const definition = {
      schema: "animama/avatar-effect/1",
      kind: "hover",
      region: "eyes",
      image: "shared.webp",
      transform: {
        offset: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        rotation: { x: 0, y: 0, z: 0 },
      },
      hoverKind: "eye_hover",
    };
    const effect = (runtimeId: string, url: string) =>
      privateEntry({
        slot: "avatar_vfx",
        runtimeId,
        kind: "avatar_vfx",
        files: [
          {
            role: "image",
            ordinal: 1,
            filename: "shared.webp",
            contentType: "image/webp",
            bytes: 1,
            url,
          },
        ],
        logicalResourceUrls: { "shared.webp": url },
        definition,
      });
    const first = effect("private-avatar-a", "/runtime/release-a/image");
    const second = effect("private-avatar-b", "/runtime/release-b/image");
    let objectUrlOrdinal = 0;
    const fetcher = vi.fn(async (input: RequestInfo | URL) =>
      authorizedSource(input)
        ? new Response(new Uint8Array([1]), {
            headers: { "content-length": "1" },
          })
        : authorizedDownload(String(input)),
    );
    const catalog = new AnimaRuntimeMediaCatalog(
      mediaCatalog({ avatarVfx: [first, second] }),
      {
        fetcher,
        createObjectURL: () => `blob:release-${++objectUrlOrdinal}`,
      },
    );

    await expect(
      catalog.loadAvatarVFX(first.runtime_id),
    ).resolves.toMatchObject({
      id: first.runtime_id,
      assetPath: "blob:release-1",
    });
    await expect(
      catalog.loadAvatarVFX(second.runtime_id),
    ).resolves.toMatchObject({
      id: second.runtime_id,
      assetPath: "blob:release-2",
    });
    expect(fetcher.mock.calls.map(([input]) => String(input))).toEqual([
      "/runtime/release-a/image",
      "/runtime/release-b/image",
    ]);
  });

  it("fails closed when a private Avatar definition has no exact image mapping", async () => {
    const entry = privateEntry({
      slot: "avatar_vfx",
      runtimeId: "private-avatar-missing-image",
      kind: "avatar_vfx",
      files: [],
      definition: {
        schema: "animama/avatar-effect/1",
        kind: "hover",
        region: "eyes",
        image: "missing.webp",
        transform: {
          offset: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
          rotation: { x: 0, y: 0, z: 0 },
        },
        hoverKind: "eye_hover",
      },
    });
    const fetcher = vi.fn();
    const catalog = new AnimaRuntimeMediaCatalog(
      mediaCatalog({ avatarVfx: [entry] }),
      { fetcher },
    );

    await expect(catalog.loadAvatarVFX(entry.runtime_id)).resolves.toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("loads private Scene background images without leaking logical filenames", async () => {
    const image = new Uint8Array([4, 5, 6]);
    const entry = privateEntry({
      slot: "scene_background_vfx",
      runtimeId: "private-scene-effect",
      kind: "scene_vfx",
      files: [
        {
          role: "image",
          ordinal: 1,
          filename: "mark.webp",
          contentType: "image/webp",
          bytes: image.byteLength,
          url: "/runtime/scene-image",
        },
      ],
      logicalResourceUrls: { "mark.webp": "/runtime/scene-image" },
      definition: {
        schema: "animama/scene-effect/1",
        kind: "background_layers",
        durationMs: 1000,
        coverUiOverlays: false,
        dismissOnInput: false,
        solid: { enabled: true, color: "#ffffff" },
        pattern: {
          enabled: false,
          pattern: "none",
          color: "#000000",
          size: 16,
          spacing: 8,
          opacity: 0.5,
        },
        marquee: {
          enabled: true,
          items: [
            { id: "mark", kind: "image", label: "Mark", image: "mark.webp" },
          ],
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
    });
    const catalog = new AnimaRuntimeMediaCatalog(
      mediaCatalog({ sceneBackgroundVfx: [entry] }),
      {
        fetcher: async (input) =>
          authorizedSource(input)
            ? new Response(image, {
                headers: { "content-length": String(image.byteLength) },
              })
            : authorizedDownload(String(input)),
        createObjectURL: () => "blob:scene-mark",
      },
    );

    await expect(
      catalog.loadSceneVFX("background_layers", entry.runtime_id),
    ).resolves.toMatchObject({
      id: entry.runtime_id,
      marquee: { items: [{ kind: "png", src: "blob:scene-mark" }] },
    });
  });

  it("shares one eager particle budget across priority tiers", () => {
    const particle = (runtimeId: string, preloadTier: "tier_a" | "tier_b") =>
      privateEntry({
        slot: "particle_vfx",
        runtimeId,
        kind: "particle_vfx",
        files: [
          {
            role: "manifest",
            ordinal: 1,
            filename: `${runtimeId}.json`,
            contentType: "application/json",
            bytes: 4,
            url: `/runtime/${runtimeId}`,
          },
        ],
        config: { preload_tier: preloadTier },
      });
    const catalog = new AnimaRuntimeMediaCatalog(
      mediaCatalog({
        particleVfx: [
          particle("priority-a", "tier_a"),
          particle("priority-b", "tier_b"),
        ],
      }),
      { eagerPreloadBudgetBytes: 5 },
    );

    expect(catalog.getParticlePreloadIds("tierA")).toEqual(["priority-a"]);
    expect(catalog.getParticlePreloadIds("tierB")).toEqual([]);
  });

  it("rewrites only exact private particle texture references and releases them", async () => {
    const manifest = JSON.stringify({
      images: [
        { url: "textures/spark.png" },
        { url: "textures/spark.png" },
        { url: "variants/spark.png" },
      ],
      object: { type: "Object3D", children: [] },
    });
    const texture = new Uint8Array([9, 8, 7]);
    const entry = privateEntry({
      slot: "particle_vfx",
      runtimeId: "private-particle",
      kind: "particle_vfx",
      files: [
        {
          role: "manifest",
          ordinal: 1,
          filename: "effect.json",
          contentType: "application/json",
          bytes: new TextEncoder().encode(manifest).byteLength,
          url: "/runtime/manifest",
        },
        {
          role: "texture",
          ordinal: 1,
          filename: "spark.png",
          contentType: "image/png",
          bytes: texture.byteLength,
          url: "/runtime/texture",
        },
      ],
      logicalResourceUrls: {
        "textures/spark.png": "/runtime/texture",
        "variants/spark.png": "/runtime/texture",
      },
      config: {
        max_particles: 32,
        duration_seconds: 1,
        max_duration_seconds: 2.5,
        looping_allowed: false,
        shape_auto_fit: {
          kind: "avatar_bounds_rectangle",
          padding: { width: 0.1, height: 0.2 },
          emitter_names: ["outline"],
        },
      },
    });
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const source = authorizedSource(input);
      if (!source) return authorizedDownload(String(input));
      const body = source.endsWith("manifest") ? manifest : texture;
      const bytes =
        typeof body === "string"
          ? new TextEncoder().encode(body).byteLength
          : body.byteLength;
      return new Response(body, {
        status: 200,
        headers: { "content-length": String(bytes) },
      });
    });
    const blobs: Blob[] = [];
    const createObjectURL = vi.fn((blob: Blob) => {
      blobs.push(blob);
      return `blob:owned-${blobs.length}`;
    });
    const revokeObjectURL = vi.fn();
    const catalog = new AnimaRuntimeMediaCatalog(
      mediaCatalog({ particleVfx: [entry] }),
      {
        fetcher,
        createObjectURL,
        revokeObjectURL,
      },
    );

    await expect(
      catalog.resolveParticleVFX("private-particle"),
    ).resolves.toMatchObject({
      id: "private-particle",
      assetPath: "blob:owned-2",
      performanceBudget: {
        maxDurationSec: 2.5,
        maxParticles: 32,
        loopingAllowed: false,
      },
      shapeAutoFit: {
        kind: "avatarBoundsRectangle",
        padding: { width: 0.1, height: 0.2 },
        emitterNames: ["outline"],
      },
    });
    expect(JSON.parse(await blobs[1]!.text())).toMatchObject({
      images: [
        { url: "blob:owned-1" },
        { url: "blob:owned-1" },
        { url: "blob:owned-1" },
      ],
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    catalog.dispose();
    expect(revokeObjectURL.mock.calls.map(([url]) => url)).toEqual([
      "blob:owned-1",
      "blob:owned-2",
    ]);
  });

  it("fails closed when a particle manifest contains an unowned reference", async () => {
    const manifest = JSON.stringify({
      images: [{ url: "https://attacker.example/texture.png" }],
      object: {},
    });
    const bytes = new TextEncoder().encode(manifest).byteLength;
    const entry = privateEntry({
      slot: "particle_vfx",
      runtimeId: "unsafe-particle",
      kind: "particle_vfx",
      files: [
        {
          role: "manifest",
          ordinal: 1,
          filename: "effect.json",
          contentType: "application/json",
          bytes,
          url: "/runtime/manifest",
        },
      ],
    });
    const catalog = new AnimaRuntimeMediaCatalog(
      mediaCatalog({ particleVfx: [entry] }),
      {
        fetcher: async (input) =>
          authorizedSource(input)
            ? new Response(manifest, {
                status: 200,
                headers: { "content-length": String(bytes) },
              })
            : authorizedDownload(String(input)),
      },
    );

    await expect(
      catalog.resolveParticleVFX("unsafe-particle"),
    ).resolves.toBeNull();
  });
});
