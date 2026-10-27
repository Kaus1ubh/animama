import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Avatar } from "./Avatar";
import type { AvatarMaterialMode } from "./avatarSettings";
import {
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

function storeMeasurement(frameMs: number) {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  });
  resetAvatarCanvasGpuForTesting("Apple | Test GPU");
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
    resetAvatarCanvasGpuForTesting();
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
});
