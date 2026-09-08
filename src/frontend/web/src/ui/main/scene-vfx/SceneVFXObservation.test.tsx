import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type {
  ResolvedSceneBackgroundLayersVFXEntry,
  SceneVFXRuntimeEntry,
} from "@/lib/scene-vfx/types";
import { CanvasViewportProvider } from "@/ui/main/canvas/CanvasViewportContext";
import { SceneVFXBackgroundLayersEffect } from "./SceneVFXBackgroundLayersEffect";

function runtimeEntry(
  enabled: boolean,
): SceneVFXRuntimeEntry<ResolvedSceneBackgroundLayersVFXEntry> {
  return {
    kind: "background_layers",
    entry: {
      id: "chaos-chibi",
      label: "Chaos Chibi",
      kind: "background_layers",
      enabled: true,
      durationMs: null,
      coverUiOverlays: false,
      dismissOnInput: false,
      solid: { enabled: false, color: "#000000" },
      pattern: {
        enabled,
        pattern: "polkadot",
        color: "#ff00ff",
        size: 12,
        spacing: 8,
        opacity: 0.4,
      },
      marquee: {
        enabled,
        items: [
          {
            id: "chibi-1",
            kind: "png",
            src: "/effects/chibi-1.png",
            label: "Chibi 1",
          },
          {
            id: "chibi-2",
            kind: "png",
            src: "/effects/chibi-2.png",
            label: "Chibi 2",
          },
        ],
        itemSize: 72,
        gap: 24,
        rowGap: 20,
        direction: "diagonal-down-left",
        itemRotationMode: "upright",
        itemRotationOffsetDeg: 0,
        speedPxPerSec: 160,
        opacity: 0.8,
      },
    },
    startedAtMs: 1_000,
    expiresAtMs: null,
  };
}

function renderEffect(enabled: boolean): string {
  return renderToStaticMarkup(
    <CanvasViewportProvider
      value={{ width: 320, height: 180, aspectRatio: 16 / 9, hasSize: true }}
    >
      <SceneVFXBackgroundLayersEffect runtimeEntry={runtimeEntry(enabled)} />
    </CanvasViewportProvider>,
  );
}

describe("Scene VFX observation metadata", () => {
  it("exposes effect, layer, animation-owner, and resolved-item identities", () => {
    const html = renderEffect(true);

    expect(html).toContain('data-scene-vfx-id="chaos-chibi"');
    expect(html).toContain('data-scene-vfx-kind="background_layers"');
    expect(html).toContain('data-scene-vfx-layer="pattern"');
    expect(html).toContain('data-scene-vfx-layer="marquee"');
    expect(html).toContain('data-scene-vfx-marquee-track="0"');
    expect(html).toContain('data-scene-vfx-item-id="chibi-1"');
    expect(html).toContain('data-scene-vfx-item-id="chibi-2"');
    expect(html).toContain("animation-name:scene-vfx-marquee-shift");
    expect(html).toContain("opacity:0.8");
  });

  it("renders no layer metadata or cells when the layers are disabled", () => {
    const html = renderEffect(false);

    expect(html).toContain('data-scene-vfx-id="chaos-chibi"');
    expect(html).not.toContain("data-scene-vfx-layer");
    expect(html).not.toContain("data-scene-vfx-marquee-track");
    expect(html).not.toContain("data-scene-vfx-item-id");
    expect(html).not.toContain("background-image");
  });
});
