import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  includedContentCompatibilityPlugin,
  resolveAliasFile,
} from "../vite-plugins/included-content-compat";
import { includedContentAliases } from "../vite.config";

const temporaryRoots: string[] = [];

function contentRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), "animama-included-alias-"));
  temporaryRoots.push(root);
  mkdirSync(path.join(root, "avatars"));
  mkdirSync(path.join(root, "voices"));
  writeFileSync(path.join(root, "avatars", "mika.vrm"), "avatar");
  writeFileSync(path.join(root, "voices", "private.bin"), "voice");
  return root;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("Included content compatibility aliases", () => {
  const aliases = [{ route: "/vrm", source: "avatars" }] as const;

  it("uses tracked content for every shipped compatibility mount", () => {
    // Ignored development packs can exist locally while being absent from a
    // fresh checkout. Such inputs must never become required build aliases.
    const repositoryRoot = fileURLToPath(
      new URL("../../../../", import.meta.url),
    );
    const tracked = execFileSync(
      "git",
      ["ls-files", "-z", "--", "content/included"],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
      },
    ).split("\0");
    for (const alias of includedContentAliases) {
      const source = `content/included/${alias.source}`;
      expect(
        tracked.some(
          (file) => file === source || file.startsWith(`${source}/`),
        ),
        `Compatibility mount ${alias.route} requires tracked input ${source}`,
      ).toBe(true);
    }
  });

  it("fails a production build when a required compatibility input is missing", () => {
    const root = contentRoot();
    const output = mkdtempSync(path.join(tmpdir(), "animama-alias-build-"));
    temporaryRoots.push(output);
    const plugin = includedContentCompatibilityPlugin({
      includedRoot: root,
      aliases: [{ route: "/required", source: "missing" }],
    });
    const hook = plugin.writeBundle;
    if (typeof hook !== "function")
      throw new Error("Expected writeBundle hook");
    expect(() =>
      hook.call({} as never, { dir: output } as never, {}),
    ).toThrow();
  });

  it("resolves a regular file inside the configured alias", () => {
    const root = contentRoot();

    expect(resolveAliasFile("/vrm/mika.vrm", root, aliases)).toBe(
      realpathSync(path.join(root, "avatars", "mika.vrm")),
    );
  });

  it("rejects encoded traversal into a different Included type", () => {
    const root = contentRoot();

    expect(
      resolveAliasFile("/vrm/%2e%2e/voices/private.bin", root, aliases),
    ).toBeNull();
  });

  it("rejects a file reached through a symlinked parent", () => {
    const root = contentRoot();
    const outside = mkdtempSync(path.join(tmpdir(), "animama-alias-outside-"));
    temporaryRoots.push(outside);
    writeFileSync(path.join(outside, "escaped.vrm"), "outside");
    symlinkSync(outside, path.join(root, "avatars", "linked"));

    expect(
      resolveAliasFile("/vrm/linked/escaped.vrm", root, aliases),
    ).toBeNull();
  });

  it.each([true, false])(
    "copies production aliases only when enabled (%s)",
    (copyBuildAliases) => {
      const root = contentRoot();
      const output = mkdtempSync(path.join(tmpdir(), "animama-alias-build-"));
      temporaryRoots.push(output);
      const plugin = includedContentCompatibilityPlugin({
        includedRoot: root,
        aliases,
        copyBuildAliases,
      });
      const hook = plugin.writeBundle;
      if (typeof hook !== "function")
        throw new Error("Expected writeBundle hook");
      hook.call({} as never, { dir: output } as never, {});
      expect(existsSync(path.join(output, "vrm/mika.vrm"))).toBe(
        copyBuildAliases,
      );
      expect(typeof plugin.configureServer).toBe("function");
      expect(typeof plugin.configurePreviewServer).toBe("function");
    },
  );
});
