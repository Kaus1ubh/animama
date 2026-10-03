import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { publishGithub } from "../scripts/runtime/publish-github.mjs";

const distribution = { owner: "example", repo: "releases" };
let directory;
beforeEach(() => {
  directory = mkdtempSync(path.join(tmpdir(), "animama-github-"));
  vi.stubEnv("ANIMAMA_RELEASE_TOKEN", "fixture-token");
});
afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

/** A fake GitHub API holding one release of v0.2.0 with the given assets. */
function github(release, assets) {
  const uploads = [];
  const patches = [];
  vi.stubGlobal("fetch", async (url, init = {}) => {
    const { pathname, searchParams } = new URL(url);
    const json = (body) => new Response(JSON.stringify(body), { status: 200 });
    if (pathname === "/repos/example/releases") return json({ private: false });
    if (pathname.endsWith("/releases/tags/v0.2.0"))
      return release ? json(release) : new Response(null, { status: 404 });
    if (pathname.endsWith("/releases/7/assets") && init.method === "POST") {
      const name = searchParams.get("name");
      uploads.push(name);
      for await (const _chunk of init.body); // Read the upload, as GitHub would.
      return json({ digest: `sha256:${name}` });
    }
    if (pathname.endsWith("/releases/7/assets")) return json(assets);
    if (pathname.endsWith("/releases/7") && init.method === "PATCH") {
      const body = JSON.parse(init.body);
      patches.push(body);
      return json({
        ...release,
        draft: body.draft,
        prerelease: body.prerelease,
      });
    }
    throw new Error(`unexpected ${init.method ?? "GET"} ${pathname}`);
  });
  return { uploads, patches };
}

/** Candidate files whose fake digest is their own name. */
function files(...names) {
  return names.map((name) => {
    writeFileSync(path.join(directory, name), name);
    return { name, sha256: name };
  });
}

const stable = { id: 7, tag_name: "v0.2.0", draft: false, prerelease: false };
const macAssets = ["Animama-0.2.0-arm64.dmg", "latest-mac.yml"].map((name) => ({
  name,
  state: "uploaded",
  digest: `sha256:${name}`,
}));
const publish = (options) =>
  publishGithub({
    distribution,
    version: "0.2.0",
    directory,
    releaseBody: "Windows body",
    target: "win32-x64",
    ...options,
  });

describe("GitHub publication into a shared release", () => {
  it("adds Windows files to the published macOS release, feed last, keeping its description", async () => {
    const api = github(stable, macAssets);
    await publish({
      files: files(
        "latest.yml",
        "Animama-0.2.0-x64-setup.exe",
        "size-report-win32-x64.json",
      ),
      preview: false,
    });
    expect(api.uploads).toEqual([
      "Animama-0.2.0-x64-setup.exe",
      "size-report-win32-x64.json",
      "latest.yml",
    ]);
    expect(api.patches).toEqual([
      { draft: false, prerelease: false, make_latest: "true" },
    ]);
  });

  it("refuses once the target's feed is published, or a preview over a stable release", async () => {
    github(stable, [
      ...macAssets,
      { name: "latest.yml", state: "uploaded", digest: "sha256:latest.yml" },
    ]);
    await expect(
      publish({ files: files("latest.yml"), preview: false }),
    ).rejects.toThrow("Never replace a stable release");
    github(stable, macAssets);
    await expect(
      publish({ files: files("Animama-0.2.0-x64-setup.exe"), preview: true }),
    ).rejects.toThrow("Never replace a stable release");
  });

  it("refuses an unexpected file of its own target before uploading anything", async () => {
    const api = github({ ...stable, draft: true }, [
      ...macAssets,
      { name: "notes-win32-x64.txt", state: "uploaded", digest: "sha256:x" },
    ]);
    await expect(
      publish({ files: files("latest.yml"), preview: false }),
    ).rejects.toThrow("unexpected assets");
    expect(api.uploads).toEqual([]);
  });

  it("checks every existing asset before the first upload", async () => {
    const api = github({ ...stable, draft: true }, [
      {
        name: "backend-model-assets.json",
        state: "uploaded",
        digest: "sha256:other",
      },
    ]);
    await expect(
      publish({
        files: files(
          "Animama-0.2.0-x64-setup.exe",
          "backend-model-assets.json",
        ),
        preview: false,
      }),
    ).rejects.toThrow("differs or is incomplete");
    expect(api.uploads).toEqual([]);
  });
});
