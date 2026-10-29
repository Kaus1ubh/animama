import type { LilToonMaterial } from "@mochiya/three-liltoon";
import type { VRMLoaderPlugin } from "@pixiv/three-vrm";
import type * as THREE from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";

import { createLogger } from "@/lib/logger";

import { installLilToonDepthPrepass } from "./depthPrepass";
import {
  installLilToonGpuCheck,
  rememberAvatarCanvasGpu,
} from "./lilToonGpuCheck";

/**
 * Authored lilToon materials through three-liltoon, loaded only when needed.
 *
 * Mochiya Avatar Tools exports a VRChat Avatar's lilToon settings in the
 * `MOCHIYA_materials_liltoon` glTF extension, beside plain glTF fallback
 * materials. three-liltoon renders them, but it is about 2 MB of shader code,
 * so it is imported only when a loaded file declares the extension. Materials
 * without it, including every Included Avatar's, load exactly as before.
 *
 * Once the runtime has loaded, every Avatar renderer registered with
 * `installLilToonRenderingWhenLoaded` gains lilToon's outline and extra passes
 * and Animama's depth pre-pass for opaque lilToon primitives
 * (`depthPrepass.ts`); renderers of sessions that never load such an Avatar
 * are untouched.
 *
 * If the import fails, the glTF fallback materials load in development and in
 * the review tools, and a later Avatar retries. In a built app a failed chunk
 * load is the app's stale-file case instead: `PageLoadError` replaces the app
 * with its reload screen, as for any other lazily loaded code.
 */

const logger = createLogger("LilToon");

/** The glTF extension that carries authored lilToon material settings. */
export const LILTOON_MATERIALS_EXTENSION = "MOCHIYA_materials_liltoon";

/** The parts of three-liltoon Animama uses. */
export type LilToonRuntime = {
  /**
   * Make a VRM loader plugin build lilToon materials and lilToon expression
   * bindings (three-liltoon's `enableLilToonVRM`). Called from the plugin's
   * `beforeRoot`, before any material loads; GLTFLoader reads the plugin's
   * `loadMaterial` and `afterRoot` when it calls them.
   */
  enhancePlugin: (plugin: VRMLoaderPlugin) => void;
  /**
   * Install lilToon's passes and the depth pre-pass on a renderer; returns
   * their release.
   */
  enableRendering: (renderer: THREE.WebGLRenderer) => () => void;
};

/** Whether a glTF JSON document declares authored lilToon materials. */
export function usesLilToonMaterials(json: unknown): boolean {
  const used = (json as { extensionsUsed?: unknown } | null)?.extensionsUsed;
  return Array.isArray(used) && used.includes(LILTOON_MATERIALS_EXTENSION);
}

/**
 * How a loaded file's authored lilToon materials render: `none` when it has
 * none; `fallback` when its glTF fallback materials loaded instead (the Simple
 * material setting, or three-liltoon failed to load).
 */
export type LilToonMaterialState = "none" | "rendered" | "fallback";

export function lilToonMaterialStateOf(gltf: GLTF): LilToonMaterialState {
  if (!usesLilToonMaterials(gltf.parser.json)) return "none";
  let rendered = false;
  gltf.scene.traverse((object) => {
    const material = (object as THREE.Mesh).material;
    if (!material) return;
    for (const entry of Array.isArray(material) ? material : [material]) {
      // Set by three-liltoon's `LilToonMaterial`.
      if ((entry as { isLilToonMaterial?: boolean }).isLilToonMaterial)
        rendered = true;
    }
  });
  return rendered ? "rendered" : "fallback";
}

/**
 * lilToon's outline vertex-colour mode 2 takes the outline's direction from
 * the vertex colour's RGB (a tangent-space normal baked by the Avatar's
 * author) and its width from the alpha. Exports that drop vertex colours
 * leave three-liltoon reading white, which pushes the outline along tangent +
 * bitangent + normal at about 1.7 times its width, through thin parts such as
 * hair tips. Outlined materials on meshes without vertex colours use mode 0
 * instead: the mesh normal (or the outline vector texture), with the width
 * mask still applied. GLTFLoader gives meshes with and without colours their
 * own material copies, so meshes that keep their colours draw as authored.
 * Mode 1 (width from red) is left alone: without colours it keeps its
 * direction and reads full width, as Unity does for a mesh without colours.
 * Returns the names of the materials changed.
 */
function fallBackFromMissingOutlineColours(scene: THREE.Object3D): string[] {
  const coloured = new Map<LilToonMaterial, boolean>();
  scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const hasColour = mesh.geometry.hasAttribute("color");
    for (const entry of Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material]) {
      if (isVertexColourOutline(entry))
        coloured.set(entry, (coloured.get(entry) ?? false) || hasColour);
    }
  });
  const changed = new Set<string>();
  for (const [material, hasColour] of coloured) {
    if (hasColour) continue;
    material.setProperty("_OutlineVertexR2Width", 0);
    changed.add(material.name);
  }
  return [...changed];
}

/** An outlined lilToon material whose outline reads vertex colours (mode 2). */
function isVertexColourOutline(
  material: THREE.Material,
): material is LilToonMaterial {
  const lilToon = material as Partial<LilToonMaterial>;
  return (
    lilToon.isLilToonMaterial === true &&
    lilToon.featureSet?.outline === true &&
    Number(lilToon.lilToonProperties?._OutlineVertexR2Width ?? 0) === 2
  );
}

async function importLilToonRuntime(): Promise<LilToonRuntime> {
  const [core, vrm] = await Promise.all([
    import("@mochiya/three-liltoon"),
    import("@mochiya/three-liltoon/vrm"),
  ]);
  // A cancelled `vite:preloadError` resolves the import to undefined.
  if (
    typeof core?.enableLilToon !== "function" ||
    typeof vrm?.enableLilToonVRM !== "function"
  ) {
    throw new Error("three-liltoon did not load");
  }
  return {
    enhancePlugin: (plugin) => {
      vrm.enableLilToonVRM(plugin, {
        onWarning: (warning) =>
          logger.warn("Load", "lilToon material warning", { ...warning }),
      });
    },
    enableRendering: (renderer) => {
      const releasePasses = core.enableLilToon(renderer);
      // Outermost, so it attaches its meshes before lilToon prepares a frame.
      const releasePrepass = installLilToonDepthPrepass(renderer);
      return () => {
        releasePrepass();
        releasePasses();
      };
    },
  };
}

let runtimeImporter: () => Promise<LilToonRuntime> = importLilToonRuntime;
let runtimePromise: Promise<LilToonRuntime> | null = null;
let loadedRuntime: LilToonRuntime | null = null;
const loadedListeners = new Set<(runtime: LilToonRuntime) => void>();

/** Run a renderer listener; one failing renderer must not stop the rest. */
function notify(
  listener: (runtime: LilToonRuntime) => void,
  runtime: LilToonRuntime,
): void {
  try {
    listener(runtime);
  } catch (error) {
    logger.error("Render", "Failed to install lilToon passes", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Import three-liltoon once; later calls share the same import. */
export function loadLilToonRuntime(): Promise<LilToonRuntime> {
  runtimePromise ??= runtimeImporter().then(
    (runtime) => {
      loadedRuntime = runtime;
      for (const listener of [...loadedListeners]) notify(listener, runtime);
      return runtime;
    },
    (error: unknown) => {
      // Let a later Avatar retry instead of caching the failure.
      runtimePromise = null;
      throw error;
    },
  );
  return runtimePromise;
}

/**
 * Install lilToon's passes on `renderer` as soon as the runtime is loaded (at
 * once if it already is). Returns a cleanup that releases the passes or stops
 * waiting. The renderer's GPU is noted at once, so the Materials setting's
 * Automatic can look up its measurement before the next Avatar loads
 * (`lilToonGpuCheck.ts`). With `measureGpu` (the chat canvas), the canvas
 * also times lilToon frames whenever a measurement is due.
 */
export function installLilToonRenderingWhenLoaded(
  renderer: THREE.WebGLRenderer,
  { measureGpu = false }: { measureGpu?: boolean } = {},
): () => void {
  rememberAvatarCanvasGpu(renderer);
  let release: (() => void) | null = null;
  const install = (runtime: LilToonRuntime) => {
    loadedListeners.delete(install);
    const releasePasses = runtime.enableRendering(renderer);
    let releaseCheck: () => void = () => undefined;
    try {
      // Outermost, so it times the passes and the pre-pass as well.
      if (measureGpu) releaseCheck = installLilToonGpuCheck(renderer);
    } catch (error) {
      releasePasses();
      throw error;
    }
    release = () => {
      releaseCheck();
      releasePasses();
    };
  };
  if (loadedRuntime) notify(install, loadedRuntime);
  else loadedListeners.add(install);
  return () => {
    loadedListeners.delete(install);
    release?.();
    release = null;
  };
}

/**
 * Let a VRM loader plugin build lilToon materials for files that declare the
 * extension, importing three-liltoon on demand, and fall back from outline
 * vertex colours such files lack (`fallBackFromMissingOutlineColours`). Other
 * files are untouched: the plugin gains no material hook.
 */
export function withOnDemandLilToon<T extends VRMLoaderPlugin>(plugin: T): T {
  const beforeRoot = plugin.beforeRoot.bind(plugin);
  const afterRoot = plugin.afterRoot.bind(plugin);
  plugin.afterRoot = async (gltf) => {
    await afterRoot(gltf);
    if (!usesLilToonMaterials(plugin.parser.json)) return;
    const changed = fallBackFromMissingOutlineColours(gltf.scene);
    if (changed.length)
      logger.warn(
        "Load",
        "lilToon outlines read vertex colours the file lacks; using the mesh normal",
        { materials: changed },
      );
  };
  plugin.beforeRoot = async () => {
    await beforeRoot();
    if (!usesLilToonMaterials(plugin.parser.json)) return;
    try {
      const runtime = await loadLilToonRuntime();
      runtime.enhancePlugin(plugin);
    } catch (error) {
      // The glTF fallback materials still load, so the Avatar stays usable.
      logger.error("Load", "Failed to load lilToon; using fallback materials", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
  return plugin;
}

/** Replace the runtime import, for tests; returns a restore function. */
export function setLilToonRuntimeImporterForTesting(
  importer: () => Promise<LilToonRuntime>,
): () => void {
  const previous = runtimeImporter;
  runtimeImporter = importer;
  runtimePromise = null;
  loadedRuntime = null;
  loadedListeners.clear();
  return () => {
    runtimeImporter = previous;
    runtimePromise = null;
    loadedRuntime = null;
    loadedListeners.clear();
  };
}
