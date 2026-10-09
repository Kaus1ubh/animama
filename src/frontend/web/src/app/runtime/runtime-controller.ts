import { QueryClient } from "@tanstack/react-query";
import type { RuntimeAdmission } from "@animama/runtime-contracts";
import { createLogger } from "@/lib/logger";
import { queryClientOptions } from "@/query/queryClientOptions";
import type {
  AccountAffordances,
  AdmissionRefresh,
  AppComposition,
} from "./composition";
import { SessionRequestScope } from "./session-requests";
import { clearPrivateSessionState } from "./private-session-state";
import { beginHostedRecoverySession } from "@/lib/content/recovery-session";

const logger = createLogger("RuntimeController");
const NO_ACCOUNT: AccountAffordances = {
  canOpenAccount: false,
  signOutIncomplete: false,
};

export type RuntimeSnapshot = {
  admission: RuntimeAdmission;
  queryClient: QueryClient;
  scope: SessionRequestScope | null;
  reconnecting: boolean;
  /** The composition's account controls as of this admission. */
  account: AccountAffordances;
};

/** Owns a composition's caches and invalidates requests before exposing a new admission. */
export class RuntimeController {
  private readonly listeners = new Set<() => void>();
  private pending: AbortController | null = null;
  private generation = 0;
  /** Settles once every ended session's disposal has settled; it never rejects. */
  private cleanup: Promise<void> = Promise.resolve();
  /** Disposal failures not yet shown to the person; each is reported once. */
  private cleanupErrors: unknown[] = [];
  private retry: ReturnType<typeof setTimeout> | null = null;
  private retryDelay = 1_000;
  private snapshot: RuntimeSnapshot = {
    admission: { status: "loading" },
    queryClient: new QueryClient({ defaultOptions: queryClientOptions }),
    scope: null,
    reconnecting: false,
    account: NO_ACCOUNT,
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
    const account = this.composition.accountAffordances?.() ?? NO_ACCOUNT;
    if (
      admission.status === "ready" &&
      previous.admission.status === "ready" &&
      admission.session.key === previous.admission.session.key &&
      admission.session.owner.id === previous.admission.session.owner.id
    ) {
      previous.scope?.resume();
      this.snapshot = { ...previous, admission, reconnecting: false, account };
      this.listeners.forEach((listener) => listener());
      return;
    }
    this.composition.bindSession?.(null);
    if (previous.scope) {
      const ended = previous.scope.end().catch((error: unknown) => {
        this.cleanupErrors.push(error);
      });
      // Readmission still waits for every earlier disposal, but a failure is
      // collected for one report instead of rejecting every later admission.
      this.cleanup = Promise.all([this.cleanup, ended]).then(() => {});
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
      account,
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
    const { status } = this.snapshot.admission;
    // A loading view (such as account setup progress) stays while it re-reads.
    if (invalidate === true || (status !== "ready" && status !== "loading"))
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
      this.retryDelay = 1_000;
      if (generation !== this.generation || pending.signal.aborted) return;
      if (admission.status === "ready" && this.takeCleanupFailures())
        this.publish({
          status: "unavailable",
          message:
            "Animama could not finish clearing the previous session from this browser. Reload the page, or try again to continue.",
        });
      else this.publish(admission);
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

  /**
   * Ends private work at once, then shows how the sign-out finished. An
   * incomplete remote sign-out is reported by the composition's account
   * affordances, which survive any re-read made while it runs.
   */
  readonly signOut = async (): Promise<void> => {
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    this.pending?.abort();
    ++this.generation;
    // Private work ends immediately, even when the logout request fails.
    this.publish({ status: "sign-in-required" });
    const [remote] = await Promise.allSettled([
      this.composition.accountActions?.signOut(),
      this.cleanup,
    ]);
    // A sign-in that finished meanwhile owns the view now.
    if (this.snapshot.admission.status === "ready") return;
    const cleanupFailed = this.takeCleanupFailures();
    const incomplete =
      this.composition.accountAffordances?.().signOutIncomplete ?? false;
    this.publish(
      cleanupFailed || (remote.status === "rejected" && !incomplete)
        ? {
            status: "sign-in-required",
            message:
              "You are signed out, but some private data could not be removed from this browser. Reload the page before signing in again.",
          }
        : { status: "sign-in-required" },
    );
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

  /**
   * Takes the disposal failures collected so far. Reporting each one once lets a
   * retry admit again, while later cleanups report only their own failures.
   */
  private takeCleanupFailures(): boolean {
    if (!this.cleanupErrors.length) return false;
    logger.error(
      "Session",
      "Previous session cleanup failed",
      new AggregateError(
        this.cleanupErrors.splice(0),
        "Session cleanup failed",
      ),
    );
    return true;
  }

  private suspend(): void {
    if (!this.snapshot.scope) return;
    this.snapshot.scope.suspend();
    this.snapshot = { ...this.snapshot, reconnecting: true };
    this.listeners.forEach((listener) => listener());
  }
}
