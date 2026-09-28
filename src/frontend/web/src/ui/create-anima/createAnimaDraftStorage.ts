import { z } from "zod";
import {
  createAnimaDraftSchema,
  previousCreateAnimaDraftSchema,
  migratePreviousCreateAnimaDraft,
  itemIdSchema,
  legacyCreateAnimaDraftSchema,
  migrateLegacyCreateAnimaDraft,
  submissionLocksEditing,
  type CreateAnimaDraft,
} from "./createAnimaDraft";
import { upgradeDefaultAnimaIdentityMarkdown } from "./createAnimaIdentity";

const recordBase = {
  schema_version: z.literal(3),
  writer: z.string().uuid(),
  sequence: z.number().int().nonnegative(),
};
export const creationRecordSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...recordBase,
    kind: z.literal("draft"),
    draft: createAnimaDraftSchema,
  }),
  z.strictObject({
    ...recordBase,
    kind: z.literal("complete"),
    anima_id: itemIdSchema,
  }),
]);
export type CreationRecord = z.infer<typeof creationRecordSchema>;
const legacyRecordSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    schema_version: z.literal(1),
    writer: z.string().uuid(),
    sequence: z.number().int().nonnegative(),
    kind: z.literal("draft"),
    draft: legacyCreateAnimaDraftSchema,
  }),
  z.strictObject({
    schema_version: z.literal(1),
    writer: z.string().uuid(),
    sequence: z.number().int().nonnegative(),
    kind: z.literal("complete"),
    anima_id: itemIdSchema,
  }),
]);
export type CreationStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;

export class CreationDraftConflict extends Error {
  constructor() {
    super(
      "This draft changed in another tab. Review it before taking over editing.",
    );
  }
}

/** Route supported saved schemas explicitly; preserve unknown schemas for recovery. */
export function migrateCreationRecord(raw: string): CreationRecord {
  if (raw.length > 2 * 1024 * 1024)
    throw new Error(
      "The saved draft exceeds the recovery limit. Start over only after confirming you no longer need it.",
    );
  const value: unknown = JSON.parse(raw);
  const current = creationRecordSchema.safeParse(value);
  if (current.success) {
    const record = current.data;
    if (record.kind !== "draft" || record.draft.submission) return record;
    const identity = upgradeDefaultAnimaIdentityMarkdown(
      record.draft.identity_markdown,
      record.draft.display_name,
    );
    return identity === record.draft.identity_markdown
      ? record
      : { ...record, draft: { ...record.draft, identity_markdown: identity } };
  }
  const previous = z
    .discriminatedUnion("kind", [
      z.strictObject({
        ...recordBase,
        schema_version: z.literal(2),
        kind: z.literal("draft"),
        draft: previousCreateAnimaDraftSchema,
      }),
      z.strictObject({
        ...recordBase,
        schema_version: z.literal(2),
        kind: z.literal("complete"),
        anima_id: itemIdSchema,
      }),
    ])
    .safeParse(value);
  if (previous.success)
    return previous.data.kind === "complete"
      ? { ...previous.data, schema_version: 3 }
      : {
          ...previous.data,
          schema_version: 3,
          draft: migratePreviousCreateAnimaDraft(previous.data.draft),
        };
  const legacy = legacyRecordSchema.safeParse(value);
  if (legacy.success) {
    const base = {
      schema_version: 3 as const,
      writer: legacy.data.writer,
      sequence: legacy.data.sequence,
    };
    return legacy.data.kind === "complete"
      ? { ...base, kind: "complete", anima_id: legacy.data.anima_id }
      : {
          ...base,
          kind: "draft",
          draft: migrateLegacyCreateAnimaDraft(legacy.data.draft),
        };
  }
  throw new Error(
    "This saved draft cannot be read by this version. It has not been discarded. Confirm Start over to replace it.",
  );
}

/** Owner and installation are part of the key; values contain no credentials or runtime URLs. */
export function creationStorageKey(
  owner: string,
  installation: string,
): string {
  return `animama:create-anima:${encodeURIComponent(installation)}:${encodeURIComponent(owner)}`;
}

/** Optimistic writes reject competing tabs, including immediately before network dispatch. */
export class CreateAnimaDraftStorage {
  readonly writer = crypto.randomUUID();
  private expected: string | null = null;
  private sequence = 0;
  readonly key: string;
  private readonly storage: CreationStorage;
  constructor(key: string, storage: CreationStorage) {
    this.key = key;
    this.storage = storage;
  }

  read(): CreationRecord | null {
    const raw = this.storage.getItem(this.key);
    this.expected = raw;
    const record = raw ? migrateCreationRecord(raw) : null;
    this.sequence = record?.sequence ?? 0;
    return record;
  }

  changedElsewhere(): boolean {
    return this.storage.getItem(this.key) !== this.expected;
  }

  private write(record: CreationRecord): void {
    if (this.changedElsewhere()) throw new CreationDraftConflict();
    const raw = JSON.stringify(creationRecordSchema.parse(record));
    this.storage.setItem(this.key, raw);
    if (this.storage.getItem(this.key) !== raw)
      throw new CreationDraftConflict();
    this.expected = raw;
    this.sequence = record.sequence;
  }

  save(draft: CreateAnimaDraft): void {
    this.write({
      schema_version: 3,
      writer: this.writer,
      sequence: this.sequence + 1,
      kind: "draft",
      draft,
    });
  }

  complete(animaId: string): void {
    this.write({
      schema_version: 3,
      writer: this.writer,
      sequence: this.sequence + 1,
      kind: "complete",
      anima_id: animaId,
    });
  }

  /** Caller must explicitly confirm discard; a dispatched command cannot be discarded. */
  discard(
    options: { acknowledgeDeleted?: boolean; corruptConfirmed?: boolean } = {},
  ): void {
    if (this.changedElsewhere()) throw new CreationDraftConflict();
    let record: CreationRecord | null = null;
    try {
      record = this.expected ? migrateCreationRecord(this.expected) : null;
    } catch (error) {
      if (!options.corruptConfirmed) throw error;
    }
    if (
      record?.kind === "draft" &&
      submissionLocksEditing(record.draft) &&
      !(
        options.acknowledgeDeleted &&
        record.draft.submission?.state === "deleted"
      )
    )
      throw new Error("Check creation result before discarding this request.");
    this.storage.removeItem(this.key);
    this.expected = null;
  }

  /** Read-and-claim only an editable draft. Pending requests can be replayed, never taken over. */
  takeOver(): CreationRecord | null {
    const record = this.read();
    if (record?.kind === "draft" && submissionLocksEditing(record.draft))
      throw new Error(
        "Creation is pending in another tab. Check the original creation result.",
      );
    if (record?.kind === "draft") this.save(record.draft);
    return record;
  }
}
