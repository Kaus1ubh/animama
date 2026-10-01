import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { UserFileUploadUppy } from "@/hooks/useUserFileUpload";
import { ChatInterfaceView } from "@/ui/main/chat/ChatInterface";

const fixture = vi.hoisted(() => ({
  capabilities: undefined as Record<string, unknown> | undefined,
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
vi.mock("@/lib/speech/stt-provider", () => ({
  isWebSpeechSupported: () => true,
}));
vi.mock("@animama/product-ui/components", () => ({
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
  ChatInput: ({
    leadingActions,
    children,
  }: {
    leadingActions?: ReactNode;
    children?: ReactNode;
  }) => (
    <>
      {leadingActions}
      {children}
    </>
  ),
  ChatInputDictation: () => null,
  ChatInputFileUploadButton: () => <button>Attach files</button>,
  ChatInputModelSelector: () => null,
  ChatInputSubmit: () => null,
  ChatInputTextArea: () => null,
}));
vi.mock("@/ui/components/chat-input-file-tray", () => ({
  ChatInputFileTray: () => <div>Upload tray</div>,
}));
vi.mock("./ChatFileDropOverlay", () => ({
  ChatFileDropOverlay: ({ enabled }: { enabled: boolean }) =>
    enabled ? <div>Drop files</div> : null,
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
      fileUploadUppy={{} as UserFileUploadUppy}
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

describe("chat file upload entry points", () => {
  beforeEach(() => {
    fixture.capabilities = undefined;
  });

  it.each([
    ["reported", { chat_file_uploads: true }],
    ["still loading", undefined],
  ])("are offered when uploads are %s", (_label, capabilities) => {
    fixture.capabilities = capabilities;
    const html = render();
    expect(html).toContain("Attach files");
    expect(html).toContain("Upload tray");
    expect(html).toContain("Drop files");
  });

  it("are hidden when the runtime reports uploads disabled", () => {
    fixture.capabilities = { chat_file_uploads: false };
    const html = render();
    expect(html).not.toContain("Attach files");
    expect(html).not.toContain("Upload tray");
    expect(html).not.toContain("Drop files");
  });
});
