import type {
  RuntimeAdmission,
  RuntimeUsage,
} from "@animama/runtime-contracts";
import { zRuntimeCapabilities } from "@animama/runtime-contracts/validators";
import type { AdmissionRefresh, AppComposition } from "../runtime/composition";
import type { SessionRequestScope } from "../runtime/session-requests";
import { traceProductRequest } from "../runtime/product-request-tracing";
import { createAccountSetup } from "./account-setup";
import {
  markSignOutIncomplete,
  signInReturnPath,
  signOutMarkedIncomplete,
  takeSignInFailure,
} from "./account-navigation";
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

/**
 * Context states that end the account's access, so they retire private work and
 * purge hosted recovery. `paused` (enrollment, capacity, rate and cooldown
 * limits) is transient: it withholds admission without revoking anything.
 */
const REVOKING_STATES = new Set([
  "session_required",
  "ineligible",
  "restricted",
  "deletion_pending",
]);
/** Server-owned account setup states; they withhold admission without revoking. */
const SETUP_STATES = new Set([
  "bootstrap_required",
  "bootstrapping",
  "recovery",
]);
/** Progress reads while setup finishes elsewhere, before recovery is offered (~2 min). */
const SETUP_POLL_DELAYS_MS = [1_500, 3_000, 5_000];
const MAX_SETUP_POLLS = 24;
/** An open view repeats failed setup on its own after this pause, doubling to a minute. */
const SETUP_PAUSE_MS = 2_000;
const MAX_SETUP_PAUSE_MS = 60_000;

/** Cookie authority and CSRF are installed before React; browser headers cannot choose an owner. */
export function createHostedComposition(
  options: Options,
): AppComposition & { browserFetch: typeof globalThis.fetch } {
  const origin = new URL(options.baseUrl).origin;
  let csrf: string | null = null;
  let scope: SessionRequestScope | null = null;
  let session: { owner: string; generation: string; key: string } | null = null;
  let accountUrl: string | null = null;
  /** This tab signed out, so it stays signed out until a sign-in here. */
  let signedOut = false;
  /** Another tab signed out; this tab checks again when it is next focused. */
  let signedOutElsewhere = false;
  /** This page's remote logout failed; a browser-wide marker mirrors it. */
  let signOutFailed = false;
  let signOutAttempt: Promise<void> | null = null;
  /** A failed sign-in callback is reported on the sign-in view until the next attempt. */
  let signInFailed = takeSignInFailure();
  let signInError = false;
  let loginRequest: AbortController | null = null;
  let events: AbortController | null = null;
  let bootstrapTimer: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let eventsDelay = 1_000;
  let eventsDoubted = false;
  const listeners = new Set<(invalidate?: AdmissionRefresh) => void>();
  let channel: BroadcastChannel | null = null;
  const notify = (invalidate: AdmissionRefresh = false) =>
    listeners.forEach((listener) => listener(invalidate));
  const stopEvents = () => {
    events?.abort();
    events = null;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    eventsDelay = 1_000;
    eventsDoubted = false;
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

  const signOutIncomplete = () => signOutFailed || signOutMarkedIncomplete();
  const signInRequired = (): RuntimeAdmission =>
    signInFailed
      ? {
          status: "sign-in-required",
          message: "Sign-in did not finish. Please try again.",
        }
      : { status: "sign-in-required" };

  /**
   * Reads the current session for sign-out work without admitting it. Returns
   * its CSRF token, or null once the session has ended.
   */
  async function liveSessionCsrf(signal?: AbortSignal): Promise<string | null> {
    const response = await authorizedFetch("/v1/hosted/runtime-context", {
      signal,
    });
    if (response.status === 401 || response.status === 403) return null;
    if (!response.ok)
      throw new Error("Hosted context is temporarily unavailable");
    const context = (await response.json()) as HostedContext;
    if (context.state === "session_required") return null;
    if (typeof context.csrf_token !== "string" || !context.csrf_token)
      throw new Error("Hosted context has no current CSRF token");
    return context.csrf_token;
  }

  /** The sign-out finished elsewhere, or the session ended on its own. */
  function forgetIncompleteSignOut(): void {
    signOutFailed = false;
    markSignOutIncomplete(false);
    csrf = null;
  }

  /**
   * A failed sign-out stays on its retry view, and never readmits the session
   * it left live, until it finishes or someone signs in again. The read keeps
   * the retry's CSRF token current.
   */
  async function incompleteSignOut(
    signal?: AbortSignal,
  ): Promise<RuntimeAdmission> {
    try {
      const current = await liveSessionCsrf(signal);
      if (current) csrf = current;
      else forgetIncompleteSignOut();
    } catch {
      signal?.throwIfAborted();
      // The retry reads the context again before its logout.
    }
    return { status: "sign-in-required" };
  }

  async function logout(): Promise<void> {
    // A retry, or a page reloaded since the failure, uses the current token.
    if (!csrf || signOutIncomplete()) csrf = await liveSessionCsrf();
    if (csrf) await json("/api/cloud/auth/logout", { method: "POST" });
  }

  async function signOutOnce(): Promise<void> {
    loginRequest?.abort();
    session = null;
    signedOut = true;
    signedOutElsewhere = false;
    // Private browser state is removed at once, whatever the server says.
    const recoveryCleanup = purgeHostedRecoverySessions();
    forgetHostedRecoveryIdentity();
    channel?.postMessage({ type: "signed-out" });
    const [remote, local] = await Promise.allSettled([
      logout(),
      recoveryCleanup,
    ]);
    accountUrl = null;
    signOutFailed = remote.status === "rejected";
    markSignOutIncomplete(signOutFailed);
    if (!signOutFailed) csrf = null;
    const errors = [remote, local].flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    if (errors.length)
      throw new AggregateError(
        errors,
        "Hosted sign-out could not fully complete",
      );
  }

  /** Whether another tab's newer session is live, so a sign-in here can adopt it. */
  async function anotherSessionIsLive(signal: AbortSignal): Promise<boolean> {
    try {
      return (await liveSessionCsrf(signal)) !== null;
    } catch {
      signal.throwIfAborted();
      return false;
    }
  }

  // Attempts are not tied to an admission read: a superseded read must not
  // abandon a setup request whose reply would otherwise be lost.
  const setup = createAccountSetup((idempotencyKey) =>
    authorizedFetch("/v1/hosted/bootstrap:ensure", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idempotency_key: idempotencyKey }),
    }),
  );
  /** A signed-in first use starts setup without a click, once per page. */
  let automaticSetup = true;
  /** A person's retry permits one attempt, including in `recovery`. */
  let setupRequested = false;
  let setupPolls = 0;
  let setupPause = SETUP_PAUSE_MS;
  let setupPausedUntil = 0;

  /**
   * Account setup withholds admission without revoking anything. A first use
   * sets up on its own behind a setup view, and `recovery` (or a failed
   * attempt) waits for a person's retry. An open view keeps its session and
   * drafts suspended while it repairs at a bounded pace.
   */
  function setupAdmission(state: string): RuntimeAdmission {
    const open = session !== null;
    if (state === "bootstrapping") {
      if (open) throw new Error("Hosted account setup has not finished");
      setupPolls += 1;
      if (setupPolls > MAX_SETUP_POLLS) return { status: "recovery" };
      if (listeners.size && !bootstrapTimer)
        bootstrapTimer = setTimeout(
          () => {
            bootstrapTimer = null;
            notify();
          },
          SETUP_POLL_DELAYS_MS[
            Math.min(setupPolls, SETUP_POLL_DELAYS_MS.length) - 1
          ],
        );
      return {
        status: "loading",
        message: "Finishing setting up your account…",
      };
    }
    const permitted = open
      ? Date.now() >= setupPausedUntil
      : setupRequested || (state === "bootstrap_required" && automaticSetup);
    if (permitted && csrf && !setup.running) {
      if (open) {
        setupPausedUntil = Date.now() + setupPause;
        setupPause = Math.min(setupPause * 2, MAX_SETUP_PAUSE_MS);
      } else {
        automaticSetup = false;
        setupRequested = false;
      }
      // The context read afterwards, not the reply, decides what comes next.
      void setup.run().then(() => notify());
    }
    if (open) throw new Error("Hosted account setup has not finished");
    return setup.running
      ? { status: "loading", message: "Setting up your account…" }
      : { status: "recovery" };
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
      restricted: "restricted",
      deletion_pending: "restricted",
    };
    if (context.state !== "bootstrapping") setupPolls = 0;
    if (context.state !== "active") {
      if (SETUP_STATES.has(context.state)) return setupAdmission(context.state);
      const authoritativeDenial = REVOKING_STATES.has(context.state);
      if (session && !authoritativeDenial)
        throw new Error("Hosted admission could not currently be confirmed");
      session = null;
      // Initial reloads have no in-memory session yet. Unknown/transient states
      // withhold admission but cannot revoke that tab's persisted operation.
      if (authoritativeDenial) {
        void scope?.end();
        await purgeHostedRecoverySessions();
        forgetHostedRecoveryIdentity();
        signal?.throwIfAborted();
      }
      if (context.state === "session_required") return signInRequired();
      return { status: states[context.state] ?? "unavailable" };
    }
    setupRequested = false;
    setupPause = SETUP_PAUSE_MS;
    signInFailed = false;
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
    if (signOutAttempt) return { status: "sign-in-required" };
    if (signOutIncomplete()) return incompleteSignOut(signal);
    if (signedOut || signedOutElsewhere) return { status: "sign-in-required" };
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
      return signInRequired();
    }
    if (!response.ok)
      throw new Error("Hosted context is temporarily unavailable");
    const context = (await response.json()) as HostedContext;
    signal?.throwIfAborted();
    if (context.state === "identity_unavailable" && session)
      throw new Error("Hosted identity is temporarily unavailable");
    return contextAdmission(context, signal);
  }

  /** A person's retry permits one new setup attempt and restarts progress reads. */
  async function repair(signal?: AbortSignal): Promise<RuntimeAdmission> {
    setupRequested = true;
    setupPolls = 0;
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
          if (controller.signal.aborted) return;
          eventsDoubted = true;
          // The runtime context, not the events stream, decides whether admission ended.
          notify(
            response.status === 401 || response.status === 403
              ? "recheck"
              : "uncertain",
          );
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
              eventsDoubted = true;
              notify("recheck");
              return;
            }
            if (/^event:\s*ready\s*$/m.test(event)) {
              eventsDelay = 1_000;
              // A restored stream lets paused requests resume without waiting for
              // backoff; a plain refresh resumes the same session without pausing again.
              if (eventsDoubted) notify();
              eventsDoubted = false;
            }
          }
        }
        if (!controller.signal.aborted) {
          eventsDoubted = true;
          notify("uncertain");
        }
      } catch {
        if (!controller.signal.aborted) {
          eventsDoubted = true;
          notify("uncertain");
        }
      } finally {
        void reader?.cancel().catch(() => {});
        if (events === controller) events = null;
        if (!controller.signal.aborted && scope && listeners.size) {
          // Bounded exponential backoff with jitter keeps an outage from
          // turning every open tab into a once-per-second poller.
          const delay = Math.min(
            eventsDelay * (0.8 + Math.random() * 0.4),
            30_000,
          );
          eventsDelay = Math.min(eventsDelay * 2, 30_000);
          retryTimer = setTimeout(() => {
            retryTimer = null;
            startEvents();
          }, delay);
        }
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
    accountAffordances: () => ({
      // Without a validated URL the Account controls are hidden, not broken.
      canOpenAccount: accountUrl !== null,
      signOutIncomplete: signOutIncomplete(),
    }),
    accountActions: {
      signIn: () => {
        // The session a failed sign-out left live is never adopted: only a
        // new sign-in, which ends that session on the server, replaces it.
        const replaceSession = signOutAttempt !== null || signOutIncomplete();
        forgetIncompleteSignOut();
        signedOut = false;
        signedOutElsewhere = false;
        signInFailed = false;
        automaticSetup = true;
        session = null;
        forgetHostedRecoveryIdentity();
        loginRequest?.abort();
        const controller = new AbortController();
        loginRequest = controller;
        void (async () => {
          // Another tab may have signed in since this view signed out. Adopt
          // that session instead of replacing it (and retiring its drafts).
          if (
            !replaceSession &&
            (await anotherSessionIsLive(controller.signal))
          )
            return notify(true);
          // Login is deliberately separate from product CSRF admission.
          const response = await options.fetch(
            new Request(new URL("/api/cloud/auth/login", origin), {
              method: "POST",
              signal: controller.signal,
              credentials: "same-origin",
              cache: "no-store",
              redirect: "error",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ return_path: signInReturnPath() }),
            }),
          );
          if (!response.ok) throw new Error("Sign-in is unavailable");
          const result = (await response.json()) as {
            authorization_url?: string;
          };
          controller.signal.throwIfAborted();
          const url = new URL(result.authorization_url ?? "");
          if (url.protocol !== "https:" || url.username || url.password)
            throw new Error("Sign-in requires a secure identity endpoint");
          options.navigate(url.href);
        })().catch(() => {
          if (!controller.signal.aborted) {
            signInError = true;
            notify(true);
          }
        });
      },
      /** Joins a running sign-out; a failed remote logout keeps its CSRF for the retry. */
      signOut: () =>
        (signOutAttempt ??= signOutOnce().finally(() => {
          signOutAttempt = null;
        })),
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
      // Returning to a tab checks the server again, including a tab another
      // tab signed out: someone may have signed in again since.
      const onFocus = () => {
        if (typeof document !== "undefined" && document.hidden) return;
        signedOutElsewhere = false;
        refresh();
      };
      if (typeof window !== "undefined") {
        window.addEventListener("focus", onFocus);
        if (typeof document !== "undefined")
          document.addEventListener("visibilitychange", onFocus);
        if (typeof BroadcastChannel !== "undefined" && !channel) {
          channel = new BroadcastChannel("animama-hosted-admission");
          channel.onmessage = (event: MessageEvent<unknown>) => {
            if (
              event.data &&
              typeof event.data === "object" &&
              "type" in event.data &&
              event.data.type === "signed-out"
            ) {
              // Only the tab that signed out stays latched; this one ends its
              // private work now and reads the server when it is next focused.
              signedOutElsewhere = true;
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
        if (typeof document !== "undefined")
          document.removeEventListener("visibilitychange", onFocus);
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
