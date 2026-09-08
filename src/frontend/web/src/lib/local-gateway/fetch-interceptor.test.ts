import { afterEach, describe, expect, it, vi } from "vitest";

describe("local gateway fetch interceptor", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("adds only the CSRF marker to same-origin mutating /v1 requests", async () => {
    const received: Request[] = [];
    const nativeFetch = vi.fn(async (input: RequestInfo | URL) => {
      received.push(input as Request);
      return new Response(null, { status: 204 });
    });
    vi.stubGlobal("window", {
      fetch: nativeFetch,
      location: { origin: "http://gateway.test" },
    });
    const { installLocalGatewayFetchInterceptor } =
      await import("./fetch-interceptor");
    installLocalGatewayFetchInterceptor();

    await window.fetch("http://gateway.test/v1/items", { method: "POST" });
    const forwarded = received[0]!;
    expect(forwarded.headers.get("X-Animama-CSRF")).toBe("1");
    expect(forwarded.headers.has("Authorization")).toBe(false);
    expect(forwarded.headers.has("X-Animama-Principal-Id")).toBe(false);
    expect(forwarded.headers.has("X-Animama-Internal-Token")).toBe(false);

    await window.fetch("http://gateway.test/v1/items", { method: "GET" });
    const safe = received[1]!;
    expect(safe.headers.has("X-Animama-CSRF")).toBe(false);

    await window.fetch("https://discover.example/v1/items", {
      method: "POST",
    });
    const remote = received[2]!;
    expect(remote.headers.has("X-Animama-CSRF")).toBe(false);
  });
});
