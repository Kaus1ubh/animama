import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  VerifiedByteLoader,
  verifyRuntimeBytes,
  type VerifiedByteMember,
} from "./VerifiedByteLoader";

function member(payload: Uint8Array): VerifiedByteMember {
  return {
    file_ref: "member-1",
    url: "/v1/animas/a/runtime/revisions/r/files/member-1",
    media_type: "application/octet-stream",
    size_bytes: payload.byteLength,
    sha256: createHash("sha256").update(payload).digest("hex"),
  };
}

describe("VerifiedByteLoader", () => {
  it("keeps exactly a view's verified bytes when its buffer is larger", async () => {
    const buffer = new TextEncoder().encode("xxruntimeyy").buffer;
    const view = new Uint8Array(buffer, 2, 7);

    const verified = await verifyRuntimeBytes(member(view), view);
    new Uint8Array(buffer).fill(0);

    expect(await verified.blob.text()).toBe("runtime");
  });

  it("deduplicates concurrent requests and verifies exact bytes", async () => {
    const payload = new TextEncoder().encode("runtime");
    const fetcher = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        void input;
        void init;
        return new Response(payload);
      },
    );
    const loader = new VerifiedByteLoader({
      apiBaseUrl: "http://localhost:8000",
      fetcher,
    });

    const [first, second] = await Promise.all([
      loader.load(member(payload)),
      loader.load(member(payload)),
    ]);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
    expect(first.blob.size).toBe(payload.byteLength);
    expect(fetcher.mock.calls[0]?.[1]?.cache).toBe("default");
    expect(
      new Headers(fetcher.mock.calls[0]?.[1]?.headers).has("Authorization"),
    ).toBe(false);
  });

  it("rejects a changed digest", async () => {
    const expected = new TextEncoder().encode("expected");
    const changed = new TextEncoder().encode("changed!");
    const loader = new VerifiedByteLoader({
      fetcher: vi.fn(async () => new Response(changed)),
    });

    await expect(loader.load(member(expected))).rejects.toMatchObject({
      code: "digest_mismatch",
    });
  });

  it("reads a member that fails verification once more from the network", async () => {
    const expected = new TextEncoder().encode("expected");
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) =>
        // A damaged copy from the browser cache, then the network's.
        new Response(
          init?.cache === "reload"
            ? expected
            : new TextEncoder().encode("damaged!"),
        ),
    );
    const verified = await new VerifiedByteLoader({ fetcher }).load(
      member(expected),
    );
    expect(await verified.blob.text()).toBe("expected");
    expect(fetcher.mock.calls.map(([, init]) => init?.cache)).toEqual([
      "default",
      "reload",
    ]);
  });

  it("reads a truncated cached copy once more from the network", async () => {
    const expected = new TextEncoder().encode("expected");
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) =>
        new Response(
          init?.cache === "reload" ? expected : expected.slice(0, 4),
        ),
    );
    const verified = await new VerifiedByteLoader({ fetcher }).load(
      member(expected),
    );
    expect(await verified.blob.text()).toBe("expected");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not read again once cancelled", async () => {
    const expected = new TextEncoder().encode("expected");
    const abort = new AbortController();
    const fetcher = vi.fn(async () => {
      abort.abort();
      return new Response(new TextEncoder().encode("damaged!"));
    });
    await expect(
      new VerifiedByteLoader({ fetcher }).load(member(expected), abort.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("retries only a verification failure, and only once", async () => {
    const expected = new TextEncoder().encode("expected");
    const changed = vi.fn(
      async () => new Response(new TextEncoder().encode("changed!")),
    );
    await expect(
      new VerifiedByteLoader({ fetcher: changed }).load(member(expected)),
    ).rejects.toMatchObject({ code: "digest_mismatch" });
    expect(changed).toHaveBeenCalledTimes(2);
    const refused = vi.fn(async () => new Response(null, { status: 409 }));
    await expect(
      new VerifiedByteLoader({ fetcher: refused }).load(member(expected)),
    ).rejects.toMatchObject({ code: "request_failed" });
    expect(refused).toHaveBeenCalledTimes(1);
  });
});
