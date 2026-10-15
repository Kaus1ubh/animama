import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { PyGesture } from "@animama/runtime-contracts/sdk";
import type { AnimaCreationSources } from "@/query/hooks/useAnimaCreation";
import { CreateAnimaActionsStep } from "./CreateAnimaActionsStep";
import {
  creationIssueTarget,
  selectCreationGesture,
} from "./createAnimaActions";
import { creationOptions, readyDraft, ref } from "./createAnimaTestFixtures";

const gesture = (itemId: string, semanticKey: string): PyGesture => ({
  item_id: itemId,
  source: "included",
  name: semanticKey,
  revision_sha256: "a".repeat(64),
  editable: false,
  semantic_key: semanticKey,
  implementation: { kind: "vrma" },
});

describe("exact Action selections", () => {
  it("replaces one semantic key without duplicating it and supports None", () => {
    const initial = [
      { semantic_key: "greeting", source: ref("wave") },
      { semantic_key: "nod", source: ref("nod") },
    ];
    const replacement = {
      ...ref("my-wave"),
      semantic_key: "greeting",
    } as PyGesture;
    const changed = selectCreationGesture(initial, replacement, "greeting");
    expect(changed).toEqual([
      { semantic_key: "greeting", source: ref("my-wave") },
      initial[1],
    ]);
    expect(selectCreationGesture(changed, null, "greeting")).toEqual([
      initial[1],
    ]);
    expect(initial[0]!.source.item_id).toBe("wave");
  });
  it("links hidden errors to the canonical Gesture key or exact Reaction cell", () => {
    const gestures = [
      { semantic_key: "z", source: ref("z") },
      { semantic_key: "a", source: ref("a") },
    ];
    expect(creationIssueTarget("/gestures/0/source", gestures)).toBe(
      "creation-gesture-a",
    );
    expect(creationIssueTarget("/reactions/anger/3", gestures)).toBe(
      "creation-reaction-anger-3",
    );
    // A pool member's path names its cell, at any of the four intensities.
    expect(creationIssueTarget("/reactions/joy/4/1", gestures)).toBe(
      "creation-reaction-joy-4",
    );
    expect(creationIssueTarget("/display_name", gestures)).toBe(
      "creation-display-name",
    );
  });
  it("shows server-derived recommendations and permits empty equipment without previewing automatically", () => {
    const options = creationOptions();
    options.counts.recommended_gestures = 37;
    const sources = {
      options: { data: options },
      gestures: { data: [], isError: false },
      reactions: { data: [], isError: false },
    } as unknown as AnimaCreationSources;
    const preview = vi.fn();
    const html = renderToStaticMarkup(
      <CreateAnimaActionsStep
        draft={readyDraft()}
        sources={sources}
        onEdit={vi.fn()}
        onReset={vi.fn()}
        onPreview={preview}
      />,
    );
    expect(html).toContain("37");
    expect(html).toContain(
      "No Gestures selected. Your Anima can still be created.",
    );
    expect(html).toContain("Reset to recommended");
    expect(html).toContain("/96");
    expect(html).not.toContain("One Gesture per semantic key");
    expect(html).not.toContain("Every emotion has three intensity cells");
    expect(preview).not.toHaveBeenCalled();
  });
  it("omits Gesture summary rows for empty and selected keys", () => {
    const item = gesture("acknowledging", "acknowledging");
    const sources = {
      options: { data: creationOptions() },
      gestures: { data: [item], isLoading: false, isError: false },
      reactions: { data: [], isError: false },
    } as unknown as AnimaCreationSources;
    const emptyDraft = readyDraft();
    const emptyHtml = renderToStaticMarkup(
      <CreateAnimaActionsStep
        draft={emptyDraft}
        sources={sources}
        onEdit={vi.fn()}
        onReset={vi.fn()}
        onPreview={vi.fn()}
      />,
    );
    expect(emptyHtml).not.toContain("Selected: None");
    expect(emptyHtml).not.toContain("Select None");

    const selectedDraft = readyDraft();
    selectedDraft.gestures = [
      { semantic_key: "acknowledging", source: ref("acknowledging") },
    ];
    const selectedHtml = renderToStaticMarkup(
      <CreateAnimaActionsStep
        draft={selectedDraft}
        sources={sources}
        onEdit={vi.fn()}
        onReset={vi.fn()}
        onPreview={vi.fn()}
      />,
    );
    expect(selectedHtml).not.toContain("Select None");
    expect(selectedHtml).not.toContain("Selected: None");
    expect(selectedHtml).toContain("Selected");
  });
  it("shows every matching Gesture key without progressive disclosure", () => {
    const gestures = Array.from({ length: 14 }, (_, index) =>
      gesture(`gesture-${index}`, `key-${String(index).padStart(2, "0")}`),
    );
    const sources = {
      options: { data: creationOptions() },
      gestures: { data: gestures, isLoading: false, isError: false },
      reactions: { data: [], isError: false },
    } as unknown as AnimaCreationSources;
    const html = renderToStaticMarkup(
      <CreateAnimaActionsStep
        draft={readyDraft()}
        sources={sources}
        onEdit={vi.fn()}
        onReset={vi.fn()}
        onPreview={vi.fn()}
      />,
    );
    expect(html).toContain('aria-label="Gesture key-13"');
    expect(html).not.toContain("Show more Gesture keys");
  });
  it("joins every Reaction emotion and initially expands Admiration only", () => {
    const sources = {
      options: { data: creationOptions() },
      gestures: { data: [], isLoading: false, isError: false },
      reactions: { data: [], isError: false },
    } as unknown as AnimaCreationSources;
    const html = renderToStaticMarkup(
      <CreateAnimaActionsStep
        draft={readyDraft()}
        sources={sources}
        onEdit={vi.fn()}
        onReset={vi.fn()}
        onPreview={vi.fn()}
        focusTarget="creation-reaction-admiration-1"
      />,
    );
    expect(html).toContain('data-testid="creation-reaction-matrix"');
    expect(html.match(/data-reaction-emotion=/g)).toHaveLength(24);
    expect(html.match(/aria-expanded="true"/g)).toHaveLength(1);
    expect(html.match(/aria-expanded="false"/g)).toHaveLength(23);
    expect(html).toContain('id="creation-reaction-admiration-1"');
    expect(html).not.toContain('id="creation-reaction-caring-1"');
    expect(html.match(/border-l-2/g)).toHaveLength(24);
    expect(html.match(/border-l-primary/g)).toHaveLength(1);
  });
});
