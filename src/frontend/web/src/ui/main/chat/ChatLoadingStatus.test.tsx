import { renderToStaticMarkup } from "@/test/runtime-markup";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ChatLoadingStatusLines,
  useChatLoadingStatus,
  type ChatLoadingStatus,
} from "@/ui/main/chat/ChatLoadingStatus";

const fixture = vi.hoisted(() => ({
  mounted: {
    playbackStatus: "preparing",
    avatarVisualStatus: "loading",
    preparationProgress: null as {
      completedMembers: number;
      totalMembers: number;
    } | null,
  },
  pocket: { ready: false, phase: "idle", loadingStep: null as number | null },
  downloads: {} as Record<string, { status: string; progress: number | null }>,
  downloadsEnabled: [] as boolean[],
}));

vi.mock("@/ui/app/AnimaRouteProviders", () => ({
  useMountedAnimaRuntimeContent: () => fixture.mounted,
}));
vi.mock("@/hooks/use-pocket-tts-runtime", () => ({
  POCKET_LOADING_STEP_COUNT: 5,
  usePocketTtsRuntime: () => fixture.pocket,
}));
vi.mock("@/hooks/use-pocket-voice-downloads", () => ({
  usePocketVoiceDownloads: ({ enabled }: { enabled: boolean }) => {
    fixture.downloadsEnabled.push(enabled);
    return { availability: (id: string) => fixture.downloads[id] ?? null };
  },
}));

const idle: ChatLoadingStatus = {
  avatar: false,
  content: null,
  textToSpeech: null,
  speechToText: false,
  voiceDownload: null,
};

/** The rendered status lines, in order. */
function linesOf(markup: string): string[] {
  return [...markup.matchAll(/<p>(.*?)<\/p>/g)].map((match) => match[1]);
}

function lines(status: Partial<ChatLoadingStatus>) {
  return linesOf(
    renderToStaticMarkup(
      <ChatLoadingStatusLines status={{ ...idle, ...status }} />,
    ),
  );
}

function Harness({ isDictationPreparing = false }) {
  const status = useChatLoadingStatus({ isDictationPreparing });
  return <ChatLoadingStatusLines status={status} />;
}

function routeLines(isDictationPreparing = false) {
  return linesOf(
    renderToStaticMarkup(
      <Harness isDictationPreparing={isDictationPreparing} />,
    ),
  );
}

describe("ChatLoadingStatusLines", () => {
  it("renders nothing when nothing is pending", () => {
    expect(renderToStaticMarkup(<ChatLoadingStatusLines status={idle} />)).toBe(
      "",
    );
  });

  it("stacks one Loading line per local item", () => {
    expect(
      lines({
        avatar: true,
        content: { completed: 31, total: 40 },
        textToSpeech: { step: 2, total: 5 },
        speechToText: true,
      }),
    ).toEqual([
      "Loading avatar",
      "Loading animations and effects (31/40)",
      "Loading Text-to-Speech (PocketTTS), step 2 of 5",
      "Loading Speech-to-Text (Parakeet)",
    ]);
  });

  it("omits an unknown content count or PocketTTS step", () => {
    expect(
      lines({
        content: { completed: 0, total: 0 },
        textToSpeech: { step: null, total: 5 },
      }),
    ).toEqual([
      "Loading animations and effects",
      "Loading Text-to-Speech (PocketTTS)",
    ]);
  });

  it("says Downloading only for a voice install, with size and progress", () => {
    const voiceDownload = { name: "Azelma", sizeBytes: 8 * 1024 ** 2 };
    expect(
      lines({ voiceDownload: { ...voiceDownload, progress: 0.42 } }),
    ).toEqual(["Downloading voice Azelma (8 MB), 42%"]);
    expect(
      lines({ voiceDownload: { ...voiceDownload, progress: null } }),
    ).toEqual(["Downloading voice Azelma (8 MB)"]);
  });
});

describe("useChatLoadingStatus", () => {
  beforeEach(() => {
    fixture.mounted = {
      playbackStatus: "preparing",
      avatarVisualStatus: "loading",
      preparationProgress: null,
    };
    fixture.pocket = { ready: false, phase: "idle", loadingStep: null };
    fixture.downloads = {};
    fixture.downloadsEnabled = [];
  });

  it("shows the Avatar first, then content progress once it is visible", () => {
    expect(routeLines()).toEqual(["Loading avatar"]);
    fixture.mounted = {
      playbackStatus: "preparing",
      avatarVisualStatus: "visible",
      preparationProgress: { completedMembers: 3, totalMembers: 9 },
    };
    expect(routeLines()).toEqual(["Loading animations and effects (3/9)"]);
    fixture.mounted.playbackStatus = "ready";
    expect(routeLines()).toEqual([]);
  });

  it("reports the PocketTTS step during its first load and Parakeet while dictation prepares", () => {
    fixture.mounted.playbackStatus = "ready";
    fixture.mounted.avatarVisualStatus = "visible";
    fixture.pocket = { ready: false, phase: "loading", loadingStep: 4 };
    expect(routeLines(true)).toEqual([
      "Loading Text-to-Speech (PocketTTS), step 4 of 5",
      "Loading Speech-to-Text (Parakeet)",
    ]);
    fixture.pocket = { ready: true, phase: "loading", loadingStep: null };
    expect(routeLines()).toEqual([]);
  });

  it("reads a downloading voice from the shared cache without fetching", () => {
    fixture.mounted.playbackStatus = "ready";
    fixture.downloads.azelma = { status: "downloading", progress: 0.5 };
    expect(routeLines()).toEqual([
      expect.stringMatching(/^Downloading voice Azelma \(.+\), 50%$/),
    ]);
    expect(fixture.downloadsEnabled.every((enabled) => !enabled)).toBe(true);
  });
});
