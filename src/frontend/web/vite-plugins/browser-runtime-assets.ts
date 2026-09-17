import path from "node:path";
import type { Plugin, ResolvedConfig } from "vite";
import {
  copyBrowserRuntimeAssets,
  resolveBrowserRuntimeAssets,
  isOptionalBrowserCatalog,
  resolveOptionalBrowserCatalog,
  verifyOptionalBrowserCatalogs,
  type ResolvedBrowserRuntimeAsset,
} from "../../scripts/browser-runtime-assets.mjs";
import {
  installLocalAssetMiddleware,
  type MiddlewareServer,
} from "./local-parakeet-models";

type RuntimeAsset = ResolvedBrowserRuntimeAsset;

/** Keep existing URLs and worker-relative imports independent of storage location. */
export function installBrowserRuntimeAssets(
  server: MiddlewareServer,
  assets: RuntimeAsset[],
  publicRoot?: string,
): void {
  const inventory = new Map(
    assets.map((asset) => [`/onnx/${asset.path}`, asset]),
  );
  installLocalAssetMiddleware(server, (requestUrl) => {
    const raw = requestUrl?.split("?")[0] ?? "";
    if (raw !== "/onnx" && !raw.startsWith("/onnx/")) return null;
    if (raw.startsWith("/onnx/models/parakeet-tdt-0.6b-v2/")) return null;
    let pathname: string;
    try {
      pathname = decodeURIComponent(raw);
    } catch {
      throw Object.assign(new Error("Invalid URL encoding"), {
        statusCode: 400,
      });
    }
    let asset: Pick<RuntimeAsset, "path" | "filePath" | "size"> | undefined =
      inventory.get(pathname);
    if (
      !asset &&
      publicRoot &&
      isOptionalBrowserCatalog(pathname.slice("/onnx/".length))
    ) {
      try {
        asset = resolveOptionalBrowserCatalog(
          publicRoot,
          pathname.slice("/onnx/".length),
        );
      } catch {
        throw Object.assign(new Error("Not found"), { statusCode: 404 });
      }
    }
    if (!asset)
      throw Object.assign(new Error("Not found"), { statusCode: 404 });
    const extension = path.extname(asset.path);
    return {
      filePath: asset.filePath,
      size: asset.size,
      contentType:
        extension === ".wasm"
          ? "application/wasm"
          : [".js", ".mjs"].includes(extension)
            ? "text/javascript; charset=utf-8"
            : "application/octet-stream",
    };
  });
}

/** Verify before serving/building; built artifacts retain independent model copies. */
export function browserRuntimeAssetsPlugin(): Plugin {
  let config: ResolvedConfig;
  let assets: RuntimeAsset[] = [];
  return {
    name: "animama-browser-runtime-assets",
    configResolved(value) {
      config = value;
    },
    configureServer(server) {
      if (config.publicDir) verifyOptionalBrowserCatalogs(config.publicDir);
      installBrowserRuntimeAssets(
        server,
        resolveBrowserRuntimeAssets(),
        config.publicDir || undefined,
      );
    },
    configurePreviewServer(server) {
      installBrowserRuntimeAssets(
        server,
        resolveBrowserRuntimeAssets({
          builtRoot: path.resolve(config.root, config.build.outDir),
        }),
        path.resolve(config.root, config.build.outDir),
      );
    },
    buildStart() {
      if (config.command === "build") {
        if (config.publicDir) verifyOptionalBrowserCatalogs(config.publicDir);
        assets = resolveBrowserRuntimeAssets();
      }
    },
    closeBundle() {
      if (config.command === "build" && assets.length) {
        copyBrowserRuntimeAssets(
          assets,
          path.resolve(config.root, config.build.outDir),
        );
        resolveBrowserRuntimeAssets({
          builtRoot: path.resolve(config.root, config.build.outDir),
        });
      }
    },
  };
}
