import type { ReactNode } from "react";
import { renderToStaticMarkup } from "@/test/runtime-markup";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ChatInterfaceView } from "@/ui/main/chat/ChatInterface";

const fixture = vi.hoisted(() => ({
  capabilities: {} as Record<string, unknown>,
}));

vi.mock("@/query/hooks/useRuntimeCapabilities", () => ({
  useRuntimeCapabilities: () => ({ data: fixture.capabilities }),
}));
vi.mock("@/query/hooks/useAnima", () => ({ useAnima: () => ({}) }));
vi.mock("@/query/hooks/useModelProviders", () => ({
  useModelProviders: () => ({}),
}));
vi.mock("@/platform/RuntimePlatformProvider", () => ({
  useRuntimePlatform: () => ({}),
}));
// Neither offline speech nor browser speech recognition is available.
vi.mock("@/lib/speech/stt-provider", () => ({
  isWebSpeechSupported: () => false,
}));
vi.mock("@animama/product-ui/components", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@animama/product-ui/components")>()),
  ChatConversation: () => null,
}));
vi.mock("@/ui/components/chat-transcript", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    ChatTranscript: Pass,
    ChatTranscriptContent: Pass,
    ChatTranscriptScrollButton: () => null,
  };
});
vi.mock("@/ui/components/chat-input", () => ({
  ChatInput: ({ children }: { children?: ReactNode }) => <>{children}</>,
  ChatInputDictation: () => null,
  ChatInputFileUploadButton: () => null,
  ChatInputFileUploadUnavailable: () => null,
  ChatInputModelSelector: () => null,
  ChatInputSubmit: () => null,
  ChatInputTextArea: () => null,
}));
vi.mock("@/ui/settings/OfflineSpeechDownloads", () => ({
  OfflineSpeechDownloads: () => <div>Speech model state</div>,
}));

function render() {
  return renderToStaticMarkup(
    <ChatInterfaceView
      animaId="annie"
      animaName="Annie"
      activeChat={null}
      activeMode={null}
      canChat
      displayMessages={[]}
      input=""
      inputPlaceholder="Message"
      isAwaitingStreamingAnimationFinalization={false}
      isStreaming={false}
      onIncompatibleModelSelect={vi.fn()}
      onInputChange={vi.fn()}
      onPromptSuggestionSelect={vi.fn()}
      onStop={vi.fn()}
      onStreamingAnimationComplete={vi.fn()}
      onSubmit={vi.fn()}
      promptSuggestions={[]}
      showPromptSuggestions={false}
      layout="chat-only"
    />,
  );
}

describe("unavailable speech recognition in the composer", () => {
  beforeEach(() => {
    fixture.capabilities = {};
  });

  it("offers the offline speech download where the owner administers models", () => {
    fixture.capabilities = {
      offline_speech_enabled: false,
      local_filesystem_administration: true,
    };
    const html = render();
    expect(html).toContain(
      "Install offline speech recognition to use dictation and Voice Mode",
    );
    expect(html).toContain("Speech model state");
  });

  it("says offline speech is not available where the operator provides models", () => {
    fixture.capabilities = {
      offline_speech_enabled: false,
      local_filesystem_administration: false,
    };
    const html = render();
    expect(html).not.toMatch(/Install offline speech/i);
    expect(html).toContain(
      "Offline speech recognition for dictation and Voice Mode is not available here",
    );
    expect(html).toContain("Speech model state");
  });
});
