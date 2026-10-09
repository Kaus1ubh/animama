import { describe, expect, it, vi } from "vitest";
import { SessionRequestScope } from "./session-requests";

it("fences already-buffered body readers and clones after sign-out", async () => {
  const scope = new SessionRequestScope("buffered", {
    baseUrl: "https://app.example.test",
    fetch: async () => new Response("private"),
  });
  const response = await scope.fetch("/v1/private");
  const clone = response.clone();
  await new Promise((resolve) => setTimeout(resolve, 0));
  scope.end();
  await expect(response.body!.getReader().read()).rejects.toMatchObject({
    name: "AbortError",
  });
  await expect(clone.text()).rejects.toMatchObject({ name: "AbortError" });
});

it("fences async iterators and transformed private streams after sign-out", async () => {
  const scope = new SessionRequestScope("iterated", {
    baseUrl: "https://app.example.test",
    fetch: async () => new Response("private"),
  });
  const reply = await scope.fetch("/v1/private");
  const transformed = reply
    .clone()
    .body!.pipeThrough(new TransformStream<Uint8Array, Uint8Array>());
  const iterator = reply.body!.values();
  await new Promise((resolve) => setTimeout(resolve, 0));
  scope.end();
  await expect(iterator.next()).rejects.toMatchObject({ name: "AbortError" });
  await expect(transformed.getReader().read()).rejects.toMatchObject({
    name: "AbortError",
  });
});

const origin = "https://app.example.test";

it.each([204, 205, 304])(
  "preserves bodyless HTTP %s replies and still fences them after session end",
  async (status) => {
    // Chromium may expose an empty stream for bodyless network responses.
    const cancelled = vi.fn();
    const emptyBody = new ReadableStream({ cancel: cancelled });
    const response = new Proxy(new Response(null, { status }), {
      get(target, key) {
        if (key === "body") return emptyBody;
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const scope = new SessionRequestScope("bodyless", {
      baseUrl: origin,
      fetch: async () => response,
    });
    const reply = await scope.fetch("/v1/content/package-imports/stage");
    expect(reply.status).toBe(status);
    expect(reply.body).toBeNull();
    expect(cancelled).toHaveBeenCalledOnce();
    const clone = reply.clone();
    expect(await reply.text()).toBe("");
    await scope.end();
    await expect(clone.text()).rejects.toMatchObject({ name: "AbortError" });
  },
);

describe("admitted request lifetime", () => {
  it("rejects foreign product origins before dispatch", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response());
    const scope = new SessionRequestScope("session-a", {
      baseUrl: origin,
      fetch: fetcher,
    });
    await expect(
      scope.fetch("https://other.example.test/v1/chats"),
    ).rejects.toThrow("origin");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("aborts in-flight work and rejects a late result even when a fixture ignores abort", async () => {
    let resolve!: (response: Response) => void;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const scope = new SessionRequestScope("session-a", {
      baseUrl: origin,
      fetch: fetcher,
    });
    const result = scope.fetch("/v1/chats");
    const request = fetcher.mock.calls[0][0] as Request;
    scope.end();
    expect(request.signal.aborted).toBe(true);
    resolve(Response.json({ private: "owner-a" }));
    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    await expect(scope.fetch("/v1/chats")).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("cancels private response bodies after headers have arrived", async () => {
    let body!: ReadableStreamDefaultController<Uint8Array>;
    const cancelled = vi.fn();
    const response = new Response(
      new ReadableStream({
        start(controller) {
          body = controller;
        },
        cancel: cancelled,
      }),
    );
    const scope = new SessionRequestScope("session-a", {
      baseUrl: origin,
      fetch: async () => response,
    });
    const reply = await scope.fetch("/v1/private-bytes");
    const read = reply.text();
    scope.end();
    await expect(read).rejects.toMatchObject({ name: "AbortError" });
    expect(cancelled).toHaveBeenCalled();
    expect(() => body.enqueue(new TextEncoder().encode("private"))).toThrow();
  });

  it("disposes resources once and disposes late registrations immediately", () => {
    const scope = new SessionRequestScope("session-a", {
      baseUrl: origin,
      fetch,
    });
    const dispose = vi.fn();
    scope.register(dispose);
    scope.end();
    scope.end();
    expect(dispose).toHaveBeenCalledOnce();
    const late = vi.fn();
    scope.register(late);
    expect(late).toHaveBeenCalledOnce();
  });

  it("aborts immediately while awaited teardown drains durable cleanup and attempts every resource", async () => {
    const scope = new SessionRequestScope("durable-cleanup", {
      baseUrl: origin,
      fetch,
    });
    let finish!: () => void;
    const durable = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const afterFailure = vi.fn();
    scope.register(() => durable);
    scope.register(() => {
      throw new Error("A disposal failed");
    });
    scope.register(afterFailure);
    const pending = scope.end();
    expect(scope.controller.signal.aborted).toBe(true);
    expect(afterFailure).toHaveBeenCalledOnce();
    let settled = false;
    void pending.catch(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    finish();
    await expect(pending).rejects.toThrow(
      "Session resources could not all be disposed",
    );
    expect(scope.end()).toBe(pending);
  });
});
