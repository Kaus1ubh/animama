import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const webRoot = fileURLToPath(new URL("../../../", import.meta.url));
const sharedRoots = ["src/query", "src/hooks", "src/stores", "src/ui"];

async function sourceFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(root, entry.name);
      if (entry.isDirectory()) return sourceFiles(path);
      return /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
    }),
  );
  return nested.flat();
}

describe("local composition boundaries", () => {
  it("keeps shared feature modules independent from local installation setup", async () => {
    const files = (
      await Promise.all(
        sharedRoots.map((relative) => sourceFiles(join(webRoot, relative))),
      )
    ).flat();
    const violations: string[] = [];

    for (const file of files) {
      const source = await readFile(file, "utf8");
      if (
        source.includes("app/local-runtime") ||
        source.includes("LocalRuntimeProvider") ||
        source.includes("installation_settings") ||
        source.includes("routes/setup") ||
        source.includes("/v1/runtime/bootstrap") ||
        source.includes("/v1/runtime-context")
      ) {
        violations.push(file.slice(webRoot.length + 1));
      }
    }

    expect(violations).toEqual([]);
  });

  it("uses an explicit local entrypoint and has no Better Auth dependency", async () => {
    const [indexHtml, packageJson] = await Promise.all([
      readFile(join(webRoot, "index.html"), "utf8"),
      readFile(join(webRoot, "package.json"), "utf8"),
    ]);
    const source = await Promise.all(
      (await sourceFiles(join(webRoot, "src")))
        .filter((file) => !file.includes(`${join("src", "client")}/`))
        .filter((file) => !file.endsWith("runtime-boundaries.test.ts"))
        .map((file) => readFile(file, "utf8")),
    );

    expect(indexHtml).toContain("/src/main.local.tsx");
    expect(packageJson).not.toContain('"better-auth"');
    expect(source.join("\n")).not.toContain('from "better-auth');
  });
});
