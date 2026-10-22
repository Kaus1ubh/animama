import { describe, expect, it, vi } from "vitest";

import type { PyAvatarContent } from "@animama/runtime-contracts/api-types";

/** A capture that only ends when its signal aborts, like a stalled GPU read. */
function stalledCapture(signal: AbortSignal): Promise<Blob> {
  return new Promise((_resolve, reject) => {
    if (signal.aborted) reject(signal.reason);
    signal.addEventListener("abort", () => reject(signal.reason));
  });
}

import {
  CreationPortraits,
  CREATION_PORTRAIT_TIMEOUT_MS,
  creationPortraitTarget,
} from "./createAnimaPortrait";

const REVISION = "a".repeat(64);

function avatar(overrides: Partial<PyAvatarContent> = {}): PyAvatarContent {
  return {
    item_id: "avatar-1",
    revision_sha256: REVISION,
    source: "local",
    portrait: null,
    ...overrides,
  } as PyAvatarContent;
}

describe("creationPortraitTarget", () => {
  const selected = { item_id: "avatar-1", revision_sha256: REVISION };

  it("targets a selected Local Avatar without a portrait", () => {
    expect(
      creationPortraitTarget({ selected, file: null, avatars: [avatar()] }),
    ).toEqual(selected);
  });

  it("targets a Local portrait captured from another revision", () => {
    const stale = avatar({
      portrait: {
        url: "/v1/content/files/old",
        avatar_revision_sha256: "b".repeat(64),
      },
    });
    expect(
      creationPortraitTarget({ selected, file: null, avatars: [stale] }),
    ).toEqual(selected);
  });

  it.each([
    ["an Included Avatar", { avatars: [avatar({ source: "included" })] }],
    [
      "a current portrait",
      {
        avatars: [
          avatar({
            portrait: { url: "/p", avatar_revision_sha256: REVISION },
          }),
        ],
      },
    ],
    [
      "an imported portrait without a capture revision",
      {
        avatars: [
          avatar({ portrait: { url: "/p", avatar_revision_sha256: null } }),
        ],
      },
    ],
    ["an unsaved file preview", { file: new File([], "a.vrm") }],
    ["an Avatar not yet listed", { avatars: [] }],
    [
      "another revision of the Avatar",
      { avatars: [avatar({ revision_sha256: "c".repeat(64) })] },
    ],
  ])("does not target %s", (_name, overrides) => {
    expect(
      creationPortraitTarget({
        selected,
        file: null,
        avatars: [avatar()],
        ...overrides,
      }),
    ).toBeNull();
  });

  it("does not target when no Avatar is selected", () => {
    expect(
      creationPortraitTarget({
        selected: null,
        file: null,
        avatars: [avatar()],
      }),
    ).toBeNull();
  });
});

describe("CreationPortraits", () => {
  const target = { item_id: "avatar-1", revision_sha256: REVISION };
  const blob = new Blob(["portrait"], { type: "image/webp" });

  it("captures and saves once per Avatar revision", async () => {
    const portraits = new CreationPortraits();
    const capture = vi.fn(async () => blob);
    const save = vi.fn(async () => undefined);

    await portraits.generate({
      target,
      capture,
      save,
      signal: new AbortController().signal,
    });
    await portraits.generate({
      target,
      capture,
      save,
      signal: new AbortController().signal,
    });

    expect(capture).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledWith(target, blob, expect.any(AbortSignal));
  });

  it("does not retry a failed revision during the session", async () => {
    const portraits = new CreationPortraits();
    const capture = vi.fn(async () => {
      throw new Error("no GPU");
    });
    const save = vi.fn();

    await expect(
      portraits.generate({
        target,
        capture,
        save,
        signal: new AbortController().signal,
      }),
    ).resolves.toBe("failed");
    await expect(
      portraits.generate({
        target,
        capture,
        save,
        signal: new AbortController().signal,
      }),
    ).resolves.toBe("skipped");

    expect(capture).toHaveBeenCalledOnce();
    expect(save).not.toHaveBeenCalled();
  });

  it("lets a later visit retry after the stage abandoned the attempt", async () => {
    const portraits = new CreationPortraits();
    const controller = new AbortController();
    const save = vi.fn(async () => undefined);
    const pending = portraits.generate({
      target,
      capture: stalledCapture,
      save,
      signal: controller.signal,
    });
    controller.abort();

    await expect(pending).resolves.toBe("aborted");
    await expect(
      portraits.generate({
        target,
        capture: async () => blob,
        save,
        signal: new AbortController().signal,
      }),
    ).resolves.toBe("saved");
    expect(save).toHaveBeenCalledOnce();
  });

  it("gives up after the timeout and counts it as a failure", async () => {
    vi.useFakeTimers();
    try {
      const portraits = new CreationPortraits();
      const save = vi.fn();
      const pending = portraits.generate({
        target,
        capture: stalledCapture,
        save,
        signal: new AbortController().signal,
      });
      await vi.advanceTimersByTimeAsync(CREATION_PORTRAIT_TIMEOUT_MS);

      await expect(pending).resolves.toBe("failed");
      expect(save).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
