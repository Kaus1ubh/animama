import { renderToStaticMarkup } from "react-dom/server";
import { getI18n } from "react-i18next";
import { afterEach, describe, expect, it } from "vitest";

import {
  isChatAiNotice,
  isChatCrisisSupport,
  type ChatCrisisSupport,
} from "@animama/product-ui/chat";
import {
  isQuickChatCommand,
  isQuickChatSnapshot,
} from "@/hooks/useDesktopQuickChatRuntime";
import { CompanionSafetyView } from "@/ui/safety/CompanionSafetyView";

const crisis: ChatCrisisSupport = {
  type: "safety.crisis_support",
  run_id: "run-1",
  source: "moderation",
  resources: {
    code: "US",
    label: "United States",
    emergency_number: "911",
    services: [
      {
        name: "988 Suicide & Crisis Lifeline",
        description: "Free, confidential support 24/7.",
        contacts: [
          { kind: "phone", label: "Call 988", value: "988" },
          { kind: "sms", label: "Text 988", value: "988" },
          {
            kind: "chat",
            label: "Chat online",
            value: "https://chat.988lifeline.org/",
          },
        ],
      },
    ],
    source_url: "https://988lifeline.org/get-help/",
    verified_on: "2026-09-25",
  },
};

const noop = () => undefined;

describe("crisis card", () => {
  it("lists the region's resources, the emergency line and the Safety page", () => {
    const html = renderToStaticMarkup(
      <CompanionSafetyView
        notice={null}
        noticeVisible={false}
        crisis={crisis}
        onDismissCrisis={noop}
      />,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain("988 Suicide &amp; Crisis Lifeline");
    expect(html).toContain('href="tel:988"');
    expect(html).toContain('href="sms:988"');
    expect(html).toContain('href="https://chat.988lifeline.org/"');
    expect(html).toContain("call 911");
    expect(html).toContain("not a substitute for professional help");
    expect(html).toContain("Safety and crisis protocol");
    expect(html).toContain('target="_blank"');
    expect(html).toContain(">Dismiss<");
  });

  it("falls back to local emergency services for an unlisted region", () => {
    const fallback: ChatCrisisSupport = {
      ...crisis,
      resources: {
        code: "fallback",
        label: "Other regions",
        emergency_number: null,
        services: [],
        verified_on: "2026-09-25",
      },
    };
    const html = renderToStaticMarkup(
      <CompanionSafetyView
        notice={null}
        noticeVisible={false}
        crisis={fallback}
        onDismissCrisis={noop}
      />,
    );
    expect(html).toContain("contact a local crisis line");
    expect(html).toContain("call your local emergency number");
    // The protocol opens in place, so the card never navigates away.
    expect(html).not.toContain('href="/safety"');
  });
});

describe("crisis card under another UI Locale (spec R9)", () => {
  afterEach(async () => {
    await getI18n().changeLanguage("en");
  });

  it("translates the card's labels and shows the verified service data as sent", async () => {
    await getI18n().changeLanguage("ja");
    const t = getI18n().getFixedT("ja", "safety");
    const html = renderToStaticMarkup(
      <CompanionSafetyView
        notice={null}
        noticeVisible={false}
        crisis={crisis}
        onDismissCrisis={noop}
      />,
    );

    // The card's own labels come from the catalog.
    expect(html).toContain(`aria-label="${t("crisis.label")}"`);
    expect(html).toContain(t("crisis.intro"));
    expect(html).toContain(t("crisis.emergency", { number: "911" }));
    expect(html).toContain(t("crisis.notProfessional"));
    expect(html).toContain(t("protocol.title"));
    expect(html).toContain(`>${t("crisis.dismiss")}<`);
    expect(html).not.toContain("Trained people can help");
    expect(html).not.toContain(">Dismiss<");

    // Service names, descriptions and contacts are the backend's data, unchanged.
    expect(html).toContain("988 Suicide &amp; Crisis Lifeline");
    expect(html).toContain("Free, confidential support 24/7.");
    expect(html).toContain(">Call 988<");
    expect(html).toContain(">Text 988<");
    expect(html).toContain(">Chat online<");
    expect(html).toContain('href="tel:988"');
    expect(html).toContain('href="https://chat.988lifeline.org/"');
  });

  it("words the AI notice in the UI Locale around the Anima's name", async () => {
    await getI18n().changeLanguage("ja");
    const html = renderToStaticMarkup(
      <CompanionSafetyView
        notice={{ kind: "reminder", animaName: "Annie" }}
        noticeVisible
        crisis={null}
        onDismissCrisis={noop}
      />,
    );
    expect(html).toContain(
      getI18n().getFixedT("ja", "safety")("aiNotice.reminder", {
        name: "Annie",
      }),
    );
    expect(html).not.toContain("not a person");
  });
});

describe("AI notice", () => {
  it("is a polite status line naming the Anima", () => {
    const html = renderToStaticMarkup(
      <CompanionSafetyView
        notice={{ kind: "start", animaName: "Annie" }}
        noticeVisible
        crisis={null}
        onDismissCrisis={noop}
      />,
    );
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain(
      "You&#x27;re talking with Annie, an AI — not a person.",
    );
    expect(html).toContain("motion-reduce:transition-none");
  });

  it("fades out and hides from assistive technology once hidden", () => {
    const html = renderToStaticMarkup(
      <CompanionSafetyView
        notice={{ kind: "reminder", animaName: "Annie" }}
        noticeVisible={false}
        crisis={null}
        onDismissCrisis={noop}
      />,
    );
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("opacity-0");
  });

  it("renders nothing without a notice or card", () => {
    expect(
      renderToStaticMarkup(
        <CompanionSafetyView
          notice={null}
          noticeVisible={false}
          crisis={null}
          onDismissCrisis={noop}
        />,
      ),
    ).toBe("");
  });
});

describe("safety SSE events", () => {
  it("recognizes safety events and never mistakes them for replies or errors", () => {
    const notice = {
      type: "safety.ai_notice",
      run_id: "run-1",
      kind: "start",
      anima_name: "Annie",
    };
    expect(isChatAiNotice(notice)).toBe(true);
    expect(isChatCrisisSupport(crisis)).toBe(true);
    for (const payload of [notice, crisis]) {
      expect(
        "text" in payload ||
          "error" in payload ||
          "emotions" in payload ||
          "gesture" in payload,
      ).toBe(false);
    }
    expect(isChatAiNotice({ ...notice, kind: "other" })).toBe(false);
    expect(isChatCrisisSupport({ ...crisis, resources: null })).toBe(false);
  });
});

describe("Quick Chat safety bridge", () => {
  it("accepts the dismiss command and safety snapshots", () => {
    expect(isQuickChatCommand({ type: "dismiss-crisis-card" })).toBe(true);
    const snapshot = {
      activeChat: null,
      animaId: "anima-1",
      chatId: null,
      input: "",
      inputPlaceholder: "",
      canChat: true,
      isStreaming: false,
      isAwaitingStreamingAnimationFinalization: false,
      displayMessages: [],
      promptSuggestions: [],
      showPromptSuggestions: false,
      voice: {},
    };
    expect(
      isQuickChatSnapshot({
        ...snapshot,
        safety: { notice: null, noticeVisible: false, crisis },
      }),
    ).toBe(true);
    expect(isQuickChatSnapshot({ ...snapshot, safety: "bad" })).toBe(false);
    expect(isQuickChatSnapshot(snapshot)).toBe(true);
  });
});
