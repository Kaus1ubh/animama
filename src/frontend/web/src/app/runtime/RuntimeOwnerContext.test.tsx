import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  RuntimeOwnerProvider,
  useRuntimeOwnerId,
} from "@web/app/runtime/RuntimeOwnerContext";
import { queryKeys } from "@/query/keys";
import { creationStorageKey } from "@/ui/create-anima/createAnimaDraftStorage";

function SharedFeatureProbe() {
  const ownerId = useRuntimeOwnerId();
  if (!ownerId) return <span>runtime unavailable</span>;
  return (
    <span>
      {JSON.stringify({
        query: queryKeys.chats.all(ownerId),
        draft: creationStorageKey(ownerId, "http://localhost:3000"),
      })}
    </span>
  );
}

function renderFor(ownerId: string): string {
  return renderToStaticMarkup(
    <RuntimeOwnerProvider ownerId={ownerId}>
      <SharedFeatureProbe />
    </RuntimeOwnerProvider>,
  );
}

describe("RuntimeOwnerContext", () => {
  it("partitions shared query and draft state without a local-runtime import", () => {
    const first = renderFor("installation-1");
    const second = renderFor("installation-2");

    expect(first).toContain("installation-1");
    expect(second).toContain("installation-2");
    expect(first).not.toBe(second);
  });
});
