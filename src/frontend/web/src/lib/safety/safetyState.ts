import type { ChatCrisisSupport } from "@animama/product-ui/chat";

import {
  settleAiNotice,
  showAiNotice,
  type AiNoticeKind,
  type AiNoticeState,
} from "@/lib/safety/aiNotice";

/** AI notice and crisis card state for one Anima route (spec R2, R4). */
export type CompanionSafetyState = {
  notice: AiNoticeState | null;
  noticeVisible: boolean;
  crisis: ChatCrisisSupport | null;
};

export type CompanionSafetyAction =
  | {
      type: "notice";
      kind: AiNoticeKind;
      animaName: string | null | undefined;
      runId: string;
      now: number;
    }
  | { type: "crisis"; card: ChatCrisisSupport }
  /** The turn completed, failed, stopped, or its chat panel unmounted. */
  | { type: "settle"; now: number }
  | { type: "hide-notice" }
  | { type: "remove-notice" }
  | { type: "dismiss-crisis" };

export const INITIAL_COMPANION_SAFETY_STATE: CompanionSafetyState = {
  notice: null,
  noticeVisible: false,
  crisis: null,
};

export function companionSafetyReducer(
  state: CompanionSafetyState,
  action: CompanionSafetyAction,
): CompanionSafetyState {
  switch (action.type) {
    case "notice":
      return {
        ...state,
        notice: showAiNotice(
          {
            kind: action.kind,
            animaName: action.animaName,
            runId: action.runId,
          },
          action.now,
        ),
        noticeVisible: true,
      };
    case "crisis":
      // A later positive turn replaces the card; it otherwise stays until dismissed.
      return { ...state, crisis: action.card };
    case "settle":
      return state.notice
        ? { ...state, notice: settleAiNotice(state.notice, action.now) }
        : state;
    case "hide-notice":
      return { ...state, noticeVisible: false };
    case "remove-notice":
      return { ...state, notice: null, noticeVisible: false };
    case "dismiss-crisis":
      return { ...state, crisis: null };
  }
}

/** The subset mirrored to the Quick Chat window. */
export function quickChatSafetySnapshot(state: CompanionSafetyState) {
  return {
    notice: state.notice
      ? { kind: state.notice.kind, animaName: state.notice.animaName }
      : null,
    noticeVisible: state.noticeVisible,
    crisis: state.crisis,
  };
}
