"use client";

import { useLibrarySharingFlow } from "@/query/hooks/useLibrarySharingFlow";
import { LibrarySharingDialog } from "./LibrarySharingDialog";
import { LibraryBig, Menu } from "lucide-react";
import { useTranslation } from "react-i18next";

import { hostedExclusionReasons } from "@/app/runtime/route-admission";
import type { ContentLibrarySearch } from "@/lib/content/librarySearch";
import { useRuntimeCapabilities } from "@/query/hooks/useRuntimeCapabilities";
import { AppShellPage } from "@/ui/app/AppShellPage";
import { useOptionalAppShell } from "@/ui/app/AppShell";
import { cn } from "@/lib/utils";
import { Button } from "@/ui/components/button";
import {
  UNDERLINE_TAB_LIST_CLASS,
  underlineTabClassName,
} from "@/ui/components/tabs";
import { UnavailableAction } from "@/ui/components/unavailable-action";
import { LibraryChatUploads } from "@/ui/library/LibraryChatUploads";
import { LibraryContentInventory } from "@/ui/library/LibraryContentInventory";
import {
  useRuntimeFeatureEnabled,
  useRuntimeFeatureUnavailableReason,
} from "@/ui/app/RuntimeFeatureGate";
import { ContentHealth } from "@/ui/content-health/ContentHealth";

const SECTIONS = ["all", "avatars", "actions", "fx", "chat-uploads"] as const;
const ACTION_FILTERS = [
  "all",
  "gestures",
  "reactions",
  "poses",
  "idle-styles",
] as const;
const FX_FILTERS = ["all", "particle", "avatar", "scene", "sound"] as const;

/** Common product Library. Creation starts from the dedicated Create hub. */
export function LibraryPage({
  search,
  onSearchChange,
}: {
  search: ContentLibrarySearch;
  onSearchChange: (update: Partial<ContentLibrarySearch>) => void;
}) {
  const { t } = useTranslation(["library", "sidebar"]);
  const appShell = useOptionalAppShell();
  const sectionLabel = (section: (typeof SECTIONS)[number]) => {
    switch (section) {
      case "all":
        return t("page.sections.all");
      case "avatars":
        return t("page.sections.avatars");
      case "actions":
        return t("page.sections.actions");
      case "fx":
        return t("page.sections.fx");
      case "chat-uploads":
        return t("page.sections.chatUploads");
    }
  };
  const actionFilterLabel = (filter: (typeof ACTION_FILTERS)[number]) => {
    switch (filter) {
      case "all":
        return t("page.actionFilters.all");
      case "gestures":
        return t("page.actionFilters.gestures");
      case "reactions":
        return t("page.actionFilters.reactions");
      case "poses":
        return t("page.actionFilters.poses");
      case "idle-styles":
        return t("page.actionFilters.idleStyles");
    }
  };
  const fxFilterLabel = (filter: (typeof FX_FILTERS)[number]) => {
    switch (filter) {
      case "all":
        return t("page.fxFilters.all");
      case "particle":
        return t("page.fxFilters.particle");
      case "avatar":
        return t("page.fxFilters.avatar");
      case "scene":
        return t("page.fxFilters.scene");
      case "sound":
        return t("page.fxFilters.sound");
    }
  };
  const sharing = useLibrarySharingFlow();
  const uploadsEnabled = useRuntimeFeatureEnabled("chat_file_uploads");
  const uploadsUnavailable =
    useRuntimeFeatureUnavailableReason("chat_file_uploads");
  // Chat Uploads also manages document processing. Where uploads are withheld,
  // the section names a withheld processor too; a local runtime without the
  // document worker still offers uploads and never shows this reason.
  const documentsUnavailable =
    useRuntimeCapabilities().data?.user_file_processing?.enabled === false
      ? hostedExclusionReasons.document_processing
      : null;
  return (
    <AppShellPage contentClassName="gap-0">
      <header className="pb-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="md:hidden"
              aria-label={t("sidebar:open")}
              onClick={appShell?.openSidebar}
            >
              <Menu aria-hidden="true" />
            </Button>
            <div className="bg-primary/10 text-primary flex size-10 items-center justify-center rounded-xl">
              <LibraryBig className="size-5" />
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {t("page.title")}
            </h1>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <ContentHealth />
            <LibrarySharingDialog flow={sharing} />
          </div>
        </div>
      </header>
      <nav
        aria-label={t("page.sectionsLabel")}
        className={cn(
          "bg-background/95 sticky top-0 z-40 backdrop-blur-sm",
          UNDERLINE_TAB_LIST_CLASS,
        )}
      >
        {SECTIONS.filter(
          (value) =>
            value !== "chat-uploads" ||
            uploadsEnabled ||
            uploadsUnavailable !== null,
        ).map((value) =>
          value === "chat-uploads" && uploadsUnavailable ? (
            <UnavailableAction key={value} reason={uploadsUnavailable}>
              <button
                type="button"
                className={underlineTabClassName(search.section === value)}
              >
                {sectionLabel(value)}
              </button>
            </UnavailableAction>
          ) : (
            <button
              key={value}
              type="button"
              className={underlineTabClassName(search.section === value)}
              onClick={() => onSearchChange({ section: value })}
            >
              {sectionLabel(value)}
            </button>
          ),
        )}
      </nav>
      {search.section === "actions" ? (
        <div className="flex flex-wrap items-center gap-2 pt-4">
          {ACTION_FILTERS.map((value) => (
            <Button
              key={value}
              size="sm"
              variant={search.action === value ? "default" : "outline"}
              onClick={() => onSearchChange({ action: value })}
            >
              {actionFilterLabel(value)}
            </Button>
          ))}
        </div>
      ) : null}
      {search.section === "fx" ? (
        <div className="flex flex-wrap gap-2 pt-4">
          {FX_FILTERS.map((value) => (
            <Button
              key={value}
              size="sm"
              variant={search.fx === value ? "default" : "outline"}
              onClick={() => onSearchChange({ fx: value })}
            >
              {fxFilterLabel(value)}
            </Button>
          ))}
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
                {t("page.uploadsUnavailable.title")}
              </h2>
              <p className="text-muted-foreground">
                {[
                  uploadsUnavailable,
                  documentsUnavailable,
                  t("page.uploadsUnavailable.stillAvailable"),
                ]
                  .filter(Boolean)
                  .join(" ")}
              </p>
              <Button
                variant="outline"
                onClick={() => onSearchChange({ section: "all" })}
              >
                {t("page.uploadsUnavailable.back")}
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
