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
}
