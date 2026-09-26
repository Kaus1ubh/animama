import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type ReactNode,
} from "react";

import type { ChatSafetyEffects } from "@animama/product-ui/chat";
import { aiNoticeHideAt } from "@/lib/safety/aiNotice";
import {
  INITIAL_COMPANION_SAFETY_STATE,
  companionSafetyReducer,
  type CompanionSafetyState,
} from "@/lib/safety/safetyState";

/** Time for the notice fade-out before it is removed. */
const AI_NOTICE_FADE_MS = 600;

type CompanionSafetyContextValue = CompanionSafetyState & {
  /** Pass to the chat session so turn events reach this provider. */
  sessionEffects: ChatSafetyEffects;
  /** Report whether a chat turn is streaming; `false` settles the notice. */
  reportStreaming: (isStreaming: boolean) => void;
  dismissCrisis: () => void;
};

const CompanionSafetyContext =
  createContext<CompanionSafetyContextValue | null>(null);

/**
 * Holds the AI notice and crisis card for one Anima route.
 *
 * It sits above the chat panel so the card survives canvas-mode switches (the
 * Avatar-only mode unmounts the chat panel).
 */
export function CompanionSafetyProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(
    companionSafetyReducer,
    INITIAL_COMPANION_SAFETY_STATE,
  );

  const sessionEffects = useMemo<ChatSafetyEffects>(
    () => ({
      onAiNotice: (event) =>
        dispatch({
          type: "notice",
          kind: event.kind,
          animaName: event.anima_name,
          runId: event.run_id,
          now: Date.now(),
        }),
      onCrisisSupport: (card) => dispatch({ type: "crisis", card }),
    }),
    [],
  );

  const reportStreaming = useCallback((isStreaming: boolean) => {
    if (!isStreaming) dispatch({ type: "settle", now: Date.now() });
  }, []);

  const hideAt = state.notice ? aiNoticeHideAt(state.notice) : null;
  useEffect(() => {
    if (hideAt === null) return;
    const delay = Math.max(0, hideAt - Date.now());
    const hide = window.setTimeout(
      () => dispatch({ type: "hide-notice" }),
      delay,
    );
    const remove = window.setTimeout(
      () => dispatch({ type: "remove-notice" }),
      delay + AI_NOTICE_FADE_MS,
    );
    return () => {
      window.clearTimeout(hide);
      window.clearTimeout(remove);
    };
  }, [hideAt]);

  const dismissCrisis = useCallback(
    () => dispatch({ type: "dismiss-crisis" }),
    [],
  );

  const value = useMemo<CompanionSafetyContextValue>(
    () => ({ ...state, sessionEffects, reportStreaming, dismissCrisis }),
    [dismissCrisis, reportStreaming, sessionEffects, state],
  );

  return (
    <CompanionSafetyContext.Provider value={value}>
      {children}
    </CompanionSafetyContext.Provider>
  );
}

/** Safety state for the current Anima route, or `null` outside one (Quick Chat, tests). */
export function useCompanionSafety(): CompanionSafetyContextValue | null {
  return useContext(CompanionSafetyContext);
}
