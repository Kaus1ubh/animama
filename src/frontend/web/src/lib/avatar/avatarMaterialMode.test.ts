import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Avatar } from "./Avatar";
import type { AvatarMaterialMode } from "./avatarSettings";
import {
  automaticDecisionSinceLoad,
  resetAvatarCanvasGpuForTesting,
  writeLilToonGpuMeasurement,
} from "./liltoon/lilToonGpuCheck";

type LoadVrm = (
  url: string,
  onProgress: unknown,
  resourceUrls: unknown,
  materialMode: AvatarMaterialMode,
) => Promise<never>;

/**
 * Load with `materialMode` and return the mode the VRM loader was asked for;
 * the loader stops the load there.
 */
async function loaderMode(
  materialMode: AvatarMaterialMode,
): Promise<{ mode: AvatarMaterialMode; avatar: Avatar }> {
  const loadVrm = vi
    .spyOn(Avatar as unknown as { _loadVrm: LoadVrm }, "_loadVrm")
    .mockRejectedValue(new Error("stop"));
  const avatar = new Avatar(new THREE.PerspectiveCamera());
  await expect(
    avatar.load({ filePath: "/converted.vrm", materialMode }),
  ).rejects.toThrow("stop");
  return { mode: loadVrm.mock.calls[0]![3], avatar };
}

/** Per-viewer storage, empty. */
function stubStorage() {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  });
}

function storeMeasurement(frameMs: number, options: { stub?: boolean } = {}) {
  if (options.stub !== false) {
    stubStorage();
    resetAvatarCanvasGpuForTesting("Apple | Test GPU");
  }
  writeLilToonGpuMeasurement("Apple | Test GPU", {
    status: "measured",
    method: 1,
    frameMs,
    frames: 60,
    pixels: 1_920_000,
    measuredAt: "2026-10-27T00:00:00.000Z",
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetAvatarCanvasGpuForTesting();
});

describe("Avatar Materials setting", () => {
  it("Automatic loads Simple after a slow lilToon measurement on this GPU", async () => {
    storeMeasurement(12);
    const { mode, avatar } = await loaderMode("automatic");
    expect(mode).toBe("simple");
    expect(avatar.materialMode).toBe("automatic");
    expect(avatar.automaticMaterials).toMatchObject({
      choice: "simple",
      reason: "slow",
      frameMs: 12,
    });
  });

  it("Automatic loads lilToon after a fast measurement or none", async () => {
    storeMeasurement(4);
    expect((await loaderMode("automatic")).mode).toBe("liltoon");
    vi.restoreAllMocks();
    resetAvatarCanvasGpuForTesting(null, null);
    const unmeasured = await loaderMode("automatic");
    expect(unmeasured.mode).toBe("liltoon");
    expect(unmeasured.avatar.automaticMaterials?.reason).toBe("not_measured");
  });

  it("an explicit setting ignores the measurement", async () => {
    storeMeasurement(12);
    const liltoon = await loaderMode("liltoon");
    expect(liltoon.mode).toBe("liltoon");
    expect(liltoon.avatar.automaticMaterials).toBeNull();
    vi.restoreAllMocks();
    expect((await loaderMode("simple")).mode).toBe("simple");
  });

  it("Automatic reads the stored measurement before any canvas notes its GPU", async () => {
    // An off-screen Diagnostics or Library load: no Avatar canvas mounted
    // yet, so the GPU a fresh context names is looked up instead.
    storeMeasurement(12);
    resetAvatarCanvasGpuForTesting(null, "Apple | Test GPU");
    const { mode, avatar } = await loaderMode("automatic");
    expect(mode).toBe("simple");
    expect(avatar.automaticMaterials?.reason).toBe("slow");
  });

  it("uses a measurement stored after a load from the next load on", async () => {
    stubStorage();
    resetAvatarCanvasGpuForTesting("Apple | Test GPU");
    const first = await loaderMode("automatic");
    expect(first.mode).toBe("liltoon");
    expect(automaticDecisionSinceLoad(first.avatar.automaticMaterials)).toBe(
      null,
    );

    // The chat canvas finishes its measurement while this Avatar is shown.
    storeMeasurement(14.4, { stub: false });
    expect(
      automaticDecisionSinceLoad(first.avatar.automaticMaterials),
    ).toMatchObject({ choice: "simple", reason: "slow", frameMs: 14.4 });
    vi.restoreAllMocks();
    const next = await loaderMode("automatic");
    expect(next.mode).toBe("simple");
    expect(automaticDecisionSinceLoad(next.avatar.automaticMaterials)).toBe(
      null,
    );
  });
});
