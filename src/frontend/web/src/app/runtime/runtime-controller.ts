import { QueryClient } from "@tanstack/react-query";
import type { RuntimeAdmission } from "@animama/runtime-contracts";
import { queryClientOptions } from "@/query/queryClientOptions";
import type { AdmissionRefresh, AppComposition } from "./composition";
import { SessionRequestScope } from "./session-requests";
import { clearPrivateSessionState } from "./private-session-state";
import { beginHostedRecoverySession } from "@/lib/content/recovery-session";

export type RuntimeSnapshot = {
  admission: RuntimeAdmission;
  queryClient: QueryClient;
  scope: SessionRequestScope | null;
  reconnecting: boolean;
};

/** Owns a composition's caches and invalidates requests before exposing a new admission. */
export class RuntimeController {
  private readonly listeners = new Set<() => void>();
  private pending: AbortController | null = null;
  private generation = 0;
  private cleanup: Promise<void> = Promise.resolve();
  private retry: ReturnType<typeof setTimeout> | null = null;
  private retryDelay = 1_000;
  private snapshot: RuntimeSnapshot = {
    admission: { status: "loading" },
    queryClient: new QueryClient({ defaultOptions: queryClientOptions }),
    scope: null,
    reconnecting: false,
  };

  readonly composition: AppComposition;
  constructor(composition: AppComposition) {
    this.composition = composition;
  }

  readonly getSnapshot = () => this.snapshot;
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private publish(admission: RuntimeAdmission): void {
    const previous = this.snapshot;
    if (
      admission.status === "ready" &&
      previous.admission.status === "ready" &&
      admission.session.key === previous.admission.session.key &&
      admission.session.owner.id === previous.admission.session.owner.id
    ) {
      previous.scope?.resume();
      this.snapshot = { ...previous, admission, reconnecting: false };
      this.listeners.forEach((listener) => listener());
      return;
    }
    this.composition.bindSession?.(null);
    if (previous.scope) {
      this.cleanup = Promise.allSettled([
        this.cleanup,
        previous.scope.end(),
      ]).then((results) => {
        const errors = results.flatMap((result) =>
          result.status === "rejected" ? [result.reason] : [],
        );
        if (errors.length)
          throw new AggregateError(errors, "Session cleanup failed");
      });
      void this.cleanup.catch(() => {});
    }
    void previous.queryClient.cancelQueries();
    previous.queryClient.clear();
    const scope =
      admission.status === "ready"
        ? new SessionRequestScope(
            admission.session.key,
            this.composition.transport,
          )
        : null;
    if (scope) {
      if (this.composition.kind === "hosted")
        beginHostedRecoverySession(scope.key);
      // Controller ownership fences cleanup before React effects, timers or unmounts can race it.
      scope.register(() =>
        clearPrivateSessionState(scope.key, this.composition.kind === "hosted"),
      );
    }
    this.snapshot = {
      admission,
      queryClient: new QueryClient({ defaultOptions: queryClientOptions }),
      scope,
      reconnecting: false,
    };
    this.composition.bindSession?.(scope);
    this.listeners.forEach((listener) => listener());
  }

  readonly refresh = async (
    repair = false,
    invalidate: AdmissionRefresh = false,
  ): Promise<void> => {
    if (invalidate === "uncertain" || invalidate === "recheck") {
      this.suspend();
      // Events can fail repeatedly while a context read or its backoff is still
      // pending. Preserve that read's chance to finish and its bounded retry; a
      // recheck reads the context immediately instead.
      if (invalidate === "uncertain" && (this.pending || this.retry)) return;
    }
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    this.pending?.abort();
    const pending = new AbortController();
    this.pending = pending;
    const generation = ++this.generation;
    if (invalidate === true || this.snapshot.admission.status !== "ready")
      this.publish({ status: "loading" });
    try {
      const admission = await (
        repair ? this.composition.repair : this.composition.readAdmission
      )(pending.signal);
      if (generation !== this.generation || pending.signal.aborted) return;
      if (
        admission.status === "ready" &&
        this.snapshot.admission.status === "ready" &&
        (admission.session.key !== this.snapshot.admission.session.key ||
          admission.session.owner.id !==
            this.snapshot.admission.session.owner.id)
      )
        this.publish({ status: "loading" });
      if (admission.status === "ready") await this.cleanup;
      if (generation === this.generation && !pending.signal.aborted)
        this.publish(admission);
      this.retryDelay = 1_000;
    } catch {
      if (generation === this.generation && !pending.signal.aborted) {
        if (
          this.composition.kind === "hosted" &&
          this.snapshot.scope &&
          !this.snapshot.scope.controller.signal.aborted
        ) {
          this.suspend();
          this.retry = setTimeout(() => {
            void this.refresh();
          }, this.retryDelay);
          this.retryDelay = Math.min(this.retryDelay * 2, 30_000);
          return;
        }
        this.publish({
          status: "unavailable",
          message: "Animama could not reach the runtime. Please try again.",
        });
      }
    } finally {
      if (this.pending === pending) this.pending = null;
    }
  };

  readonly signOut = async (): Promise<void> => {
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    this.pending?.abort();
    const generation = ++this.generation;
    // Private work ends immediately, even when the logout request fails.
    this.publish({ status: "sign-in-required" });
    const [remote, cleanup] = await Promise.allSettled([
      this.composition.accountActions?.signOut(),
      this.cleanup,
    ]);
    if (generation !== this.generation) return;
    if (cleanup.status === "rejected") {
      this.publish({
        status: "sign-in-required",
        message:
          "This view is signed out. Browser recovery could not be fully removed.",
      });
    } else if (remote.status === "rejected") {
      this.publish({
        status: "sign-in-required",
        message:
          "This view is signed out. Remote sign-out could not be confirmed; sign in again to continue.",
      });
    }
  };

  readonly completeOnboarding = async (
    input: Parameters<NonNullable<AppComposition["completeOnboarding"]>>[0],
  ) => {
    if (!this.composition.completeOnboarding)
      throw new Error("Setup is unavailable in this application.");
    const generation = this.generation;
    const admission = await this.composition.completeOnboarding(input);
    if (generation === this.generation) this.publish(admission);
  };

  dispose(): void {
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    this.pending?.abort();
    ++this.generation;
    this.publish({ status: "loading" });
  }

  private suspend(): void {
    if (!this.snapshot.scope) return;
    this.snapshot.scope.suspend();
    this.snapshot = { ...this.snapshot, reconnecting: true };
    this.listeners.forEach((listener) => listener());
  }
}
