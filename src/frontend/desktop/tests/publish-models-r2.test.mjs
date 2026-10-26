import { afterEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  modelDistribution,
  modelKey,
  planModelPublication,
  publishModelObjects,
  stageModelCandidate,
  verifiedModelSource,
} from "../scripts/runtime/model-publication.mjs";
import { sha256 as sha256File, writeJson } from "../scripts/runtime/common.mjs";
import { writeArtifactIndex } from "../scripts/runtime/release-artifacts.mjs";

const modelId = "parakeet-tdt-0.6b-v2-webgpu";
const origin = "https://downloads.example.test";
const credentials = {
  accountId: "a".repeat(32),
  accessKeyId: "fixture-access-key",
  secretAccessKey: "fixture-secret-value",
};
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const payload = {
  "ATTRIBUTION.md": "attribution",
  "README.md": "readme",
  "encoder-model.fp16.onnx": "encoder weights",
};

const repo = path.resolve(import.meta.dirname, "../../../..");

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true });
});
const temporary = () => {
  const root = mkdtempSync(path.join(tmpdir(), "animama-models-"));
  roots.push(root);
  return root;
};

/**
 * A fixture manifest, a verified model store holding it, and a backend asset
 * catalog whose set entry pins the complete inventory, as the Parakeet sets do.
 */
function fixtureSet(id = modelId, bytes = payload) {
  const sources = Object.fromEntries(
    JSON.parse(
      readFileSync(path.join(repo, "models", id, "manifest.json")),
    ).files.map((file) => [file.path, file.source]),
  );
  const root = temporary();
  const manifestFile = path.join(root, "manifest.json");
  writeJson(manifestFile, {
    schema_version: 1,
    model_id: id,
    license: "CC-BY-4.0",
    files: Object.entries(bytes).map(([name, content]) => ({
      path: name,
      size: Buffer.byteLength(content),
      sha256: sha(content),
      // The store accepts only the reviewed upstream source for the encoder.
      source: sources[name],
    })),
  });
  for (const name of ["ATTRIBUTION.md", "README.md"])
    writeFileSync(path.join(root, name), bytes[name]);
  const modelRoot = path.join(root, "store");
  const setDirectory = path.join(modelRoot, id, sha256File(manifestFile));
  mkdirSync(setDirectory, { recursive: true });
  for (const [name, content] of Object.entries(bytes))
    writeFileSync(path.join(setDirectory, name), content);
  const catalog = {
    schema: "animama-asset-catalog/1",
    assets: [
      {
        id: "fixture-set",
        manifest_sha256: sha256File(manifestFile),
        license_ref: "CC-BY-4.0",
        files: Object.entries(bytes).map(([name, content]) => ({
          path: name,
          url: `${origin}/models/${id}/${sha(content)}/${name}`,
          size: Buffer.byteLength(content),
          sha256: sha(content),
        })),
      },
    ],
  };
  return { root, manifestFile, modelRoot, catalog };
}

function staged() {
  const set = fixtureSet();
  const directory = path.join(set.root, "candidate");
  stageModelCandidate({
    modelId,
    directory,
    modelRoot: set.modelRoot,
    manifestFile: set.manifestFile,
  });
  return { ...set, directory };
}

/** A passing scan receipt covering the candidate's exact files. */
function passScan(directory, planned) {
  writeJson(path.join(directory, "release-scan.json"), {
    schema: "animama-release-scan/1",
    result: "pass",
    scanner: {
      version: JSON.parse(
        readFileSync(
          path.join(repo, "scripts/repository-boundary/scanner-pins.json"),
        ),
      ).gitleaks.version,
      canary: "detected",
      config_sha256: sha256File(
        path.join(
          repo,
          "src/frontend/desktop/runtime/release-scan.gitleaks.toml",
        ),
      ),
    },
    files: planned.map(({ name, sha256 }) => ({ name, sha256 })),
  });
}

/**
 * An in-memory R2. The S3 endpoint answers signed HEADs (optionally scripted
 * to simulate a race), enforces If-None-Match and the signed payload hash, and
 * records every PUT attempt; the public domain serves stored bytes.
 */
function fakeR2(seed = {}, { publicResponses = {}, headResponses = {} } = {}) {
  const objects = new Map(
    Object.entries(seed).map(([key, body]) => [key, Buffer.from(body)]),
  );
  const puts = [];
  const writes = [];
  const fetch = async (url, init = {}) => {
    const target = new URL(url);
    const method = init.method ?? "GET";
    if (
      target.hostname === `${credentials.accountId}.r2.cloudflarestorage.com`
    ) {
      const headers = new Headers(init.headers);
      expect(headers.get("authorization")).toMatch(/^AWS4-HMAC-SHA256 /u);
      const key = decodeURIComponent(
        target.pathname.slice("/fixture-bucket/".length),
      );
      if (method === "HEAD") {
        const scripted = headResponses[key]?.shift();
        if (scripted) return new Response(null, { status: scripted });
        return new Response(null, { status: objects.has(key) ? 200 : 404 });
      }
      expect(method).toBe("PUT");
      puts.push({ key, headers });
      const chunks = [];
      for await (const chunk of init.body) chunks.push(Buffer.from(chunk));
      const body = Buffer.concat(chunks);
      if (sha(body) !== headers.get("x-amz-content-sha256"))
        return new Response(null, { status: 400 });
      if (headers.get("if-none-match") === "*" && objects.has(key))
        return new Response(null, { status: 412 });
      objects.set(key, body);
      writes.push(key);
      return new Response(null, { status: 200 });
    }
    if (target.origin === origin && method === "GET") {
      expect(new Headers(init.headers).get("accept-encoding")).toBe("identity");
      const key = decodeURIComponent(target.pathname.slice(1));
      const scripted = publicResponses[key]?.shift();
      if (scripted) return scripted(objects.get(key));
      const body = objects.get(key);
      return body
        ? new Response(body, {
            status: 200,
            headers: { "content-length": String(body.length) },
          })
        : new Response(null, { status: 404 });
    }
    throw new Error(`unexpected request ${method} ${target.origin}`);
  };
  return { fetch, objects, puts, writes };
}

/** A staged candidate with its plan and a passing scan. */
function scannedCandidate() {
  const candidate = staged();
  const planned = planModelPublication({
    modelId,
    directory: candidate.directory,
    origin,
    manifestFile: candidate.manifestFile,
    catalog: candidate.catalog,
  });
  passScan(candidate.directory, planned);
  const byName = (name) => planned.find((file) => file.name === name);
  return { candidate, planned, encoder: byName("encoder-model.fp16.onnx") };
}

const publish = (candidate, planned, r2) =>
  publishModelObjects({
    directory: candidate.directory,
    planned,
    bucket: "fixture-bucket",
    credentials,
    fetch: r2.fetch,
    retryDelayMs: 0,
  });

describe("model publication", () => {
  it("publishes an explicitly sealed voice inventory independently of checkout voice names", () => {
    const directory = temporary();
    const modelId = "pocket-tts-voices";
    const bytes = {
      "ATTRIBUTION.md": "sealed attribution",
      "README.md": "sealed readme",
      "previous-release-voice.safetensors": "sealed voice bytes",
    };
    const files = Object.entries(bytes).map(([name, content]) => {
      writeFileSync(path.join(directory, name), content);
      return {
        path: name,
        size: Buffer.byteLength(content),
        sha256: sha(content),
      };
    });
    const manifestFile = path.join(directory, "manifest.json");
    writeJson(manifestFile, {
      schema_version: 1,
      model_id: modelId,
      license: "CC-BY-4.0",
      files,
    });
    writeArtifactIndex(
      directory,
      null,
      [...Object.keys(bytes), "manifest.json"],
      { model_id: modelId },
    );
    const voice = files[2];
    const planned = planModelPublication({
      modelId,
      directory,
      origin,
      manifestFile,
      catalog: {
        assets: [
          {
            url: `${origin}/models/${modelId}/${voice.sha256}/${voice.path}`,
            size: voice.size,
            sha256: voice.sha256,
          },
        ],
      },
    });
    expect(planned.map((file) => file.name)).toEqual(
      [...Object.keys(bytes), "manifest.json"].sort(),
    );
  });
  it("stages the optional Pocket cloning encoder and notices before first publication", () => {
    const cloningId = "pocket-tts-voice-cloning";
    const bytes = {
      "ATTRIBUTION.md": "reviewed attribution",
      "README.md": "optional cloning guidance",
      "mimi_encoder.onnx": "unchanged encoder bytes",
    };
    const candidate = fixtureSet(cloningId, bytes);
    const directory = path.join(candidate.root, "candidate");
    stageModelCandidate({
      modelId: cloningId,
      directory,
      manifestFile: candidate.manifestFile,
      modelRoot: candidate.modelRoot,
    });
    const encoder = bytes["mimi_encoder.onnx"];
    const catalog = {
      assets: [
        {
          id: "pocket-tts-voice-cloning-encoder",
          url: `${origin}/models/${cloningId}/${sha(encoder)}/mimi_encoder.onnx`,
          size: Buffer.byteLength(encoder),
          sha256: sha(encoder),
        },
      ],
    };
    const options = {
      modelId: cloningId,
      directory,
      manifestFile: candidate.manifestFile,
      origin,
      catalog,
    };
    expect(planModelPublication(options).map((file) => file.name)).toEqual([
      "ATTRIBUTION.md",
      "README.md",
      "manifest.json",
      "mimi_encoder.onnx",
    ]);
    catalog.assets[0].sha256 = "f".repeat(64);
    expect(() => planModelPublication(options)).toThrow(
      "catalog does not match",
    );
  });

  it("publishes base Parakeet as the backend asset set pins it", () => {
    const baseId = "parakeet-tdt-0.6b-v2";
    const manifest = JSON.parse(
      readFileSync(path.join(repo, "models", baseId, "manifest.json")),
    );
    const bytes = Object.fromEntries(
      manifest.files.map((file) => [file.path, `fixture ${file.path}`]),
    );
    const candidate = fixtureSet(baseId, bytes);
    const directory = path.join(candidate.root, "candidate");
    stageModelCandidate({
      modelId: baseId,
      directory,
      manifestFile: candidate.manifestFile,
      modelRoot: candidate.modelRoot,
    });
    const options = {
      modelId: baseId,
      directory,
      manifestFile: candidate.manifestFile,
      origin,
      catalog: candidate.catalog,
    };
    const planned = planModelPublication(options);
    expect(planned).toHaveLength(8);
    expect(
      planned.find((file) => file.name === "encoder-model.int8.onnx").url,
    ).toBe(
      `${origin}/models/${baseId}/${sha(bytes["encoder-model.int8.onnx"])}/encoder-model.int8.onnx`,
    );
    expect(planned.map((file) => file.name)).toEqual(
      expect.arrayContaining(["ATTRIBUTION.md", "README.md"]),
    );
    // Without a backend consumer, nothing justifies publishing the set.
    expect(() =>
      planModelPublication({ ...options, catalog: { assets: [] } }),
    ).toThrow("catalog does not match");
  });

  it.each(["url", "size", "sha256", "missing notice", "duplicate"])(
    "rejects backend set inventory drift: %s",
    (field) => {
      const candidate = staged();
      const catalog = structuredClone(candidate.catalog);
      const files = catalog.assets[0].files;
      if (field === "missing notice") files.shift();
      else if (field === "duplicate") files[0] = { ...files[1] };
      else files[0][field] = field === "size" ? 99 : "invalid";
      expect(() =>
        planModelPublication({
          modelId,
          directory: candidate.directory,
          manifestFile: candidate.manifestFile,
          origin,
          catalog,
        }),
      ).toThrow("catalog does not match");
    },
  );

  it("asks for a SenseVoice acquisition from the published objects", () => {
    // An empty home (LOCALAPPDATA on Windows) gives an empty default store.
    const home = mkdtempSync(path.join(tmpdir(), "animama-empty-home-"));
    vi.stubEnv("HOME", home);
    vi.stubEnv("LOCALAPPDATA", home);
    vi.stubEnv("XDG_CACHE_HOME", undefined);
    vi.stubEnv("ANIMAMA_MODEL_ROOT", undefined);
    try {
      expect(() =>
        verifiedModelSource({ modelId: "sensevoice-small" }),
      ).toThrow(
        "Acquire the set first: python3 scripts/models/sensevoice.py acquire",
      );
    } finally {
      vi.unstubAllEnvs();
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("addresses every file by its own SHA-256 under models/", () => {
    const candidate = staged();
    const planned = planModelPublication({
      modelId,
      directory: candidate.directory,
      origin,
      manifestFile: candidate.manifestFile,
      catalog: candidate.catalog,
    });
    expect(planned.map((file) => file.key)).toEqual(
      [
        ...Object.entries(payload).map(([name, content]) => [
          name,
          sha(content),
        ]),
        ["manifest.json", sha256File(candidate.manifestFile)],
      ]
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([name, digest]) => `models/${modelId}/${digest}/${name}`),
    );
    expect(modelKey(modelId, { name: "a.onnx", sha256: "f".repeat(64) })).toBe(
      `models/${modelId}/${"f".repeat(64)}/a.onnx`,
    );
  });

  it("uploads missing objects create-only with immutable caching and suffix types", async () => {
    const { candidate, planned } = scannedCandidate();
    const r2 = fakeR2();

    const outcomes = await publish(candidate, planned, r2);

    expect(r2.puts.map((put) => put.key).sort()).toEqual(
      planned.map((file) => file.key).sort(),
    );
    for (const { key, headers } of r2.puts) {
      expect(headers.get("if-none-match")).toBe("*");
      expect(headers.get("cache-control")).toBe(
        "public, max-age=31536000, immutable",
      );
      expect(headers.get("content-type")).toBe(
        key.endsWith(".md")
          ? "text/markdown; charset=utf-8"
          : key.endsWith(".json")
            ? "application/json"
            : "application/octet-stream",
      );
    }
    expect(outcomes.every((item) => item.outcome === "uploaded")).toBe(true);
  });

  it("never sends a PUT for an object the bucket already holds, even behind a stale public 404", async () => {
    const { candidate, planned, encoder } = scannedCandidate();
    const r2 = fakeR2(
      { [encoder.key]: payload["encoder-model.fp16.onnx"] },
      {
        // The edge has not seen the object yet; verification retries.
        publicResponses: {
          [encoder.key]: [() => new Response(null, { status: 404 })],
        },
      },
    );

    const outcomes = await publish(candidate, planned, r2);

    expect(r2.puts.map((put) => put.key)).not.toContain(encoder.key);
    expect(outcomes.find((item) => item.key === encoder.key).outcome).toBe(
      "already published",
    );
    // A rerun sends no PUT at all.
    r2.puts.length = 0;
    await publish(candidate, planned, r2);
    expect(r2.puts).toEqual([]);
  });

  it.each([
    ["matching", "encoder weights", null],
    // Same length, so only the digest check can catch it.
    ["differing", "encoder weightX", "differs"],
  ])(
    "verifies a %s object created concurrently (412)",
    async (_label, existing, error) => {
      const { candidate, planned, encoder } = scannedCandidate();
      const r2 = fakeR2(
        { [encoder.key]: existing },
        { headResponses: { [encoder.key]: [404] } },
      );
      const run = publish(candidate, planned, r2);
      if (error) await expect(run).rejects.toThrow(error);
      else await run;
      const attempt = r2.puts.find((put) => put.key === encoder.key);
      expect(attempt.headers.get("if-none-match")).toBe("*");
      expect(r2.writes).not.toContain(encoder.key);
    },
  );

  it.each([
    [
      "compressed",
      (body) =>
        new Response(body, {
          headers: {
            "content-encoding": "gzip",
            "content-length": String(body.length),
          },
        }),
    ],
    [
      "with the wrong length",
      (body) =>
        new Response(body, {
          headers: { "content-length": String(body.length + 1) },
        }),
    ],
  ])("refuses a public object served %s", async (_label, respond) => {
    const { candidate, planned, encoder } = scannedCandidate();
    const r2 = fakeR2(
      { [encoder.key]: payload["encoder-model.fp16.onnx"] },
      { publicResponses: { [encoder.key]: [respond] } },
    );
    await expect(publish(candidate, planned, r2)).rejects.toThrow(
      "exact uncompressed bytes",
    );
  });

  it("requires a passing scan of these exact files", async () => {
    const candidate = staged();
    const planned = planModelPublication({
      modelId,
      directory: candidate.directory,
      origin,
      manifestFile: candidate.manifestFile,
      catalog: candidate.catalog,
    });
    const r2 = fakeR2();
    await expect(publish(candidate, planned, r2)).rejects.toThrow(
      "passing release scan",
    );
    passScan(
      candidate.directory,
      planned.map((file) => ({ ...file, sha256: "0".repeat(64) })),
    );
    await expect(publish(candidate, planned, r2)).rejects.toThrow(
      "does not cover",
    );
    expect(r2.writes).toEqual([]);
  });

  it("refuses a catalog that pins an object this publication does not create", () => {
    const candidate = staged();
    const catalog = structuredClone(candidate.catalog);
    catalog.assets.push({
      id: "fixture-encoder",
      url: `${origin}/models/${modelId}/${"0".repeat(64)}/encoder-model.fp16.onnx`,
      size: Buffer.byteLength(payload["encoder-model.fp16.onnx"]),
      sha256: "0".repeat(64),
      media_type: "application/octet-stream",
      license_ref: "CC-BY-4.0",
    });
    expect(() =>
      planModelPublication({
        modelId,
        directory: candidate.directory,
        origin,
        manifestFile: candidate.manifestFile,
        catalog,
      }),
    ).toThrow("catalog does not match");
  });

  it("refuses a candidate changed after staging", () => {
    const candidate = staged();
    writeFileSync(path.join(candidate.directory, "README.md"), "changed");
    expect(() =>
      planModelPublication({
        modelId,
        directory: candidate.directory,
        origin,
        manifestFile: candidate.manifestFile,
        catalog: candidate.catalog,
      }),
    ).toThrow("stage it again");
  });

  it("never prints credentials when an upload is rejected", async () => {
    const candidate = staged();
    const planned = planModelPublication({
      modelId,
      directory: candidate.directory,
      origin,
      manifestFile: candidate.manifestFile,
      catalog: candidate.catalog,
    });
    passScan(candidate.directory, planned);
    const r2 = fakeR2();
    const rejecting = async (url, init) =>
      init?.method === "PUT"
        ? new Response(null, { status: 403 })
        : r2.fetch(url, init);
    const error = await publishModelObjects({
      directory: candidate.directory,
      planned,
      bucket: "fixture-bucket",
      credentials,
      fetch: rejecting,
      retryDelayMs: 0,
    }).catch((caught) => caught);
    expect(error.message).toContain("rejected (403)");
    expect(error.message).not.toContain(credentials.secretAccessKey);
    expect(error.message).not.toContain(credentials.accessKeyId);
  });

  it.each(["publish-r2.mjs", "publish-macos.mjs", "publish-models-r2.mjs"])(
    "%s parses under plain Node",
    (script) => {
      // Vitest rewrites imports, which can hide load-time errors such as a
      // duplicate declaration; the release commands run under plain Node.
      const result = spawnSync(process.execPath, [
        "--check",
        path.join(import.meta.dirname, "../scripts/runtime", script),
      ]);
      expect(result.stderr.toString()).toBe("");
      expect(result.status).toBe(0);
    },
  );

  it("reads the bucket and origin from the release policy", () => {
    expect(modelDistribution()).toEqual({
      origin: "https://downloads.animama.ai",
      bucket: "animama-releases",
    });
  });
});
