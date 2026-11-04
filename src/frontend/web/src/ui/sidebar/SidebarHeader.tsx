import { Logo, LogoMark } from "@/ui/components/logo";
import { cn } from "@/lib/utils";
import { useSidebar } from "@/ui/sidebar/Sidebar";
import { PanelLeft, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/ui/components/tooltip";

type SidebarHeaderProps = {
  onSearch: () => void;
};

export const SidebarHeader = ({ onSearch }: SidebarHeaderProps) => {
  const { t } = useTranslation("sidebar");
  const { open, setOpen, animate } = useSidebar();
  const transition = animate
    ? "transition-opacity duration-150 ease-in-out motion-reduce:transition-none"
    : "transition-none";

  // Retain both layouts so opacity tracks the sidebar width without a delayed swap.
  // Inactive controls are inert as well as invisible during the crossfade.
  return (
    <div className="short:h-9 relative h-11 shrink-0">
      <div
        aria-hidden={!open}
        inert={!open}
        className={cn(
          "absolute top-0 left-0 flex h-11 w-[230px] items-center justify-between",
          transition,
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      >
        <Logo />
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={onSearch}
            className={cn(
              "inline-flex h-8 w-8 items-center justify-center rounded-md",
              "text-sidebar-foreground hover:bg-sidebar-accent/60 transition-colors",
            )}
            aria-label={t("search.open")}
            title={t("search.open")}
          >
            <Search className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className={cn(
              "inline-flex h-8 w-8 items-center justify-center rounded-md",
              "text-sidebar-foreground hover:bg-sidebar-accent/60 transition-colors",
            )}
            aria-label={t("close")}
            title={t("close")}
          >
            <PanelLeft className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div
        aria-hidden={open}
        inert={open}
        className={cn(
          "absolute top-0 left-0",
          transition,
          open ? "pointer-events-none opacity-0" : "opacity-100",
        )}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => setOpen(true)}
              className={cn(
                "border-border/60 bg-background/60 text-foreground/80 hover:text-foreground short:h-9 short:w-9 flex h-11 w-11 items-center justify-center rounded-full border shadow-sm backdrop-blur-md transition-colors",
              )}
              aria-label={t("open")}
            >
              <span className="items-center group-hover/sidebar-shell:hidden">
                <LogoMark className="size-7 translate-x-px -translate-y-px bg-transparent" />
              </span>
              <span className="hidden items-center group-hover/sidebar-shell:flex">
                <PanelLeft className="h-5 w-5" />
              </span>
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={8}>
            {t("open")}
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
};
