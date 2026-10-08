import type {
  RuntimeAdmission,
  RuntimeUsage,
} from "@animama/runtime-contracts";
import { zRuntimeCapabilities } from "@animama/runtime-contracts/validators";
import type { AdmissionRefresh, AppComposition } from "../runtime/composition";
import type { SessionRequestScope } from "../runtime/session-requests";
import { traceProductRequest } from "../runtime/product-request-tracing";
import {
  hostedRecoveryIdentity,
  forgetHostedRecoveryIdentity,
} from "./recovery-identity";
import { purgeHostedRecoverySessions } from "@/lib/content/recovery-session";

type HostedContext = {
  schema_version: number;
  state: string;
  user_id: string | null;
  csrf_token: string | null;
  recovery_session_id?: string;
  capabilities: unknown;
  account_url?: string | null;
};
type Options = {
  baseUrl: string;
  fetch: typeof globalThis.fetch;
  navigate: (url: string) => void;
  sessionKey?: () => string;
};

/** Cookie authority and CSRF are installed before React; browser headers cannot choose an owner. */
export function createHostedComposition(
  options: Options,
): AppComposition & { browserFetch: typeof globalThis.fetch } {
  const origin = new URL(options.baseUrl).origin;
  let csrf: string | null = null;
  let scope: SessionRequestScope | null = null;
  let session: { owner: string; generation: string; key: string } | null = null;
  let accountUrl: string | null = null;
  let signedOut = false;
  let signInError = false;
  let loginRequest: AbortController | null = null;
  let events: AbortController | null = null;
  let bootstrapTimer: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<(invalidate?: AdmissionRefresh) => void>();
  let channel: BroadcastChannel | null = null;
  const notify = (invalidate: AdmissionRefresh = false) =>
    listeners.forEach((listener) => listener(invalidate));
  const stopEvents = () => {
    events?.abort();
    events = null;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
  };

  const key = options.sessionKey ?? (() => crypto.randomUUID());

  const authorizedFetch: typeof globalThis.fetch = async (input, init) => {
    const target = typeof input === "string" ? new URL(input, origin) : input;
    const request = new Request(target, init);
    const url = new URL(request.url);
    if (url.origin !== origin)
      throw new TypeError(
        "Hosted requests must stay on the application origin",
      );
    const headers = new Headers(request.headers);
    headers.delete("Authorization");
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase())) {
      if (!csrf) throw new Error("A current hosted CSRF token is required");
      headers.set("X-Animama-CSRF", csrf);
    }
    return options.fetch(
      traceProductRequest(
        new Request(request, {
          headers,
          credentials: "same-origin",
          cache: "no-store",
          redirect: "error",
        }),
      ),
    );
  };

  async function json<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await authorizedFetch(path, init);
    if (!response.ok)
      throw new Error(`Hosted request failed (${response.status})`);
    return response.json() as Promise<T>;
  }

  async function contextAdmission(
    context: HostedContext,
    signal?: AbortSignal,
  ): Promise<RuntimeAdmission> {
    if (context.schema_version !== 1) {
      if (session) throw new Error("Hosted context has an incompatible format");
      return {
        status: "unavailable",
        message: "This hosted runtime needs an application update.",
      };
    }
    if (context.state !== "bootstrapping" && bootstrapTimer) {
      clearTimeout(bootstrapTimer);
      bootstrapTimer = null;
    }
    csrf =
      typeof context.csrf_token === "string" && context.csrf_token
        ? context.csrf_token
        : null;
    accountUrl = null;
    if (typeof context.account_url === "string") {
      try {
        const url = new URL(context.account_url, origin);
        if (
          !url.username &&
          !url.password &&
          (url.protocol === "https:" ||
            (url.protocol === "http:" && url.origin === origin))
        )
          accountUrl = url.href;
      } catch {
        /* An invalid optional account URL withholds navigation. */
      }
    }
    const states: Record<
      string,
      Exclude<RuntimeAdmission["status"], "ready">
    > = {
      session_required: "sign-in-required",
      identity_unavailable: "unavailable",
      ineligible: "ineligible",
      paused: "restricted",
      bootstrap_required: "recovery",
      bootstrapping: "loading",
      recovery: "recovery",
      restricted: "restricted",
      deletion_pending: "restricted",
    };
    if (context.state !== "active") {
      const authoritativeDenial = [
        "session_required",
        "ineligible",
        "paused",
        "restricted",
        "deletion_pending",
      ].includes(context.state);
      if (session && !authoritativeDenial)
        throw new Error("Hosted admission could not currently be confirmed");
      session = null;
      // Initial reloads have no in-memory session yet. Unknown/repair states
      // withhold admission but cannot revoke that tab's persisted operation.
      if (authoritativeDenial) {
        void scope?.end();
        await purgeHostedRecoverySessions();
        forgetHostedRecoveryIdentity();
        signal?.throwIfAborted();
      }
      if (
        context.state === "bootstrapping" &&
        listeners.size &&
        !bootstrapTimer
      )
        bootstrapTimer = setTimeout(() => {
          bootstrapTimer = null;
          notify();
        }, 1_000);
      return { status: states[context.state] ?? "unavailable" };
    }
    const result = zRuntimeCapabilities.safeParse(context.capabilities);
    // Older schema defaults must not accidentally admit a hosted surface.
    const raw = context.capabilities as { schema_version?: unknown } | null;
    if (
      !result.success ||
      raw?.schema_version !== 2 ||
      typeof context.user_id !== "string" ||
      !context.user_id ||
      !csrf ||
      csrf.length > 512 ||
      /[\r\n]/.test(csrf) ||
      result.data.runtime_kind !== "hosted"
    ) {
      if (session)
        throw new Error("Hosted context has incompatible capabilities");
      return {
        status: "unavailable",
        message: "This hosted runtime needs an application update.",
      };
    }
    const capabilities = result.data;
    if (
      capabilities.anima_creation ||
      capabilities.chat_file_uploads ||
      capabilities.user_file_processing.enabled ||
      capabilities.provider_credentials ||
      capabilities.model_configuration ||
      capabilities.local_filesystem_administration ||
      capabilities.native_features ||
      capabilities.web_search?.configuration
    ) {
      if (session)
        throw new Error("Hosted context has incompatible capabilities");
      return {
        status: "unavailable",
        message:
          "This hosted runtime has incompatible application capabilities.",
      };
    }
    const recoveryGeneration =
      typeof context.recovery_session_id === "string" &&
      /^[A-Za-z0-9_-]{16,128}$/.test(context.recovery_session_id)
        ? context.recovery_session_id
        : undefined;
    const generation = recoveryGeneration ?? csrf;
    if (
      session?.owner !== context.user_id ||
      session.generation !== generation
    ) {
      if (session) await scope?.end();
      const recoveryKey = options.sessionKey
        ? key()
        : await hostedRecoveryIdentity(
            context.user_id,
            recoveryGeneration,
            signal,
          );
      signal?.throwIfAborted();
      session = { owner: context.user_id, generation, key: recoveryKey };
    }
    return {
      status: "ready",
      session: { key: session.key, owner: { id: context.user_id } },
      capabilities,
      onboardingRequired: false,
    };
  }

  async function readAdmission(
    signal?: AbortSignal,
  ): Promise<RuntimeAdmission> {
    if (signedOut) return { status: "sign-in-required" };
    if (signInError) {
      signInError = false;
      return {
        status: "unavailable",
        message: "Sign-in could not be started. Please try again.",
      };
    }
    const response = await authorizedFetch("/v1/hosted/runtime-context", {
      signal,
    });
    signal?.throwIfAborted();
    if (response.status === 401 || response.status === 403) {
      session = null;
      csrf = null;
      void scope?.end();
      await purgeHostedRecoverySessions();
      forgetHostedRecoveryIdentity();
      signal?.throwIfAborted();
      return { status: "sign-in-required" };
    }
    if (!response.ok)
      throw new Error("Hosted context is temporarily unavailable");
    const context = (await response.json()) as HostedContext;
    signal?.throwIfAborted();
    if (context.state === "identity_unavailable" && session)
      throw new Error("Hosted identity is temporarily unavailable");
    return contextAdmission(context, signal);
  }

  async function repair(signal?: AbortSignal): Promise<RuntimeAdmission> {
    if (signedOut) return { status: "sign-in-required" };
    const context = await json<HostedContext>("/v1/hosted/runtime-context", {
      signal,
    });
    signal?.throwIfAborted();
    const admission = await contextAdmission(context, signal);
    if (!["bootstrap_required", "recovery"].includes(context.state))
      return admission;
    if (!csrf) return { status: "sign-in-required" };
    await json("/v1/hosted/bootstrap:ensure", {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idempotency_key: key() }),
    });
    return readAdmission(signal);
  }

  const browserFetch: typeof globalThis.fetch = (input, init) => {
    const target = typeof input === "string" ? new URL(input, origin) : input;
    const request = new Request(target, init);
    const url = new URL(request.url);
    if (url.origin === origin && url.pathname.startsWith("/v1/")) {
      if (!scope)
        return Promise.reject(
          new DOMException(
            "Hosted product admission is required",
            "AbortError",
          ),
        );
      return scope.fetch(request);
    }
    return options.fetch(request);
  };

  function startEvents() {
    if (!scope || !listeners.size || events) return;
    const controller = new AbortController();
    events = controller;
    void (async () => {
      let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
      try {
        const response = await authorizedFetch("/v1/hosted/events", {
          signal: controller.signal,
        });
        if (!response.ok || !response.body) {
          if (response.status === 401 || response.status === 403) {
            session = null;
            notify(true);
          } else notify("uncertain");
          return;
        }
        reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (!controller.signal.aborted) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true });
          buffer = buffer.replace(/\r\n/g, "\n");
          if (buffer.length > 64 * 1024)
            throw new Error("Hosted events exceeded the buffer limit");
          let end: number;
          while ((end = buffer.indexOf("\n\n")) >= 0) {
            const event = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            if (/^event:\s*revoked\s*$/m.test(event)) {
              session = null;
              notify(true);
              return;
            }
          }
        }
        if (!controller.signal.aborted) notify("uncertain");
      } catch {
        if (!controller.signal.aborted) {
          notify("uncertain");
        }
      } finally {
        void reader?.cancel().catch(() => {});
        if (events === controller) events = null;
        if (!controller.signal.aborted && scope && listeners.size)
          retryTimer = setTimeout(() => {
            retryTimer = null;
            startEvents();
          }, 1_000);
      }
    })();
  }

  return {
    kind: "hosted",
    transport: { baseUrl: origin, fetch: authorizedFetch },
    browserFetch,
    readAdmission,
    repair,
    bindSession: (next) => {
      stopEvents();
      scope = next;
      if (next) startEvents();
    },
    accountActions: {
      signIn: () => {
        signedOut = false;
        session = null;
        forgetHostedRecoveryIdentity();
        loginRequest?.abort();
        const controller = new AbortController();
        loginRequest = controller;
        // Login is deliberately separate from product CSRF admission.
        void options
          .fetch(
            new Request(new URL("/api/cloud/auth/login", origin), {
              method: "POST",
              signal: controller.signal,
              credentials: "same-origin",
              cache: "no-store",
              redirect: "error",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ return_path: "/" }),
            }),
          )
          .then(async (response) => {
            if (!response.ok) throw new Error("Sign-in is unavailable");
            const result = (await response.json()) as {
              authorization_url?: string;
            };
            controller.signal.throwIfAborted();
            const url = new URL(result.authorization_url ?? "");
            if (url.protocol !== "https:" || url.username || url.password)
              throw new Error("Sign-in requires a secure identity endpoint");
            options.navigate(url.href);
          })
          .catch(() => {
            if (!controller.signal.aborted) {
              signInError = true;
              notify(true);
            }
          });
      },
      signOut: async () => {
        loginRequest?.abort();
        signedOut = true;
        session = null;
        const recoveryCleanup = purgeHostedRecoverySessions();
        channel?.postMessage({ type: "signed-out" });
        try {
          const results = await Promise.allSettled([
            json("/api/cloud/auth/logout", { method: "POST" }),
            recoveryCleanup,
          ]);
          const errors = results.flatMap((result) =>
            result.status === "rejected" ? [result.reason] : [],
          );
          if (errors.length)
            throw new AggregateError(
              errors,
              "Hosted sign-out could not fully complete",
            );
        } finally {
          forgetHostedRecoveryIdentity();
          csrf = null;
          accountUrl = null;
        }
      },
      openAccount: () => {
        if (!accountUrl)
          throw new Error(
            "Account access is unavailable. Please contact the hosted operator.",
          );
        options.navigate(accountUrl);
      },
      loadUsage: async (signal): Promise<RuntimeUsage> => {
        if (!scope) throw new Error("Account usage requires current admission");
        const response = await scope.fetch("/v1/hosted/quotas", { signal });
        if (!response.ok) throw new Error("Account usage is unavailable");
        const value = (await response.json()) as {
          turns: { used: number; limit: number };
          chats: { used: number; limit: number };
          storage_bytes: { used: number; limit: number };
          resets_at: string;
        };
        for (const unit of [value.turns, value.chats, value.storage_bytes]) {
          if (
            !unit ||
            !Number.isSafeInteger(unit.used) ||
            unit.used < 0 ||
            !Number.isSafeInteger(unit.limit) ||
            unit.limit < 0
          )
            throw new Error("Account usage has an incompatible format");
        }
        if (!Number.isFinite(Date.parse(value.resets_at)))
          throw new Error("Account usage has an incompatible reset time");
        return {
          units: [
            {
              id: "turns",
              label: "Chat turns",
              ...value.turns,
              resetsAt: value.resets_at,
            },
            { id: "chats", label: "Chats", ...value.chats },
            {
              id: "storage_bytes",
              label: "Storage bytes",
              ...value.storage_bytes,
            },
          ],
        };
      },
    },
    subscribe: (refresh) => {
      listeners.add(refresh);
      const onFocus = () => refresh();
      if (typeof window !== "undefined") {
        window.addEventListener("focus", onFocus);
        if (typeof BroadcastChannel !== "undefined" && !channel) {
          channel = new BroadcastChannel("animama-hosted-admission");
          channel.onmessage = (event: MessageEvent<unknown>) => {
            if (
              event.data &&
              typeof event.data === "object" &&
              "type" in event.data &&
              event.data.type === "signed-out"
            ) {
              signedOut = true;
              session = null;
              notify(true);
            }
          };
        }
      }
      startEvents();
      return () => {
        listeners.delete(refresh);
        if (typeof window !== "undefined")
          window.removeEventListener("focus", onFocus);
        if (!listeners.size) {
          stopEvents();
          if (bootstrapTimer) clearTimeout(bootstrapTimer);
          bootstrapTimer = null;
          channel?.close();
          channel = null;
        }
      };
    },
  };
}
