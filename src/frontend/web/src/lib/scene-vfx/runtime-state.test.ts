import { describe, expect, it } from "vitest";

import {
  getSceneBackgroundLayerPresetById,
  getSceneFocusLinePresetById,
} from "./catalog";
import {
  buildSceneVFXRuntimeEntry,
  buildSceneVFXRuntimeState,
  sceneVFXActiveByKind,
} from "./runtime-state";

describe("Scene VFX runtime state", () => {
  it("normalizes and stamps a local background entry without mutating it", () => {
    const source = getSceneBackgroundLayerPresetById("shoujo-hearts");
    if (!source) throw new Error("Missing scene VFX test fixture");
    const original = structuredClone(source);
    const runtime = buildSceneVFXRuntimeEntry(source, 1_000);
    expect(source).toEqual(original);
    expect(runtime.entry).not.toBe(source);
    expect(runtime.runtimeId).toBe(source.id);
    expect(runtime.startedAtMs).toBe(1_000);
    expect(runtime.expiresAtMs).toBe(
      runtime.entry.durationMs === null
        ? null
        : 1_000 + runtime.entry.durationMs,
    );
    expect(sceneVFXActiveByKind(runtime)).toEqual({
      background_layers: runtime,
    });
  });

  it("keeps a focus entry keyed independently from global store state", () => {
    const source = getSceneFocusLinePresetById("dark");
    if (!source) throw new Error("Missing focus-lines test fixture");
    const runtime = buildSceneVFXRuntimeEntry(source, 2_000);
    const activeByKind = sceneVFXActiveByKind(runtime);
    expect(activeByKind).toEqual({ focus_lines: runtime });
    expect(buildSceneVFXRuntimeState(activeByKind)).toMatchObject({
      activeByKind: { focus_lines: runtime },
      coverUiOverlaysActive: runtime.entry.coverUiOverlays,
    });
    expect(sceneVFXActiveByKind(null)).toEqual({});
  });
});
