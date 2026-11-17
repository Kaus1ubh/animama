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
  assets: [] as {
    id: string;
    status: string;
    size_bytes: number;
    total_bytes?: number;
    bytes_downloaded?: number;
  }[],
  automatic: undefined as
    | { state: string; batch_size?: number | null }
    | undefined,
}));

vi.mock("@/ui/app/AnimaRouteProviders", () => ({
  useMountedAnimaRuntimeContent: () => fixture.mounted,
}));
vi.mock("@/hooks/usePocketTtsRuntime", () => ({
  POCKET_LOADING_STEP_COUNT: 5,
  usePocketTtsRuntime: () => fixture.pocket,
}));
vi.mock("@/query/hooks/useAutomaticEpisodeProcessing", () => ({
  AUTOMATIC_EPISODE_PROCESSING_POLL_MS: 5_000,
  useAutomaticEpisodeProcessing: () => ({ data: fixture.automatic }),
}));
vi.mock("@/query/hooks/useModelAssets", () => ({
  useOperatorManagedModelAssets: () => false,
  useModelAssets: () => ({ data: { assets: fixture.assets } }),
}));

const idle: ChatLoadingStatus = {
  avatar: false,
  content: null,
  textToSpeech: null,
  speechToText: false,
  downloads: [],
  episodeProcessing: null,
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

  it("says Downloading for speech model downloads, with size and progress", () => {
    expect(
      lines({
        downloads: [
          {
            assetId: "parakeet-stt-webgpu",
            item: "speechToTextGpu",
            sizeBytes: 1.2 * 1024 ** 3,
            progress: 0.42,
          },
          {
            assetId: "pocket-tts-voice-cloning-encoder",
            item: "voiceClone",
            sizeBytes: 38 * 1024 ** 2,
            progress: null,
          },
        ],
      }),
    ).toEqual([
      "Downloading Speech-to-Text (Parakeet GPU): 42% of 1.2 GB",
      "Downloading Voice Clone encoder (38 MB)",
    ]);
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
    fixture.assets = [];
    fixture.automatic = undefined;
  });

  it("shows the progress line only while an automatic run is working", () => {
    fixture.mounted.playbackStatus = "ready";
    fixture.automatic = { state: "running", batch_size: 12 };
    expect(routeLines()).toEqual(["Crystallizing 12 notes into memory…"]);
    fixture.automatic = { state: "waiting", batch_size: null };
    expect(routeLines()).toEqual([]);
    // Without the capability the query never runs and has no data.
    fixture.automatic = undefined;
    expect(routeLines()).toEqual([]);
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

  it("lists a Parakeet download started elsewhere but not a Pocket voice", () => {
    fixture.mounted.playbackStatus = "ready";
    fixture.assets = [
      {
        id: "parakeet-stt",
        status: "downloading",
        size_bytes: 661332409,
        total_bytes: 1000,
        bytes_downloaded: 500,
      },
      { id: "pocket-voice-azelma", status: "downloading", size_bytes: 7963896 },
    ];
    expect(routeLines()).toEqual([
      "Downloading Speech-to-Text (Parakeet CPU): 50% of 630.7 MB",
    ]);
  });
});
