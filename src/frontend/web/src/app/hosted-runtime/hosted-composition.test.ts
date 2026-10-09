import { afterEach, describe, expect, it, vi } from "vitest";
import { createHostedComposition } from "./hosted-composition";
import { hostedCapabilitiesFixture as capabilities } from "../runtime/runtime-fixture";
import { RuntimeController } from "../runtime/runtime-controller";

const active = {
  schema_version: 1,
  state: "active",
  user_id: "owner",
  csrf_token: "fixture-csrf",
  recovery_session_id: "fixture-session-generation-one",
  capabilities,
  account_url: "https://accounts.example.test/",
};
function fixture(context = active) {
  const calls: Request[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const request = input as Request;
    calls.push(request);
    if (new URL(request.url).pathname === "/v1/hosted/runtime-context")
      return Response.json(context);
    if (new URL(request.url).pathname === "/api/cloud/auth/login")
      return Response.json({
        authorization_url: "https://identity.example.test/sign-in",
      });
    return Response.json({ ok: true });
  });
  const navigate = vi.fn();
  const composition = createHostedComposition({
    baseUrl: "https://app.example.test",
    fetch,
    navigate,
  });
  return { composition, calls, navigate, fetch };
}

function installReloadStorage() {
  const sessionRows = new Map<string, string>();
  const draftRows = new Map<string, string>();
  const storage = (rows: Map<string, string>) => ({
    get length() {
      return rows.size;
    },
    key: (index: number) => [...rows.keys()][index] ?? null,
    getItem: (key: string) => rows.get(key) ?? null,
    setItem: (key: string, value: string) => rows.set(key, value),
    removeItem: (key: string) => rows.delete(key),
  });
  vi.stubGlobal("window", {
    sessionStorage: storage(sessionRows),
    localStorage: storage(draftRows),
  });
  vi.stubGlobal("performance", {
    getEntriesByType: () => [{ type: "reload" }],
  });
  return { sessionRows, draftRows };
}

describe("hosted admission and transport", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("recovers the original draft namespace after reload without persisting credentials", async () => {
    const rows = new Map<string, string>();
    const sessionStorage = {
      getItem: (key: string) => rows.get(key) ?? null,
      setItem: (key: string, value: string) => rows.set(key, value),
      removeItem: (key: string) => rows.delete(key),
    };
    vi.stubGlobal("window", { sessionStorage });
    vi.stubGlobal("performance", {
      getEntriesByType: () => [{ type: "reload" }],
    });
    const first = await fixture().composition.readAdmission();
    const reloaded = await fixture().composition.readAdmission();
    expect(
      first.status === "ready" &&
        reloaded.status === "ready" &&
        first.session.key,
    ).toBe(reloaded.status === "ready" && reloaded.session.key);
    expect([...rows.values()].join(" ")).not.toContain(active.csrf_token);
  });

  it("isolates a new tab even when its opener cloned session storage", async () => {
    const rows = new Map<string, string>();
    vi.stubGlobal("window", {
      sessionStorage: {
        getItem: (key: string) => rows.get(key) ?? null,
        setItem: (key: string, value: string) => rows.set(key, value),
        removeItem: (key: string) => rows.delete(key),
      },
    });
    vi.stubGlobal("performance", {
      getEntriesByType: () => [{ type: "navigate" }],
    });
    const first = await fixture().composition.readAdmission();
    const otherTab = await fixture().composition.readAdmission();
    expect(
      first.status === "ready" &&
        otherTab.status === "ready" &&
        first.session.key !== otherTab.session.key,
    ).toBe(true);
  });

  it("notifies other hosted views before a delayed remote logout settles", async () => {
    const messages = vi.fn();
    vi.stubGlobal("window", {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      localStorage: { length: 0, key: () => null },
    });
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        postMessage = messages;
        close = vi.fn();
        onmessage = null;
      },
    );
    const { composition, fetch } = fixture();
    await composition.readAdmission();
    const unsubscribe = composition.subscribe!(vi.fn());
    let finish!: (response: Response) => void;
    fetch.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    const pending = composition.accountActions!.signOut();
    try {
      expect(messages).toHaveBeenCalledWith({ type: "signed-out" });
    } finally {
      finish(Response.json({ ok: true }));
      await pending;
      unsubscribe();
      vi.unstubAllGlobals();
    }
  });
  it("refreshes an explicitly reauthenticated lifetime even when owner and CSRF are unchanged", async () => {
    const { composition } = fixture();
    const first = await composition.readAdmission();
    composition.accountActions!.signIn();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const second = await composition.readAdmission();
    expect(
      first.status === "ready" &&
        second.status === "ready" &&
        first.session.key !== second.session.key,
    ).toBe(true);
  });

  it("ends private work when a CRLF-framed server event revokes admission", async () => {
    let state = "active";
    let events!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        events = controller;
      },
    });
    const fetch: typeof globalThis.fetch = async (input) =>
      new URL((input as Request).url).pathname === "/v1/hosted/events"
        ? new Response(stream)
        : Response.json({ ...active, state });
    const composition = createHostedComposition({
      baseUrl: "https://app.example.test",
      fetch,
      navigate: vi.fn(),
    });
    const controller = new RuntimeController(composition);
    const unsubscribe = composition.subscribe!((invalidate) => {
      void controller.refresh(false, invalidate);
    });
    try {
      await controller.refresh();
      const old = controller.getSnapshot().scope!;
      state = "restricted";
      events.enqueue(
        new TextEncoder().encode("event: revoked\r\ndata: {}\r\n\r\n"),
      );
      await vi.waitFor(() => expect(old.controller.signal.aborted).toBe(true));
      await vi.waitFor(() =>
        expect(controller.getSnapshot().admission.status).toBe("restricted"),
      );
    } finally {
      unsubscribe();
      controller.dispose();
    }
  });

  it.each([
    ["a revoked event", "event"],
    ["an events 403", "forbidden"],
  ] as const)(
    "keeps private work when %s is not confirmed by the runtime context",
    async (_label, signal) => {
      let streams = 0;
      let contextReads = 0;
      let events!: ReadableStreamDefaultController<Uint8Array>;
      const fetch: typeof globalThis.fetch = async (input) => {
        const path = new URL((input as Request).url).pathname;
        if (path === "/v1/hosted/runtime-context") {
          contextReads += 1;
          return Response.json(active);
        }
        if (path !== "/v1/hosted/events") return Response.json({ ok: true });
        streams += 1;
        if (signal === "forbidden" && streams === 1)
          return new Response(null, { status: 403 });
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              events = controller;
            },
          }),
        );
      };
      const composition = createHostedComposition({
        baseUrl: "https://app.example.test",
        fetch,
        navigate: vi.fn(),
      });
      const controller = new RuntimeController(composition);
      const unsubscribe = composition.subscribe!((invalidate) => {
        void controller.refresh(false, invalidate);
      });
      try {
        await controller.refresh();
        const original = controller.getSnapshot();
        original.queryClient.setQueryData(["draft"], "retain");
        const readsBefore = contextReads;
        if (signal === "event") {
          await vi.waitFor(() => expect(events).toBeDefined());
          events.enqueue(new TextEncoder().encode("event: revoked\n\n"));
        }
        // The signal prompts a fresh context read, which keeps the session.
        await vi.waitFor(() =>
          expect(contextReads).toBeGreaterThan(readsBefore),
        );
        await vi.waitFor(() =>
          expect(controller.getSnapshot().reconnecting).toBe(false),
        );
        const current = controller.getSnapshot();
        const resumed = await current.scope!.fetch(
          new Request("https://app.example.test/v1/chats"),
        );
        expect(resumed.ok).toBe(true);
        expect(original.scope!.controller.signal.aborted).toBe(false);
        expect(current.scope).toBe(original.scope);
        expect(current.queryClient.getQueryData(["draft"])).toBe("retain");
      } finally {
        unsubscribe();
        controller.dispose();
      }
    },
  );

  it.each(["network", "server", "eof"])(
    "retains private work through an events %s fault and failed context refresh",
    async (failure) => {
      let online = true;
      const fetch: typeof globalThis.fetch = async (input) => {
        const path = new URL((input as Request).url).pathname;
        if (path === "/v1/hosted/events") {
          online = false;
          if (failure === "network") throw new TypeError("Offline");
          return new Response(failure === "eof" ? "" : null, {
            status: failure === "server" ? 503 : 200,
          });
        }
        if (!online) throw new TypeError("Offline");
        return Response.json(active);
      };
      const composition = createHostedComposition({
        baseUrl: "https://app.example.test",
        fetch,
        navigate: vi.fn(),
      });
      const controller = new RuntimeController(composition);
      await controller.refresh();
      const original = controller.getSnapshot().scope!;
      controller.getSnapshot().queryClient.setQueryData(["draft"], "retain");
      const unsubscribe = composition.subscribe!((invalidate) => {
        void controller.refresh(false, invalidate);
      });
      try {
        await vi.waitFor(() =>
          expect(controller.getSnapshot().reconnecting).toBe(true),
        );
        expect(controller.getSnapshot().scope).toBe(original);
        expect(original.controller.signal.aborted).toBe(false);
        expect(
          controller.getSnapshot().queryClient.getQueryData(["draft"]),
        ).toBe("retain");
        await expect(
          original.fetch("/v1/chats", { method: "POST" }),
        ).rejects.toThrow("reconnecting");
        online = true;
        await controller.refresh();
        expect(controller.getSnapshot().scope).toBe(original);
        expect(controller.getSnapshot().reconnecting).toBe(false);
      } finally {
        unsubscribe();
        controller.dispose();
      }
    },
  );

  it.each(["server", "eof"])(
    "does not let repeated events %s failures abort a slow healthy admission read",
    async (failure) => {
      vi.useFakeTimers();
      let reads = 0;
      let aborted = 0;
      const fetch: typeof globalThis.fetch = async (input) => {
        const request = input as Request;
        if (new URL(request.url).pathname === "/v1/hosted/events")
          return new Response(failure === "eof" ? "" : null, {
            status: failure === "server" ? 503 : 200,
          });
        if (++reads === 1) return Response.json(active);
        return new Promise<Response>((resolve, reject) => {
          const timer = setTimeout(() => resolve(Response.json(active)), 2_500);
          request.signal.addEventListener("abort", () => {
            clearTimeout(timer);
            ++aborted;
            reject(new DOMException("Admission superseded", "AbortError"));
          });
        });
      };
      const composition = createHostedComposition({
        baseUrl: "https://app.example.test",
        fetch,
        navigate: vi.fn(),
      });
      const controller = new RuntimeController(composition);
      await controller.refresh();
      const original = controller.getSnapshot();
      original.queryClient.setQueryData(["draft"], "original-operation");
      const unsubscribe = composition.subscribe!((invalidate) => {
        void controller.refresh(false, invalidate);
      });
      try {
        await vi.advanceTimersByTimeAsync(2_500);
        expect(aborted).toBe(0);
        expect(reads).toBe(2);
        expect(controller.getSnapshot().scope).toBe(original.scope);
        expect(controller.getSnapshot().reconnecting).toBe(false);
        expect(original.queryClient.getQueryData(["draft"])).toBe(
          "original-operation",
        );
      } finally {
        unsubscribe();
        controller.dispose();
        vi.useRealTimers();
      }
    },
  );

  it("retains admission backoff despite repeated uncertain events notifications", async () => {
    vi.useFakeTimers();
    const started = Date.now();
    const reads: number[] = [];
    const fetch: typeof globalThis.fetch = async (input) => {
      if (new URL((input as Request).url).pathname === "/v1/hosted/events")
        return new Response(null, { status: 503 });
      reads.push(Date.now() - started);
      if (reads.length === 1) return Response.json(active);
      throw new TypeError("Context temporarily unavailable");
    };
    const composition = createHostedComposition({
      baseUrl: "https://app.example.test",
      fetch,
      navigate: vi.fn(),
    });
    const controller = new RuntimeController(composition);
    await controller.refresh();
    const original = controller.getSnapshot().scope;
    const unsubscribe = composition.subscribe!((invalidate) => {
      void controller.refresh(false, invalidate);
    });
    try {
      await vi.advanceTimersByTimeAsync(61_000);
      expect(reads).toEqual([
        0, 0, 1_000, 3_000, 7_000, 15_000, 31_000, 61_000,
      ]);
      expect(controller.getSnapshot().scope).toBe(original);
      expect(controller.getSnapshot().reconnecting).toBe(true);
    } finally {
      unsubscribe();
      controller.dispose();
      vi.useRealTimers();
    }
  });

  it.each(["unknown", undefined, "recovery", "bootstrap_required", "paused"])(
    "preserves persisted ambiguous recovery through an initial %s context after reload",
    async (state) => {
      const { sessionRows, draftRows } = installReloadStorage();
      const first = await fixture().composition.readAdmission();
      expect(first.status).toBe("ready");
      if (first.status !== "ready")
        throw new Error("Initial admission missing");
      const key = `animama:content-edit:${encodeURIComponent(first.session.key)}:pose`;
      const draft = JSON.stringify({ operationId: "original-ambiguous-save" });
      draftRows.set(key, draft);
      const context: Record<string, unknown> = { ...active };
      if (state === undefined) delete context.state;
      else context.state = state;
      const reloaded = fixture(context as typeof active);
      expect((await reloaded.composition.readAdmission()).status).not.toBe(
        "ready",
      );
      await expect(
        reloaded.composition.browserFetch("/v1/poses", { method: "POST" }),
      ).rejects.toMatchObject({ name: "AbortError" });
      expect(draftRows.get(key)).toBe(draft);
      expect(sessionRows.get("animama.hosted-recovery.v1")).toContain(
        first.session.key,
      );
      reloaded.fetch.mockResolvedValueOnce(Response.json(active));
      const recovered = await reloaded.composition.readAdmission();
      expect(recovered.status === "ready" && recovered.session.key).toBe(
        first.session.key,
      );
      expect(draftRows.get(key)).toBe(draft);
    },
  );

  it.each([
    ["session_required", 200],
    ["ineligible", 200],
    ["restricted", 200],
    ["deletion_pending", 200],
    ["unauthorized", 401],
    ["forbidden", 403],
  ] as const)(
    "purges reload recovery on authoritative %s denial",
    async (state, status) => {
      const { sessionRows, draftRows } = installReloadStorage();
      const first = await fixture().composition.readAdmission();
      if (first.status !== "ready")
        throw new Error("Initial admission missing");
      const key = `animama:content-edit:${encodeURIComponent(first.session.key)}:pose`;
      draftRows.set(
        key,
        JSON.stringify({ operationId: "original-ambiguous-save" }),
      );
      const reloaded = fixture({ ...active, state });
      if (status !== 200)
        reloaded.fetch.mockResolvedValueOnce(new Response(null, { status }));
      expect((await reloaded.composition.readAdmission()).status).not.toBe(
        "ready",
      );
      expect(draftRows.has(key)).toBe(false);
      expect(sessionRows.has("animama.hosted-recovery.v1")).toBe(false);
    },
  );

  it("keeps an open session and its drafts through a transient paused context", async () => {
    const context = { ...active };
    const { composition } = fixture(context);
    const controller = new RuntimeController(composition);
    await controller.refresh();
    const original = controller.getSnapshot();
    original.queryClient.setQueryData(["draft"], "retain");
    context.state = "paused";
    await controller.refresh();
    try {
      expect(controller.getSnapshot().scope).toBe(original.scope);
      expect(original.scope!.controller.signal.aborted).toBe(false);
      expect(controller.getSnapshot().reconnecting).toBe(true);
      context.state = "active";
      await controller.refresh();
      expect(controller.getSnapshot().scope).toBe(original.scope);
      expect(controller.getSnapshot().reconnecting).toBe(false);
      expect(original.queryClient.getQueryData(["draft"])).toBe("retain");
    } finally {
      controller.dispose();
    }
  });

  it.each([401, 403])(
    "retires ready admission on authoritative context HTTP %s",
    async (status) => {
      const { composition, fetch } = fixture();
      const controller = new RuntimeController(composition);
      await controller.refresh();
      const old = controller.getSnapshot().scope!;
      fetch.mockResolvedValueOnce(new Response(null, { status }));
      await controller.refresh();
      expect(old.controller.signal.aborted).toBe(true);
      expect(controller.getSnapshot().admission.status).toBe(
        "sign-in-required",
      );
    },
  );
  it("reads only hosted admission and retains a lifetime during an unchanged authority read", async () => {
    const { composition, calls } = fixture();
    const first = await composition.readAdmission();
    const second = await composition.readAdmission();
    expect(first.status).toBe("ready");
    expect(second).toEqual(first);
    expect(calls.map((call) => new URL(call.url).pathname)).toEqual([
      "/v1/hosted/runtime-context",
      "/v1/hosted/runtime-context",
    ]);
    expect(
      calls.every(
        (call) =>
          call.credentials === "same-origin" &&
          call.cache === "no-store" &&
          call.redirect === "error",
      ),
    ).toBe(true);
  });

  it("uses a fresh lifetime when the same owner reauthenticates", async () => {
    const context = { ...active };
    const { composition } = fixture(context);
    const first = await composition.readAdmission();
    context.csrf_token = "reauthenticated-fixture";
    context.recovery_session_id = "fixture-session-generation-two";
    const second = await composition.readAdmission();
    expect(
      first.status === "ready" &&
        second.status === "ready" &&
        first.session.key !== second.session.key,
    ).toBe(true);
  });

  it("retains draft identity across a CSRF refresh within the same authenticated session", async () => {
    const context = { ...active };
    const { composition } = fixture(context);
    const first = await composition.readAdmission();
    context.csrf_token = "refreshed-csrf";
    expect(await composition.readAdmission()).toEqual(first);
  });

  it.each([
    ["session_required", "sign-in-required"],
    ["ineligible", "ineligible"],
    ["paused", "restricted"],
    ["restricted", "restricted"],
    ["deletion_pending", "restricted"],
    ["recovery", "recovery"],
    ["bootstrapping", "loading"],
    ["identity_unavailable", "unavailable"],
    ["unknown", "unavailable"],
  ])("withholds private product dispatch in %s", async (state, expected) => {
    const { composition, calls } = fixture({ ...active, state });
    expect((await composition.readAdmission()).status).toBe(expected);
    await expect(composition.browserFetch("/v1/animas")).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(calls).toHaveLength(1);
  });

  it("fails closed for old, absent and incompatible capability schemas", async () => {
    for (const bad of [
      { ...capabilities, schema_version: 1 },
      undefined,
      { ...capabilities, anima_creation: true },
    ]) {
      const { composition } = fixture({
        ...active,
        capabilities: bad,
      } as typeof active);
      expect((await composition.readAdmission()).status).toBe("unavailable");
    }
  });

  it("uses cookie and current CSRF authority for explicit SDK, byte and streaming requests", async () => {
    const { composition, calls } = fixture();
    const controller = new RuntimeController(composition);
    await controller.refresh();
    await composition.browserFetch("/v1/chats", {
      method: "POST",
      headers: { Authorization: "Bearer ignored" },
      body: "{}",
    });
    const request = calls.at(-1)!;
    expect(request.headers.get("X-Animama-CSRF")).toBe("fixture-csrf");
    expect(request.headers.has("Authorization")).toBe(false);
    expect(request.credentials).toBe("same-origin");
    await expect(
      controller
        .getSnapshot()
        .scope!.fetch("https://other.example.test/v1/chats"),
    ).rejects.toThrow("application origin");
  });

  it("repairs only reported hosted bootstrap/recovery, never installation bootstrap", async () => {
    const { composition, calls } = fixture({ ...active, state: "recovery" });
    expect((await composition.readAdmission()).status).toBe("recovery");
    expect(calls).toHaveLength(1);
    await composition.repair();
    await vi.waitFor(() =>
      expect(calls.map((call) => new URL(call.url).pathname)).toEqual([
        "/v1/hosted/runtime-context",
        "/v1/hosted/runtime-context",
        "/v1/hosted/bootstrap:ensure",
      ]),
    );
    const body = (await calls[2].json()) as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(["idempotency_key"]);
    expect(calls[2].headers.get("X-Animama-CSRF")).toBe("fixture-csrf");
  });

  it("binds account navigation to a validated admission URL and gives useful absence feedback", async () => {
    const { composition, navigate } = fixture();
    await composition.readAdmission();
    composition.accountActions!.openAccount();
    expect(navigate).toHaveBeenCalledWith("https://accounts.example.test/");
    const missing = fixture({
      ...active,
      account_url: undefined,
    } as unknown as typeof active);
    await missing.composition.readAdmission();
    expect(() => missing.composition.accountActions!.openAccount()).toThrow(
      "Account access is unavailable",
    );
  });
});

/** A signed-in account whose server-owned setup the test controls. */
function setupFlow(
  initial: string,
  ensure: (key: string, sent: number) => Response | Promise<Response>,
) {
  const state = { value: initial };
  const keys: string[] = [];
  let contextReads = 0;
  const fetch: typeof globalThis.fetch = async (input) => {
    const request = input as Request;
    const path = new URL(request.url).pathname;
    if (path === "/v1/hosted/runtime-context") {
      contextReads += 1;
      return Response.json({ ...active, state: state.value });
    }
    if (path === "/v1/hosted/bootstrap:ensure") {
      const body = (await request.json()) as { idempotency_key: string };
      keys.push(body.idempotency_key);
      return ensure(body.idempotency_key, keys.length);
    }
    if (path === "/v1/hosted/events")
      return new Response(new ReadableStream<Uint8Array>());
    return Response.json({ ok: true });
  };
  const composition = createHostedComposition({
    baseUrl: "https://app.example.test",
    fetch,
    navigate: vi.fn(),
  });
  const controller = new RuntimeController(composition);
  const views: string[] = [];
  controller.subscribe(() => {
    const admission = controller.getSnapshot().admission;
    views.push(
      admission.status === "loading" && admission.message
        ? `loading: ${admission.message}`
        : admission.status,
    );
  });
  const unsubscribe = composition.subscribe!((invalidate) => {
    void controller.refresh(false, invalidate);
  });
  return {
    state,
    keys,
    views,
    controller,
    contextReads: () => contextReads,
    status: () => controller.getSnapshot().admission.status,
    close: () => {
      unsubscribe();
      controller.dispose();
    },
  };
}
const setupAnswer = () => Response.json({ state: "active", ready: true });

describe("hosted account setup", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sets up a signed-in first-use account automatically, then admits it", async () => {
    const flow = setupFlow("bootstrap_required", () => {
      flow.state.value = "active";
      return setupAnswer();
    });
    try {
      await flow.controller.refresh();
      await vi.waitFor(() => expect(flow.status()).toBe("ready"));
      expect(flow.views).toContain("loading: Setting up your account…");
      expect(flow.views).not.toContain("recovery");
      expect(flow.keys).toHaveLength(1);
    } finally {
      flow.close();
    }
  });

  it("replays the same idempotency key after a lost reply", async () => {
    vi.useFakeTimers();
    const flow = setupFlow("bootstrap_required", (_key, sent) => {
      if (sent === 1) throw new TypeError("Failed to fetch");
      flow.state.value = "active";
      return setupAnswer();
    });
    try {
      await flow.controller.refresh();
      await vi.advanceTimersByTimeAsync(500);
      await vi.waitFor(() => expect(flow.status()).toBe("ready"));
      expect(flow.keys).toHaveLength(2);
      expect(flow.keys[1]).toBe(flow.keys[0]);
    } finally {
      flow.close();
    }
  });

  it("offers recovery after an unanswered attempt and replays its key on retry", async () => {
    vi.useFakeTimers();
    let online = false;
    const flow = setupFlow("bootstrap_required", () => {
      if (!online) throw new TypeError("Failed to fetch");
      flow.state.value = "active";
      return setupAnswer();
    });
    try {
      await flow.controller.refresh();
      await vi.advanceTimersByTimeAsync(1_500);
      await vi.waitFor(() => expect(flow.status()).toBe("recovery"));
      expect(flow.keys).toHaveLength(3);
      // Ordinary reads do not repeat an automatic attempt that already failed.
      await flow.controller.refresh();
      expect(flow.status()).toBe("recovery");
      expect(flow.keys).toHaveLength(3);
      online = true;
      await flow.controller.refresh(true);
      await vi.waitFor(() => expect(flow.status()).toBe("ready"));
      expect(flow.keys).toHaveLength(4);
      expect(flow.keys[3]).toBe(flow.keys[0]);
    } finally {
      flow.close();
    }
  });

  it("starts a person's retry with a new key once the server answered", async () => {
    const flow = setupFlow("bootstrap_required", (_key, sent) => {
      if (sent === 1)
        return Response.json(
          { state: "identity_unavailable" },
          { status: 503 },
        );
      flow.state.value = "active";
      return setupAnswer();
    });
    try {
      await flow.controller.refresh();
      await vi.waitFor(() => expect(flow.status()).toBe("recovery"));
      expect(flow.keys).toHaveLength(1);
      await flow.controller.refresh(true);
      await vi.waitFor(() => expect(flow.status()).toBe("ready"));
      expect(flow.keys).toHaveLength(2);
      expect(flow.keys[1]).not.toBe(flow.keys[0]);
    } finally {
      flow.close();
    }
  });

  it("runs one setup attempt at a time", async () => {
    let finish!: () => void;
    const flow = setupFlow(
      "bootstrap_required",
      () =>
        new Promise<Response>((resolve) => {
          finish = () => {
            flow.state.value = "active";
            resolve(setupAnswer());
          };
        }),
    );
    try {
      await flow.controller.refresh();
      await flow.controller.refresh();
      await flow.controller.refresh(true);
      await vi.waitFor(() => expect(flow.keys).toHaveLength(1));
      expect(flow.status()).toBe("loading");
      finish();
      await vi.waitFor(() => expect(flow.status()).toBe("ready"));
      expect(flow.keys).toHaveLength(1);
    } finally {
      flow.close();
    }
  });

  it("bounds setup progress polling, then offers recovery that polls again", async () => {
    vi.useFakeTimers();
    const flow = setupFlow("bootstrapping", () => setupAnswer());
    try {
      await flow.controller.refresh();
      expect(flow.views.at(-1)).toMatch(/^loading: /);
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(flow.status()).toBe("recovery");
      const reads = flow.contextReads();
      expect(reads).toBeGreaterThan(10);
      expect(reads).toBeLessThan(40);
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(flow.contextReads()).toBe(reads);
      await flow.controller.refresh(true);
      expect(flow.status()).toBe("loading");
      flow.state.value = "active";
      await vi.advanceTimersByTimeAsync(5_000);
      expect(flow.status()).toBe("ready");
      expect(flow.keys).toHaveLength(0);
    } finally {
      flow.close();
    }
  });

  it("repairs an open view's bootstrap requirement without ending its session", async () => {
    const flow = setupFlow("active", () => {
      flow.state.value = "active";
      return setupAnswer();
    });
    try {
      await flow.controller.refresh();
      const original = flow.controller.getSnapshot();
      original.queryClient.setQueryData(["draft"], "retain");
      // A newer release requires the idempotent bootstrap again.
      flow.state.value = "bootstrap_required";
      await flow.controller.refresh();
      await vi.waitFor(() => expect(flow.keys).toHaveLength(1));
      await vi.waitFor(() =>
        expect(flow.controller.getSnapshot().reconnecting).toBe(false),
      );
      expect(flow.controller.getSnapshot().scope).toBe(original.scope);
      expect(original.scope!.controller.signal.aborted).toBe(false);
      expect(original.queryClient.getQueryData(["draft"])).toBe("retain");
    } finally {
      flow.close();
    }
  });

  it("keeps repairing an open view at a bounded pace while setup fails", async () => {
    vi.useFakeTimers();
    let healthy = false;
    const flow = setupFlow("active", () => {
      if (!healthy)
        return Response.json(
          { state: "identity_unavailable" },
          { status: 503 },
        );
      flow.state.value = "active";
      return setupAnswer();
    });
    try {
      await flow.controller.refresh();
      const original = flow.controller.getSnapshot().scope;
      flow.state.value = "recovery";
      await flow.controller.refresh();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(flow.keys.length).toBeGreaterThan(1);
      expect(flow.keys.length).toBeLessThanOrEqual(6);
      expect(flow.controller.getSnapshot().reconnecting).toBe(true);
      expect(flow.controller.getSnapshot().scope).toBe(original);
      healthy = true;
      await vi.advanceTimersByTimeAsync(120_000);
      expect(flow.controller.getSnapshot().reconnecting).toBe(false);
      expect(flow.controller.getSnapshot().scope).toBe(original);
    } finally {
      flow.close();
    }
  });
});
