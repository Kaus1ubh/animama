"use client";

import { useThree } from "@react-three/fiber";
import { type ReactNode, useEffect, useRef, useState } from "react";

import type { CursorLookAtInputProvider } from "@/lib/avatar";
import {
  createSceneFrameDemand,
  nextSceneFrame,
  SceneFrameDemandContext,
  sceneTargetFps,
  type SceneFrameDemand,
} from "./sceneFramePacing";

const INPUT_EVENTS = ["pointermove", "pointerdown", "wheel", "keydown"];

/**
 * Renders an on-demand (`frameloop="demand"`) canvas at the rate its scene
 * needs: 60 fps, or 30 while the Avatar idles without input. Runs its own
 * display-rate loop and renders due frames there with `advance`, whose
 * `useFrame` delta is the real time since the previous render. Requesting
 * them with `invalidate` instead would render one display frame later, and on
 * a 60 Hz display R3F's stopped loop would then drop every other frame.
 *
 * Input marks the scene active: window pointer, wheel and key events, and in
 * PiP the desktop cursor feed that drives cursor look-at.
 */
export function SceneFramePacer({
  demand,
  cursorLookAtInputProvider = null,
}: {
  demand: SceneFrameDemand;
  cursorLookAtInputProvider?: CursorLookAtInputProvider | null;
}) {
  const advance = useThree((state) => state.advance);
  // The loop keeps its schedule when the provider's identity changes.
  const cursorProviderRef = useRef(cursorLookAtInputProvider);
  useEffect(() => {
    cursorProviderRef.current = cursorLookAtInputProvider;
  }, [cursorLookAtInputProvider]);

  useEffect(() => {
    const markInput = () => {
      demand.lastInputMs = performance.now();
    };
    for (const type of INPUT_EVENTS) {
      window.addEventListener(type, markInput, { passive: true });
    }
    let lastCursorX = Number.NaN;
    let lastCursorY = Number.NaN;
    let lastFrameMs = Number.NEGATIVE_INFINITY;
    let handle = 0;
    const tick = (nowMs: number) => {
      handle = requestAnimationFrame(tick);
      const cursor = cursorProviderRef.current?.();
      if (
        cursor &&
        (cursor.clientX !== lastCursorX || cursor.clientY !== lastCursorY)
      ) {
        lastCursorX = cursor.clientX;
        lastCursorY = cursor.clientY;
        demand.lastInputMs = nowMs;
      }
      const next = nextSceneFrame(
        nowMs,
        lastFrameMs,
        sceneTargetFps(demand, nowMs),
      );
      if (next === null) return;
      lastFrameMs = next;
      advance(nowMs);
    };
    handle = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(handle);
      for (const type of INPUT_EVENTS) {
        window.removeEventListener(type, markInput);
      }
    };
  }, [advance, demand]);

  return null;
}

/**
 * Paces a `frameloop="demand"` canvas and gives its children the frame demand.
 * Render inside the Canvas. Actors that report idle through
 * `useSceneFrameDemand` drop the scene to the idle rate; others keep 60 fps.
 */
export function PacedScene({
  children,
  cursorLookAtInputProvider = null,
  enabled = true,
}: {
  children: ReactNode;
  cursorLookAtInputProvider?: CursorLookAtInputProvider | null;
  /** Off, the canvas renders only when invalidated; children stay mounted. */
  enabled?: boolean;
}) {
  const [demand] = useState(createSceneFrameDemand);
  return (
    <SceneFrameDemandContext.Provider value={demand}>
      {enabled ? (
        <SceneFramePacer
          demand={demand}
          cursorLookAtInputProvider={cursorLookAtInputProvider}
        />
      ) : null}
      {children}
    </SceneFrameDemandContext.Provider>
  );
}
