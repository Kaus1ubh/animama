import { describe, expect, it, vi } from "vitest";

import type {
  RuntimeResourceKind,
  AnimaRuntimeCatalogSnapshot,
  RuntimeCatalogEntry,
  RuntimeContentSlot,
} from "./types";
import {
  AVATAR_POSE_CLIP_IDS,
  AVATAR_REACTION_CLIP_IDS,
} from "@/lib/avatar/poses/catalog";
import {
  buildEmotionRuntimeState,
  createEmptyEmotionStateMap,
} from "@/lib/emotion";
import { AnimaRuntimeCatalog } from "./AnimaRuntimeCatalog";

const MANIFEST_URL = "https://api.example.test/runtime/manifest";
const VRMA_URL = "https://api.example.test/runtime/animation";

function authorizedDownload(sourceUrl: string): Response {
  void sourceUrl;
  return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 });
}

function authorizedSource(input: RequestInfo | URL): string {
  return String(input);
}

function runtimeEntry(args: {
  slot: RuntimeContentSlot;
  runtimeId: string;
  kind: RuntimeResourceKind;
  config?: Record<string, unknown>;
  url?: string;
  role?: string;
  contentRevision?: string;
  sourceType?: "authorized_files" | "prepared_files";
}): RuntimeCatalogEntry {
  return {
    slot: args.slot,
    runtime_id: args.runtimeId,
    kind: args.kind,
    display_name: `Custom ${args.runtimeId}`,
    description: `Description for ${args.runtimeId}`,
    config_schema_version: 1,
    config: args.config ?? {},
    content_revision: args.contentRevision ?? "content-v1",
    source: {
      type: args.sourceType ?? "authorized_files",
      files: [
        {
          role: args.role ?? "manifest",
          ordinal: 1,
          filename: `${args.runtimeId}.json`,
          content_type:
            args.kind === "animation"
              ? "application/octet-stream"
              : "application/json",
          size_bytes: 512,
          content_revision: "file-v1",
          url: args.url ?? MANIFEST_URL,
        },
      ],
    },
  };
}

function runtimeContent(
  overrides: Partial<AnimaRuntimeCatalogSnapshot> = {},
): AnimaRuntimeCatalogSnapshot {
  return {
    schema_version: 1,
    effective_revision: "effective-v1",
    loadout_revision: 1,
    app_catalog_version: 1,
    avatar_model: runtimeEntry({
      slot: "primary_model",
      runtimeId: "primary",
      kind: "avatar_model",
      role: "model",
    }),
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
    warnings: [],
    ...overrides,
  };
}

function poseClip(
  args: {
    id?: string;
    role?: "motion" | "reaction";
    events?: unknown[];
  } = {},
) {
  return {
    schema: "animaPoseClip/1.0",
    id: args.id ?? "authored-id",
    name: "Authored clip",
    ...(args.role ? { role: args.role } : {}),
    duration: 1,
    poses: {
      rest: {
        humanoid: {
          head: { rotation: [0, 0, 0, 1] },
        },
      },
    },
    poseKeyframes: [{ time: 0, pose: "rest" }],
    ...(args.events ? { events: args.events } : {}),
  };
}

function appPoseClipEntry(args: {
  catalog: "avatar_pose_clips" | "avatar_reaction_clips";
  slot: "gesture" | "pose" | "reaction";
  runtimeId: string;
}): RuntimeCatalogEntry {
  const key =
    args.catalog === "avatar_reaction_clips"
      ? AVATAR_REACTION_CLIP_IDS[0]
      : AVATAR_POSE_CLIP_IDS[0];
  if (!key) throw new Error(`Missing built-in clip in ${args.catalog}`);
  return {
    slot: args.slot,
    runtime_id: args.runtimeId,
    kind: "anima_pose_clip",
    display_name: args.runtimeId,
    description: null,
    config_schema_version: 1,
    config: {},
    content_revision: `builtin:${args.catalog}:${key}`,
    source: {
      type: "runtime_catalog",
      catalog: args.catalog,
      key,
    },
  };
}

function joyfulState() {
  const values = createEmptyEmotionStateMap();
  values.joy = 10;
  return buildEmotionRuntimeState(values);
}

describe("AnimaRuntimeCatalog", () => {
  it("skips pending motion and media without fetching, then appends to the same revision", async () => {
    const gesture = {
      ...runtimeEntry({
        slot: "gesture",
        runtimeId: "wave",
        kind: "animation",
        role: "animation",
        url: "blob:wave",
        sourceType: "prepared_files",
      }),
      runtime_root_ids: ["gesture:wave"],
    };
    const reaction = {
      ...runtimeEntry({
        slot: "reaction",
        runtimeId: "joy-1",
        kind: "anima_pose_clip",
      }),
      runtime_root_ids: ["reaction:joy-1"],
    };
    const sound = {
      ...runtimeEntry({
        slot: "sfx",
        runtimeId: "cue",
        kind: "audio",
        role: "audio",
        url: "blob:cue",
        sourceType: "prepared_files",
      }),
      runtime_root_ids: ["reaction:joy-1"],
    };
    const issued = runtimeContent({
      gestures: [gesture],
      reactions: [reaction],
      sfx: [sound],
    });
    const readiness = new Map<string, "pending" | "ready">([
      ["gesture:wave", "pending"],
      ["reaction:joy-1", "pending"],
    ]);
    const fetcher = vi.fn<typeof fetch>();
    let preparing = true;
    const catalog = new AnimaRuntimeCatalog(runtimeContent(), {
      fetcher,
      preparation: {
        issued,
        getRootReadiness: (id) => readiness.get(id) ?? "failed",
        isPreparing: () => preparing,
      },
    });
    const changed = vi.fn();
    catalog.subscribe(changed);
    for (let i = 0; i < 40; i++) expect(catalog.getGesture("wave")).toBeNull();
    expect(
      catalog.getReactionRuntimeId({
        emotionalTone: "joy",
        emotionalIntensity: 1,
      }),
    ).toBeNull();
    await expect(catalog.loadReactionClip("joy-1")).resolves.toBeNull();
    await expect(catalog.resolveAudio("sfx", "cue")).resolves.toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
    expect(
      catalog.diagnostics.filter(
        (item) => item.code === "runtime_resource_pending",
      ),
    ).toHaveLength(3);

    readiness.set("gesture:wave", "ready");
    catalog.admitPrepared(runtimeContent({ gestures: [gesture] }));
    const admitted = catalog.getGesture("wave");
    const resource = catalog.resolveVrma("blob:wave");
    expect(admitted).not.toBeNull();
    expect(resource).not.toBeNull();
    catalog.admitPrepared(runtimeContent({ gestures: [gesture] }));
    expect(changed).toHaveBeenCalledTimes(1);
    expect(catalog.getGesture("wave")).toBe(admitted);
    expect(catalog.resolveVrma("blob:wave")).toBe(resource);
    expect(fetcher).not.toHaveBeenCalled();

    preparing = false;
    catalog.admitPrepared(runtimeContent({ gestures: [gesture] }));
    expect(changed).toHaveBeenCalledTimes(2);
    expect(catalog.isPreparing()).toBe(false);
    expect(() =>
      catalog.admitPrepared(
        runtimeContent({ effective_revision: "different" }),
      ),
    ).toThrow(/remount/);
    expect(() =>
      catalog.admitPrepared(runtimeContent({ reactions: [reaction] })),
    ).toThrow(/verified/);
    catalog.dispose();
    catalog.admitPrepared(runtimeContent({ gestures: [gesture] }));
    expect(catalog.getGesture("wave")).toBeNull();
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it("normalizes user idle and gesture VRMAs and keys cache by content", async () => {
    const idle = runtimeEntry({
      slot: "idle_animation",
      runtimeId: "custom-idle",
      kind: "animation",
      url: VRMA_URL,
      role: "animation",
      contentRevision: "idle-content-7",
      config: {
        emotion_weights: { joy: { "1": 5, "2": 5, "3": 5 } },
        duration_seconds: 4,
        preload_tier: "tier_a",
        loop_type: "repeat",
        loop_count: 2,
      },
    });
    const gesture = runtimeEntry({
      slot: "gesture",
      runtimeId: "victory-dance",
      kind: "animation",
      url: `${VRMA_URL}/gesture`,
      role: "animation",
      contentRevision: "gesture-content-3",
      config: { duration_seconds: 2, preload_tier: "tier_b" },
    });
    const fetcher = vi.fn(async (input: RequestInfo | URL) =>
      authorizedDownload(String(input)),
    );
    const catalog = new AnimaRuntimeCatalog(
      runtimeContent({ idle_animations: [idle], gestures: [gesture] }),
      { fetcher },
    );

    const selected = catalog.selectIdleAnimation({
      emotionalState: joyfulState(),
      randomRoll: 0,
    }).selected;
    expect(selected?.entry.id).toBe("custom-idle");
    const gestureEntry = catalog.getGesture("victory-dance");
    expect(gestureEntry).toMatchObject({
      id: "victory-dance",
      type: "vrma",
      duration: 2,
    });
    expect(
      catalog.listAnimations().map((entry) => ({
        id: entry.id,
        role: entry.animation_type,
        type: entry.type,
      })),
    ).toEqual([
      { id: "custom-idle", role: "idle", type: "vrma" },
      { id: "victory-dance", role: "gesture", type: "vrma" },
    ]);
    expect(catalog.getPreloadEntries()).toEqual([
      expect.objectContaining({ runtimeId: "custom-idle", tier: "tier_a" }),
      expect.objectContaining({ runtimeId: "victory-dance", tier: "tier_b" }),
    ]);

    const idleResource = catalog.resolveVrma(selected!.entry.file);
    const gestureResource = catalog.resolveVrma(gestureEntry!.file);
    expect(idleResource).toMatchObject({
      runtimeId: "custom-idle",
      url: VRMA_URL,
      cacheKey: "vrma:custom-idle:idle-content-7",
    });
    expect(gestureResource?.cacheKey).toBe(
      "vrma:victory-dance:gesture-content-3",
    );
    const download = await idleResource?.getDownloadUrl?.();
    expect(download?.url).toMatch(/^blob:/);
    download?.release();
    expect(fetcher).toHaveBeenCalledWith(
      VRMA_URL,
      expect.objectContaining({
        cache: "no-cache",
        redirect: "error",
      }),
    );
  });

  it("releases an outstanding animation URL when its catalog is disposed", async () => {
    const gesture = runtimeEntry({
      slot: "gesture",
      runtimeId: "temporary-animation",
      kind: "animation",
      url: VRMA_URL,
      role: "animation",
    });
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(authorizedDownload(VRMA_URL));
    const catalog = new AnimaRuntimeCatalog(
      runtimeContent({ gestures: [gesture] }),
      { fetcher },
    );
    const resource = catalog.resolveVrma(VRMA_URL)!;
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    const download = await resource.getDownloadUrl!();
    expect(revoke).not.toHaveBeenCalled();

    catalog.dispose();
    download.release();

    expect(revoke).toHaveBeenCalledExactlyOnceWith(download.url);
    await expect(resource.getDownloadUrl!()).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not publish a late animation URL after catalog disposal", async () => {
    const gesture = runtimeEntry({
      slot: "gesture",
      runtimeId: "late-animation",
      kind: "animation",
      url: VRMA_URL,
      role: "animation",
    });
    let finishBody!: (blob: Blob) => void;
    const response = new Response();
    const readBody = vi.spyOn(response, "blob").mockImplementation(
      () =>
        new Promise<Blob>((resolve) => {
          finishBody = resolve;
        }),
    );
    const catalog = new AnimaRuntimeCatalog(
      runtimeContent({ gestures: [gesture] }),
      {
        fetcher: vi.fn<typeof fetch>().mockResolvedValue(response),
      },
    );
    const create = vi.spyOn(URL, "createObjectURL");
    const download = catalog.resolveVrma(VRMA_URL)!.getDownloadUrl!();
    await vi.waitFor(() => expect(readBody).toHaveBeenCalled());

    catalog.dispose();
    finishBody(new Blob(["animation"]));

    await expect(download).rejects.toMatchObject({ name: "AbortError" });
    expect(create).not.toHaveBeenCalled();
  });

  it("fetches a private pose manifest lazily once and canonicalizes its ID", async () => {
    const entry = runtimeEntry({
      slot: "pose",
      runtimeId: "custom-pose",
      kind: "anima_pose_clip",
    });
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      if (!authorizedSource(input)) return authorizedDownload(String(input));
      return new Response(JSON.stringify(poseClip()), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const catalog = new AnimaRuntimeCatalog(
      runtimeContent({ poses: [entry] }),
      {
        fetcher,
      },
    );

    expect(catalog.getPoseClip("custom-pose")).toBeNull();
    expect(catalog.listPoseClips()).toEqual([
      expect.objectContaining({ runtimeId: "custom-pose", loaded: false }),
    ]);
    expect(fetcher).not.toHaveBeenCalled();

    const [first, second] = await Promise.all([
      catalog.loadPoseClip("custom-pose"),
      catalog.loadPoseClip("custom-pose"),
    ]);
    expect(first).toBe(second);
    expect(first).toMatchObject({
      id: "custom-pose",
      name: "Custom custom-pose",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
      MANIFEST_URL,
      expect.objectContaining({
        cache: "no-cache",
        redirect: "error",
        signal: expect.any(AbortSignal),
      }),
    );
    expect(catalog.listPoseClips()[0]?.loaded).toBe(true);
    await catalog.loadPoseClip("custom-pose");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("loads typed Reaction sequence files through the shared preview catalog", async () => {
    const entry = runtimeEntry({
      slot: "reaction",
      runtimeId: "joy-1",
      kind: "anima_pose_clip",
      role: "sequence",
    });
    const fetcher = vi.fn(async (input: RequestInfo | URL) =>
      authorizedSource(input)
        ? new Response(JSON.stringify(poseClip()), { status: 200 })
        : authorizedDownload(String(input)),
    );
    const catalog = new AnimaRuntimeCatalog(
      runtimeContent({ reactions: [entry] }),
      {
        fetcher,
      },
    );

    expect(catalog.listReactionClips()).toEqual([
      expect.objectContaining({ runtimeId: "joy-1", loaded: false }),
    ]);
    await expect(catalog.loadReactionClip("joy-1")).resolves.toMatchObject({
      id: "joy-1",
    });
    expect(catalog.listReactionClips()[0]?.loaded).toBe(true);
  });

  it("mounts the same roleless private clip bytes by gesture and reaction slot", async () => {
    const reaction = runtimeEntry({
      slot: "reaction",
      runtimeId: "joy-2",
      kind: "anima_pose_clip",
    });
    const gesture = runtimeEntry({
      slot: "gesture",
      runtimeId: "custom-gesture",
      kind: "anima_pose_clip",
    });
    const catalog = new AnimaRuntimeCatalog(
      runtimeContent({ gestures: [gesture], reactions: [reaction] }),
      {
        fetcher: async (input) =>
          authorizedSource(input)
            ? new Response(JSON.stringify(poseClip()), { status: 200 })
            : authorizedDownload(String(input)),
      },
    );

    expect(catalog.getGesture("custom-gesture")).toMatchObject({
      type: "animaPoseClip",
      file: "custom-gesture",
    });
    expect(catalog.getGesture("joy-2")).toBeNull();
    expect(
      catalog.getReactionRuntimeId({
        emotionalTone: "joy",
        emotionalIntensity: 2,
      }),
    ).toBe("joy-2");
    expect(
      catalog.getReactionRuntimeId({
        emotionalTone: "alarm",
        emotionalIntensity: 2,
      }),
    ).toBeNull();
    await expect(catalog.loadPoseClip("custom-gesture")).resolves.toMatchObject(
      {
        id: "custom-gesture",
      },
    );
    await expect(catalog.loadReactionClip("joy-2")).resolves.toMatchObject({
      id: "joy-2",
    });
    expect(catalog.getReactionClip("joy-2")?.role).toBeUndefined();
  });

  it("resolves built-in clips from their source catalog and mounts them by slot", () => {
    const reactionAsGesture = appPoseClipEntry({
      catalog: "avatar_reaction_clips",
      slot: "gesture",
      runtimeId: "reaction-as-gesture",
    });
    const poseAsReaction = appPoseClipEntry({
      catalog: "avatar_pose_clips",
      slot: "reaction",
      runtimeId: "pose-as-reaction",
    });
    const catalog = new AnimaRuntimeCatalog(
      runtimeContent({
        gestures: [reactionAsGesture],
        reactions: [poseAsReaction],
      }),
    );

    expect(catalog.getGesture("reaction-as-gesture")).toMatchObject({
      type: "animaPoseClip",
      file: "reaction-as-gesture",
    });
    expect(catalog.getPoseClip("reaction-as-gesture")).toMatchObject({
      id: "reaction-as-gesture",
    });
    expect(catalog.getReactionClip("pose-as-reaction")).toMatchObject({
      id: "pose-as-reaction",
    });
    expect(catalog.diagnostics).toEqual([]);
  });

  it("accepts user clip events only when the referenced ID is effective", async () => {
    const clipEntry = runtimeEntry({
      slot: "pose",
      runtimeId: "sound-pose",
      kind: "anima_pose_clip",
    });
    const sfxEntry = runtimeEntry({
      slot: "sfx",
      runtimeId: "equipped-cue",
      kind: "audio",
      role: "primary",
    });
    const catalog = new AnimaRuntimeCatalog(
      runtimeContent({ poses: [clipEntry], sfx: [sfxEntry] }),
      {
        fetcher: async (input) =>
          authorizedSource(input)
            ? new Response(
                JSON.stringify(
                  poseClip({
                    events: [
                      {
                        id: "sound",
                        time: 0,
                        kind: "sfx",
                        cueId: "equipped-cue",
                      },
                    ],
                  }),
                ),
                { status: 200 },
              )
            : authorizedDownload(String(input)),
      },
    );

    await expect(catalog.loadPoseClip("sound-pose")).resolves.toMatchObject({
      id: "sound-pose",
      events: [expect.objectContaining({ cueId: "equipped-cue" })],
    });
    expect(catalog.diagnostics).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "missing_event_reference" }),
      ]),
    );
  });

  it("keeps identical local aliases isolated between action roots", async () => {
    const firstClip = runtimeEntry({
      slot: "gesture",
      runtimeId: "first-root",
      kind: "anima_pose_clip",
      url: `${MANIFEST_URL}/first`,
      config: { runtime_reference_map: { ding: "opaque-sfx-first" } },
    });
    const secondClip = runtimeEntry({
      slot: "gesture",
      runtimeId: "second-root",
      kind: "anima_pose_clip",
      url: `${MANIFEST_URL}/second`,
      config: { runtime_reference_map: { ding: "opaque-sfx-second" } },
    });
    const firstSfx = runtimeEntry({
      slot: "sfx",
      runtimeId: "opaque-sfx-first",
      kind: "audio",
      role: "audio",
    });
    const secondSfx = runtimeEntry({
      slot: "sfx",
      runtimeId: "opaque-sfx-second",
      kind: "audio",
      role: "audio",
    });
    const catalog = new AnimaRuntimeCatalog(
      runtimeContent({
        gestures: [firstClip, secondClip],
        sfx: [firstSfx, secondSfx],
      }),
      {
        fetcher: async (input) =>
          authorizedSource(input)
            ? new Response(
                JSON.stringify(
                  poseClip({
                    events: [
                      { id: "sound", time: 0, kind: "sfx", cueId: "ding" },
                    ],
                  }),
                ),
                { status: 200 },
              )
            : authorizedDownload(String(input)),
      },
    );

    await expect(catalog.loadPoseClip("first-root")).resolves.toMatchObject({
      events: [expect.objectContaining({ cueId: "opaque-sfx-first" })],
    });
    await expect(catalog.loadPoseClip("second-root")).resolves.toMatchObject({
      events: [expect.objectContaining({ cueId: "opaque-sfx-second" })],
    });
  });

  it("ignores legacy clip role but rejects references outside the effective catalog", async () => {
    const reaction = runtimeEntry({
      slot: "reaction",
      runtimeId: "joy-2",
      kind: "anima_pose_clip",
    });
    const missingSfx = runtimeEntry({
      slot: "pose",
      runtimeId: "missing-sfx",
      kind: "anima_pose_clip",
      url: `${MANIFEST_URL}/missing-sfx`,
    });
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const source = authorizedSource(input);
      if (!source) return authorizedDownload(String(input));
      const payload =
        source === MANIFEST_URL
          ? poseClip({ role: "motion" })
          : poseClip({
              events: [
                {
                  id: "sound",
                  time: 0,
                  kind: "sfx",
                  cueId: "not-equipped",
                },
              ],
            });
      return new Response(JSON.stringify(payload), { status: 200 });
    });
    const catalog = new AnimaRuntimeCatalog(
      runtimeContent({ reactions: [reaction], poses: [missingSfx] }),
      {
        fetcher,
      },
    );

    await expect(catalog.loadReactionClip("joy-2")).resolves.toMatchObject({
      id: "joy-2",
      role: "motion",
    });
    await expect(catalog.loadPoseClip("missing-sfx")).resolves.toBeNull();
    expect(catalog.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "missing_event_reference",
          runtimeId: "missing-sfx",
        }),
      ]),
    );
    expect(catalog.diagnostics).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "invalid_motion_source",
          runtimeId: "joy-2",
        }),
      ]),
    );
  });

  it("keeps missing effect references playable only for an isolated Library preview", async () => {
    const clipEntry = runtimeEntry({
      slot: "pose",
      runtimeId: "library-preview",
      kind: "anima_pose_clip",
    });
    const catalog = new AnimaRuntimeCatalog(
      runtimeContent({ poses: [clipEntry] }),
      {
        allowMissingClipEventReferences: true,
        fetcher: async (input) =>
          authorizedSource(input)
            ? new Response(
                JSON.stringify(
                  poseClip({
                    events: [
                      {
                        id: "missing-sound",
                        time: 0,
                        kind: "sfx",
                        cueId: "not-equipped",
                      },
                    ],
                  }),
                ),
                { status: 200 },
              )
            : authorizedDownload(String(input)),
      },
    );

    await expect(
      catalog.loadPoseClip("library-preview"),
    ).resolves.toMatchObject({
      id: "library-preview",
      events: [expect.objectContaining({ cueId: "not-equipped" })],
    });
    expect(catalog.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "missing_event_reference",
          runtimeId: "library-preview",
        }),
      ]),
    );
  });

  it("omits colliding runtime IDs instead of choosing an ambiguous source", () => {
    const first = runtimeEntry({
      slot: "idle_animation",
      runtimeId: "duplicate",
      kind: "animation",
      url: VRMA_URL,
    });
    const second = { ...first, content_revision: "other-content" };
    const catalog = new AnimaRuntimeCatalog(
      runtimeContent({ idle_animations: [first, second] }),
    );

    expect(catalog.getIdleAnimations()).toEqual([]);
    expect(catalog.getPreloadEntries()).toEqual([]);
    expect(
      catalog.diagnostics.filter(
        (diagnostic) => diagnostic.code === "duplicate_runtime_id",
      ),
    ).toHaveLength(2);
  });

  it("rejects different pose sources that collide across gesture and pose slots", () => {
    const gesture = runtimeEntry({
      slot: "gesture",
      runtimeId: "shared-motion",
      kind: "anima_pose_clip",
      contentRevision: "gesture-content",
    });
    const pose = runtimeEntry({
      slot: "pose",
      runtimeId: "shared-motion",
      kind: "anima_pose_clip",
      contentRevision: "pose-content",
      url: `${MANIFEST_URL}/pose`,
    });
    const catalog = new AnimaRuntimeCatalog(
      runtimeContent({ gestures: [gesture], poses: [pose] }),
    );

    expect(catalog.getGesture("shared-motion")).toBeNull();
    expect(catalog.listPoseClips()).toEqual([]);
    expect(catalog.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "duplicate_runtime_id",
          runtimeId: "shared-motion",
        }),
      ]),
    );
  });

  it("aborts in-flight private manifest work and releases loaded state", async () => {
    const entry = runtimeEntry({
      slot: "pose",
      runtimeId: "slow-pose",
      kind: "anima_pose_clip",
    });
    const fetcher = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    );
    const catalog = new AnimaRuntimeCatalog(
      runtimeContent({ poses: [entry] }),
      {
        fetcher,
      },
    );

    const pending = catalog.loadPoseClip("slow-pose");
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    catalog.dispose();

    await expect(pending).resolves.toBeNull();
    expect(catalog.resolveVrma("anything")).toBeNull();
    expect(catalog.listAnimations()).toEqual([]);
    expect(catalog.listPoseClips()).toEqual([]);
    expect(catalog.getPreloadEntries()).toEqual([]);
    await expect(catalog.loadPoseClip("slow-pose")).resolves.toBeNull();
  });

  it("rejects a manifest whose declared size exceeds the runtime bound", async () => {
    const entry = runtimeEntry({
      slot: "pose",
      runtimeId: "oversized-pose",
      kind: "anima_pose_clip",
    });
    const catalog = new AnimaRuntimeCatalog(
      runtimeContent({ poses: [entry] }),
      {
        fetcher: async (input) =>
          authorizedSource(input)
            ? new Response("{}", {
                status: 200,
                headers: { "content-length": `${2 * 1024 * 1024 + 1}` },
              })
            : authorizedDownload(String(input)),
      },
    );

    await expect(catalog.loadPoseClip("oversized-pose")).resolves.toBeNull();
    expect(catalog.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "invalid_motion_manifest",
          runtimeId: "oversized-pose",
        }),
      ]),
    );
  });

  it("loads a 2.0 clip and names it for this runtime", async () => {
    const entry = runtimeEntry({
      slot: "pose",
      runtimeId: "beat-pose",
      kind: "anima_pose_clip",
    });
    const clip = {
      schema: "animaPoseClip/2.0",
      id: "authored",
      name: "Authored",
      duration: 1,
      beats: [{ id: "a", label: "A", time: 0 }],
      expressions: { happy: [{ beat: "a", v: 0.5 }] },
    };
    const catalog = new AnimaRuntimeCatalog(
      runtimeContent({ poses: [entry] }),
      {
        fetcher: async (input) =>
          authorizedSource(input)
            ? new Response(JSON.stringify(clip), { status: 200 })
            : authorizedDownload(String(input)),
      },
    );

    const loaded = await catalog.loadPoseClip("beat-pose");
    expect(loaded).toMatchObject({
      schema: "animaPoseClip/2.0",
      id: "beat-pose",
      beats: clip.beats,
    });
  });

  it("skips an invalid 2.0 clip with a diagnostic", async () => {
    const entry = runtimeEntry({
      slot: "pose",
      runtimeId: "broken-pose",
      kind: "anima_pose_clip",
    });
    const catalog = new AnimaRuntimeCatalog(
      runtimeContent({ poses: [entry] }),
      {
        fetcher: async (input) =>
          authorizedSource(input)
            ? new Response(
                JSON.stringify({
                  schema: "animaPoseClip/2.0",
                  id: "broken",
                  name: "Broken",
                  duration: 1,
                  beats: [{ id: "a", label: "A", time: 0 }],
                  expressions: { happy: [{ beat: "missing", v: 1 }] },
                }),
                { status: 200 },
              )
            : authorizedDownload(String(input)),
      },
    );

    await expect(catalog.loadPoseClip("broken-pose")).resolves.toBeNull();
    expect(catalog.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "invalid_motion_manifest",
          runtimeId: "broken-pose",
          message: expect.stringContaining("expressions.happy[0].beat"),
        }),
      ]),
    );
  });
});
