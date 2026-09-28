import { describe, expect, it } from "vitest";
import { importRecoveryStore } from "./recoveryStore";
const record = {
  operation_id: "op",
  stage_id: "stage",
  review_digest: "a".repeat(64),
  commit_requested: true,
};
function memory(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (i) => [...values.keys()][i] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}
describe("package recovery storage", () => {
  it("survives reload with only operation identifiers and commit uncertainty", () => {
    const local = memory();
    const store = importRecoveryStore("owner", local);
    store.write(record);
    expect(importRecoveryStore("owner", local).read()).toEqual(record);
    expect(JSON.parse(local.getItem(local.key(0)!)!)).toEqual(record);
    expect(importRecoveryStore("another-owner", local).read()).toBeNull();
  });
  it("does not overwrite or clear a new operation started by another window", () => {
    const local = memory();
    const first = importRecoveryStore("owner", local);
    first.write(record);
    const next = importRecoveryStore("owner", local);
    next.read();
    next.write(null);
    next.write({ ...record, operation_id: "new-op" });
    expect(() => first.write({ ...record, commit_requested: false })).toThrow(
      "Another window",
    );
    expect(() => first.write(null)).toThrow("Another window");
    expect(next.read()?.operation_id).toBe("new-op");
  });
  it("fails closed on corrupted or oversized recovery data", () => {
    const local = memory();
    const store = importRecoveryStore("owner", local);
    store.write(record);
    const key = local.key(0)!;
    local.setItem(key, '{"operation_id":"op"}');
    expect(() => store.read()).toThrow("Invalid import recovery data");
    local.setItem(key, "x".repeat(2048));
    expect(() => store.read()).toThrow("Invalid import recovery data");
  });
});
