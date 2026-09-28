import { expect, it } from "vitest";
import {
  CREATION_STEPS,
  buildAnimaSpec,
  creationRoots,
  draftIssues,
} from "./createAnimaDraft";
import { readyDraft, ref } from "./createAnimaTestFixtures";

it("places Voice before Identity and includes both provider choices in creation", () => {
  expect(CREATION_STEPS).toEqual([
    "Avatar",
    "Voice",
    "Identity",
    "Actions",
    "Review",
  ]);
  const draft = {
    ...readyDraft(),
    voice: {
      provider: "pocket_tts" as const,
      pocket: { type: "preset" as const, voice_id: "eve" },
      elevenlabs_voice_id: "retained-id",
    },
  };
  expect(buildAnimaSpec(draft).voice).toEqual(draft.voice);
});

it("pins a shared clone as a creation source even while ElevenLabs is selected", () => {
  const source = ref("clone-narrator");
  const draft = {
    ...readyDraft(),
    voice: {
      provider: "elevenlabs" as const,
      pocket: { type: "clone" as const, source },
      elevenlabs_voice_id: "retained-id",
    },
  };
  expect(creationRoots(draft)).toContainEqual({
    kind: "voice",
    source,
    path: "/voice/pocket/source",
  });
});

it("requires an ElevenLabs ID before leaving Voice without blocking PocketTTS", () => {
  const draft = {
    ...readyDraft(),
    voice: {
      provider: "elevenlabs" as const,
      pocket: { type: "preset" as const, voice_id: "eve" },
      elevenlabs_voice_id: null,
    },
  };
  expect(
    draftIssues(draft, 1).some((issue) => issue.path.startsWith("/voice")),
  ).toBe(true);
  expect(
    draftIssues(
      { ...draft, voice: { ...draft.voice, provider: "pocket_tts" } },
      1,
    ),
  ).toEqual([]);
});
