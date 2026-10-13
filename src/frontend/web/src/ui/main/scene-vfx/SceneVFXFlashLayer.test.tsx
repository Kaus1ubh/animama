// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";

import allLayers from "@/lib/content/fixtures/scene-effect-all-layers.json";
import { buildSceneVFXRuntimeEntry } from "@/lib/scene-vfx/runtime-state";
import { sceneEntryFromDefinition } from "@/lib/scene-vfx/sceneDefinition";
import type {
  ResolvedSceneBackgroundLayersVFXEntry,
  SceneVFXRuntimeEntry,
} from "@/lib/scene-vfx/types";
import { CanvasViewportProvider } from "@/ui/main/canvas/CanvasViewportContext";
import { SceneVFXBackgroundLayersEffect } from "./SceneVFXBackgroundLayersEffect";

const VIEWPORT = { width: 320, height: 200, aspectRatio: 1.6, hasSize: true };

/** The all-layers fixture as a runtime entry started at `startedAtMs`. */
function started(
  startedAtMs: number,
): SceneVFXRuntimeEntry<ResolvedSceneBackgroundLayersVFXEntry> {
  const { entry } = sceneEntryFromDefinition(
    allLayers,
    { id: "affection", label: "Affection" },
    (name) => `blob:${name}`,
  );
  return {
    ...buildSceneVFXRuntimeEntry(entry),
    startedAtMs,
  } as SceneVFXRuntimeEntry<ResolvedSceneBackgroundLayersVFXEntry>;
}

describe("SceneVFXBackgroundLayersEffect", () => {
  it("draws every optional layer and replays the entry flash on each start", () => {
    const host = document.createElement("div");
    const root = createRoot(host);
    const render = (runtimeEntry: ReturnType<typeof started>) =>
      act(() =>
        root.render(
          <CanvasViewportProvider value={VIEWPORT}>
            <SceneVFXBackgroundLayersEffect runtimeEntry={runtimeEntry} />
          </CanvasViewportProvider>,
        ),
      );
    render(started(1000));
    const layers = [...host.querySelectorAll("[data-scene-vfx-layer]")].map(
      (layer) => layer.getAttribute("data-scene-vfx-layer"),
    );
    expect(new Set(layers)).toEqual(
      new Set(["gradient", "pattern", "tile", "rays", "scatter", "flash"]),
    );
    const firstFlash = host.querySelector('[data-scene-vfx-layer="flash"]');
    // The same start keeps the element; a new start replaces it, so the
    // one-shot CSS animation runs again.
    render(started(1000));
    expect(host.querySelector('[data-scene-vfx-layer="flash"]')).toBe(
      firstFlash,
    );
    render(started(2000));
    expect(host.querySelector('[data-scene-vfx-layer="flash"]')).not.toBe(
      firstFlash,
    );
    act(() => root.unmount());
  });
});
