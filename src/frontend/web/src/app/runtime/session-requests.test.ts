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

/** Like native fetch, error the body when the request signal aborts. */
function abortableReply(request: Request, status = 200): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("first"));
        const abort = () =>
          controller.error(
            new DOMException("BodyStreamBuffer was aborted", "AbortError"),
          );
        if (request.signal.aborted) abort();
        else request.signal.addEventListener("abort", abort);
      },
    }),
    { status },
  );
}

/** Collect rejections nobody handled while `run` and its follow-up tasks settle. */
async function unhandledRejections(run: () => Promise<void>) {
  const reasons: unknown[] = [];
  const record = (reason: unknown) => reasons.push(reason);
  process.on("unhandledRejection", record);
  try {
    await run();
    await new Promise((resolve) => setTimeout(resolve, 10));
  } finally {
    process.off("unhandledRejection", record);
  }
  return reasons;
}

describe("ending a scope with natively aborted bodies", () => {
  it.each(["unread", "partly read", "already aborted"])(
    "leaves no unhandled rejection for a body that is %s",
    async (state) => {
      const caller = new AbortController();
      const reasons = await unhandledRejections(async () => {
        const scope = new SessionRequestScope("native-abort", {
          baseUrl: origin,
          fetch: async (request) => abortableReply(request as Request),
        });
        const reply = await scope.fetch("/v1/chat", { signal: caller.signal });
        const reader = reply.body!.getReader();
        if (state === "partly read") await reader.read();
        if (state === "already aborted") caller.abort();
        await scope.end();
        await expect(reader.read()).rejects.toMatchObject({
          name: "AbortError",
        });
      });
      expect(reasons).toEqual([]);
    },
  );

  it("leaves no unhandled rejection for a reply that arrives after the scope ended", async () => {
    const reasons = await unhandledRejections(async () => {
      const scope: SessionRequestScope = new SessionRequestScope("late-reply", {
        baseUrl: origin,
        fetch: async (request) => {
          void scope.end();
          return abortableReply(request as Request);
        },
      });
      await expect(scope.fetch("/v1/chat")).rejects.toMatchObject({
        name: "AbortError",
      });
    });
    expect(reasons).toEqual([]);
  });

  it("leaves no unhandled rejection for a bodyless reply with an aborted stream", async () => {
    const reasons = await unhandledRejections(async () => {
      const errored = new ReadableStream({
        start: (controller) => controller.error(new Error("stream aborted")),
      });
      const scope = new SessionRequestScope("bodyless-aborted", {
        baseUrl: origin,
        fetch: async () =>
          new Proxy(new Response(null, { status: 204 }), {
            get(target, key) {
              if (key === "body") return errored;
              const value = Reflect.get(target, key, target);
              return typeof value === "function" ? value.bind(target) : value;
            },
          }),
      });
      expect((await scope.fetch("/v1/chats")).status).toBe(204);
      await scope.end();
    });
    expect(reasons).toEqual([]);
  });
});

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
