import {
  BookOpenIcon,
  Code2Icon,
  ImagePlusIcon,
  LoaderCircleIcon,
  SaveIcon,
  UploadIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { Button } from "@/ui/components/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/ui/components/tooltip";

export type CreatorDocumentStatus = {
  label: string;
  tone?: "saved" | "dirty" | "warning" | "error";
  /** Actionable detail shown below a compact failure status. */
  tooltip?: ReactNode;
};

type CreatorToolbarProps = {
  typeLabel: string;
  typeIcon: ReactNode;
  documentName?: string;
  documentControl?: ReactNode;
  status: CreatorDocumentStatus;
  onNew: () => void;
  onImport: () => void;
  onJson: () => void;
  onLibrary: () => void;
  onSave: () => void;
  newDisabled?: boolean;
  importDisabled?: boolean;
  jsonDisabled?: boolean;
  libraryDisabled?: boolean;
  saveDisabled: boolean;
  saveBusy: boolean;
  saveLabel: string;
  libraryLabel?: string;
  domainActions?: ReactNode;
};

/** Common Effect-creator document actions and status presentation. */
export function CreatorToolbar({
  typeLabel,
  typeIcon,
  documentName,
  documentControl,
  status,
  onNew,
  onImport,
  onJson,
  onLibrary,
  onSave,
  newDisabled,
  importDisabled,
  jsonDisabled,
  libraryDisabled,
  saveDisabled,
  saveBusy,
  saveLabel,
  libraryLabel = "Library",
  domainActions,
}: CreatorToolbarProps) {
  return (
    <header className="pointer-events-none absolute inset-x-0 top-0 z-50 flex items-start justify-between gap-3 p-3 lg:p-4 lg:pl-[calc(var(--app-shell-sidebar-inset)+1rem)] lg:transition-[padding-left] lg:duration-150 lg:ease-in-out">
      <div className="pointer-events-auto flex flex-wrap gap-2">
        <CreatorToolbarButton active icon={typeIcon} label={typeLabel} />
        <CreatorToolbarButton
          icon={<ImagePlusIcon />}
          label="New"
          onClick={onNew}
          disabled={newDisabled}
        />
        <CreatorToolbarButton
          icon={<UploadIcon />}
          label="Import"
          onClick={onImport}
          disabled={importDisabled}
        />
        <CreatorToolbarButton
          icon={<Code2Icon />}
          label="JSON"
          onClick={onJson}
          disabled={jsonDisabled}
        />
      </div>

      <div className="bg-background/88 border-border/70 pointer-events-auto hidden h-12 min-w-[250px] items-center rounded-xl border px-4 py-2 text-center shadow-sm backdrop-blur-xl md:flex md:flex-col md:justify-center">
        {documentControl ?? (
          <div className="w-full truncate text-sm font-semibold">
            {documentName}
          </div>
        )}
        <CreatorToolbarStatus status={status} />
      </div>

      <div className="pointer-events-auto flex flex-wrap justify-end gap-2">
        {domainActions}
        <CreatorToolbarButton
          className="hidden sm:inline-flex"
          icon={<BookOpenIcon />}
          label={libraryLabel}
          onClick={onLibrary}
          disabled={libraryDisabled}
        />
        <Button
          type="button"
          className="h-11 rounded-xl px-4 shadow-sm"
          disabled={saveDisabled}
          onClick={onSave}
        >
          {saveBusy ? (
            <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" />
          ) : (
            <SaveIcon />
          )}
          {saveLabel}
        </Button>
      </div>
    </header>
  );
}

/** Compact creator status with optional keyboard- and hover-accessible detail. */
function CreatorToolbarStatus({ status }: { status: CreatorDocumentStatus }) {
  const content = (
    <span className="text-muted-foreground flex items-center justify-center gap-2 text-[11px]">
      <span
        className={cn(
          "size-2 rounded-full",
          status.tone === "saved" && "bg-emerald-500",
          (!status.tone || status.tone === "dirty") && "bg-sky-400",
          status.tone === "warning" && "bg-amber-500",
          status.tone === "error" && "bg-destructive",
        )}
      />
      {status.label}
    </span>
  );

  if (!status.tooltip) return content;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="focus-visible:ring-ring rounded-sm outline-none focus-visible:ring-2"
          aria-label={
            typeof status.tooltip === "string"
              ? `${status.label}: ${status.tooltip}`
              : status.label
          }
        >
          {content}
        </button>
      </TooltipTrigger>
      <TooltipContent
        side="bottom"
        sideOffset={8}
        className="max-w-sm text-left"
      >
        {status.tooltip}
      </TooltipContent>
    </Tooltip>
  );
}

function CreatorToolbarButton({
  icon,
  label,
  active,
  className,
  disabled,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  active?: boolean;
  className?: string;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      className={cn(
        "bg-background/88 h-11 rounded-xl shadow-sm backdrop-blur-xl [&_svg]:size-4",
        active &&
          "border-sky-300 bg-sky-100/80 text-sky-950 dark:bg-sky-950/60 dark:text-sky-100",
        className,
      )}
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
      <span className="hidden xl:inline">{label}</span>
    </Button>
  );
}
