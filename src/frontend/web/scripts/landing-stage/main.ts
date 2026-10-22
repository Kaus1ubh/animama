import "./zod-config";
import "@fontsource-variable/dm-sans";
import "@fontsource/patrick-hand";
// Before the Scene layers' own sheet (loaded with the stage), so Tailwind's
// cascade layers keep their order (theme, base, components, utilities).
import "./stage.css";

import { devParam } from "./page";

/*
 * The page's entry. It runs the live 3D stage (`stage.ts`), or stills of her
 * (`fallback.ts`) where the stage would not run well. The choice is made
 * before either loads, so a visitor shown the stills downloads neither
 * three.js nor the Avatars.
 */

type NetworkInformation = { saveData?: boolean };

/**
 * Why to show stills instead of the live stage, or null to run it: no
 * WebGL 2, WebGL only in software (no usable graphics card), or the visitor
 * asking their browser to save data (the Avatars are tens of megabytes).
 * Slow but capable machines get the stage at a lower resolution instead.
 */
function fallbackReason(): string | null {
  if (devParam("fallback") !== null) return "requested";
  const connection = (navigator as { connection?: NetworkInformation })
    .connection;
  if (connection?.saveData) return "save-data";
  const supports = (options?: WebGLContextAttributes) => {
    const context = document
      .createElement("canvas")
      .getContext("webgl2", options);
    context?.getExtension("WEBGL_lose_context")?.loseContext();
    return context !== null;
  };
  if (supports({ failIfMajorPerformanceCaveat: true })) return null;
  return supports() ? "software-rendering" : "no-webgl";
}

const showStills = (reason: string) =>
  import("./fallback").then(({ startFallback }) => startFallback(reason));

const reason = fallbackReason();
// The stage throws while loading if it cannot start its renderer after all.
void (reason ? showStills(reason) : import("./stage")).catch(
  (error: unknown) => {
    console.error("Landing stage:", error);
    if (!reason) void showStills("stage-failed");
  },
);
