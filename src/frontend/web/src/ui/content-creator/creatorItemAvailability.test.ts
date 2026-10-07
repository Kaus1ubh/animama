import { describe, expect, it } from "vitest";

import { creatorItemUnavailableMessage } from "./creatorItemAvailability";

const ready = { state: "ready", origin: "owned", editable: true } as const;

describe("creator item availability", () => {
  it("never blocks a new document", () => {
    expect(
      creatorItemUnavailableMessage({
        itemId: undefined,
        label: "Avatar Effect",
        item: undefined,
        readFailed: true,
        loadError: "ignored",
      }),
    ).toBeNull();
  });

  it("reports a failed read with no cached item, such as a 404", () => {
    expect(
      creatorItemUnavailableMessage({
        itemId: "missing",
        label: "Scene Effect",
        item: undefined,
        readFailed: true,
      }),
    ).toMatch(/Scene Effect could not be found/);
  });

  it("keeps an open document when a background refetch fails", () => {
    expect(
      creatorItemUnavailableMessage({
        itemId: "item",
        label: "Particle Effect",
        item: ready,
        readFailed: true,
      }),
    ).toBeNull();
  });

  it("waits while the item is still being read", () => {
    expect(
      creatorItemUnavailableMessage({
        itemId: "item",
        label: "Particle Effect",
        item: undefined,
        readFailed: false,
      }),
    ).toBeNull();
  });

  it.each([
    { ...ready, state: "invalid" as const },
    { ...ready, state: "missing" as const },
    { ...ready, editable: false },
  ])("reports an unreadable or locked item %#", (item) => {
    expect(
      creatorItemUnavailableMessage({
        itemId: "item",
        label: "Avatar Effect",
        item,
        readFailed: false,
      }),
    ).toMatch(/Avatar Effect is unavailable/);
  });

  it("allows an Included item to open as a Local copy", () => {
    expect(
      creatorItemUnavailableMessage({
        itemId: "item",
        label: "Avatar Effect",
        item: { state: "ready", origin: "builtin", editable: false },
        readFailed: false,
      }),
    ).toBeNull();
  });

  it("surfaces a content download failure", () => {
    expect(
      creatorItemUnavailableMessage({
        itemId: "item",
        label: "Avatar Effect",
        item: ready,
        readFailed: false,
        loadError: "The content image could not be downloaded.",
      }),
    ).toBe("The content image could not be downloaded.");
  });
});
