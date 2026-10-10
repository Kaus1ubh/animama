"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import {
  EllipsisVertical,
  ListFilter,
  Loader2,
  Play,
  Search,
} from "lucide-react";

import { useFormatters } from "@animama/product-ui/i18n";
import type { PyGestureBinding } from "@animama/runtime-contracts/api-types";
import type { PyGesture } from "@/lib/content/catalogTypes";
import {
  presentUnifiedGestureList,
  type CustomGestureCatalogPresentation,
  type GestureLoadoutPresentation,
  type UnifiedGestureListRow,
  type UnifiedGestureMotionFilter,
  type UnifiedGestureSort,
  type UnifiedGestureStatusFilter,
} from "@/lib/loadout/animaLoadoutPresentation";
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
import { Input } from "@/ui/components/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/ui/components/tooltip";
import { StarterBadge } from "@/ui/animas/StarterBadge";
import { LoadoutSectionDisclosure } from "@/ui/animas/LoadoutSectionDisclosure";
import {
  ActionLoadoutRow,
  ActionRowIdentity,
} from "@/ui/animas/ActionLoadoutRows";

const INITIAL_GESTURE_ROW_COUNT = 20;

const LIBRARY_GESTURES = {
  section: "actions" as const,
  action: "gestures" as const,
};

/** Compact row identity whose full description is disclosed only when clipped. */
function GestureIdentity({
  name,
  description,
  starter,
}: {
  name: string;
  description: string | null;
  starter: boolean;
}) {
  return (
    <ActionRowIdentity
      name={name}
      description={description}
      badge={starter ? <StarterBadge /> : null}
    />
  );
}

function GestureListRow({
  row,
  disabled,
  onPreview,
  onPreviewAvailable,
  onEquip,
  onRemove,
  onDisableStarter,
  onRestoreStarter,
}: {
  row: UnifiedGestureListRow;
  disabled: boolean;
  onPreview: (row: PyGestureBinding) => void;
  onPreviewAvailable: (gesture: PyGesture) => void;
  onEquip: (gesture: PyGesture) => void;
  onRemove: (row: PyGestureBinding) => void;
  onDisableStarter: (row: PyGestureBinding) => void;
  onRestoreStarter: (starterId: string) => void;
}) {
  const { t } = useTranslation("animas");
  const previewable = Boolean(row.binding ?? row.gesture);
  const hasOverflow = row.kind === "custom";
  const preview = () => {
    if (row.binding) onPreview(row.binding);
    else if (row.gesture) onPreviewAvailable(row.gesture);
  };
  const equip = () => {
    if (row.gesture) onEquip(row.gesture);
    else if (row.starterId) onRestoreStarter(row.starterId);
  };
  const unequip = () => {
    if (!row.binding) return;
    if (row.kind === "custom") onRemove(row.binding);
    else onDisableStarter(row.binding);
  };

  return (
    <ActionLoadoutRow role="listitem" selected={row.equipped}>
      <GestureIdentity
        name={row.name}
        description={row.description}
        starter={row.kind === "starter"}
      />

      {row.updateAvailable ? (
        <span className="text-primary shrink-0 text-xs">
          {t("gestures.updateAvailable")}
        </span>
      ) : null}

      {row.equipped ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="border-primary/40 bg-primary/8 text-primary h-8 shrink-0 rounded-lg text-xs"
          disabled={disabled}
          aria-pressed="true"
          onClick={unequip}
        >
          {t("actions.equipped")}
        </Button>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 shrink-0 rounded-lg text-xs"
          disabled={disabled}
          onClick={equip}
        >
          {t("actions.equip")}
        </Button>
      )}

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            size="icon-sm"
            variant="outline"
            aria-label={t("actions.previewNamed", { name: row.name })}
            disabled={!previewable}
            onClick={preview}
          >
            <Play />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={6}>
          {previewable ? t("actions.preview") : t("actions.previewUnavailable")}
        </TooltipContent>
      </Tooltip>

      {hasOverflow ? (
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label={t("actions.moreActionsFor", { name: row.name })}
                >
                  <EllipsisVertical />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={6}>
              {t("actions.moreActions")}
            </TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end">
            {row.kind === "custom" ? (
              <DropdownMenuItem asChild>
                <Link to="/library" search={LIBRARY_GESTURES}>
                  {row.updateAvailable
                    ? t("gestures.updateInLibrary")
                    : t("gestures.viewInLibrary")}
                </Link>
              </DropdownMenuItem>
            ) : null}
            {row.kind === "custom" && row.binding ? (
              <DropdownMenuItem
                disabled={disabled}
                className="text-destructive"
                onSelect={() => onRemove(row.binding!)}
              >
                {t("actions.remove")}
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <span
          className="text-muted-foreground inline-flex size-8 shrink-0 items-center justify-center"
          aria-hidden="true"
        >
          <EllipsisVertical className="size-4" />
        </span>
      )}
    </ActionLoadoutRow>
  );
}

/** Unified custom-first Gesture catalog with optional Starter visibility. */
export function GestureLoadoutSection({
  presentation,
  customCatalog,
  customCatalogLoading,
  customCatalogError,
  mutationsDisabled,
  onPreview,
  onPreviewAvailable,
  onEquip,
  onRemove,
  onDisableStarter,
  onRestoreStarter,
  onRetryCustomCatalog,
}: {
  presentation: GestureLoadoutPresentation;
  customCatalog: CustomGestureCatalogPresentation;
  customCatalogLoading: boolean;
  customCatalogError: boolean;
  mutationsDisabled: boolean;
  onPreview: (row: PyGestureBinding) => void;
  onPreviewAvailable: (gesture: PyGesture) => void;
  onEquip: (gesture: PyGesture) => void;
  onRemove: (row: PyGestureBinding) => void;
  onDisableStarter: (row: PyGestureBinding) => void;
  onRestoreStarter: (starterId: string) => void;
  onRetryCustomCatalog: () => void;
}) {
  const { t } = useTranslation("animas");
  const formatters = useFormatters();
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const [showStarters, setShowStarters] = useState(true);
  const [updatesOnly, setUpdatesOnly] = useState(false);
  const [statusFilter, setStatusFilter] =
    useState<UnifiedGestureStatusFilter>("all");
  const [motionType, setMotionType] =
    useState<UnifiedGestureMotionFilter>("all");
  const [sort, setSort] = useState<UnifiedGestureSort>("custom-first");
  const [showAllRows, setShowAllRows] = useState(false);
  const list = useMemo(
    () =>
      presentUnifiedGestureList({
        presentation,
        catalog: customCatalog,
        showStarters,
        updatesOnly,
        status: statusFilter,
        motionType,
        sort,
        query,
      }),
    [
      customCatalog,
      motionType,
      presentation,
      query,
      showStarters,
      sort,
      statusFilter,
      updatesOnly,
    ],
  );
  useEffect(() => {
    if (updatesOnly && list.updateAvailableCount === 0) {
      setUpdatesOnly(false);
    }
  }, [list.updateAvailableCount, updatesOnly]);
  useEffect(() => {
    setShowAllRows(false);
  }, [motionType, query, showStarters, sort, statusFilter, updatesOnly]);
  const visibleRows = showAllRows
    ? list.rows
    : list.rows.slice(0, INITIAL_GESTURE_ROW_COUNT);
  const hasMoreRows = visibleRows.length < list.rows.length;
  const hasNonDefaultView =
    !showStarters ||
    updatesOnly ||
    statusFilter !== "all" ||
    motionType !== "all" ||
    sort !== "custom-first";

  return (
    <LoadoutSectionDisclosure
      title={t("gestures.title")}
      headingId="gesture-loadout-heading"
      contentId="gesture-loadout-content"
      expanded={expanded}
      onToggle={() => setExpanded((current) => !current)}
      sticky
      actions={
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  size="icon-sm"
                  variant={hasNonDefaultView ? "secondary" : "outline"}
                  aria-label={t("gestures.filter")}
                >
                  <ListFilter />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={6}>
              {t("gestures.filter")}
            </TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end" className="min-w-60">
            <DropdownMenuLabel>{t("gestures.show")}</DropdownMenuLabel>
            <DropdownMenuCheckboxItem
              checked={showStarters}
              onCheckedChange={(checked) => setShowStarters(checked === true)}
              onSelect={(event) => event.preventDefault()}
            >
              {t("gestures.showStarters")}
              <span className="text-muted-foreground ml-auto text-xs">
                {formatters.number(list.starterCount)}
              </span>
            </DropdownMenuCheckboxItem>
            {list.updateAvailableCount ? (
              <DropdownMenuCheckboxItem
                checked={updatesOnly}
                onCheckedChange={(checked) => setUpdatesOnly(checked === true)}
                onSelect={(event) => event.preventDefault()}
              >
                {t("gestures.updatesOnly")}
                <span className="text-muted-foreground ml-auto text-xs">
                  {formatters.number(list.updateAvailableCount)}
                </span>
              </DropdownMenuCheckboxItem>
            ) : null}

            <DropdownMenuSeparator />
            <DropdownMenuLabel>{t("gestures.status")}</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={statusFilter}
              onValueChange={(value) =>
                setStatusFilter(value as UnifiedGestureStatusFilter)
              }
            >
              <DropdownMenuRadioItem
                value="all"
                onSelect={(event) => event.preventDefault()}
              >
                {t("gestures.all")}
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem
                value="equipped"
                onSelect={(event) => event.preventDefault()}
              >
                {t("actions.equipped")}
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem
                value="unequipped"
                onSelect={(event) => event.preventDefault()}
              >
                {t("gestures.unequipped")}
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>

            <DropdownMenuSeparator />
            <DropdownMenuLabel>{t("gestures.motionType")}</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={motionType}
              onValueChange={(value) =>
                setMotionType(value as UnifiedGestureMotionFilter)
              }
            >
              <DropdownMenuRadioItem
                value="all"
                onSelect={(event) => event.preventDefault()}
              >
                {t("gestures.all")}
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem
                value="vrma"
                onSelect={(event) => event.preventDefault()}
              >
                {t("gestures.vrma")}
                <span className="text-muted-foreground ml-auto text-xs">
                  {formatters.number(list.motionTypeCounts.vrma)}
                </span>
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem
                value="anima_clip"
                onSelect={(event) => event.preventDefault()}
              >
                {t("gestures.clips")}
                <span className="text-muted-foreground ml-auto text-xs">
                  {formatters.number(list.motionTypeCounts.anima_clip)}
                </span>
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>

            <DropdownMenuSeparator />
            <DropdownMenuLabel>{t("gestures.sortBy")}</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={sort}
              onValueChange={(value) => setSort(value as UnifiedGestureSort)}
            >
              <DropdownMenuRadioItem
                value="custom-first"
                onSelect={(event) => event.preventDefault()}
              >
                {t("gestures.customFirst")}
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem
                value="name-asc"
                onSelect={(event) => event.preventDefault()}
              >
                {t("gestures.nameAsc")}
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem
                value="name-desc"
                onSelect={(event) => event.preventDefault()}
              >
                {t("gestures.nameDesc")}
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      }
    >
      <div className="space-y-4">
        <div className="relative">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            type="search"
            aria-label={t("gestures.search")}
            placeholder={t("gestures.search")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="pl-9"
          />
        </div>

        <div className="overflow-hidden rounded-xl border">
          <div
            role="list"
            aria-label={t("gestures.listLabel")}
            className="divide-y"
          >
            {visibleRows.map((row) => (
              <GestureListRow
                key={row.id}
                row={row}
                disabled={mutationsDisabled}
                onPreview={onPreview}
                onPreviewAvailable={onPreviewAvailable}
                onEquip={onEquip}
                onRemove={onRemove}
                onDisableStarter={onDisableStarter}
                onRestoreStarter={onRestoreStarter}
              />
            ))}
            {hasMoreRows ? (
              <div role="listitem">
                <button
                  type="button"
                  className="text-primary hover:bg-muted/30 focus-visible:ring-ring flex w-full items-center justify-center px-4 py-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-inset"
                  onClick={() => setShowAllRows(true)}
                >
                  {t("gestures.showMore")}
                </button>
              </div>
            ) : null}
            {customCatalogLoading ? (
              <p className="text-muted-foreground flex items-center justify-center gap-2 px-4 py-5 text-sm">
                <Loader2 className="size-4 animate-spin" />{" "}
                {t("gestures.loadingCustom")}
              </p>
            ) : null}
            {customCatalogError ? (
              <div className="flex items-center justify-between gap-3 px-4 py-4 text-sm">
                <p className="text-destructive">{t("gestures.customFailed")}</p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onRetryCustomCatalog}
                >
                  {t("actions.retry")}
                </Button>
              </div>
            ) : null}
            {!customCatalogLoading &&
            !customCatalogError &&
            !list.rows.length ? (
              <p className="text-muted-foreground px-4 py-8 text-center text-sm">
                {query.trim()
                  ? t("gestures.noSearchMatch")
                  : statusFilter !== "all" ||
                      motionType !== "all" ||
                      updatesOnly
                    ? t("gestures.noFilterMatch")
                    : t("gestures.noCustom")}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </LoadoutSectionDisclosure>
  );
}
