import type {
  ProductRuntimeComposition,
  RuntimeAdmission,
} from "@animama/runtime-contracts";
import type { LocalOnboardingInput } from "../local-runtime/LocalRuntimeProvider";
import type { SessionRequestScope } from "./session-requests";

/** A transport fault suspends dispatch; only an authoritative revocation ends a lifetime. */
export type AdmissionRefresh = boolean | "uncertain";

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
