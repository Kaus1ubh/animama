import { resolve, sep } from "node:path";
import { stat } from "node:fs/promises";
import type { Plugin } from "vite";

import {
  installPreviewAssetCachePolicy,
  readBuildAssetInventory,
} from "../../server/src/gateway/app-asset-cache";

/** Preview stays private behind Hono, which preserves these response headers unchanged. */
export function appAssetCachePlugin(): Plugin {
  return {
    name: "animama-app-asset-cache",
    async configurePreviewServer(server) {
      const root = resolve(server.config.root, server.config.build.outDir);
      const inventoryRoot = resolve(root, ".vite");
      const inventory = await readBuildAssetInventory(root);
      server.middlewares.use(async (request, response, next) => {
        let pathname: string;
        try {
          pathname = decodeURIComponent(
            new URL(request.url ?? "/", "http://preview.local").pathname,
          );
        } catch {
          response.writeHead(400, { "cache-control": "no-store" });
          response.end();
          return;
        }
        const candidate = resolve(root, `.${pathname}`);
        // Compare normalized paths too: encoded slashes must not reveal the
        // server's inventory through an alternate spelling of its directory.
        const hiddenOrOutside =
          (candidate !== root && !candidate.startsWith(`${root}${sep}`)) ||
          candidate === inventoryRoot ||
          candidate.startsWith(`${inventoryRoot}${sep}`);
        // Vite's broad history fallback must never turn a retired chunk into
        // a successful HTML document. Let its normal handler serve real files.
        const missingAsset =
          !hiddenOrOutside &&
          pathname.startsWith("/assets/") &&
          !(await stat(candidate).catch(() => null))?.isFile();
        if (hiddenOrOutside || missingAsset) {
          response.writeHead(404, { "cache-control": "no-store" });
          response.end();
          return;
        }
        installPreviewAssetCachePolicy(request, response, inventory);
        next();
      });
    },
  };
}
