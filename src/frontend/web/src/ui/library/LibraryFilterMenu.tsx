"use client";

import { ListFilter } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  LIBRARY_UPLOAD_STATUSES,
  type ContentLibrarySearch,
} from "@/lib/content/librarySearch";
import { libraryUploadStatusLabel } from "@/lib/uploads/libraryUploads";
import { Button } from "@/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/components/dropdown-menu";

type SearchUpdate = (update: Partial<ContentLibrarySearch>) => void;

/** One contextual filter/sort menu shared by every Library inventory. */
export function LibraryFilterMenu({
  search,
  onSearchChange,
}: {
  search: ContentLibrarySearch;
  onSearchChange: SearchUpdate;
}) {
  const { t } = useTranslation("library");
  const uploads = search.section === "chat-uploads";
  const gestures =
    search.section === "all" ||
    (search.section === "actions" &&
      (search.action === "all" || search.action === "gestures"));
  const gestureFiltersActive =
    gestures &&
    (search.gestureUpdatesOnly ||
      search.gestureStatus !== "all" ||
      search.gestureMotion !== "all" ||
      search.gestureSort !== "custom-first");
  const filtersActive = uploads
    ? search.uploadStatus !== "all"
    : !search.showStarters || search.sort !== "name" || gestureFiltersActive;

  const resetFilters = () => {
    if (uploads) {
      onSearchChange({ uploadStatus: "all" });
      return;
    }
    onSearchChange({
      showStarters: true,
      sort: "name",
      ...(gestures
        ? {
            gestureUpdatesOnly: false,
            gestureStatus: "all" as const,
            gestureMotion: "all" as const,
            gestureSort: "custom-first" as const,
          }
        : {}),
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          className="h-11"
          variant={filtersActive ? "secondary" : "outline"}
          aria-label={t("filters.label")}
        >
          <ListFilter />
          {t("filters.button")}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="max-h-[calc(100dvh-2rem)] min-w-60 overflow-y-auto overscroll-contain"
      >
        {uploads ? (
          <>
            <DropdownMenuLabel>{t("filters.uploadStatus")}</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={search.uploadStatus}
              onValueChange={(value) =>
                onSearchChange({
                  uploadStatus: value as ContentLibrarySearch["uploadStatus"],
                })
              }
            >
              {LIBRARY_UPLOAD_STATUSES.map((status) => (
                <DropdownMenuRadioItem
                  key={status}
                  value={status}
                  onSelect={(event) => event.preventDefault()}
                >
                  {status === "all"
                    ? t("filters.allStatuses")
                    : libraryUploadStatusLabel(status)}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </>
        ) : (
          <>
            <DropdownMenuLabel>{t("filters.show")}</DropdownMenuLabel>
            <DropdownMenuCheckboxItem
              checked={search.showStarters}
              onCheckedChange={(checked) =>
                onSearchChange({ showStarters: checked === true })
              }
              onSelect={(event) => event.preventDefault()}
            >
              {t("filters.showStarters")}
            </DropdownMenuCheckboxItem>

            <DropdownMenuSeparator />
            <DropdownMenuLabel>{t("filters.sortBy")}</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={search.sort}
              onValueChange={(value) =>
                onSearchChange({
                  sort: value as ContentLibrarySearch["sort"],
                })
              }
            >
              <DropdownMenuRadioItem
                value="name"
                onSelect={(event) => event.preventDefault()}
              >
                {t("filters.sort.name")}
              </DropdownMenuRadioItem>
              {!(search.section === "actions" && search.action === "poses") ? (
                <DropdownMenuRadioItem
                  value="updated"
                  onSelect={(event) => event.preventDefault()}
                >
                  {t("filters.sort.updated")}
                </DropdownMenuRadioItem>
              ) : null}
              <DropdownMenuRadioItem
                value="relevance"
                onSelect={(event) => event.preventDefault()}
              >
                {t("filters.sort.relevance")}
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>

            {gestures ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>{t("filters.gestures")}</DropdownMenuLabel>
                <DropdownMenuCheckboxItem
                  checked={search.gestureUpdatesOnly}
                  onCheckedChange={(checked) =>
                    onSearchChange({
                      gestureUpdatesOnly: checked === true,
                    })
                  }
                  onSelect={(event) => event.preventDefault()}
                >
                  {t("filters.updatesOnly")}
                </DropdownMenuCheckboxItem>

                <DropdownMenuSeparator />
                <DropdownMenuLabel>
                  {t("filters.gestureStatus")}
                </DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={search.gestureStatus}
                  onValueChange={(value) =>
                    onSearchChange({
                      gestureStatus:
                        value as ContentLibrarySearch["gestureStatus"],
                    })
                  }
                >
                  <DropdownMenuRadioItem
                    value="all"
                    onSelect={(event) => event.preventDefault()}
                  >
                    {t("filters.all")}
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem
                    value="equipped"
                    onSelect={(event) => event.preventDefault()}
                  >
                    {t("filters.status.equipped")}
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem
                    value="unequipped"
                    onSelect={(event) => event.preventDefault()}
                  >
                    {t("filters.status.unequipped")}
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>

                <DropdownMenuSeparator />
                <DropdownMenuLabel>{t("filters.motionType")}</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={search.gestureMotion}
                  onValueChange={(value) =>
                    onSearchChange({
                      gestureMotion:
                        value as ContentLibrarySearch["gestureMotion"],
                    })
                  }
                >
                  <DropdownMenuRadioItem
                    value="all"
                    onSelect={(event) => event.preventDefault()}
                  >
                    {t("filters.all")}
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem
                    value="vrma"
                    onSelect={(event) => event.preventDefault()}
                  >
                    {t("filters.motion.vrma")}
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem
                    value="anima_clip"
                    onSelect={(event) => event.preventDefault()}
                  >
                    {t("filters.motion.clips")}
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>

                <DropdownMenuSeparator />
                <DropdownMenuLabel>
                  {t("filters.gestureOrder")}
                </DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={search.gestureSort}
                  onValueChange={(value) =>
                    onSearchChange({
                      gestureSort: value as ContentLibrarySearch["gestureSort"],
                    })
                  }
                >
                  <DropdownMenuRadioItem
                    value="custom-first"
                    onSelect={(event) => event.preventDefault()}
                  >
                    {t("filters.order.customFirst")}
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem
                    value="name-asc"
                    onSelect={(event) => event.preventDefault()}
                  >
                    {t("filters.order.nameAscending")}
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem
                    value="name-desc"
                    onSelect={(event) => event.preventDefault()}
                  >
                    {t("filters.order.nameDescending")}
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </>
            ) : null}
          </>
        )}

        {filtersActive ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={resetFilters}>
              {t("filters.reset")}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
