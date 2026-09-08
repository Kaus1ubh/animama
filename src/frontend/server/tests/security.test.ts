import { chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { loadInternalToken } from "../src/security/internal-token.js";
import { hasRendererCapability } from "../src/security/renderer-capability.js";
import { buildUpstreamUrl } from "../src/gateway/upstream-url.js";

const TOKEN = "d".repeat(64);

describe("gateway private credential sources", () => {
  it("never lets a request path replace the configured upstream authority", () => {
    const target = buildUpstreamUrl(
      new URL("http://gateway.test//hostile.invalid/escape?value=1"),
      new URL("http://private-fastapi:8000"),
    );

    expect(target.origin).toBe("http://private-fastapi:8000");
    expect(target.pathname).toBe("//hostile.invalid/escape");
    expect(target.search).toBe("?value=1");
  });

  it("requires a regular mode-0600 file containing 32 encoded bytes", async () => {
    const root = await mkdtemp(join(tmpdir(), "animama-gateway-token-"));
    try {
      const path = join(root, "token");
      await writeFile(path, `${TOKEN}\n`, { mode: 0o600 });
      expect(await loadInternalToken({ kind: "file", path })).toBe(TOKEN);

      await chmod(path, 0o644);
      await expect(loadInternalToken({ kind: "file", path })).rejects.toThrow(
        "0600",
      );

      await chmod(path, 0o600);
      const link = join(root, "link");
      await symlink(path, link);
      await expect(
        loadInternalToken({ kind: "file", path: link }),
      ).rejects.toThrow("regular file");

      const missing = join(root, "missing-token");
      await expect(
        loadInternalToken({ kind: "file", path: missing }),
      ).rejects.toThrow("internal gateway token file is unavailable");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("compares the optional renderer cookie without accepting missing values", () => {
    const policy = { value: "per-launch-secret" };
    expect(hasRendererCapability(null, policy)).toBe(false);
    expect(
      hasRendererCapability(
        "unrelated=1; animama_renderer_capability=wrong",
        policy,
      ),
    ).toBe(false);
    expect(
      hasRendererCapability(
        "animama_renderer_capability=per-launch-secret",
        policy,
      ),
    ).toBe(true);
  });
});
