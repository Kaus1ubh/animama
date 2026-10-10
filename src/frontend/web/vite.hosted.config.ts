import { fileURLToPath, URL } from "node:url";
import { defineConfig, mergeConfig, type Plugin } from "vite";
import sharedConfig from "./vite.config";
import {
  TEMPLATE_BASE,
  finalizeHostedBuild,
  hostedLazyResources,
} from "../scripts/hosted-build-resources.mjs";

/** Explicit build input; the product bundle contains no runtime mode switch. */
export default defineConfig(async (environment) => {
  const base =
    typeof sharedConfig === "function"
      ? await sharedConfig(environment)
      : await sharedConfig;
  const entry: Plugin = {
    name: "animama-hosted-entry",
    enforce: "post",
    generateBundle(_options, bundle) {
      const html = bundle["index.hosted.html"];
      if (html?.type === "asset") {
        delete bundle["index.hosted.html"];
        this.emitFile({
          type: "asset",
          fileName: "index.html",
          source: html.source,
        });
      }
    },
    closeBundle: {
      order: "post",
      sequential: true,
      handler() {
        finalizeHostedBuild(
          fileURLToPath(new URL("./dist-hosted", import.meta.url)),
        );
      },
    },
  };
  return mergeConfig(base, {
    base: TEMPLATE_BASE,
    plugins: [entry],
    define: {
      __ANIMAMA_LAZY_RESOURCE_PREFIXES__: JSON.stringify(
        Object.fromEntries(
          hostedLazyResources().map((r) => [r.id, r.route_prefix]),
        ),
      ),
    },
    build: {
      outDir: "dist-hosted",
      rollupOptions: {
        input: fileURLToPath(new URL("./index.hosted.html", import.meta.url)),
      },
    },
  });
});
