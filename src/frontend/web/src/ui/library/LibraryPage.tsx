"use client";

import { useLibrarySharingFlow } from "@/query/hooks/useLibrarySharingFlow";
import { LibrarySharingDialog } from "./LibrarySharingDialog";
import { LibraryBig } from "lucide-react";

import type { ContentLibrarySearch } from "@/lib/content/librarySearch";
import { AppShellPage } from "@/ui/app/AppShellPage";
import { cn } from "@/lib/utils";
import { Button } from "@/ui/components/button";
import {
  UNDERLINE_TAB_LIST_CLASS,
  underlineTabClassName,
} from "@/ui/components/tabs";
import { LibraryChatUploads } from "@/ui/library/LibraryChatUploads";
import { LibraryContentInventory } from "@/ui/library/LibraryContentInventory";
import { useRuntimeFeatureEnabled } from "@/ui/app/RuntimeFeatureGate";
import { ContentHealth } from "@/ui/content-health/ContentHealth";

const SECTIONS = [
  ["all", "All"],
  ["avatars", "Avatars"],
  ["actions", "Actions"],
  ["fx", "FX"],
  ["chat-uploads", "Chat Uploads"],
] as const;

/** Common product Library. Creation starts from the dedicated Create hub. */
export function LibraryPage({
  search,
  onSearchChange,
}: {
  search: ContentLibrarySearch;
  onSearchChange: (update: Partial<ContentLibrarySearch>) => void;
}) {
  const sharing = useLibrarySharingFlow();
  const uploadsEnabled = useRuntimeFeatureEnabled("chat_file_uploads");
  return (
    <AppShellPage contentClassName="gap-0">
      <header className="pb-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-3">
            <div className="bg-primary/10 text-primary flex size-10 items-center justify-center rounded-xl">
              <LibraryBig className="size-5" />
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">Library</h1>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <ContentHealth />
            <LibrarySharingDialog flow={sharing} />
          </div>
        </div>
      </header>
      <nav
        aria-label="Library sections"
        className={cn(
          "bg-background/95 sticky top-0 z-40 backdrop-blur-sm",
          UNDERLINE_TAB_LIST_CLASS,
        )}
      >
        {SECTIONS.filter(
          ([value]) => value !== "chat-uploads" || uploadsEnabled,
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={underlineTabClassName(search.section === value)}
            onClick={() => onSearchChange({ section: value })}
          >
            {label}
          </button>
        ))}
      </nav>
      {search.section === "actions" ? (
        <div className="flex flex-wrap items-center gap-2 pt-4">
          {(
            ["all", "gestures", "reactions", "poses", "idle-styles"] as const
          ).map((value) => (
            <Button
              key={value}
              size="sm"
              variant={search.action === value ? "default" : "outline"}
              onClick={() => onSearchChange({ action: value })}
            >
              {value === "all"
                ? "All"
                : value === "idle-styles"
                  ? "Idle Styles"
                  : value[0].toUpperCase() + value.slice(1)}
            </Button>
          ))}
        </div>
      ) : null}
      {search.section === "fx" ? (
        <div className="flex flex-wrap gap-2 pt-4">
          {(["all", "particle", "avatar", "scene", "sound"] as const).map(
            (value) => (
              <Button
                key={value}
                size="sm"
                variant={search.fx === value ? "default" : "outline"}
                onClick={() => onSearchChange({ fx: value })}
              >
                {value === "all"
                  ? "All"
                  : `${value[0].toUpperCase()}${value.slice(1)}${value === "sound" ? "" : " FX"}`}
              </Button>
            ),
          )}
        </div>
      ) : null}
      <div className="pt-5">
        {search.section === "chat-uploads" ? (
          uploadsEnabled ? (
            <LibraryChatUploads
              search={search}
              onSearchChange={onSearchChange}
            />
          ) : (
            <section
              className="space-y-3"
              aria-labelledby="library-uploads-unavailable"
            >
              <h2
                id="library-uploads-unavailable"
                className="text-lg font-semibold"
              >
                Chat Uploads unavailable
              </h2>
              <p className="text-muted-foreground">
                Chat attachments and document uploads are unavailable here. You
                can still import, create and share Library content.
              </p>
              <Button
                variant="outline"
                onClick={() => onSearchChange({ section: "all" })}
              >
                Back to Library
              </Button>
            </section>
          )
        ) : (
          <LibraryContentInventory
            search={search}
            onSearchChange={onSearchChange}
          />
        )}
      </div>
    </AppShellPage>
  );
}
