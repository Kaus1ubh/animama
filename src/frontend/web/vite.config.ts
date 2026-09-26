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
} from "./vite-plugins/local-parakeet-models";
import { browserRuntimeAssetsPlugin } from "./vite-plugins/browser-runtime-assets";
import {
  localAPIProxy,
  localDevelopmentOrigins,
  localDevelopmentRouteFence,
} from "./vite-plugins/local-api-proxy";

const webRoot = fileURLToPath(new URL(".", import.meta.url));
const webSrc = fileURLToPath(new URL("./src", import.meta.url));
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
  { route: "/effects/vfx/face", source: "vfx/avatar/face" },
  {
    route: "/effects/resources/scene-vfx/twemoji",
    source: "resources/scene-vfx/twemoji",
  },
] as const;
const publicParakeetModelBaseUrl = "/onnx/models/parakeet-tdt-0.6b-v2";
const localParakeetModelBaseUrl = "/__client-parakeet-models";
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
  "twemoji",
  "use-stick-to-bottom",
  "zod",
  "zustand",
] as const;

export const devOptimizedDependencies = [
  // The hashing worker is requested only after a user starts an Asset upload,
  // so Vite's startup crawler cannot discover this import on a cold dev stack.
  // Pre-bundle it at startup; otherwise the first hash triggers Vite's
  // late-dependency optimization and a full-page reload that strands the draft.
  "@noble/hashes/sha2.js",
  "onnxruntime-web",
  "parakeet.js",
] as const;

// Vite is a development-only application origin; keep its host policy enabled.
export const localViteAllowedHosts = [
  new URL(localDevelopmentOrigins().publicOrigin).hostname,
];

export default defineConfig(({ mode, command, isPreview }) => {
  const embeddedDesktop = mode === "embedded-desktop";
  const envParakeetModelBaseUrl =
    process.env.VITE_CLIENT_PARAKEET_MODEL_BASE_URL?.trim();
  const useLocalParakeetModels =
    !embeddedDesktop && !envParakeetModelBaseUrl && command === "serve";
  const clientParakeetModelBaseUrl =
    (!embeddedDesktop && envParakeetModelBaseUrl) ||
    (embeddedDesktop ? publicParakeetModelBaseUrl : localParakeetModelBaseUrl);

  return {
    plugins: [
      localDevelopmentRouteFence(),
      browserRuntimeAssetsPlugin(),
      includedContentCompatibilityPlugin({
        includedRoot: includedContentRoot,
        aliases: includedContentAliases,
        copyBuildAliases: !embeddedDesktop,
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
      __CLIENT_PARAKEET_MODEL_BASE_URL__: JSON.stringify(
        clientParakeetModelBaseUrl,
      ),
    },
    optimizeDeps: {
      include: [...devOptimizedDependencies],
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
      fs: {
        allow: [webRoot, publicPackagesRoot, safetyDocsRoot],
      },
    },
    preview: {
      allowedHosts: [...localViteAllowedHosts],
    },
  };
});
