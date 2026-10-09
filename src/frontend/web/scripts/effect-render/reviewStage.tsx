import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";

import "@/index.css";
import type { AnimaPoseClipEventSink, Avatar } from "@/lib/avatar";
import {
  buildSceneVFXRuntimeEntry,
  type SceneVFXActiveByKind,
} from "@/lib/scene-vfx/runtime-state";
import type { SceneVFXEntry } from "@/lib/scene-vfx/types";
import { CanvasViewportProvider } from "@/ui/main/canvas/CanvasViewportContext";
import { resolveClipOwnedSceneVFXEntry } from "@/ui/main/canvas/clip-owned-scene-vfx";
import { SceneRuntimeProvider } from "@/ui/main/canvas/SceneRuntimeContext";
import {
  SceneVFXOverlayLayers,
  SceneVFXUnderlayLayers,
} from "@/ui/main/scene-vfx/SceneVFXLayers";

/** Mid-grey tile backdrop: light and dark artwork both stay readable. */
export const TILE_BACKDROP = "#8e9097";

/**
 * A shown Scene: its start (session seconds), the id diagnostics report and,
 * for a Scene a clip started, the Scene its clear brings back.
 */
type ShownScene = {
  entry: SceneVFXEntry;
  startedAt: number;
  effectId: string;
  clip: { restores: ShownScene | null } | null;
};

/**
 * One review tile as the chat draws it: Scene underlay layers, the Avatar's
 * WebGL canvas, then Scene overlay layers, over the tile backdrop. The review
 * tools capture the element from the page, so DOM Scene layers are included.
 * Each Scene Effect's animations are paused and seeked to the time since that
 * effect started, so a tile is the same on every run; an effect with a
 * duration is removed when it ends, as the chat's lifecycle bridge does.
 */
export class ReviewStage {
  readonly element: HTMLDivElement;
  private readonly canvasHost: HTMLDivElement;
  private readonly root: Root;
  private readonly layers: HTMLDivElement;
  private readonly scenes = new Map<SceneVFXEntry["kind"], ShownScene>();
  private avatar: Avatar | null = null;
  private readonly width: number;
  private readonly height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.element = document.createElement("div");
    this.element.id = "review-stage";
    Object.assign(this.element.style, {
      position: "relative",
      width: `${width}px`,
      height: `${height}px`,
      overflow: "hidden",
      background: TILE_BACKDROP,
    });
    this.layers = document.createElement("div");
    Object.assign(this.layers.style, { position: "absolute", inset: "0" });
    this.canvasHost = document.createElement("div");
    Object.assign(this.canvasHost.style, {
      position: "absolute",
      inset: "0",
      zIndex: "10",
    });
    this.element.append(this.layers, this.canvasHost);
    document.body.append(this.element);
    this.root = createRoot(this.layers);
    this.render();
  }

  /** Place the Avatar renderer's canvas between the Scene bands. */
  attachCanvas(canvas: HTMLCanvasElement, avatar: Avatar): void {
    this.avatar = avatar;
    this.canvasHost.replaceChildren(canvas);
    this.render();
  }

  /**
   * Show a Scene Effect from session time `startedAt` (seconds), replacing
   * any of its kind. `effectId` is the id diagnostics report (default the
   * entry's).
   */
  showScene(
    entry: SceneVFXEntry,
    startedAt: number,
    effectId: string = entry.id,
  ): void {
    this.scenes.set(entry.kind, { entry, startedAt, effectId, clip: null });
    this.render();
  }

  /** Remove every Scene. */
  clearScenes(): void {
    this.scenes.clear();
    this.render();
  }

  /**
   * The Scene half of a clip event sink, applying a clip's Scene Effects as
   * chat does: each lasts until the clip clears it, and a clear removes only
   * the Scene its own event started and brings back the one shown before the
   * clip. `resolve` finds a Scene by dependency alias (null reports it through
   * `onMissing`); `now` is the session time in seconds.
   */
  clipSceneSink(
    resolve: (alias: string) => SceneVFXEntry | null,
    now: () => number,
    onMissing: (alias: string) => void,
  ): Pick<AnimaPoseClipEventSink, "applySceneVFX" | "clearSceneVFX"> {
    return {
      applySceneVFX: (event, context) => {
        const scene = resolve(event.presetId);
        if (!scene) {
          onMissing(event.presetId);
          return;
        }
        const shown = this.scenes.get(event.sceneKind) ?? null;
        this.scenes.set(event.sceneKind, {
          entry: resolveClipOwnedSceneVFXEntry(event, context, () => scene),
          startedAt: now(),
          effectId: event.presetId,
          clip: { restores: shown?.clip ? shown.clip.restores : shown },
        });
        this.render();
      },
      clearSceneVFX: (event, context) => {
        const shown = this.scenes.get(event.sceneKind);
        if (!shown?.clip || shown.entry.id !== context.appliedId) return;
        if (shown.clip.restores)
          this.scenes.set(event.sceneKind, shown.clip.restores);
        else this.scenes.delete(event.sceneKind);
        this.render();
      },
    };
  }

  /** Scene Effects currently shown, by effect id. */
  sceneIds(): string[] {
    return [...this.scenes.values()].map(({ effectId }) => effectId);
  }

  /**
   * Show the Scene Effects as they are at `time` seconds of session time:
   * re-render (so layers that follow the Avatar, such as focus lines aimed
   * at the face, re-resolve against the current camera), drop effects whose
   * duration has ended, then pause each effect's animations at its own
   * elapsed time.
   */
  async seek(time: number): Promise<void> {
    for (const [kind, { entry, startedAt }] of this.scenes)
      if (
        entry.durationMs != null &&
        time - startedAt > entry.durationMs / 1000
      )
        this.scenes.delete(kind);
    this.render();
    // Let layer effects that sample the Avatar commit their state.
    await new Promise((resolve) => setTimeout(resolve, 0));
    flushSync(() => undefined);
    for (const { entry, startedAt } of this.scenes.values()) {
      const root = this.layers.querySelector(
        `[data-scene-vfx-id="${CSS.escape(entry.id)}"]`,
      );
      const elapsedMs = Math.max(0, (time - startedAt) * 1000);
      for (const animation of root?.getAnimations({ subtree: true }) ?? []) {
        animation.pause();
        animation.currentTime = elapsedMs;
      }
    }
  }

  dispose(): void {
    this.scenes.clear();
    this.root.unmount();
    this.element.remove();
  }

  private render(): void {
    const activeByKind: SceneVFXActiveByKind = {};
    for (const { entry } of this.scenes.values()) {
      const runtime = buildSceneVFXRuntimeEntry(entry);
      if (entry.kind === "focus_lines")
        activeByKind.focus_lines = runtime as NonNullable<
          SceneVFXActiveByKind["focus_lines"]
        >;
      else
        activeByKind.background_layers = runtime as NonNullable<
          SceneVFXActiveByKind["background_layers"]
        >;
    }
    const viewport = {
      width: this.width,
      height: this.height,
      aspectRatio: this.width / this.height,
      hasSize: true,
    };
    // The underlay band is z-0 and the overlay z-20; the canvas host (z 10)
    // sits between them, as the chat stacks its bands around the canvas.
    flushSync(() =>
      this.root.render(
        <CanvasViewportProvider value={viewport}>
          <SceneRuntimeProvider value={{ avatar: this.avatar }}>
            <SceneVFXUnderlayLayers activeByKind={activeByKind} />
            <SceneVFXOverlayLayers
              activeByKind={activeByKind}
              className="z-20"
            />
          </SceneRuntimeProvider>
        </CanvasViewportProvider>,
      ),
    );
  }
}
