import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import { describe, expect, it } from "vitest";

import viteConfig from "../../../vite.config";

const webSrc = fileURLToPath(new URL("../..", import.meta.url));
const modelsRoot = fileURLToPath(
  new URL("../../../../../../models", import.meta.url),
);
// Relative string literals that pass through a `models/` path segment.
const modelSpecifier = /["'](\.{1,2}\/[^"'\n]*\/models\/[^"'\n]+)["']/g;

/** Whether `target` is `dir` itself or lies inside it. */
function isWithin(dir: string, target: string): boolean {
  const relative = path.relative(dir, target);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

/** Repository `models/` files imported by app source (tests excluded). */
function importedModelFiles(): string[] {
  const files = new Set<string>();
  for (const entry of readdirSync(webSrc, { recursive: true })) {
    const file = path.join(webSrc, String(entry));
    if (
      !/\.[cm]?[jt]sx?$/.test(file) ||
      /\.(test|spec)\.[cm]?[jt]sx?$/.test(file)
    )
      continue;
    for (const [, specifier] of readFileSync(file, "utf8").matchAll(
      modelSpecifier,
    )) {
      const target = path.resolve(path.dirname(file), specifier.split("?")[0]);
      if (isWithin(modelsRoot, target)) files.add(target);
    }
  }
  return [...files].sort();
}

describe("model notices in the Vite development server", () => {
  it("allows exactly the model folders whose files the app imports", async () => {
    const config =
      typeof viteConfig === "function"
        ? await viteConfig({ command: "serve", mode: "development" })
        : viteConfig;
    const allow = (config.server?.fs?.allow ?? []).map((entry) =>
      path.resolve(entry),
    );
    const imported = importedModelFiles();
    expect(imported).not.toEqual([]);

    // Each imported notice must be servable, or its module fails with a 403.
    for (const file of imported) {
      expect(
        allow.some((entry) => isWithin(entry, file)),
        `${path.relative(modelsRoot, file)} is outside server.fs.allow`,
      ).toBe(true);
    }
    // Vite is the development application origin: never expose the whole
    // models directory, and allow only folders the app actually imports from.
    expect(allow.filter((entry) => isWithin(entry, modelsRoot))).toEqual([]);
    expect(allow.filter((entry) => isWithin(modelsRoot, entry)).sort()).toEqual(
      [...new Set(imported.map((file) => path.dirname(file)))].sort(),
    );
  });
});
