import type { ReactNode } from "react";
import type { PortableAnima } from "@animama/runtime-contracts/api-types";
import {
  FileBox,
  Hand,
  HeartHandshake,
  Image,
  Layers3,
  ScanFace,
  ShieldCheck,
  Sparkles,
  UserRound,
  Volume2,
  Wind,
} from "lucide-react";
import {
  sharingKindLabel,
  type PackageDisplayItem,
} from "./sharingPresentation";

export function SharingItemIcon({ kind }: { kind: string }) {
  const Icon =
    (
      {
        avatar: UserRound,
        gesture: Hand,
        reaction: HeartHandshake,
        pose: UserRound,
        idle_style: Wind,
        particle_effect: Sparkles,
        avatar_effect: ScanFace,
        scene_effect: Layers3,
        sound_effect: Volume2,
        appearance: Image,
      } as Record<string, typeof FileBox>
    )[kind] ?? FileBox;
  return (
    <span className="bg-muted text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded-lg">
      <Icon aria-hidden="true" className="size-5" />
    </span>
  );
}

export function SharingItemRow({
  item,
  children,
}: {
  item: PackageDisplayItem;
  children?: ReactNode;
}) {
  const renamed =
    item.originalName !== undefined && item.originalName !== item.name;
  return (
    <div className="flex min-w-0 items-center gap-3 p-3">
      <SharingItemIcon kind={item.kind} />
      <div className="min-w-0 flex-1">
        <p className="font-medium break-words">{item.name}</p>
        <p className="text-muted-foreground text-xs">
          {sharingKindLabel(item.kind)}
        </p>
        {renamed ? (
          <p className="text-muted-foreground mt-1 text-xs break-words">
            Automatically renamed from “{item.originalName}”
          </p>
        ) : null}
      </div>
      {children}
    </div>
  );
}

export function SharingRequiredItems({
  items,
}: {
  items: PackageDisplayItem[];
}) {
  if (!items.length) return null;
  return (
    <details className="rounded-xl border">
      <summary className="cursor-pointer px-4 py-3 font-medium">
        Required items{" "}
        <span className="text-muted-foreground font-normal">
          ({items.length})
        </span>
      </summary>
      <div className="divide-y border-t">
        {items.map((item) => (
          <SharingItemRow key={item.id} item={item} />
        ))}
      </div>
    </details>
  );
}

export function SharingPrivacyNote() {
  return (
    <div className="bg-muted/50 flex gap-3 rounded-xl p-4 text-sm">
      <ShieldCheck
        aria-hidden="true"
        className="text-muted-foreground mt-0.5 size-5 shrink-0"
      />
      <div>
        <p className="font-medium">A fresh companion for someone else</p>
        <p className="text-muted-foreground mt-1">
          Identity and equipped content are included. Chats, memories,
          credentials, voice settings, and other private settings are left out.
        </p>
      </div>
    </div>
  );
}

function Configuration({
  value,
}: {
  value: Record<string, unknown> | undefined;
}) {
  if (!value || !Object.keys(value).length) return null;
  return (
    <dl className="mt-2 grid gap-1 text-xs">
      {Object.entries(value).map(([key, entry]) => (
        <div key={key} className="flex flex-wrap gap-x-2">
          <dt className="text-muted-foreground capitalize">
            {key.replaceAll("_", " ")}
          </dt>
          <dd className="min-w-0 break-words whitespace-pre-wrap">
            {typeof entry === "object"
              ? JSON.stringify(entry, null, 2)
              : String(entry)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Show every saved equipment cell and its configuration without editing the export. */
export function SharingAnimaDetails({
  anima,
  items,
  showPrivacyNote = true,
}: {
  anima: PortableAnima;
  items: PackageDisplayItem[];
  showPrivacyNote?: boolean;
}) {
  const name = (id: string | null) =>
    id === null ? "None" : (items.find((item) => item.id === id)?.name ?? id);
  const counts = new Map<string, number>();
  for (const item of items)
    counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
  return (
    <div className="space-y-5">
      <div className="grid gap-6 md:grid-cols-[1.2fr_1fr]">
        <section className="min-w-0 space-y-3">
          <h3 className="font-semibold">Identity</h3>
          <div className="rounded-xl border p-4">
            <p className="mb-3 font-semibold break-words">
              {anima.display_name}
            </p>
            <div
              className="max-h-64 overflow-y-auto text-sm break-words whitespace-pre-wrap"
              tabIndex={0}
              aria-label="Full Anima identity"
            >
              {anima.identity_markdown}
            </div>
          </div>
        </section>
        <section className="min-w-0 space-y-3">
          <h3 className="font-semibold">Included content</h3>
          <div className="divide-y">
            {[...counts].map(([kind, count]) => (
              <div key={kind} className="flex items-center gap-3 py-2">
                <SharingItemIcon kind={kind} />
                <span className="flex-1">
                  {sharingKindLabel(kind)}
                  {count === 1 ? "" : "s"}
                </span>
                <span>{count}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
      <details className="rounded-xl border">
        <summary className="cursor-pointer px-4 py-3 font-medium">
          Equipment and configuration
        </summary>
        <div className="space-y-4 border-t p-4 text-sm">
          <p>
            <span className="font-medium">Avatar: </span>
            {name(anima.avatar)}
          </p>
          <section>
            <h4 className="mb-2 font-medium">Gestures</h4>
            {anima.gestures.length ? (
              <ul className="space-y-3">
                {anima.gestures.map((gesture, index) => (
                  <li key={`${gesture.semantic_key}-${index}`}>
                    <span className="break-words">
                      {gesture.semantic_key}: {name(gesture.entry_id)}
                    </span>
                    <Configuration value={gesture.config} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground">None</p>
            )}
          </section>
          <details>
            <summary className="cursor-pointer font-medium">
              Reaction cells
            </summary>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {Object.entries(anima.reactions).flatMap(([emotion, cells]) =>
                Object.entries(cells).map(([intensity, selection]) => (
                  <div
                    key={`${emotion}-${intensity}`}
                    className="rounded-lg border p-2"
                  >
                    <p className="break-words">
                      <span className="capitalize">{emotion}</span> ·{" "}
                      {intensity}:{" "}
                      {selection ? name(selection.entry_id) : "None"}
                    </p>
                    {selection ? (
                      <Configuration value={selection.config} />
                    ) : null}
                  </div>
                )),
              )}
            </div>
          </details>
          <p>
            <span className="font-medium">Idle Style: </span>
            {name(anima.idle_style)}
          </p>
          <section>
            <h4 className="mb-2 font-medium">Appearance</h4>
            {(["profile", "background"] as const).map((slot) => (
              <div key={slot} className="mt-2">
                <p className="capitalize">
                  {slot}: {name(anima.appearance[slot]?.entry_id ?? null)}
                </p>
                {anima.appearance[slot] ? (
                  <Configuration value={anima.appearance[slot].presentation} />
                ) : null}
              </div>
            ))}
          </section>
        </div>
      </details>
      {showPrivacyNote ? <SharingPrivacyNote /> : null}
    </div>
  );
}
