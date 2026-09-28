import { z } from "zod";
import { POCKET_VOICES } from "@/lib/speech/pocket/voice-catalog";

import type {
  AnimaCreationDiagnostic,
  AnimaCreationOptions,
  ItemRevisionRef,
  SourceRevision,
} from "@animama/runtime-contracts/sdk";
import { TRACKED_EMOTIONS, type TrackedEmotion } from "@/lib/emotion";
import {
  defaultAnimaIdentityMarkdown,
  DEFAULT_ANIMA_IDENTITY_MARKDOWN,
  synchronizeDefaultAnimaIdentityName,
  upgradeDefaultAnimaIdentityMarkdown,
} from "./createAnimaIdentity";

export const CREATION_STEPS = [
  "Avatar",
  "Voice",
  "Identity",
  "Actions",
  "Review",
] as const;
export type CreationStep = 0 | 1 | 2 | 3 | 4;
export const INTENSITIES = ["1", "2", "3"] as const;
export type Intensity = (typeof INTENSITIES)[number];
export const itemIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/)
  .refine(
    (value) => !/^(?:blob|data|file|https?|javascript):/i.test(value),
    "Use a logical content ID, not a delivery URL.",
  );
const revisionSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const itemRefSchema = z.strictObject({
  item_id: itemIdSchema,
  revision_sha256: revisionSchema,
});
const sourceRevisionSchema = z.strictObject({
  kind: z.enum([
    "voice",
    "avatar",
    "appearance",
    "gesture",
    "reaction",
    "idle_style",
    "pose",
    "pose_clip",
    "particle_effect",
    "avatar_effect",
    "scene_effect",
    "sound_effect",
  ]),
  revision_sha256: revisionSchema,
});
export const sourceMapSchema = z.record(itemIdSchema, sourceRevisionSchema);
export type SourceMap = Record<string, SourceRevision>;
const presentationSchema = z.strictObject({
  fit: z.enum(["cover", "contain"]),
  focal_x: z.number().min(0).max(1),
  focal_y: z.number().min(0).max(1),
  zoom: z.number().min(1).max(4),
});
const appearanceSchema = z.strictObject({
  source: itemRefSchema,
  presentation: presentationSchema,
});
const gestureSchema = z.strictObject({
  semantic_key: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,127}$/),
  source: itemRefSchema,
});
const reactionCellsSchema = z.strictObject({
  "1": itemRefSchema.nullable(),
  "2": itemRefSchema.nullable(),
  "3": itemRefSchema.nullable(),
});
const reactionsSchema = z.record(z.enum(TRACKED_EMOTIONS), reactionCellsSchema);
const starterPackSchema = z.strictObject({
  id: z.literal("builtin:starter-loadout"),
  version: z.literal(1),
  revision_sha256: revisionSchema,
});
const evidenceSchema = z.strictObject({
  source: itemRefSchema,
  revisions: sourceMapSchema,
});
export type CreationEvidence = z.infer<typeof evidenceSchema>;

/** Editable provider fields survive switching and may be temporarily incomplete. */
export const creationVoiceDraftSchema = z.strictObject({
  provider: z.enum(["pocket_tts", "elevenlabs"]),
  pocket: z.discriminatedUnion("type", [
    z.strictObject({
      type: z.literal("preset"),
      voice_id: z.string().max(128),
    }),
    z.strictObject({ type: z.literal("clone"), source: itemRefSchema }),
  ]),
  elevenlabs_voice_id: z.string().max(100000).nullable(),
});
export type CreationVoiceDraft = z.infer<typeof creationVoiceDraftSchema>;
export const creationVoiceSchema = creationVoiceDraftSchema.superRefine(
  (voice, context) => {
    const pocket = voice.pocket;
    if (
      pocket.type === "preset" &&
      !POCKET_VOICES.some((preset) => preset.id === pocket.voice_id)
    )
      context.addIssue({
        code: "custom",
        path: ["pocket"],
        message: "Choose an available PocketTTS voice.",
      });
    if (
      (voice.provider === "elevenlabs" || voice.elevenlabs_voice_id !== null) &&
      !/^[A-Za-z0-9_-]{1,128}$/.test(voice.elevenlabs_voice_id ?? "")
    )
      context.addIssue({
        code: "custom",
        path: ["elevenlabs_voice_id"],
        message:
          "Enter an ElevenLabs voice ID using letters, numbers, underscores or hyphens.",
      });
  },
);

const animaSpecFields = {
  schema_version: z.literal(1),
  identity_markdown: z.string().max(65536),
  avatar: itemRefSchema,
  appearance: z.strictObject({
    profile: appearanceSchema.nullable(),
    background: appearanceSchema.nullable(),
  }),
  gestures: z.array(gestureSchema).max(500),
  reactions: reactionsSchema,
  starter_pack: starterPackSchema,
  expected_source_revisions: sourceMapSchema,
};

/** Validate new commands without consulting mutable sources. */
export const animaSpecSchema = z.strictObject({
  ...animaSpecFields,
  voice: creationVoiceSchema,
  display_name: z.string().min(1).max(40),
});
export const creationRequestSchema = animaSpecSchema.extend({
  idempotency_key: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/),
});

/** Frozen saved requests accept up to 120 characters for exact retry; new commands cap names at 40. */
const frozenCreationRequestSchema = z.strictObject({
  ...animaSpecFields,
  voice: creationVoiceDraftSchema.nullable().optional(),
  display_name: z.string().min(1).max(120),
  idempotency_key: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/),
});
export type FrozenCreationRequest = z.infer<typeof frozenCreationRequestSchema>;

export const previousCreateAnimaDraftSchema = z.strictObject({
  schema_version: z.literal(2),
  draft_id: z.string().uuid(),
  step: z.number().int().min(0).max(3),
  furthest_step: z.number().int().min(0).max(3),
  meaningful: z.boolean(),
  display_name: z.string().max(100000),
  identity_markdown: z.string().max(1000000),
  avatar: itemRefSchema.nullable(),
  appearance_migration: z.enum(["none", "confirmation_required"]),
  needs_file_reselection: z.boolean(),
  gestures: z.array(gestureSchema).max(500),
  reactions: reactionsSchema,
  starter_pack: starterPackSchema.nullable(),
  default_idle: itemRefSchema.nullable(),
  idle_revisions: sourceMapSchema,
  seed_revisions: sourceMapSchema,
  evidence: z.record(itemIdSchema, evidenceSchema),
  submission: z
    .strictObject({
      request: frozenCreationRequestSchema,
      state: z.enum(["pending", "unknown", "rejected", "conflict", "deleted"]),
    })
    .nullable(),
});
export const createAnimaDraftSchema = previousCreateAnimaDraftSchema.extend({
  schema_version: z.literal(3),
  step: z.number().int().min(0).max(4),
  furthest_step: z.number().int().min(0).max(4),
  voice: creationVoiceDraftSchema.nullable(),
});
export type CreateAnimaDraft = z.infer<typeof createAnimaDraftSchema>;

/** The inserted Voice step shifts old navigation without touching frozen requests. */
export function migratePreviousCreateAnimaDraft(
  previous: z.infer<typeof previousCreateAnimaDraftSchema>,
): CreateAnimaDraft {
  return {
    ...previous,
    identity_markdown: previous.submission
      ? previous.identity_markdown
      : upgradeDefaultAnimaIdentityMarkdown(
          previous.identity_markdown,
          previous.display_name,
        ),
    schema_version: 3,
    voice: null,
    step: previous.step === 0 ? 0 : previous.step + 1,
    furthest_step:
      previous.furthest_step === 0 ? 0 : previous.furthest_step + 1,
  };
}

/** Exact schema-v1 draft shape, read only by the explicit storage migrator. */
export const legacyCreateAnimaDraftSchema = z.strictObject({
  schema_version: z.literal(1),
  draft_id: z.string().uuid(),
  step: z.number().int().min(0).max(3),
  furthest_step: z.number().int().min(0).max(3),
  meaningful: z.boolean(),
  display_name: z.string().max(100000),
  identity_markdown: z.string().max(1000000),
  avatar: itemRefSchema.nullable(),
  appearance: z.strictObject({
    profile: appearanceSchema.nullable(),
    background: appearanceSchema.nullable(),
  }),
  profile_mode: z.enum(["auto", "custom", "none"]),
  portrait_avatar: itemRefSchema.nullable(),
  portrait_pending: z.boolean(),
  needs_file_reselection: z.boolean(),
  needs_image_reselection: z.boolean().default(false),
  gestures: z.array(gestureSchema).max(500),
  reactions: reactionsSchema,
  starter_pack: starterPackSchema.nullable(),
  default_idle: itemRefSchema.nullable(),
  idle_revisions: sourceMapSchema,
  seed_revisions: sourceMapSchema,
  evidence: z.record(itemIdSchema, evidenceSchema),
  submission: z
    .strictObject({
      request: frozenCreationRequestSchema,
      state: z.enum(["pending", "unknown", "rejected", "conflict", "deleted"]),
    })
    .nullable(),
});
export type LegacyCreateAnimaDraft = z.infer<
  typeof legacyCreateAnimaDraftSchema
>;
export type CreationSourceKind =
  | "voice"
  | "avatar"
  | "appearance"
  | "gesture"
  | "reaction"
  | "idle_style";
export type CreationRoot = {
  kind: CreationSourceKind;
  source: ItemRevisionRef;
  path: string;
};

/** Every cell exists even when filtered out or explicitly empty. */
export function emptyReactions(): CreateAnimaDraft["reactions"] {
  return Object.fromEntries(
    TRACKED_EMOTIONS.map((emotion) => [
      emotion,
      { "1": null, "2": null, "3": null },
    ]),
  ) as CreateAnimaDraft["reactions"];
}

export function newCreateAnimaDraft(): CreateAnimaDraft {
  return {
    schema_version: 3,
    voice: null,
    draft_id: crypto.randomUUID(),
    step: 0,
    furthest_step: 0,
    meaningful: false,
    display_name: "",
    identity_markdown: DEFAULT_ANIMA_IDENTITY_MARKDOWN,
    avatar: null,
    appearance_migration: "none",
    needs_file_reselection: false,
    gestures: [],
    reactions: emptyReactions(),
    starter_pack: null,
    default_idle: null,
    idle_revisions: {},
    seed_revisions: {},
    evidence: {},
    submission: null,
  };
}

/** Preserve all non-Appearance edits; frozen request bodies remain byte-for-byte equivalent JSON. */
export function migrateLegacyCreateAnimaDraft(
  legacy: LegacyCreateAnimaDraft,
): CreateAnimaDraft {
  const needsConfirmation = Boolean(
    legacy.appearance.profile ||
    legacy.appearance.background ||
    legacy.portrait_pending ||
    legacy.needs_image_reselection,
  );
  return migratePreviousCreateAnimaDraft(
    previousCreateAnimaDraftSchema.parse({
      schema_version: 2,
      draft_id: legacy.draft_id,
      step: legacy.step,
      furthest_step: legacy.furthest_step,
      meaningful: legacy.meaningful,
      display_name: legacy.display_name,
      identity_markdown: legacy.identity_markdown.trim()
        ? upgradeDefaultAnimaIdentityMarkdown(
            legacy.identity_markdown,
            legacy.display_name,
          )
        : defaultAnimaIdentityMarkdown(legacy.display_name),
      avatar: legacy.avatar,
      appearance_migration: needsConfirmation
        ? "confirmation_required"
        : "none",
      needs_file_reselection: legacy.needs_file_reselection,
      gestures: legacy.gestures,
      reactions: legacy.reactions,
      starter_pack: legacy.starter_pack,
      default_idle: legacy.default_idle,
      idle_revisions: legacy.idle_revisions,
      seed_revisions: legacy.seed_revisions,
      evidence: legacy.evidence,
      submission: legacy.submission,
    }),
  );
}

export function sameRef(
  left: ItemRevisionRef | null | undefined,
  right: ItemRevisionRef | null | undefined,
): boolean {
  return (
    left?.item_id === right?.item_id &&
    left?.revision_sha256 === right?.revision_sha256
  );
}

export function normalizeIdentity(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}
export function identityBytes(value: string): number {
  return new TextEncoder().encode(normalizeIdentity(value)).byteLength;
}
export function nameLength(value: string): number {
  return Array.from(value.trim()).length;
}
function hasInvalidUnicode(value: string): boolean {
  return /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
    value,
  );
}
export function submissionLocksEditing(draft: CreateAnimaDraft): boolean {
  return Boolean(draft.submission && draft.submission.state !== "rejected");
}

/** Stable JSON for evidence comparison and edit identity, never a replacement for the server hash. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

export type DraftEdit = Partial<
  Pick<
    CreateAnimaDraft,
    | "voice"
    | "display_name"
    | "identity_markdown"
    | "appearance_migration"
    | "needs_file_reselection"
    | "gestures"
    | "reactions"
    | "evidence"
  >
>;
export type CreateAnimaDraftAction =
  | { type: "edit"; patch: DraftEdit }
  | {
      type: "avatar";
      source: ItemRevisionRef;
      evidence: CreationEvidence;
      meaningful?: boolean;
    }
  | { type: "step"; step: CreationStep }
  | { type: "seed" | "reset-actions"; options: AnimaCreationOptions }
  | { type: "evidence"; evidence: Record<string, CreationEvidence> }
  | { type: "submission"; submission: CreateAnimaDraft["submission"] };

/** Semantic changes rotate rejected commands; navigation and evidence reads do not. */
export function createAnimaDraftReducer(
  draft: CreateAnimaDraft,
  action: CreateAnimaDraftAction,
): CreateAnimaDraft {
  if (action.type === "submission")
    return { ...draft, submission: action.submission };
  if (submissionLocksEditing(draft)) return draft;
  if (action.type === "step")
    return {
      ...draft,
      step: action.step,
      furthest_step: Math.max(draft.furthest_step, action.step),
    };
  if (action.type === "evidence")
    return { ...draft, evidence: { ...draft.evidence, ...action.evidence } };
  if (action.type === "seed" || action.type === "reset-actions") {
    if (action.type === "seed" && draft.starter_pack) return draft;
    // A partially available pack is not the recommended selection. Keep the
    // current draft until its missing content is repaired, never silently omit it.
    if (action.options.diagnostics.length) return draft;
    return {
      ...draft,
      starter_pack: action.options.starter_pack,
      gestures: structuredClone(action.options.recommended.gestures),
      reactions: reactionsSchema.parse(action.options.recommended.reactions),
      seed_revisions: action.options.expected_source_revisions,
      default_idle: action.options.default_idle.source,
      idle_revisions: action.options.default_idle.expected_source_revisions,
      // A confirmed reset may accept new Action evidence, but never changes Avatar/text.
      evidence: Object.fromEntries(
        Object.entries(draft.evidence).filter(
          ([id]) =>
            draft.avatar?.item_id === id ||
            (draft.voice?.pocket.type === "clone" &&
              draft.voice.pocket.source.item_id === id),
        ),
      ),
      meaningful: draft.meaningful || action.type === "reset-actions",
      submission: draft.submission,
    };
  }
  if (action.type === "avatar") {
    return {
      ...draft,
      avatar: action.source,
      needs_file_reselection: false,
      evidence: { ...draft.evidence, [action.source.item_id]: action.evidence },
      meaningful: draft.meaningful || action.meaningful !== false,
      submission: draft.submission,
    };
  }
  if (action.type !== "edit") return draft;
  const patch =
    typeof action.patch.display_name === "string" &&
    action.patch.identity_markdown === undefined
      ? {
          ...action.patch,
          identity_markdown: synchronizeDefaultAnimaIdentityName(
            draft.identity_markdown,
            draft.display_name,
            action.patch.display_name,
          ),
        }
      : action.patch;
  const changed = Object.entries(patch).some(
    ([key, value]) =>
      canonicalJson(draft[key as keyof CreateAnimaDraft]) !==
      canonicalJson(value),
  );
  // Keep the last rejected command as retry evidence. freezeCreation compares the
  // normalized payload and rotates its key only when the submitted body changes.
  return changed ? { ...draft, ...patch, meaningful: true } : draft;
}

/** Preserve declaring paths, including repeated Reaction assignments, for error links. */
export function creationRoots(draft: CreateAnimaDraft): CreationRoot[] {
  return [
    ...(draft.voice?.pocket.type === "clone"
      ? [
          {
            kind: "voice" as const,
            source: draft.voice.pocket.source,
            path: "/voice/pocket/source",
          },
        ]
      : []),
    ...(draft.avatar
      ? [{ kind: "avatar" as const, source: draft.avatar, path: "/avatar" }]
      : []),
    ...draft.gestures.map((gesture, index) => ({
      kind: "gesture" as const,
      source: gesture.source,
      path: `/gestures/${index}/source`,
    })),
    ...TRACKED_EMOTIONS.flatMap((emotion) =>
      INTENSITIES.flatMap((intensity) => {
        const source = draft.reactions[emotion][intensity];
        return source
          ? [
              {
                kind: "reaction" as const,
                source,
                path: `/reactions/${emotion}/${intensity}`,
              },
            ]
          : [];
      }),
    ),
  ];
}

/** Exact union drops unused roots/supports and rejects contradictory revision pins. */
export function mergeSourceMaps(maps: SourceMap[]): SourceMap {
  const union: SourceMap = {};
  for (const map of maps)
    for (const [id, revision] of Object.entries(map)) {
      if (union[id] && canonicalJson(union[id]) !== canonicalJson(revision))
        throw new Error(
          `Selected sources disagree about revision ${id}. Review the affected content.`,
        );
      union[id] = revision;
    }
  return union;
}

export function buildAnimaSpec(
  draft: CreateAnimaDraft,
): z.infer<typeof animaSpecSchema> {
  if (!draft.avatar || !draft.starter_pack)
    throw new Error(
      "Choose an Avatar and resolve the Starter Pack before reviewing.",
    );
  const maps = creationRoots(draft).map(({ source }) => {
    const evidence = draft.evidence[source.item_id];
    if (!evidence || !sameRef(evidence.source, source))
      throw new Error("Selected content still needs exact source validation.");
    return evidence.revisions;
  });
  return animaSpecSchema.parse({
    schema_version: 1,
    display_name: draft.display_name.trim(),
    identity_markdown: normalizeIdentity(draft.identity_markdown),
    avatar: draft.avatar,
    voice: draft.voice,
    appearance: { profile: null, background: null },
    gestures: [...draft.gestures].sort((a, b) =>
      a.semantic_key.localeCompare(b.semantic_key),
    ),
    reactions: draft.reactions,
    starter_pack: draft.starter_pack,
    expected_source_revisions: mergeSourceMaps([draft.idle_revisions, ...maps]),
  });
}

export function draftIssues(
  draft: CreateAnimaDraft,
  through: CreationStep,
  identityLimit = 32768,
  displayNameLimit = 40,
): AnimaCreationDiagnostic[] {
  const issues: AnimaCreationDiagnostic[] = [];
  const add = (path: string, message: string) =>
    issues.push({ code: "draft_invalid", path, message });
  if (!draft.avatar)
    add("/avatar", "Choose an admitted Avatar or save your VRM to My Content.");
  if (draft.needs_file_reselection)
    add("/avatar", "Reselect and save your VRM, or cancel the unsaved upload.");
  // The name plate is a creator-wide field, so it gates the first forward move.
  const displayNameLength = nameLength(draft.display_name);
  if (displayNameLength < 1) add("/display_name", "Enter a name to continue.");
  else if (
    displayNameLength > displayNameLimit ||
    /[\p{Cc}]/u.test(draft.display_name) ||
    hasInvalidUnicode(draft.display_name)
  )
    add(
      "/display_name",
      `Use 1–${displayNameLimit} characters without control characters.`,
    );
  if (through > 0) {
    const voice = creationVoiceSchema.safeParse(draft.voice);
    if (!voice.success)
      for (const issue of voice.error.issues)
        add(
          `/voice/${issue.path.join("/")}`,
          draft.voice ? issue.message : "Choose a voice for your Anima.",
        );
  }
  if (through > 1) {
    if (
      !draft.identity_markdown.trim() ||
      identityBytes(draft.identity_markdown) > identityLimit ||
      draft.identity_markdown.includes(String.fromCharCode(0)) ||
      hasInvalidUnicode(draft.identity_markdown)
    )
      add(
        "/identity_markdown",
        `Enter nonblank Markdown within ${identityLimit.toLocaleString()} UTF-8 bytes.`,
      );
  }
  if (through > 2 && !draft.starter_pack)
    add("/starter_pack", "The installation's Starter Pack needs attention.");
  return issues;
}

export function issueStep(path: string): CreationStep | null {
  if (path.startsWith("/display_name")) return null;
  if (path.startsWith("/avatar")) return 0;
  if (path.startsWith("/voice")) return 1;
  if (path.startsWith("/identity_markdown")) return 2;
  return 3;
}

function draftValueAtPath(draft: CreateAnimaDraft, path: string): unknown {
  if (!path.startsWith("/")) return undefined;
  let value: unknown = draft;
  for (const rawPart of path.slice(1).split("/")) {
    if (!value || typeof value !== "object") return undefined;
    const part = rawPart.replace(/~1/g, "/").replace(/~0/g, "~");
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

function diagnosticRoot(
  draft: CreateAnimaDraft,
  issue: AnimaCreationDiagnostic,
): CreationRoot | null {
  const itemId = issue.declaring_action_item_id ?? issue.item_id;
  if (!itemId) return null;
  const candidates = creationRoots(draft).filter(
    (root) => root.source.item_id === itemId,
  );
  return (
    candidates.find((root) => root.path === issue.path) ??
    (candidates.length === 1 ? candidates[0]! : null)
  );
}

/** Retire diagnostics invalidated by an edit while retaining unaffected source failures. */
export function reconcileCreationIssues(
  issues: AnimaCreationDiagnostic[],
  before: CreateAnimaDraft,
  after: CreateAnimaDraft,
  identityLimit = 32768,
  displayNameLimit = 40,
): AnimaCreationDiagnostic[] {
  const currentLocal = draftIssues(after, 3, identityLimit, displayNameLimit);
  const emittedLocalPaths = new Set<string>();
  const beforeRoots = creationRoots(before);
  const afterRoots = creationRoots(after);

  return issues.flatMap((issue) => {
    if (issue.code === "draft_invalid") {
      if (emittedLocalPaths.has(issue.path)) return [];
      emittedLocalPaths.add(issue.path);
      return currentLocal.filter((current) => current.path === issue.path);
    }
    if (issue.code === "validation_unavailable") return [];

    const beforeRoot = diagnosticRoot(before, issue);
    if (beforeRoot) {
      const afterRoot = afterRoots.find(
        (root) => root.path === beforeRoot.path,
      );
      return afterRoot && sameRef(beforeRoot.source, afterRoot.source)
        ? [issue]
        : [];
    }

    const itemId = issue.declaring_action_item_id ?? issue.item_id;
    if (itemId) {
      const refs = (roots: CreationRoot[]) =>
        roots
          .filter((root) => root.source.item_id === itemId)
          .map((root) => ({ path: root.path, source: root.source }));
      if (canonicalJson(refs(beforeRoots)) !== canonicalJson(refs(afterRoots)))
        return [];
    }

    return canonicalJson(draftValueAtPath(before, issue.path)) ===
      canonicalJson(draftValueAtPath(after, issue.path))
      ? [issue]
      : [];
  });
}

export function reactionCount(
  draft: Pick<CreateAnimaDraft, "reactions">,
): number {
  return TRACKED_EMOTIONS.reduce(
    (count, emotion) =>
      count +
      INTENSITIES.filter(
        (intensity) => draft.reactions[emotion][intensity] !== null,
      ).length,
    0,
  );
}

export function setReaction(
  draft: CreateAnimaDraft,
  emotion: TrackedEmotion,
  intensity: Intensity,
  source: ItemRevisionRef | null,
): CreateAnimaDraft["reactions"] {
  return {
    ...draft.reactions,
    [emotion]: { ...draft.reactions[emotion], [intensity]: source },
  };
}
