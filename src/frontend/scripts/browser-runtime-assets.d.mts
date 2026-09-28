export type BrowserRuntimeAsset = {
  path: string;
  size: number;
  sha256: string;
  source: {
    kind: "package" | "model-store";
    path: string;
    package?: string;
    name?: string;
    version?: string;
  };
};
export type ResolvedBrowserRuntimeAsset = BrowserRuntimeAsset & {
  filePath: string;
};
export function readBrowserRuntimeManifest(manifestPath?: string): {
  schema_version: 1;
  model_manifest: string;
  files: BrowserRuntimeAsset[];
};
export function resolveBrowserRuntimeAssets(options?: {
  manifestPath?: string;
  modelDirectory?: string;
  packagesRoot?: string;
  builtRoot?: string;
  /** Web builds may omit the optional browser speech model set. */
  allowMissingModels?: boolean;
}): ResolvedBrowserRuntimeAsset[];
export function copyBrowserRuntimeAssets(
  assets: ResolvedBrowserRuntimeAsset[],
  outputDirectory: string,
): void;

export function isOptionalBrowserCatalog(relative: string): boolean;
export function resolveOptionalBrowserCatalog(
  publicRoot: string,
  relative: string,
): {
  path: string;
  filePath: string;
  size: number;
};
export function verifyOptionalBrowserCatalogs(publicRoot: string): void;
