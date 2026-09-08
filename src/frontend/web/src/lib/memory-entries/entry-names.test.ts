import { describe, expect, it } from "vitest";

import {
  memoryFileStemFromPath,
  memoryEntryNameSelectionEnd,
  normalizeMemoryEntryName,
} from "./entry-names";

describe("memory entry names", () => {
  it("trims names and adds the required Markdown extension to files", () => {
    expect(normalizeMemoryEntryName(" notes ", "file")).toBe("notes.md");
    expect(normalizeMemoryEntryName(" notes.md ", "file")).toBe("notes.md");
    expect(normalizeMemoryEntryName(" projects/notes ", "file")).toBe(
      "projects/notes.md",
    );
    expect(normalizeMemoryEntryName(" projects ", "directory")).toBe(
      "projects",
    );
    expect(normalizeMemoryEntryName("   ", "file")).toBe("");
  });

  it("uses the leaf file name for generated Markdown titles", () => {
    expect(memoryFileStemFromPath("projects/launch.md")).toBe("launch");
    expect(memoryFileStemFromPath("profile.md")).toBe("profile");
  });

  it("selects only a Markdown file stem when rename opens", () => {
    expect(memoryEntryNameSelectionEnd("notes.md", "file")).toBe(5);
    expect(memoryEntryNameSelectionEnd("notes", "file")).toBe(5);
    expect(memoryEntryNameSelectionEnd("notes", "directory")).toBe(5);
  });
});
