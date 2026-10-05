import { describe, expect, it, vi } from "vitest";
import { createHostedComposition } from "./hosted-composition";
import { hostedCapabilitiesFixture as capabilities } from "../runtime/runtime-fixture";
import { RuntimeController } from "../runtime/runtime-controller";

const active = {
  schema_version: 1,
  state: "active",
  user_id: "owner",
  csrf_token: "fixture-csrf",
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

describe("hosted admission and transport", () => {
  it("notifies other hosted views before a delayed remote logout settles", async () => {
    const messages = vi.fn();
    vi.stubGlobal("window", {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
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
      state = "paused";
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
    const second = await composition.readAdmission();
    expect(
      first.status === "ready" &&
        second.status === "ready" &&
        first.session.key !== second.session.key,
    ).toBe(true);
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
    await composition.repair();
    expect(calls.map((call) => new URL(call.url).pathname)).toEqual([
      "/v1/hosted/runtime-context",
      "/v1/hosted/bootstrap:ensure",
      "/v1/hosted/runtime-context",
    ]);
    const body = (await calls[1].json()) as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(["idempotency_key"]);
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
