import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";

import {
  includedContentCompatibilityPlugin,
  type IncludedContentAlias,
} from "./vite-plugins/included-content-compat";
import {
  localParakeetModelPlugin,
  resolveLocalParakeetModelDir,
  resolveLocalParakeetWebgpuModelDir,
} from "./vite-plugins/local-parakeet-models";
import { resolveAppVersion } from "./vite-plugins/app-version";
import { browserRuntimeAssetsPlugin } from "./vite-plugins/browser-runtime-assets";
import { webpStickerAssetsPlugin } from "./vite-plugins/webp-sticker-assets";
import {
  localAPIProxy,
  localDevelopmentOrigins,
  localDevelopmentRouteFence,
} from "./vite-plugins/local-api-proxy";

const webRoot = fileURLToPath(new URL(".", import.meta.url));
const webSrc = fileURLToPath(new URL("./src", import.meta.url));
const appVersion = resolveAppVersion();
const publicPackagesRoot = fileURLToPath(
  new URL("../packages", import.meta.url),
);
// The Safety page renders the canonical protocol document from the repository.
const safetyDocsRoot = fileURLToPath(
  new URL("../../../docs/safety", import.meta.url),
);
const includedContentRoot = fileURLToPath(
  new URL("../../../content/included", import.meta.url),
);
export const includedContentAliases: readonly IncludedContentAlias[] = [
  { route: "/background", source: "appearances" },
  { route: "/effects/scene-vfx", source: "vfx/scene" },
  { route: "/effects/vfx/quark", source: "vfx/particle/quark" },
  {
    route: "/effects/vfx/particle-vfx",
    source: "vfx/particle/particle-vfx",
  },
] as const;
const localParakeetModelBaseUrl = "/__client-parakeet-models";
const localParakeetWebgpuModelBaseUrl = "/__client-parakeet-webgpu-models";
// Where each build serves the Parakeet sets. Built apps (packaged desktop and
// self-host) download them in the app and FastAPI serves them; Vite
// development serves the operator's verified host sets and offers no
// downloads. An absent set is simply a 404.
const parakeetModels = {
  "asset-store": {
    source: "asset-store",
    baseUrl: "/onnx/models/parakeet-tdt-0.6b-v2",
    webgpuBaseUrl: "/onnx/models/parakeet-tdt-0.6b-v2-webgpu",
  },
  operator: {
    source: "operator",
    baseUrl: localParakeetModelBaseUrl,
    webgpuBaseUrl: localParakeetWebgpuModelBaseUrl,
  },
} as const;
// Reviewed model attributions bundled for the speech and voice-cloning
// settings. Allow only these notice folders, never the whole models directory.
const modelNoticeRoots = [
  "parakeet-tdt-0.6b-v2-webgpu",
  "pocket-tts-voice-cloning",
].map((folder) =>
  fileURLToPath(new URL(`../../../models/${folder}`, import.meta.url)),
);
// The self-hosted typeface resolves into the workspace package store, outside
// the web root; allow only its package directory so dev can serve the files.
const requireFromWeb = createRequire(import.meta.url);
const fontPackageRoot = path.dirname(
  requireFromWeb.resolve("@fontsource-variable/dm-sans/package.json"),
);
const rechartsEsToolkitCompat = fileURLToPath(
  new URL("./src/lib/recharts/es-toolkit-compat", import.meta.url),
);

const routerConfig = {
  target: "react",
  routesDirectory: "./src/routes",
  generatedRouteTree: "./src/routeTree.gen.ts",
  quoteStyle: "double",
  semicolons: true,
  autoCodeSplitting: true,
} as const;

const appDependencies = [
  "@gltf-transform/core",
  "@gltf-transform/extensions",
  "@hookform/resolvers",
  "@opentelemetry/api",
  "@pixiv/three-vrm",
  "@pixiv/three-vrm-animation",
  "@radix-ui/react-avatar",
  "@radix-ui/react-checkbox",
  "@radix-ui/react-dialog",
  "@radix-ui/react-dropdown-menu",
  "@radix-ui/react-label",
  "@radix-ui/react-popover",
  "@radix-ui/react-radio-group",
  "@radix-ui/react-select",
  "@radix-ui/react-slot",
  "@radix-ui/react-switch",
  "@radix-ui/react-tabs",
  "@radix-ui/react-tooltip",
  "@react-three/drei",
  "@react-three/fiber",
  "@ricky0123/vad-web",
  "@tanstack/react-query",
  "@tanstack/react-router",
  "class-variance-authority",
  "clsx",
  "color",
  "lucide-react",
  "motion",
  "next-themes",
  "onnxruntime-web",
  "parakeet.js",
  "radix-ui",
  "react",
  "react-dom",
  "react-hook-form",
  "sonner",
  "streamdown",
  "tailwind-merge",
  "three",
  "use-stick-to-bottom",
  "zod",
  "zustand",
  "i18next",
  "react-i18next",
] as const;

export const devOptimizedDependencies = [
  // The hashing worker is requested only after a user starts an Asset upload,
  // so Vite's startup crawler cannot discover this import on a cold dev stack.
  // Pre-bundle it at startup; otherwise the first hash triggers Vite's
  // late-dependency optimization and a full-page reload that strands the draft.
  "@noble/hashes/sha2.js",
  "onnxruntime-web",
  "parakeet.js",
  // The i18n runtime is imported through the linked product-ui build. Pre-bundle
  // it at startup so loading a locale's first catalog cannot trigger a late
  // dependency optimization; a fresh dev session once left mounted text in the
  // previous language after the first switch.
  "i18next",
  "react-i18next",
  // The lip-sync worker loads Chinese readings with the first spoken reply; a
  // late optimization would reload the page as that reply starts speaking.
  "pinyin-pro",
] as const;

// Pages the dev server serves, relative to the web root. Vite otherwise scans
// every `*.html` here, including tool pages that run on their own servers; the
// landing stage imports a virtual module only its server provides, and that
// unresolved import aborts the whole scan, so dependencies are found at
// runtime and each discovery reloads the open page.
export const devDependencyScanEntries = [
  "index.html",
  "index.hosted.html",
  "parakeet-bench.html",
] as const;

// Vite is a development-only application origin; keep its host policy enabled.
export const localViteAllowedHosts = [
  new URL(localDevelopmentOrigins().publicOrigin).hostname,
];

export default defineConfig(({ mode, command, isPreview }) => {
  const embeddedDesktop = mode === "embedded-desktop";
  const useLocalParakeetModels = command === "serve";

  return {
    plugins: [
      localDevelopmentRouteFence(),
      browserRuntimeAssetsPlugin(),
      includedContentCompatibilityPlugin({
        includedRoot: includedContentRoot,
        aliases: includedContentAliases,
        copyBuildAliases: !embeddedDesktop && mode !== "hosted",
      }),
      webpStickerAssetsPlugin({
        stickerRoot: path.join(
          includedContentRoot,
          "resources/scene-vfx/stickers",
        ),
      }),
      tanstackRouter(routerConfig),
      react(),
      ...(useLocalParakeetModels
        ? [
            // Keep the large Parakeet ONNX files out of Vite public/dist while
            // still giving browser code a same-origin URL in local dev/preview.
            localParakeetModelPlugin({
              modelDir: resolveLocalParakeetModelDir,
              routeBaseUrl: localParakeetModelBaseUrl,
            }),
            localParakeetModelPlugin({
              modelDir: resolveLocalParakeetWebgpuModelDir,
              routeBaseUrl: localParakeetWebgpuModelBaseUrl,
            }),
          ]
        : []),
    ],
    build: {
      manifest: true,
      rollupOptions: {
        output: {
          // Keep React out of route/app chunks so route splitting never creates
          // a circular dependency through the shared framework runtime.
          manualChunks(id) {
            if (
              id.includes("/node_modules/react/") ||
              id.includes("/node_modules/react-dom/") ||
              id.includes("/node_modules/scheduler/")
            ) {
              return "react-vendor";
            }
          },
        },
      },
    },
    define: {
      // Keep this literal at dynamic-import sites: cross-chunk exported flags
      // alone can leave unreachable inspector chunks in Rolldown's output.
      __ANIMAMA_DEV_BUILD__: JSON.stringify(command === "serve" && !isPreview),
      // A custom mode or inherited development NODE_ENV cannot enable debug
      // imports in a built app, including the embedded-desktop renderer.
      ...(command === "build" || isPreview
        ? { "import.meta.env.VITE_ENABLE_DEBUG_PANEL": JSON.stringify("false") }
        : {}),
      __ANIMAMA_APP_VERSION__: JSON.stringify(appVersion),
      __CLIENT_PARAKEET_MODELS__: JSON.stringify(
        parakeetModels[useLocalParakeetModels ? "operator" : "asset-store"],
      ),
    },
    optimizeDeps: {
      entries: [...devDependencyScanEntries],
      include: [...devOptimizedDependencies],
    },
    // Every bundled worker is a module worker. ES output lets a worker split
    // off data it loads on demand, such as lip-sync's Chinese readings.
    worker: {
      format: "es",
    },
    resolve: {
      alias: {
        "@": webSrc,
        "@web": webSrc,
        // Recharts imports `es-toolkit/compat/*`, but Vite's dep optimizer can
        // mis-bundle those CJS wrappers into broken self-calling requires
        // (`require_isUnsafeProperty is not a function`). Keep `es-toolkit`
        // direct and route Recharts through our ESM wrapper files.
        "es-toolkit/compat/get": path.join(rechartsEsToolkitCompat, "get.js"),
        "es-toolkit/compat/isPlainObject": path.join(
          rechartsEsToolkitCompat,
          "isPlainObject.js",
        ),
        "es-toolkit/compat/last": path.join(rechartsEsToolkitCompat, "last.js"),
        "es-toolkit/compat/maxBy": path.join(
          rechartsEsToolkitCompat,
          "maxBy.js",
        ),
        "es-toolkit/compat/minBy": path.join(
          rechartsEsToolkitCompat,
          "minBy.js",
        ),
        "es-toolkit/compat/omit": path.join(rechartsEsToolkitCompat, "omit.js"),
        "es-toolkit/compat/range": path.join(
          rechartsEsToolkitCompat,
          "range.js",
        ),
        "es-toolkit/compat/sortBy": path.join(
          rechartsEsToolkitCompat,
          "sortBy.js",
        ),
        "es-toolkit/compat/sumBy": path.join(
          rechartsEsToolkitCompat,
          "sumBy.js",
        ),
        "es-toolkit/compat/throttle": path.join(
          rechartsEsToolkitCompat,
          "throttle.js",
        ),
        "es-toolkit/compat/uniqBy": path.join(
          rechartsEsToolkitCompat,
          "uniqBy.js",
        ),
      },
      dedupe: [...appDependencies],
      tsconfigPaths: true,
    },
    server: {
      allowedHosts: [...localViteAllowedHosts],
      port: 8000,
      strictPort: true,
      proxy: localAPIProxy(localDevelopmentOrigins().apiTarget),
      watch: {
        // Vite already skips node_modules, test-results and its cache. These
        // outputs never feed the app; motion review notes are written to the
        // working directory or beside the globbed Included clips.
        ignored: ["**/coverage/**", "**/*.review.json", "**/*.review/**"],
      },
      fs: {
        allow: [
          webRoot,
          publicPackagesRoot,
          safetyDocsRoot,
          ...modelNoticeRoots,
          // The built-in pose catalog bundles Included Gesture/Reaction clips.
          includedContentRoot,
          fontPackageRoot,
        ],
      },
    },
    preview: {
      allowedHosts: [...localViteAllowedHosts],
    },
  };
});
