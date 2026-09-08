import { createHash } from "node:crypto";
import { mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFrontendApp } from "../src/app.js";
import { PARAKEET_MOUNT } from "../src/gateway/model-pack.js";

describe("same-origin optional model mount", () => {
  let root: string;
  let runtime: Awaited<ReturnType<typeof createFrontendApp>>;
  const bytes = Buffer.from("model-fixture");
  const sha = createHash("sha256").update(bytes).digest("hex");
  const headers = {
    Host: "gateway.test",
    Origin: "http://gateway.test",
    "Sec-Fetch-Site": "same-origin",
    Cookie: "animama_renderer_capability=fixture",
  };
  beforeEach(async () => {
    root = await mkdtemp(
      path.join(await realpath(tmpdir()), "animama-model-mount-"),
    );
    await writeFile(path.join(root, "encoder.onnx"), bytes);
    runtime = await createFrontendApp({
      publicOrigin: new URL("http://gateway.test"),
      fastApiOrigin: new URL("http://127.0.0.1:9"),
      staticRoot: root,
      internalTokenSource: { kind: "value", value: "a".repeat(64) },
      principalProvider: { getInstallationPrincipalId: async () => "owner" },
      rendererCapability: { value: "fixture" },
      parakeetMount: {
        root,
        version: "0.1.0-exact",
        files: [
          {
            path: "encoder.onnx",
            size_bytes: bytes.length,
            sha256: sha,
            media_type: "application/octet-stream",
          },
        ],
      },
    });
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });
  const request = (
    suffix = "encoder.onnx?v=0.1.0-exact",
    init: RequestInit = {},
  ) =>
    runtime.app.request(`http://gateway.test${PARAKEET_MOUNT}${suffix}`, {
      ...init,
      headers: { ...headers, ...init.headers },
    });

  it("serves immutable exact-version bytes with ETag, HEAD, ranges and If-Range", async () => {
    const full = await request();
    expect(full.status).toBe(200);
    expect(Buffer.from(await full.arrayBuffer())).toEqual(bytes);
    expect(full.headers.get("Cache-Control")).toContain("immutable");
    const head = await request(undefined, { method: "HEAD" });
    expect(await head.text()).toBe("");
    expect(head.headers.get("Content-Length")).toBe(String(bytes.length));
    const range = await request(undefined, { headers: { Range: "bytes=2-5" } });
    expect(range.status).toBe(206);
    expect(await range.text()).toBe(bytes.subarray(2, 6).toString());
    expect(range.headers.get("Content-Range")).toBe(
      `bytes 2-5/${bytes.length}`,
    );
    const suffix = await request(undefined, { headers: { Range: "bytes=-3" } });
    expect(await suffix.text()).toBe(bytes.subarray(-3).toString());
    const staleRange = await request(undefined, {
      headers: { Range: "bytes=2-5", "If-Range": '"old"' },
    });
    expect(staleRange.status).toBe(200);
    await staleRange.body?.cancel();
    expect(
      (await request(undefined, { headers: { "If-None-Match": `"${sha}"` } }))
        .status,
    ).toBe(304);
    const unversioned = await request("encoder.onnx");
    expect(unversioned.headers.get("Cache-Control")).not.toContain("immutable");
    await unversioned.body?.cancel();
  });
  it.each(["bytes=0-1,3-4", "bytes=500-", "bytes=-0", "bytes=a-b"])(
    "rejects unsupported or unsatisfiable range %s",
    async (range) => {
      expect(
        (await request(undefined, { headers: { Range: range } })).status,
      ).toBe(416);
    },
  );
  it("rejects hostile origins, stale versions, undeclared files and path escapes", async () => {
    expect(
      (
        await request(undefined, {
          headers: { Origin: "https://hostile.invalid" },
        })
      ).status,
    ).toBe(403);
    expect((await request(undefined, { headers: { Cookie: "" } })).status).toBe(
      401,
    );
    for (const suffix of [
      "encoder.onnx?v=old",
      "private.txt",
      "..%2Fprivate.txt",
      "%2Fencoder.onnx",
    ])
      expect((await request(suffix)).status).toBe(404);
  });
  it("never follows a substituted symlink or serves changed-length bytes", async () => {
    await writeFile(path.join(root, "encoder.onnx"), "changed");
    expect((await request()).status).toBe(404);
    await rm(path.join(root, "encoder.onnx"));
    await writeFile(path.join(root, "other.onnx"), bytes);
    await symlink(
      path.join(root, "other.onnx"),
      path.join(root, "encoder.onnx"),
    );
    expect((await request()).status).toBe(404);
  });
});
