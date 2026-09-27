import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type {
  PyAnimaIdentityItem,
  PyMemoryEntryHeader,
} from "@/lib/content/catalogTypes";
import {
  animaFolderFiles,
  buildMemoryAnimaFolders,
} from "@/lib/memory-entries/anima-folders";
import { buildMemoryWorkspaceTree } from "@/lib/memory-entries/workspace-tree";
import { MemoryFileExplorer } from "./MemoryFileExplorer";

function animaFile(
  animaId: string,
  name: "IDENTITY.md" | "MEMORIES.md",
): PyMemoryEntryHeader {
  const role = name === "IDENTITY.md" ? "identity" : "memories";
  return {
    id: `${role}-${animaId}`,
    anima_id: animaId,
    scope: "anima",
    type: "file",
    name,
    path: name,
    kind: `anima_${role}`,
    version: 1,
  };
}

function anima(
  animaId: string,
  displayName: string,
  files: { identity?: boolean; memories?: boolean } = {},
): PyAnimaIdentityItem {
  return {
    anima_id: animaId,
    display_name: displayName,
    aggregate_revision: 1,
    identity_status: files.identity === false ? "repair_required" : "ready",
    entry: files.identity === false ? null : animaFile(animaId, "IDENTITY.md"),
    memories_entry:
      files.memories === false ? null : animaFile(animaId, "MEMORIES.md"),
  };
}

/** Renders the explorer with every Anima folder expanded. */
function renderExplorer(
  identities: PyAnimaIdentityItem[],
  props: {
    repairingAnimaId?: string | null;
    onRepairAnimaMemories?: (animaId: string) => void;
  } = {},
) {
  const folders = buildMemoryAnimaFolders(identities);
  const entries = folders
    .flatMap(animaFolderFiles)
    .flatMap((file) => (file.entry ? [file.entry] : []));
  const tree = buildMemoryWorkspaceTree(entries, "en-US", folders);
  const expanded = new Set([
    "virtual:animas",
    ...folders.map((folder) => `virtual:animas:${folder.animaId}`),
  ]);
  return renderToStaticMarkup(
    <MemoryFileExplorer
      entries={entries}
      tree={tree}
      selectedEntryId={null}
      expandedDirectoryIds={expanded}
      pendingEpisodeCount={0}
      collapsed={false}
      isLoading={false}
      isError={false}
      onEntrySelect={() => {}}
      onDirectoryToggle={() => {}}
      onExpandedDirectoryIdsChange={() => {}}
      onEntryRename={() => {}}
      onEntryDelete={() => {}}
      onCollapsedChange={() => {}}
      onRetry={() => {}}
      {...props}
    />,
  );
}

function textOrder(html: string, ...needles: string[]) {
  return needles.map((needle) => html.indexOf(needle));
}

describe("Anima folders in the memory explorer", () => {
  it("lists IDENTITY.md then MEMORIES.md with owner-facing paths", () => {
    const html = renderExplorer([anima("a", "Annie")]);

    const [identity, memories] = textOrder(
      html,
      'title="Animas/Annie/IDENTITY.md"',
      'title="Animas/Annie/MEMORIES.md"',
    );
    expect(identity).toBeGreaterThan(-1);
    expect(memories).toBeGreaterThan(identity!);
    expect(html).not.toContain("Needs repair");
    expect(html).not.toContain("is missing");
  });

  it("offers repair for a missing MEMORIES.md beside a live identity", () => {
    const html = renderExplorer([anima("a", "Annie", { memories: false })], {
      onRepairAnimaMemories: () => {},
    });

    expect(html).toContain("Needs repair");
    expect(html).toContain("MEMORIES.md is missing.");
    expect(html).toContain('aria-label="Repair MEMORIES.md for Annie"');
    expect(html).not.toContain("identity is missing");
    const [identity, missing] = textOrder(
      html,
      'title="Animas/Annie/IDENTITY.md"',
      "MEMORIES.md is missing.",
    );
    expect(missing).toBeGreaterThan(identity!);
  });

  it("keeps the identity repair state distinct from missing memories", () => {
    const html = renderExplorer([anima("a", "Annie", { identity: false })], {
      onRepairAnimaMemories: () => {},
    });

    const [identityNotice, memories] = textOrder(
      html,
      "identity is missing and needs repair.",
      'title="Animas/Annie/MEMORIES.md"',
    );
    expect(identityNotice).toBeGreaterThan(-1);
    expect(memories).toBeGreaterThan(identityNotice!);
    expect(html).not.toContain("MEMORIES.md is missing.");
    expect(html).not.toContain("Repair MEMORIES.md");
  });

  it("disables every repair while one is in flight", () => {
    const html = renderExplorer(
      [
        anima("a", "Annie", { memories: false }),
        anima("b", "Mika", { memories: false }),
      ],
      { repairingAnimaId: "a", onRepairAnimaMemories: () => {} },
    );

    const repairButtons = html.match(/<button[^>]*Repair MEMORIES\.md[^>]*>/g);
    expect(repairButtons).toHaveLength(2);
    for (const button of repairButtons ?? []) {
      expect(button).toContain("disabled");
    }
    expect(html).toContain("animate-spin");
  });
});
