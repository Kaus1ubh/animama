import { describe, expect, it, vi } from "vitest";
import type { PyContentItem } from "@/lib/content/catalogTypes";
import { SoundUploadQueue } from "./soundUploadQueue";

const item = { item_id: "saved-sound" } as PyContentItem;
const file = (name: string) => new File(["audio"], name, { type: "audio/wav" });

describe("sound upload queue", () => {
  it("keeps successes and retries only the failed file with its original operation", async () => {
    const save = vi
      .fn()
      .mockResolvedValueOnce(item)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(item);
    const onSaved = vi.fn();
    const queue = new SoundUploadQueue(
      { listNames: async () => [], save, onSaved },
      vi.fn(),
    );
    await queue.add([file("First.wav"), file("Second.wav")]);
    expect(queue.entries.map((entry) => entry.status)).toEqual([
      "saved",
      "error",
    ]);
    const failedOperation = save.mock.calls[1][0].operationId;
    await queue.retry(queue.entries[1].id);
    expect(queue.entries.map((entry) => entry.status)).toEqual([
      "saved",
      "saved",
    ]);
    expect(save).toHaveBeenCalledTimes(3);
    expect(save.mock.calls[2][0].operationId).toBe(failedOperation);
    expect(onSaved).toHaveBeenCalledTimes(2);
    await queue.retry(queue.entries[0].id);
    expect(save).toHaveBeenCalledTimes(3);
  });

  it("allocates filename names against the entire catalog and the same batch", async () => {
    const save = vi.fn().mockResolvedValue(item);
    const queue = new SoundUploadQueue(
      { listNames: async () => ["pop", "Pop 1"], save, onSaved: vi.fn() },
      vi.fn(),
    );
    await queue.add([file("Pop.wav"), file("Pop.mp3"), file("ドン!.ogg")]);
    expect(queue.entries.map((entry) => entry.name)).toEqual([
      "Pop 2",
      "Pop 3",
      "ドン!",
    ]);
    expect(save.mock.calls.map(([input]) => input.metadata.name)).toEqual([
      "Pop 2",
      "Pop 3",
      "ドン!",
    ]);
    expect(
      new Set(save.mock.calls.map(([input]) => input.metadata.id)).size,
    ).toBe(3);
    for (const [input] of save.mock.calls)
      expect(input.entryName).toMatch(/^[A-Za-z0-9][A-Za-z0-9._ -]{0,119}$/);
  });

  it("reports unsupported files separately while continuing supported uploads", async () => {
    const save = vi.fn().mockResolvedValue(item);
    const queue = new SoundUploadQueue(
      { listNames: async () => [], save, onSaved: vi.fn() },
      vi.fn(),
    );
    await queue.add([file("Bad.m4a"), file("Good.WAV")]);
    expect(queue.entries.map((entry) => entry.status)).toEqual([
      "error",
      "saved",
    ]);
    expect(queue.entries[0].error).toContain("WAV, MP3, or Ogg");
    expect(save).toHaveBeenCalledTimes(1);
  });
  it("retains queued files after catalog failure and prevents concurrent duplicate retries", async () => {
    const listNames = vi
      .fn()
      .mockRejectedValueOnce(new Error("Catalog unavailable"))
      .mockResolvedValue([]);
    let complete: (value: PyContentItem) => void = () => undefined;
    const save = vi.fn(
      () =>
        new Promise<PyContentItem>((resolve) => {
          complete = resolve;
        }),
    );
    const states: string[] = [];
    const queue = new SoundUploadQueue(
      { listNames, save, onSaved: vi.fn() },
      () => {
        states.push(queue.entries.map((entry) => entry.status).join(","));
      },
    );
    await queue.add([file("Pop.wav")]);
    expect(queue.entries[0].status).toBe("error");
    expect(save).not.toHaveBeenCalled();
    const retry = queue.retry(queue.entries[0].id);
    await queue.retry(queue.entries[0].id);
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    complete(item);
    await retry;
    expect(queue.entries[0].status).toBe("saved");
    expect(states).toContain("queued");
    expect(states).toContain("uploading");
    expect(states).toContain("saved");
  });
  it.each(["sync", "async"])(
    "continues after a %s refresh failure and refreshes without uploading again",
    async (mode) => {
      const save = vi.fn().mockResolvedValue(item);
      const onSaved = vi
        .fn()
        .mockImplementationOnce(() => {
          if (mode === "sync") throw new Error("Refresh failed");
          return Promise.reject(new Error("Refresh failed"));
        })
        .mockResolvedValue(undefined);
      const queue = new SoundUploadQueue(
        { listNames: async () => [], save, onSaved },
        vi.fn(),
      );
      await queue.add([file("First.wav"), file("Second.wav")]);
      expect(queue.entries.map((entry) => entry.status)).toEqual([
        "saved",
        "saved",
      ]);
      expect(queue.entries[0].notificationError).toContain("Refresh failed");
      await queue.refresh(queue.entries[0].id);
      expect(queue.entries[0].notificationError).toBeUndefined();
      await queue.add([file("Third.wav")]);
      expect(save).toHaveBeenCalledTimes(3);
      expect(onSaved).toHaveBeenCalledTimes(4);
    },
  );

  it("bounds long filename names while retaining unique suffixes", async () => {
    const save = vi.fn().mockResolvedValue(item);
    const queue = new SoundUploadQueue(
      { listNames: async () => ["a".repeat(120)], save, onSaved: vi.fn() },
      vi.fn(),
    );
    await queue.add([
      file(`${"a".repeat(140)}.wav`),
      file(`${"a".repeat(140)}.mp3`),
    ]);
    expect(queue.entries.map((entry) => entry.name)).toEqual([
      `${"a".repeat(118)} 1`,
      `${"a".repeat(118)} 2`,
    ]);
    for (const entry of queue.entries)
      expect(entry.name.length).toBeLessThanOrEqual(120);
  });
});
