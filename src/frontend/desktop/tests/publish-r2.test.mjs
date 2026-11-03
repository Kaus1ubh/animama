import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PublicationError } from "../scripts/runtime/publication.mjs";
import {
  preflightR2,
  publishR2,
  r2Credentials,
} from "../scripts/runtime/publish-r2.mjs";

const base = "https://downloads.example.test/desktop";
const distribution = { kind: "r2", base_url: base };
const credentials = {
  accountId: "a".repeat(32),
  accessKeyId: "fixture-access-key",
  secretAccessKey: "fixture-secret-value",
};
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true });
});

/** A candidate directory holding the given files, returned with their index entries. */
function candidate(files) {
  const directory = mkdtempSync(path.join(tmpdir(), "animama-r2-"));
  roots.push(directory);
  return {
    directory,
    files: Object.entries(files).map(([name, content]) => {
      writeFileSync(path.join(directory, name), content);
      return { name, sha256: sha(Buffer.from(content)) };
    }),
  };
}

/**
 * An in-memory R2 behind Cloudflare. The S3 endpoint answers signed HEADs,
 * enforces If-None-Match and the signed payload hash, rejects any write to an
 * existing object under the locked `desktop/v` prefix (409), and records every
 * PUT attempt. The public domain serves stored bytes anonymously; like the
 * edge, once it answers 404 for a full URL (query included), it keeps serving
 * that 404 for longer than one run.
 */
function fakeR2(seed = {}, { publicResponses = {}, putStatus } = {}) {
  const objects = new Map(
    Object.entries(seed).map(([key, body]) => [
      key,
      { body: Buffer.from(body) },
    ]),
  );
  const puts = [];
  const writes = [];
  const cachedMisses = new Set();
  const fetch = async (url, init = {}) => {
    const target = new URL(url);
    const method = init.method ?? "GET";
    if (
      target.hostname === `${credentials.accountId}.r2.cloudflarestorage.com`
    ) {
      const headers = new Headers(init.headers);
      const authorization = headers.get("authorization");
      expect(authorization).toMatch(
        /^AWS4-HMAC-SHA256 Credential=fixture-access-key\/\d{8}\/auto\/s3\/aws4_request, /u,
      );
      // The payload hash, and the create-only condition when present, are signed.
      const signed = /SignedHeaders=([^,]+)/u.exec(authorization)[1].split(";");
      expect(signed).toContain("x-amz-content-sha256");
      if (headers.has("if-none-match"))
        expect(signed).toContain("if-none-match");
      expect(target.pathname.startsWith("/fixture-bucket/")).toBe(true);
      const key = decodeURIComponent(
        target.pathname.slice("/fixture-bucket/".length),
      );
      if (method === "HEAD")
        return new Response(null, { status: objects.has(key) ? 200 : 404 });
      expect(method).toBe("PUT");
      puts.push(key);
      if (putStatus) return new Response(null, { status: putStatus });
      const chunks = [];
      for await (const chunk of init.body) chunks.push(Buffer.from(chunk));
      const body = Buffer.concat(chunks);
      if (sha(body) !== headers.get("x-amz-content-sha256"))
        return new Response(null, { status: 400 });
      if (key.startsWith("desktop/v") && objects.has(key))
        return new Response(null, { status: 409 });
      if (headers.get("if-none-match") === "*" && objects.has(key))
        return new Response(null, { status: 412 });
      objects.set(key, { body, cacheControl: headers.get("cache-control") });
      writes.push(key);
      return new Response(null, { status: 200 });
    }
    if (target.origin === new URL(base).origin && method === "GET") {
      expect(
        init.headers?.authorization ?? init.headers?.Authorization,
      ).toBeUndefined();
      const key = target.pathname.slice(1);
      // Scripted responses emulate propagation delay or a stale edge.
      const scripted = publicResponses[key]?.shift();
      if (scripted) return scripted();
      const object = objects.get(key);
      if (object && !cachedMisses.has(target.href))
        return new Response(object.body, { status: 200 });
      cachedMisses.add(target.href);
      return new Response(null, { status: 404 });
    }
    throw new Error(`unexpected request ${method} ${target.origin}`);
  };
  return { fetch, objects, puts, writes };
}

const publish = (r2, options) =>
  publishR2({
    distribution,
    bucket: "fixture-bucket",
    version: "0.2.0",
    credentials,
    fetch: r2.fetch,
    retryDelayMs: 0,
    ...options,
  });

describe("R2 publication", () => {
  it("uploads a preview into the version folder only, create-only and verified anonymously", async () => {
    const { directory, files } = candidate({
      "Animama-0.2.0-arm64.dmg": "dmg bytes",
      "THIRD_PARTY_NOTICES.txt": "notices",
    });
    const r2 = fakeR2();
    await publish(r2, { directory, files, preview: true });
    expect(r2.writes.sort()).toEqual([
      "desktop/v0.2.0/Animama-0.2.0-arm64.dmg",
      "desktop/v0.2.0/THIRD_PARTY_NOTICES.txt",
    ]);
    expect(
      r2.objects.get("desktop/v0.2.0/Animama-0.2.0-arm64.dmg").cacheControl,
    ).toBe("public, max-age=31536000, immutable");
    expect(r2.objects.has("desktop/latest-mac.yml")).toBe(false);
  });

  it("promotes stable by resuming identical objects and writing the feed last", async () => {
    const { directory, files } = candidate({
      "Animama-0.2.0-arm64.zip": "zip bytes",
      "latest-mac.yml": "version: 0.2.0\n",
    });
    const r2 = fakeR2({
      "desktop/v0.2.0/Animama-0.2.0-arm64.zip": "zip bytes",
      "desktop/latest-mac.yml": "version: 0.1.0\n",
    });
    await publish(r2, { directory, files, preview: false });
    expect(r2.writes.at(-1)).toBe("desktop/latest-mac.yml");
    expect(r2.objects.get("desktop/latest-mac.yml").body.toString()).toBe(
      "version: 0.2.0\n",
    );
    expect(r2.objects.get("desktop/latest-mac.yml").cacheControl).toBe(
      "no-cache",
    );
  });

  it("stops without writing the feed when an existing object differs", async () => {
    const { directory, files } = candidate({
      "Animama-0.2.0-arm64.zip": "zip bytes",
      "latest-mac.yml": "version: 0.2.0\n",
    });
    const r2 = fakeR2({
      "desktop/v0.2.0/Animama-0.2.0-arm64.zip": "other bytes",
    });
    await expect(
      publish(r2, { directory, files, preview: false }),
    ).rejects.toThrow("differs");
    expect(r2.puts).not.toContain("desktop/v0.2.0/Animama-0.2.0-arm64.zip");
    expect(r2.objects.has("desktop/latest-mac.yml")).toBe(false);
  });

  it("resumes into the locked version folder without sending existing objects again", async () => {
    const { directory, files } = candidate({
      "Animama-0.2.0-arm64.dmg": "dmg bytes",
      "backend-model-assets.json": "{}\n",
      "THIRD_PARTY_NOTICES.txt": "notices",
    });
    // An interrupted run left these; the lock rule answers 409 to any write.
    const r2 = fakeR2({
      "desktop/v0.2.0/Animama-0.2.0-arm64.dmg": "dmg bytes",
      "desktop/v0.2.0/backend-model-assets.json": "{}\n",
    });
    const rerun = () =>
      publish(r2, {
        directory,
        files,
        preview: true,
        shared: ["backend-model-assets.json"],
      });
    await rerun();
    expect(r2.puts).toEqual(["desktop/v0.2.0/THIRD_PARTY_NOTICES.txt"]);
    r2.puts.length = 0;
    await rerun();
    expect(r2.puts).toEqual([]);
  });

  it.each([
    [
      "this version",
      "version: 0.2.0\n",
      "verify it rather than publishing again",
    ],
    ["a newer version", "version: 0.3.0\n", "Never replace a stable release"],
  ])(
    "refuses before uploading when the public feed already names %s",
    async (_label, feed, message) => {
      const r2 = fakeR2({ "desktop/latest-mac.yml": feed });
      await expect(
        preflightR2({ distribution, version: "0.2.0", fetch: r2.fetch }),
      ).rejects.toThrow(message);
      expect(r2.writes).toEqual([]);
    },
  );

  it("never caches a miss on an object's exact URL before uploading it", async () => {
    const { directory, files } = candidate({
      "Animama-0.2.0-arm64.dmg": "dmg bytes",
      "backend-model-assets.json": "{}\n",
    });
    // The shared name is checked in an empty version folder, as in a first preview.
    const r2 = fakeR2();
    await publish(r2, {
      directory,
      files,
      preview: true,
      shared: ["backend-model-assets.json"],
    });
    expect(r2.writes).toContain("desktop/v0.2.0/backend-model-assets.json");
  });

  it("waits out a 404 the edge cached before the upload, but not indefinitely", async () => {
    const { directory, files } = candidate({ "notes.txt": "notes" });
    // The edge serves a cached 404 for 3 minutes: 36 reads 5 s apart.
    const cachedMiss = () =>
      Array.from(
        { length: 36 },
        () => () => new Response(null, { status: 404 }),
      );
    const r2 = fakeR2(
      {},
      { publicResponses: { "desktop/v0.2.0/notes.txt": cachedMiss() } },
    );
    await publish(r2, { directory, files, preview: true });
    expect(r2.writes).toEqual(["desktop/v0.2.0/notes.txt"]);

    const neverServed = [...cachedMiss(), ...cachedMiss()];
    await expect(
      publish(
        fakeR2(
          {},
          { publicResponses: { "desktop/v0.2.0/notes.txt": neverServed } },
        ),
        { directory, files, preview: true },
      ),
    ).rejects.toThrow("could not be read anonymously");
    expect(neverServed.length).toBeGreaterThan(0);
  });

  it("stops with a bounded message when R2 rejects an upload", async () => {
    const { directory, files } = candidate({ "notes.txt": "notes" });
    await expect(
      publish(fakeR2({}, { putStatus: 403 }), {
        directory,
        files,
        preview: true,
      }),
    ).rejects.toThrow("upload was rejected (403)");
  });

  it("refuses to write the feed when a newer release appears mid-run", async () => {
    const { directory, files } = candidate({
      "notes.txt": "notes",
      "latest-mac.yml": "version: 0.2.0\n",
    });
    const r2 = fakeR2(
      { "desktop/latest-mac.yml": "version: 0.1.0\n" },
      {
        publicResponses: {
          "desktop/latest-mac.yml": [
            () => new Response("version: 0.3.0\n", { status: 200 }),
          ],
        },
      },
    );
    await expect(
      publish(r2, { directory, files, preview: false }),
    ).rejects.toThrow("newer version");
    expect(r2.objects.get("desktop/latest-mac.yml").body.toString()).toBe(
      "version: 0.1.0\n",
    );
  });

  it("fails when the public feed read-back differs from the uploaded feed", async () => {
    const { directory, files } = candidate({
      "notes.txt": "notes",
      "latest-mac.yml": "version: 0.2.0\n",
    });
    const r2 = fakeR2(
      {},
      {
        publicResponses: {
          // First read is the preflight (empty bucket); the read-back is stale.
          "desktop/latest-mac.yml": [
            () => new Response(null, { status: 404 }),
            () => new Response("version: 0.2.0\n# other\n", { status: 200 }),
          ],
        },
      },
    );
    await expect(
      publish(r2, { directory, files, preview: false }),
    ).rejects.toThrow("does not match this candidate's feed");
  });

  it("promotes the Windows feed independently and reads the JSON feeds releases write", async () => {
    const feed = (version) =>
      JSON.stringify({ version, tag: `v${version}` }, null, 2);
    const { directory, files } = candidate({
      "Animama-0.2.0-x64-setup.exe": "installer bytes",
      "latest.yml": feed("0.2.0"),
    });
    const r2 = fakeR2({
      "desktop/latest.yml": feed("0.1.0"),
      // macOS already promoted this version; its feed is left alone.
      "desktop/latest-mac.yml": feed("0.2.0"),
    });
    await publish(r2, { directory, files, preview: false, feed: "latest.yml" });
    expect(r2.writes.at(-1)).toBe("desktop/latest.yml");
    expect(r2.writes).not.toContain("desktop/latest-mac.yml");
    expect(r2.objects.get("desktop/latest.yml").body.toString()).toBe(
      feed("0.2.0"),
    );
    await expect(
      preflightR2({
        distribution,
        version: "0.2.0",
        feed: "latest.yml",
        fetch: r2.fetch,
      }),
    ).rejects.toThrow("verify it rather than publishing again");
    await expect(
      preflightR2({
        distribution,
        version: "0.2.0",
        fetch: fakeR2({ "desktop/latest-mac.yml": feed("0.3.0") }).fetch,
      }),
    ).rejects.toThrow("Never replace a stable release");
  });

  it("checks files shared with the other target before uploading anything", async () => {
    const { directory, files } = candidate({
      "Animama-0.2.0-x64-setup.exe": "installer bytes",
      "backend-model-assets.json": "{}\r\n",
    });
    const r2 = fakeR2({
      "desktop/v0.2.0/backend-model-assets.json": "{}\n",
    });
    await expect(
      publish(r2, {
        directory,
        files,
        preview: true,
        shared: ["backend-model-assets.json"],
      }),
    ).rejects.toThrow(
      "backend-model-assets.json is already published with different bytes",
    );
    expect(r2.writes).toEqual([]);
    const same = fakeR2({
      "desktop/v0.2.0/backend-model-assets.json": "{}\r\n",
    });
    await publish(same, {
      directory,
      files,
      preview: true,
      shared: ["backend-model-assets.json"],
    });
    expect(same.writes).toContain("desktop/v0.2.0/Animama-0.2.0-x64-setup.exe");
  });

  it("accepts an empty bucket but not an unreachable public domain", async () => {
    await expect(
      preflightR2({ distribution, version: "0.2.0", fetch: fakeR2().fetch }),
    ).resolves.toBeUndefined();
    await expect(
      preflightR2({
        distribution,
        version: "0.2.0",
        fetch: async () => new Response(null, { status: 503 }),
      }),
    ).rejects.toThrow("public R2 domain");
  });

  it("requires scoped credentials and never echoes them", () => {
    expect(() => r2Credentials({})).toThrow(PublicationError);
    expect(() =>
      r2Credentials({
        ANIMAMA_R2_ACCOUNT_ID: "not-an-account",
        ANIMAMA_R2_ACCESS_KEY_ID: "k",
        ANIMAMA_R2_SECRET_ACCESS_KEY: "secret-value",
      }),
    ).toThrow(
      expect.objectContaining({
        message: expect.not.stringContaining("secret-value"),
      }),
    );
    expect(
      r2Credentials({
        ANIMAMA_R2_ACCOUNT_ID: "a".repeat(32),
        ANIMAMA_R2_ACCESS_KEY_ID: "k",
        ANIMAMA_R2_SECRET_ACCESS_KEY: "s",
      }),
    ).toEqual({
      accountId: "a".repeat(32),
      accessKeyId: "k",
      secretAccessKey: "s",
    });
  });

  it("reports upload failures with bounded messages", async () => {
    const { directory, files } = candidate({ "notes.txt": "notes" });
    const failing = async (_url, init = {}) => {
      if (init.method === "HEAD") return new Response(null, { status: 404 });
      throw new Error(`socket closed ${credentials.secretAccessKey}`);
    };
    const error = await publish(
      { fetch: failing },
      { directory, files, preview: true },
    ).catch((caught) => caught);
    expect(error).toBeInstanceOf(PublicationError);
    expect(error.message).not.toContain(credentials.secretAccessKey);
    expect(error.message).not.toContain("r2.cloudflarestorage.com");
  });
});
