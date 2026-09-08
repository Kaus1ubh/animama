import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import type { VRM } from "@pixiv/three-vrm";
import type { VRMAnimation } from "@pixiv/three-vrm-animation";

import {
  AnimationManager,
  stripTranslationTracksForRootedPlayback,
} from "@/lib/avatar/AnimationManager";

describe("AnimationManager rooted playback", () => {
  it("does not populate or play on a disposed rig after a pending decode completes", async () => {
    let release!: (value: VRMAnimation | null) => void;
    const pending = new Promise<VRMAnimation | null>((resolve) => {
      release = resolve;
    });
    const manager = new AnimationManager({ scene: new THREE.Group() } as VRM, {
      loadVrma: () => pending,
    });
    const play = manager.playLoop("blob:pending", "idle");
    manager.dispose();
    manager.dispose();
    release(null);
    await expect(play).rejects.toMatchObject({ name: "AbortError" });
    expect(manager.getActiveActions()).toEqual([]);
  });

  it("rechecks a request's planner/run guard after decoding instead of playing it late", async () => {
    let release!: (value: THREE.AnimationClip) => void;
    const decoded = new Promise<THREE.AnimationClip>((resolve) => {
      release = resolve;
    });
    const manager = new AnimationManager({ scene: new THREE.Group() } as VRM);
    vi.spyOn(
      manager as unknown as { _loadClip: () => Promise<THREE.AnimationClip> },
      "_loadClip",
    ).mockReturnValue(decoded);
    let current = true;
    const play = manager.playLoop("blob:ready", "idle", {
      isCurrent: () => current,
    });
    current = false;
    release(new THREE.AnimationClip("idle", 1, []));
    await expect(play).rejects.toMatchObject({ name: "AbortError" });
    expect(manager.getActiveActions()).toEqual([]);
    manager.dispose();
  });

  it("removes generated humanoid translation tracks while preserving other tracks", () => {
    const clip = new THREE.AnimationClip("silly_slap", 3.83, [
      new THREE.VectorKeyframeTrack(
        "NormalizedHips.position",
        [0, 1],
        [0, 0, 0, 0, 0, 1],
      ),
      new THREE.QuaternionKeyframeTrack(
        "NormalizedHips.quaternion",
        [0, 1],
        [0, 0, 0, 1, 0, 0.25, 0, 0.9682458],
      ),
      new THREE.NumberKeyframeTrack("happy.weight", [0, 1], [0, 1]),
    ]);

    const rooted = stripTranslationTracksForRootedPlayback(clip);

    expect(rooted).not.toBe(clip);
    expect(rooted.name).toBe("silly_slap");
    expect(rooted.duration).toBe(3.83);
    expect(rooted.tracks.map((track) => track.name)).toEqual([
      "NormalizedHips.quaternion",
      "happy.weight",
    ]);
  });

  it("reuses clips that do not contain translation tracks", () => {
    const clip = new THREE.AnimationClip("idle", 2, [
      new THREE.QuaternionKeyframeTrack(
        "NormalizedHips.quaternion",
        [0, 1],
        [0, 0, 0, 1, 0, 0, 0, 1],
      ),
    ]);

    expect(stripTranslationTracksForRootedPlayback(clip)).toBe(clip);
  });
});
