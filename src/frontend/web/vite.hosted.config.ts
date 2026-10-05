import { fileURLToPath, URL } from "node:url";
import { defineConfig, mergeConfig, type Plugin } from "vite";
import sharedConfig from "./vite.config";

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
  };
  return mergeConfig(base, {
    plugins: [entry],
    build: {
      outDir: "dist-hosted",
      rollupOptions: {
        input: fileURLToPath(new URL("./index.hosted.html", import.meta.url)),
      },
    },
  });
});
