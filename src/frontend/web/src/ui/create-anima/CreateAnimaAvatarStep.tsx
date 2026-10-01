import { Check, Upload, UserRound } from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";

import type {
  ItemRevisionRef,
  PyAvatarContent,
} from "@animama/runtime-contracts/sdk";
import { ContentSaveApiError } from "@/lib/content/contentSaveErrors";
import { cn } from "@/lib/utils";
import type {
  AnimaCreationOperations,
  AnimaCreationSources,
} from "@/query/hooks/useAnimaCreation";
import { Button } from "@/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/ui/components/dialog";
import { Input } from "@/ui/components/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/components/tabs";
import { itemReference } from "./createAnimaContent";
import { sameRef, type CreateAnimaDraft } from "./createAnimaDraft";
import { checkCreationVrm } from "./createAnimaFiles";

/** The server remains authoritative; offer only an unambiguous caller-editable collision. */
export function avatarCollisionTarget(
  name: string,
  items: PyAvatarContent[],
): PyAvatarContent | undefined {
  const filename = `${name
    .trim()
    .replace(/[ _]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .toLowerCase()}.vrm`;
  const matches = items.filter(
    (item) =>
      item.source === "local" &&
      item.editable &&
      item.files?.some((file) => file.filename === filename),
  );
  return matches.length === 1 ? matches[0] : undefined;
}

export function CreateAnimaAvatarStep({
  draft,
  sources,
  operations,
  file,
  fileInputRef,
  onFile,
  onSelect,
  onWorking,
}: {
  draft: CreateAnimaDraft;
  sources: AnimaCreationSources;
  operations: AnimaCreationOperations;
  file: File | null;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onFile: (file: File | null) => void;
  onSelect: (source: ItemRevisionRef, meaningful?: boolean) => Promise<void>;
  onWorking: (working: boolean) => void;
}) {
  const avatars = sources.avatars.data ?? [];
  const selected = avatars.find(
    (item) => item.item_id === draft.avatar?.item_id,
  );
  const [tab, setTab] = useState(
    selected?.source === "local" ? "local" : "included",
  );
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(8);
  const [name, setName] = useState(file?.name.replace(/\.vrm$/i, "") ?? "");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [collision, setCollision] = useState<PyAvatarContent | null>(null);
  const request = useRef(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    const currentRequest = request;
    return () => {
      alive.current = false;
      currentRequest.current++;
    };
  }, []);

  const working = (value: boolean) => {
    setBusy(value);
    onWorking(value);
  };
  const choose = async (source: ItemRevisionRef) => {
    if (busy) return;
    working(true);
    setError(null);
    setNotice(null);
    try {
      await onSelect(source);
      onFile(null);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "This Avatar needs attention. Choose another source or retry.",
      );
    } finally {
      if (alive.current) working(false);
    }
  };
  const selectFile = async (next: File | undefined) => {
    if (!next || busy) return;
    const token = ++request.current;
    working(true);
    setError(null);
    setNotice(null);
    try {
      await checkCreationVrm(next);
      if (!alive.current || request.current !== token) return;
      onFile(next);
      setName(next.name.replace(/\.vrm$/i, ""));
    } catch (reason) {
      if (alive.current && request.current === token)
        setError(
          reason instanceof Error ? reason.message : "Could not read this VRM.",
        );
    } finally {
      if (alive.current && request.current === token) working(false);
    }
  };
  const save = async (replace?: PyAvatarContent) => {
    if (!file || busy || !name.trim()) return;
    working(true);
    setError(null);
    setCollision(null);
    try {
      const saved = await operations.saveAvatar.mutateAsync({
        file,
        name: name.trim(),
        replace: replace ? itemReference(replace) : undefined,
      });
      if (!alive.current) return;
      await onSelect(itemReference(saved));
      onFile(null);
      setTab("local");
      setNotice(
        !replace && avatars.some((item) => item.item_id === saved.item_id)
          ? "These exact bytes are already in My Content. The existing Avatar is selected; its name and metadata were kept."
          : "Avatar saved to My Content. It will stay there even if you cancel creation.",
      );
    } catch (reason) {
      if (!alive.current) return;
      if (
        reason instanceof ContentSaveApiError &&
        reason.code === "content_path_exists"
      ) {
        const fresh = await sources.avatars.refetch();
        setCollision(
          avatarCollisionTarget(name, fresh.data ?? avatars) ?? null,
        );
        setError(
          "That name is already used. Enter a new name, or explicitly replace the matching Avatar below. An Avatar used by a live Anima cannot be replaced here.",
        );
      } else
        setError(
          reason instanceof ContentSaveApiError &&
            reason.code === "avatar_in_use_choose_new_name"
            ? "This Avatar is used by a live Anima. Keep it intact and save your upload under a new name."
            : reason instanceof Error
              ? reason.message
              : "Save failed. Your file is still here; you can retry.",
        );
    } finally {
      if (alive.current) working(false);
    }
  };
  const filtered = avatars.filter(
    (item) =>
      item.source === tab &&
      `${item.name} ${item.description ?? ""}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );

  return (
    <div className="space-y-5">
      <section id="creation-avatar" tabIndex={-1} aria-label="Avatar selection">
        <Input
          ref={fileInputRef}
          id="creation-vrm-file"
          className="hidden"
          type="file"
          accept=".vrm"
          aria-label="Choose a VRM file"
          aria-hidden="true"
          tabIndex={-1}
          disabled={busy}
          onChange={(event) => {
            const next = event.target.files?.[0];
            event.target.value = "";
            void selectFile(next);
          }}
        />
        <Tabs
          value={tab}
          onValueChange={(value) => {
            setTab(value);
            setLimit(8);
          }}
        >
          <div className="flex items-center gap-2">
            <TabsList className="grid min-w-0 flex-1 grid-cols-2">
              <TabsTrigger value="included">Included</TabsTrigger>
              <TabsTrigger value="local">My Content</TabsTrigger>
            </TabsList>
            <Button
              type="button"
              variant="outline"
              className="shrink-0"
              disabled={busy}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="size-4" />
              Upload VRM
            </Button>
          </div>
          {(["included", "local"] as const).map((source) => (
            <TabsContent key={source} value={source} className="space-y-3">
              <Input
                aria-label="Search Avatars"
                placeholder="Search Avatars…"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setLimit(8);
                }}
              />
              {sources.avatars.isLoading ? (
                <p role="status" className="text-muted-foreground text-sm">
                  Loading Avatars…
                </p>
              ) : sources.avatars.isError ? (
                <div role="alert" className="space-y-2 text-sm">
                  <p>
                    Avatars could not be loaded. Your selection is preserved.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void sources.avatars.refetch()}
                  >
                    Retry Avatars
                  </Button>
                </div>
              ) : !filtered.length ? (
                <p className="text-muted-foreground rounded-xl border border-dashed p-5 text-sm">
                  {search
                    ? "No matching Avatars. Your selected Avatar has not changed."
                    : source === "local"
                      ? "No Avatars in My Content yet. Upload a VRM to add one."
                      : "No Included Avatars are available. You can use My Content or upload a VRM."}
                </p>
              ) : (
                <div
                  role="radiogroup"
                  aria-label={`${source === "local" ? "My Content" : "Included"} Avatars`}
                  className="grid grid-cols-2 gap-3"
                >
                  {filtered.slice(0, limit).map((item) => {
                    const checked = sameRef(draft.avatar, item);
                    return (
                      <label
                        key={item.item_id}
                        className={cn(
                          "focus-within:ring-ring relative flex cursor-pointer flex-col gap-2 rounded-xl border p-3 focus-within:ring-2",
                          checked
                            ? "border-primary bg-primary/5"
                            : "bg-background hover:bg-muted/30",
                          busy && "pointer-events-none opacity-60",
                        )}
                      >
                        <input
                          className="sr-only"
                          type="radio"
                          name="creation-avatar-source"
                          aria-label={`${item.name} ${item.source === "local" ? "My Content" : "Included"}`}
                          checked={checked}
                          disabled={busy}
                          value={item.item_id}
                          onChange={() => void choose(itemReference(item))}
                        />
                        <div className="bg-muted/30 flex h-24 items-center justify-center rounded-lg">
                          <UserRound
                            className="text-muted-foreground/60 size-11"
                            aria-hidden="true"
                          />
                        </div>
                        <span className="flex items-center justify-between gap-2 text-sm font-medium">
                          <span className="min-w-0 break-words">
                            {item.name}
                          </span>
                          {checked ? (
                            <Check
                              className="text-primary size-4 shrink-0"
                              aria-hidden="true"
                            />
                          ) : null}
                        </span>
                        <span className="text-muted-foreground text-xs">
                          {source === "local" ? "My Content" : "Included"}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
              {filtered.length > limit ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setLimit((value) => value + 12)}
                >
                  Show more Avatars
                </Button>
              ) : null}
            </TabsContent>
          ))}
        </Tabs>
        {file ? (
          <div className="mt-4 space-y-3 rounded-xl border p-4">
            <p className="text-sm break-all">
              Previewing {file.name} · {(file.size / 1024 / 1024).toFixed(1)}{" "}
              MiB
            </p>
            <label htmlFor="creation-vrm-name" className="text-sm font-medium">
              Save to My Content as
            </label>
            <Input
              id="creation-vrm-name"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setCollision(null);
              }}
              disabled={busy}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => void save()}
                disabled={busy || !name.trim()}
              >
                {busy ? "Saving Avatar…" : "Save Avatar to My Content"}
              </Button>
              <Button
                variant="outline"
                onClick={() => onFile(null)}
                disabled={busy}
              >
                Cancel upload
              </Button>
            </div>
          </div>
        ) : draft.needs_file_reselection ? (
          <div className="mt-4 space-y-2 rounded-xl border p-4 text-sm">
            <p>
              Your previous file was not saved. Choose it again with Upload VRM;
              browsers cannot restore local files after a reload.
            </p>
            <Button variant="outline" onClick={() => onFile(null)}>
              Discard unsaved upload
            </Button>
          </div>
        ) : null}
      </section>
      {error ? (
        <p role="alert" className="text-destructive text-sm break-words">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="text-muted-foreground text-sm">
          {notice}
        </p>
      ) : null}
      {collision ? (
        <Dialog open onOpenChange={(open) => !open && setCollision(null)}>
          <DialogContent>
            <DialogTitle>This Avatar name is already used</DialogTitle>
            <DialogDescription>
              Use a different name to keep both files. Replace changes the
              existing My Content item and requires its current revision. The
              server will refuse replacement if a live Anima uses it.
            </DialogDescription>
            <p className="text-sm break-words">
              {collision.name} · {collision.item_id}
            </p>
            <p className="text-muted-foreground font-mono text-xs break-all">
              {collision.revision_sha256}
            </p>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setCollision(null);
                  document.getElementById("creation-vrm-name")?.focus();
                }}
              >
                Choose new name
              </Button>
              <Button
                variant="destructive"
                disabled={busy}
                onClick={() => void save(collision)}
              >
                Replace this Avatar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
