import type { VRM } from "@pixiv/three-vrm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PoseController } from "@/lib/avatar/poses/PoseController";
import type { AnimaPoseClip } from "@/lib/avatar/poses/animaPoseClip";
import type { ResolvedRuntimeAudio } from "@/lib/runtime-content/AnimaRuntimeMediaCatalog";
import { getSceneBackgroundLayerPresetById } from "@/lib/scene-vfx/catalog";
import {
  ContentPreviewApplySoundPlayer,
  createContentPreviewClipEventBridge,
} from "./effects";

class PreviewAudio {
  static instances: PreviewAudio[] = [];
  paused = true;
  currentTime = 0;
  volume = 1;
  readonly src: string;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(src: string) {
    this.src = src;
    PreviewAudio.instances.push(this);
  }
  async play() {
    this.paused = false;
  }
  pause() {
    this.paused = true;
  }
}

const sound: ResolvedRuntimeAudio = {
  runtimeId: "tap",
  label: "Tap",
  kind: "sfx",
  url: "/tap.wav",
  volume: 0.5,
  loop: false,
  autoplay: false,
  sizeBytes: null,
};

async function settleEvents() {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
}

function fixture(
  kind: "sfx" | "scene_vfx",
  resolveAudio: () => Promise<ResolvedRuntimeAudio | null>,
  finite = true,
) {
  const controller = new PoseController({
    humanoid: {
      getNormalizedPose: () => ({}),
      getNormalizedBoneNode: () => null,
      resetNormalizedPose: () => undefined,
      setNormalizedPose: () => undefined,
    },
    expressionManager: null,
  } as unknown as VRM);
  const scene = getSceneBackgroundLayerPresetById("kawaii-sparkles");
  if (!scene) throw new Error("Missing scene VFX fixture");
  const catalog = {
    resolveAudio,
    loadSceneVFX: async () => ({ ...scene, sound: { onApply: "tap" } }),
  };
  const player = new ContentPreviewApplySoundPlayer();
  const bridge = createContentPreviewClipEventBridge({
    catalog,
    onSceneVFXChange: vi.fn(),
    playSfx: (runtimeId, signal) => player.play(catalog, runtimeId, signal),
  });
  controller.setClipEventSink(bridge.sink);
  const clip: AnimaPoseClip = {
    schema: "animaPoseClip/1.0",
    id: "finite-preview",
    name: "Finite preview",
    duration: 1,
    poses: {},
    poseKeyframes: [],
    events: [
      kind === "sfx"
        ? { id: "sound", time: 0, kind, cueId: "tap" }
        : {
            id: "effect",
            time: 0,
            kind,
            sceneKind: "background_layers",
            presetId: scene.id,
            duration: 2,
          },
    ],
  };
  controller.playAnimaPoseClip(
    clip,
    finite ? { finitePlayback: { timeScale: 1, repetitions: 1 } } : {},
  );
  return { controller, player, catalog };
}

beforeEach(() => {
  PreviewAudio.instances = [];
  vi.stubGlobal("Audio", PreviewAudio);
});
afterEach(() => vi.unstubAllGlobals());

describe("finite preview sound ownership", () => {
  it.each(["sfx", "scene_vfx"] as const)(
    "does not start pending %s audio after the real clip completes",
    async (kind) => {
      let resolve!: (value: ResolvedRuntimeAudio) => void;
      const pending = new Promise<ResolvedRuntimeAudio>((done) => {
        resolve = done;
      });
      const resolveAudio = vi.fn(() => pending);
      const { controller } = fixture(kind, resolveAudio);
      await settleEvents();
      expect(resolveAudio).toHaveBeenCalledOnce();
      controller.update(1);
      expect(controller.isClipActive()).toBe(false);
      resolve(sound);
      await settleEvents();
      expect(PreviewAudio.instances).toHaveLength(0);
    },
  );

  it.each(["sfx", "scene_vfx"] as const)(
    "stops active %s audio at completion without stopping unrelated audio",
    async (kind) => {
      const unrelatedPlayer = new ContentPreviewApplySoundPlayer();
      await unrelatedPlayer.play({ resolveAudio: async () => sound }, "other");
      const unrelated = PreviewAudio.instances[0];
      const { controller } = fixture(kind, async () => sound);
      await settleEvents();
      const owned = PreviewAudio.instances[1];
      expect(owned?.paused).toBe(false);
      controller.update(1);
      expect(controller.isClipActive()).toBe(false);
      expect(owned?.paused).toBe(true);
      expect(unrelated?.paused).toBe(false);
    },
  );

  it("cancels active sound on interruption before the clip fade finishes", async () => {
    const { controller } = fixture("sfx", async () => sound);
    await settleEvents();
    const owned = PreviewAudio.instances[0];
    expect(owned?.paused).toBe(false);
    controller.stopClip({ fadeOutDurationSec: 1 });
    expect(owned?.paused).toBe(true);
  });

  it("keeps ordinary preview audio behavior after its clip completes", async () => {
    const { controller, player } = fixture("sfx", async () => sound, false);
    await settleEvents();
    controller.update(1);
    expect(controller.isClipActive()).toBe(false);
    expect(PreviewAudio.instances[0]?.paused).toBe(false);
    player.stop();
    expect(PreviewAudio.instances[0]?.paused).toBe(true);
  });

  it("does not let an old occurrence cancel its replacement sound", async () => {
    const { controller, player, catalog } = fixture("sfx", async () => sound);
    await settleEvents();
    await player.play(catalog, "new-preview");
    const replacement = PreviewAudio.instances[1];
    controller.update(1);
    expect(replacement?.paused).toBe(false);
  });

  it("ignores an already cancelled event without replacing ordinary audio", async () => {
    const player = new ContentPreviewApplySoundPlayer();
    const catalog = { resolveAudio: vi.fn(async () => sound) };
    await player.play(catalog, "ordinary");
    const cancelled = new AbortController();
    cancelled.abort();
    await player.play(catalog, "stale-event", cancelled.signal);
    expect(catalog.resolveAudio).toHaveBeenCalledOnce();
    expect(PreviewAudio.instances).toHaveLength(1);
    expect(PreviewAudio.instances[0]?.paused).toBe(false);
  });
});
