import { Trash2Icon } from "lucide-react";
import { usePoseCreatorStore } from "@/stores/pose-creator-store";
import { cn } from "@/lib/utils";
import { useActionEditorWorkspace } from "./ActionEditorWorkspaceContext";

/** A chronological selection surface over the same draft as the graphical timeline. */
export function ActionEventList({ onSelect }: { onSelect?: () => void }) {
  const workspace = useActionEditorWorkspace();
  const draft = usePoseCreatorStore((state) => state.clipDraft);
  const selectKeyframe = usePoseCreatorStore(
    (state) => state.selectClipKeyframe,
  );
  const selectEvent = usePoseCreatorStore((state) => state.selectClipEvent);
  const deleteKeyframe = usePoseCreatorStore(
    (state) => state.deleteSelectedClipKeyframe,
  );
  const deleteEvent = usePoseCreatorStore(
    (state) => state.deleteSelectedClipEvent,
  );
  const editing = usePoseCreatorStore((state) => Boolean(state.clipInlineEdit));
  const labelFor = (alias: string) => {
    const dependency = workspace.document.dependencies.find(
      (item) => item.alias === alias,
    );
    const item =
      dependency &&
      workspace.dependencySections
        .flatMap((section) => section.items)
        .find((item) => {
          const a = item.source,
            b = dependency.source;
          return a?.type === "catalog" && b.type === "catalog"
            ? a.catalog_item_id === b.catalog_item_id
            : a?.type === "builtin" &&
                b.type === "builtin" &&
                a.content_id === b.content_id &&
                a.version === b.version;
        });
    return (
      item?.name ??
      alias
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/[_-]+/g, " ")
        .replace(/\b\w/g, (character) => character.toUpperCase())
    );
  };
  const items = [
    ...draft.keyframes.map((frame) => ({
      id: `keyframe:${frame.id}`,
      time: frame.time,
      label:
        workspace.document.intent === "reaction"
          ? "Expression"
          : labelFor(frame.pose),
      remove: () => {
        selectKeyframe(frame.id);
        deleteKeyframe();
      },
      selected: draft.selectedKeyframeId === frame.id,
      select: () => selectKeyframe(frame.id),
    })),
    ...draft.events.map((event) => ({
      id: `event:${event.id}`,
      time: event.time,
      label: labelFor(
        event.kind === "scene_vfx"
          ? event.presetId
          : event.kind === "sfx"
            ? event.cueId
            : event.effectId,
      ),
      remove: () => {
        selectEvent(event.id);
        deleteEvent();
      },
      selected: draft.selectedEventId === event.id,
      select: () => selectEvent(event.id),
    })),
  ].sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
  if (!items.length) return null;
  return (
    <section
      aria-label="Timeline events"
      className="bg-background flex max-h-full min-h-0 flex-col rounded-2xl border p-3 shadow-xl"
    >
      <h2 className="mb-3 text-sm font-semibold">Timeline</h2>
      <ol className="min-h-0 space-y-1 overflow-y-auto">
        {items.map((item) => (
          <li
            key={item.id}
            className={cn(
              "hover:bg-accent flex items-center rounded-lg",
              item.selected && "bg-accent",
            )}
          >
            <button
              type="button"
              aria-pressed={item.selected}
              onClick={() => {
                item.select();
                onSelect?.();
              }}
              className="focus-visible:ring-ring flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left focus-visible:ring-2"
            >
              <span className="text-muted-foreground shrink-0 text-[10px] tabular-nums">
                {item.time.toFixed(2)}s
              </span>
              <span className="min-w-0">
                <span
                  className="block truncate text-xs font-medium"
                  title={item.label}
                >
                  {item.label}
                </span>
              </span>
            </button>
            <button
              type="button"
              disabled={editing}
              onClick={item.remove}
              aria-label={`Delete ${item.label} at ${item.time.toFixed(2)}s`}
              title="Delete timeline item"
              className="text-muted-foreground hover:text-foreground focus-visible:ring-ring mr-1 flex size-7 shrink-0 items-center justify-center rounded-md focus-visible:ring-2 disabled:opacity-50"
            >
              <Trash2Icon className="size-3.5" />
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
