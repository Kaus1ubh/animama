import { describe, expect, it } from "vitest";

import type { PyActionPreview } from "@/lib/content/catalogTypes";
import { ActionPreviewSession, actionClosure } from "./ActionPreviewSession";
import { actionPreviewTarget } from "./actionPreviewTarget";

const preview = (revision: string): PyActionPreview => ({
  preview_id: `preview-${revision}`,
  revision,
  revision_sha256: revision,
  expires_at: "2026-08-10T00:05:00Z",
  files: [],
  metadata: {},
  closure: { root: { content_type: "gesture" }, supports: [], revision },
});

describe("ActionPreviewSession", () => {
  it("rejects stale results after a newer request begins", () => {
    const session = new ActionPreviewSession();
    const first = session.begin();
    const second = session.begin();
    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(false);
    expect(session.commit(first.generation, preview("old"))).toBe(false);
    expect(session.commit(second.generation, preview("new"))).toBe(true);
    expect(session.preview?.revision).toBe("new");
  });

  it("validates the dependency-complete closure", () => {
    expect(actionClosure(preview("abc"))).toMatchObject({
      revision: "abc",
      root: { content_type: "gesture" },
      supports: [],
    });
  });

  it("adapts a typed built-in Gesture to the existing avatar preview runtime", () => {
    const value = preview("abc");
    value.closure = {
      root: {
        content_type: "gesture",
        source: {
          type: "builtin",
          content_id: "builtin:gesture:exclaim_frustrated",
          version: 1,
        },
        name: "Exclaim Frustrated",
        semantic_key: "exclaim_frustrated",
        implementation: {
          kind: "vrma",
          technical_source: {
            type: "public_url",
            url: "/vrm/animations/exclaim_frustrated.vrma",
          },
        },
        config: {},
        reference_map: {},
        files: [],
      },
      supports: [],
      revision: "abc",
    };

    const target = actionPreviewTarget(value, "Exclaim Frustrated");
    expect(target.sourceType).toBe("resolved_action");
    if (target.sourceType !== "resolved_action") throw new Error("fixture");
    expect(target.runtime.gestures).toHaveLength(1);
    expect(target.runtime.gestures[0]?.runtime_id).toBe("exclaim_frustrated");
  });

  it("mounts an owned Reaction sequence through its authorization endpoint", () => {
    const value = preview("owned-reaction");
    value.closure = {
      root: {
        content_type: "reaction",
        source: {
          type: "catalog",
          catalog_item_id: "reaction-item",
          logical_key: "local:reaction:happy",
        },
        name: "Happy to relaxed",
        placement_hint: { emotion: "joy", intensity: 1 },
        implementation: {
          kind: "anima_clip",
          file_role: "sequence",
        },
        config: {},
        reference_map: {},
        files: [
          {
            file_ref: "sequence-ref",
            role: "sequence",
            ordinal: 1,
            filename: "reaction.json",
            media_type: "application/json",
            size_bytes: 512,
            sha256: "a".repeat(64),
            url: "/v1/content/previews/preview/files/sequence-ref",
          },
        ],
      },
      supports: [],
      revision: "owned-reaction",
    };

    const target = actionPreviewTarget(value, "Happy to relaxed");
    expect(target.sourceType).toBe("resolved_action");
    if (target.sourceType !== "resolved_action") throw new Error("fixture");
    expect(target.runtime.reactions[0]?.source).toMatchObject({
      type: "authorized_files",
      files: [
        expect.objectContaining({
          role: "sequence",
          url: expect.stringContaining("/v1/content/previews/"),
        }),
      ],
    });
  });
});
