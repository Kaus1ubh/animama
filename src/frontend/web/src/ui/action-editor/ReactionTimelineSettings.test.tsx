import { renderToString } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { createActionDocument } from "./actionDocument";
import {
  ReactionEmotionSettings,
  ReactionTimelineSettings,
} from "./ReactionTimelineSettings";

const state = vi.hoisted(() => ({
  document: {} as ReturnType<typeof createActionDocument>,
}));
vi.mock("./ActionEditorWorkspaceContext", () => ({
  useActionEditorWorkspace: () => ({
    document: state.document,
    setDocument: vi.fn(),
  }),
}));
afterEach(() => vi.clearAllMocks());
it("shows optional placement in compact settings with intensity disabled until an emotion is chosen", () => {
  state.document = createActionDocument("reaction");
  const html = renderToString(<ReactionTimelineSettings />);
  expect(html).toContain("Emotion suggestion");
  expect(html).toContain('aria-label="Suggested emotion"');
  expect(html).toMatch(/disabled=""[^>]*aria-label="Suggested intensity"/);
  expect(html).not.toContain("Inspector");
  expect(html).not.toContain("shadow-lg");
});
it("allows intensity changes for existing placement suggestions", () => {
  state.document = {
    ...createActionDocument("reaction"),
    suggestedEmotion: "joy",
    suggestedIntensity: 2,
  };
  const html = renderToString(<ReactionTimelineSettings />);
  expect(html).not.toMatch(/disabled=""[^>]*aria-label="Suggested intensity"/);
});

it("keeps optional placement controls available independently of a timeline for VRMA reactions", () => {
  state.document = {
    ...createActionDocument("reaction"),
    implementation: "vrma",
    suggestedEmotion: "joy",
    suggestedIntensity: 2,
  };
  const html = renderToString(<ReactionEmotionSettings />);
  expect(html).toContain('aria-label="Suggested emotion"');
  expect(html).toContain('aria-label="Suggested intensity"');
  expect(html).not.toContain("Expression keyframe");
  expect(html).not.toContain("Inspector");
});
