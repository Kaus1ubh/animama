import type {
  ProductRuntimeComposition,
  RuntimeAdmission,
} from "@animama/runtime-contracts";
import type { LocalOnboardingInput } from "../local-runtime/LocalRuntimeProvider";
import type { SessionRequestScope } from "./session-requests";

/**
 * Why a composition asks for readmission. `true` ends the current session;
 * `"uncertain"` reports transport doubt and retries with backoff; `"recheck"`
 * reports a server signal that admission may have ended, so the context is read
 * now and alone decides. Both suspend authority-dependent requests meanwhile.
 */
export type AdmissionRefresh = boolean | "uncertain" | "recheck";

/** Account controls a composition can offer now; they follow each admission read. */
export type AccountAffordances = {
  /** A validated central account URL is available for the Account controls. */
  readonly canOpenAccount: boolean;
  /** A requested sign-out has not finished; retrying it is the way forward. */
  readonly signOutIncomplete: boolean;
};

/** Entrypoint-owned lifecycle hooks. Feature modules consume admission, never installation policy. */
export interface AppComposition extends ProductRuntimeComposition {
  readonly kind: "local" | "hosted";
  readonly subscribe?: (
    refresh: (invalidate?: AdmissionRefresh) => void,
  ) => () => void;
  readonly bindSession?: (scope: SessionRequestScope | null) => void;
  readonly completeOnboarding?: (
    input: LocalOnboardingInput,
  ) => Promise<RuntimeAdmission>;
  /**
   * Sends the person's explicit 18+ confirmation when admission still needs it
   * (`onboardingRequired`) and returns the admission that follows; only a
   * composition whose server records the confirmation supplies it.
   */
  readonly confirmAge?: () => Promise<RuntimeAdmission>;
  /**
   * Whether the server is still preparing this account's starter data (read
   * whenever admission is published). Product reads answer as an empty account
   * meanwhile; compositions without server-side setup omit it.
   */
  readonly setupPending?: () => boolean;
  /** Read whenever admission is published; compositions without accounts omit it. */
  readonly accountAffordances?: () => AccountAffordances;
}
