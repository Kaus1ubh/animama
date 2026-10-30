import { expect, it } from "vitest";
import {
  CREATION_STEPS,
  buildAnimaSpec,
  creationRoots,
  draftIssues,
} from "./createAnimaDraft";
import { readyDraft, ref } from "./createAnimaTestFixtures";
import type { PyAnimaSettings } from "@/lib/content/catalogTypes";
import { reusableElevenLabsVoices } from "./CreateAnimaVoiceStep";

it("places Voice before Identity and includes both provider choices in creation", () => {
  expect(CREATION_STEPS).toEqual([
    "avatar",
    "voice",
    "identity",
    "actions",
    "review",
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

it("offers each saved ElevenLabs voice once, with the Animas using it", () => {
  const anima = (displayName: string, voiceId?: string) => ({
    animaId: displayName.toLowerCase(),
    displayName,
    settings: {
      anima_id: displayName.toLowerCase(),
      preferences: voiceId
        ? { speech: { elevenlabs: { primary_voice: { voice_id: voiceId } } } }
        : {},
    } as PyAnimaSettings,
  });
  expect(
    reusableElevenLabsVoices([
      anima("Annie", "voice-a"),
      anima("Bea"),
      anima("Andrew", "voice-b"),
      anima("Cora", "voice-a"),
    ]),
  ).toEqual([
    { voiceId: "voice-a", names: ["Annie", "Cora"] },
    { voiceId: "voice-b", names: ["Andrew"] },
  ]);
});
