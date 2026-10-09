import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  RuntimeOwnerProvider,
  useRuntimeCacheKey,
  useRuntimeOwnerId,
} from "@web/app/runtime/RuntimeOwnerContext";
import { queryKeys } from "@/query/keys";
import { creationStorageKey } from "@/ui/create-anima/createAnimaDraftStorage";

function SharedFeatureProbe() {
  const ownerId = useRuntimeCacheKey();
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
  it("keeps the admitted owner while same-owner reauthentication changes cache and draft partitions", () => {
    function Probe() {
      return (
        <span>
          {useRuntimeOwnerId()}|{useRuntimeCacheKey()}
        </span>
      );
    }
    const render = (sessionKey: string) =>
      renderToStaticMarkup(
        <RuntimeOwnerProvider ownerId="same-owner" sessionKey={sessionKey}>
          <Probe />
          <SharedFeatureProbe />
        </RuntimeOwnerProvider>,
      );
    const first = render("lifetime-one");
    const second = render("lifetime-two");
    expect(first).toContain("same-owner|lifetime-one");
    expect(second).toContain("same-owner|lifetime-two");
    expect(second).not.toContain("lifetime-one");
  });
  it("partitions shared query and draft state without a local-runtime import", () => {
    const first = renderFor("installation-1");
    const second = renderFor("installation-2");

    expect(first).toContain("installation-1");
    expect(second).toContain("installation-2");
    expect(first).not.toBe(second);
  });
});
