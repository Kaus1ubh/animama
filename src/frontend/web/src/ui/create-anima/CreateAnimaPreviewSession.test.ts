import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Avatar } from "@/lib/avatar";
import type { PyTypedContentPreview } from "@animama/runtime-contracts/sdk";
import {
  CreateAnimaPreviewSession,
  PREVIEW_SETTLE_LIMIT_SEC,
} from "./CreateAnimaPreviewSession";

const mock = vi.hoisted(() => ({
  prepare: vi.fn(),
  play: vi.fn(),
  stopAudio: vi.fn(),
  resetBridge: vi.fn(),
  detach: vi.fn(),
}));
vi.mock("@/lib/runtime-content/PreviewByteSession", () => ({
  PreviewByteSession: { prepare: mock.prepare },
}));
vi.mock("@/lib/content/typedPreviewAdapters", () => ({
  typedActionPreview: (preview: unknown) => preview,
}));
vi.mock("@/lib/content-preview/actionPreviewTarget", () => ({
  actionPreviewTarget: () => ({
    sourceType: "resolved_action",
    slot: "gesture",
    runtimeId: "wave",
    runtime: {},
  }),
}));
vi.mock("@/lib/runtime-content/AnimaRuntimeCatalog", () => ({
  AnimaRuntimeCatalog: class {
    dispose() {}
  },
}));
vi.mock("@/lib/content-preview/PreviewRuntimeCatalogSession", () => ({
  PreviewRuntimeCatalogSession: class {
    replace = vi.fn();
    dispose = vi.fn();
    getPoseClip() {
      return {};
    }
    getReactionClip() {
      return {};
    }
  },
}));
vi.mock("@/lib/avatar/poses/animaPoseClip", () => ({
  getAnimaPoseClipTimelineDuration: () => 0.1,
}));
vi.mock("@/lib/content-preview/playback", () => ({
  playContentPreviewMotion: mock.play,
  boundedContentPreviewFrameDelta: (delta: number) => Math.min(delta, 0.05),
}));
vi.mock("@/lib/content-preview/effects", () => ({
  ContentPreviewApplySoundPlayer: class {
    stop = mock.stopAudio;
    play = vi.fn();
  },
  createContentPreviewClipEventBridge: () => ({ reset: mock.resetBridge }),
  attachContentPreviewClipEventBridge: () => mock.detach,
}));

function avatar() {
  return {
    isReady: true,
    resetAnimations: vi.fn(),
    clearDebugReactionClip: vi.fn(),
    setAutomaticAnimationPlaybackEnabled: vi.fn(),
    update: vi.fn(),
    isMotionActive: vi.fn(() => false),
    isClipActive: vi.fn(() => false),
    stopClip: vi.fn(),
  } as unknown as Avatar;
}
const preview = {
  item: { name: "Wave" },
  files: [],
} as unknown as PyTypedContentPreview;
beforeEach(() => {
  mock.prepare.mockReset();
  mock.play.mockReset();
  mock.play.mockResolvedValue(true);
});

describe("creator-owned preview lifecycle", () => {
  it("does not autoplay on binding; explicit playback is once-only, muted and bounded", async () => {
    const status = vi.fn();
    const finished = vi.fn();
    const bytes = { files: new Map(), dispose: vi.fn() };
    mock.prepare.mockResolvedValue(bytes);
    const session = new CreateAnimaPreviewSession(status, vi.fn(), finished);
    const model = avatar();
    const detach = session.bind(model);
    expect(mock.play).not.toHaveBeenCalled();
    expect(session.muted).toBe(true);
    await session.play(async () => preview);
    expect(mock.play).toHaveBeenCalledWith(
      expect.objectContaining({ loop: false, avatar: model }),
    );
    session.tick(100);
    session.tick(100);
    expect(finished).toHaveBeenCalledTimes(1);
    expect(bytes.dispose).toHaveBeenCalledTimes(1);
    expect(status).toHaveBeenLastCalledWith("stopped");
    expect(model.setAutomaticAnimationPlaybackEnabled).toHaveBeenLastCalledWith(
      false,
    );
    detach();
    expect(session.avatar).toBeNull();
    session.dispose();
  });
  it("keeps playing past the timeline until the Avatar settles", async () => {
    const finished = vi.fn();
    mock.prepare.mockResolvedValue({ files: new Map(), dispose: vi.fn() });
    const session = new CreateAnimaPreviewSession(vi.fn(), vi.fn(), finished);
    const model = avatar();
    session.bind(model);
    await session.play(async () => preview);
    // The 0.1 s timeline has ended; the fade-out and effects still play.
    vi.mocked(model.isMotionActive).mockReturnValue(true);
    for (let frame = 0; frame < 10; frame++) session.tick(0.05);
    expect(finished).not.toHaveBeenCalled();
    expect(model.update).toHaveBeenCalledTimes(10);
    vi.mocked(model.isMotionActive).mockReturnValue(false);
    session.tick(0.05);
    expect(finished).toHaveBeenCalledTimes(1);

    // A motion that never settles still stops after the settle limit.
    await session.play(async () => preview);
    vi.mocked(model.isMotionActive).mockReturnValue(true);
    const frames = Math.ceil((0.1 + PREVIEW_SETTLE_LIMIT_SEC) / 0.05) + 1;
    for (let frame = 0; frame < frames; frame++) session.tick(0.05);
    expect(finished).toHaveBeenCalledTimes(2);
    session.dispose();
  });

  it("aborts in-flight preparation and ignores a late source after Stop", async () => {
    const status = vi.fn();
    const session = new CreateAnimaPreviewSession(status, vi.fn(), vi.fn());
    session.bind(avatar());
    let resolve!: (value: PyTypedContentPreview) => void;
    let signal!: AbortSignal;
    const pending = session.play((nextSignal) => {
      signal = nextSignal;
      return new Promise((done) => {
        resolve = done;
      });
    });
    session.stop();
    expect(signal.aborted).toBe(true);
    resolve(preview);
    await pending;
    expect(mock.prepare).not.toHaveBeenCalled();
    expect(mock.play).not.toHaveBeenCalled();
    session.dispose();
  });
  it("disposes late prepared bytes on replacement instead of mounting them", async () => {
    let finish!: (value: unknown) => void;
    mock.prepare.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const session = new CreateAnimaPreviewSession(vi.fn(), vi.fn(), vi.fn());
    const detach = session.bind(avatar());
    const pending = session.play(async () => preview);
    await vi.waitFor(() => expect(mock.prepare).toHaveBeenCalled());
    detach();
    const bytes = { files: new Map(), dispose: vi.fn() };
    finish(bytes);
    await pending;
    expect(bytes.dispose).toHaveBeenCalledTimes(1);
    expect(mock.play).not.toHaveBeenCalled();
    expect(mock.stopAudio).toHaveBeenCalled();
    expect(mock.resetBridge).toHaveBeenCalled();
    session.dispose();
  });
  it("reports dependency failure and resets all channels", async () => {
    mock.prepare.mockRejectedValue(new Error("Missing dependency"));
    const status = vi.fn();
    const session = new CreateAnimaPreviewSession(status, vi.fn(), vi.fn());
    session.bind(avatar());
    await session.play(async () => preview);
    expect(status).toHaveBeenLastCalledWith("error", "Missing dependency");
    expect(mock.play).not.toHaveBeenCalled();
    session.dispose();
  });
});
