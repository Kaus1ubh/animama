import type { ImportRecovery, RecoveryStore } from "./importSession";

const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
/** Persist identifiers only; never save file bytes, names, identity text or review contents. */
export function importRecoveryStore(
  owner: string,
  storage: Storage,
): RecoveryStore {
  const key = `animama.package-import.v1.${owner}`;
  let ownedOperation: string | null = null;
  function read(): ImportRecovery | null {
    const raw = storage.getItem(key);
    if (raw === null) return null;
    if (raw.length > 1024) throw new Error("Invalid import recovery data.");
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object")
      throw new Error("Invalid import recovery data.");
    const record = value as Partial<ImportRecovery>;
    if (
      typeof record.operation_id !== "string" ||
      !idPattern.test(record.operation_id) ||
      !(
        record.stage_id === null ||
        (typeof record.stage_id === "string" && idPattern.test(record.stage_id))
      ) ||
      !(
        record.review_digest === null ||
        (typeof record.review_digest === "string" &&
          /^[0-9a-f]{64}$/.test(record.review_digest))
      ) ||
      typeof record.commit_requested !== "boolean"
    )
      throw new Error("Invalid import recovery data.");
    const result: ImportRecovery = {
      operation_id: record.operation_id,
      stage_id: record.stage_id,
      review_digest: record.review_digest,
      commit_requested: record.commit_requested,
    };
    ownedOperation = result.operation_id;
    return result;
  }
  return {
    read,
    write(value) {
      const prior = storage.getItem(key);
      if (prior) {
        const current = JSON.parse(prior) as ImportRecovery;
        if (
          current.operation_id !== ownedOperation &&
          current.operation_id !== value?.operation_id
        )
          throw new Error(
            "Another window has an import in progress. Finish or recover that import first.",
          );
      }
      try {
        if (value) storage.setItem(key, JSON.stringify(value));
        else storage.removeItem(key);
      } catch {
        throw new Error(
          "Recovery identifiers could not be saved. Enable browser storage before importing.",
        );
      }
      ownedOperation = value?.operation_id ?? null;
    },
  };
}
