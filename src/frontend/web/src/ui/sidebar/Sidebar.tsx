"use client";

import { cn } from "@/lib/utils";
import { useOptionalAppShell } from "@/ui/app/AppShell";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/ui/components/tooltip";
import { Link } from "@tanstack/react-router";
import React, { useCallback, useState, createContext, useContext } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useTranslation } from "react-i18next";

export interface SidebarLinkItem {
  label: string;
  href?: "#";
  to?:
    | "/$animaId"
    | "/animas"
    | "/animas/$animaId"
    | "/library"
    | "/create"
    | "/memories";
  params?: { animaId: string };
  icon: React.JSX.Element | React.ReactNode;
  onClick?: (event: React.MouseEvent<HTMLAnchorElement>) => void;
}

interface SidebarContextProps {
  open: boolean;
  setOpen: React.Dispatch<React.SetStateAction<boolean>>;
  animate: boolean;
}

const SidebarContext = createContext<SidebarContextProps | undefined>(
  undefined,
);

export const useSidebar = () => {
  const context = useContext(SidebarContext);
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider");
  }
  return context;
};

/**
 * Close the sidebar when it is the mobile drawer (below the `md` breakpoint),
 * which is drawn above dialogs; call it before opening a dialog from the
 * sidebar. The desktop sidebar is left as it is.
 */
export function useCloseMobileSidebar(): () => void {
  const { setOpen } = useSidebar();
  return useCallback(() => {
    if (!window.matchMedia("(min-width: 768px)").matches) setOpen(false);
  }, [setOpen]);
}

export const SidebarProvider = ({
  children,
  open: openProp,
  setOpen: setOpenProp,
  animate = true,
}: {
  children: React.ReactNode;
  open?: boolean;
  setOpen?: React.Dispatch<React.SetStateAction<boolean>>;
  animate?: boolean;
}) => {
  const [openState, setOpenState] = useState(false);

  const open = openProp !== undefined ? openProp : openState;
  const setOpen = setOpenProp !== undefined ? setOpenProp : setOpenState;

  return (
    <SidebarContext.Provider value={{ open, setOpen, animate }}>
      {children}
    </SidebarContext.Provider>
  );
};

export const Sidebar = ({
  children,
  open,
  setOpen,
  animate,
}: {
  children: React.ReactNode;
  open?: boolean;
  setOpen?: React.Dispatch<React.SetStateAction<boolean>>;
  animate?: boolean;
}) => {
  return (
    <SidebarProvider open={open} setOpen={setOpen} animate={animate}>
      {children}
    </SidebarProvider>
  );
};

export const SidebarBody = ({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) => {
  return (
    <ResponsiveSidebar className={className} {...props}>
      {children}
    </ResponsiveSidebar>
  );
};

export const ResponsiveSidebar = ({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) => {
  const { t } = useTranslation("sidebar");
  const { open, animate, setOpen } = useSidebar();
  const appShell = useOptionalAppShell();
  const isDesktop = appShell?.isDesktop ?? true;
  const transitionClass = animate
    ? "transition-transform duration-200 ease-in-out md:transition-[width] md:duration-150"
    : "transition-none";
  const desktopWidthClass = open ? "md:w-[242px]" : "md:w-[88px]";
  const translateClass = open
    ? "translate-x-0"
    : "-translate-x-full md:translate-x-0";
  const showBackdrop = open && !isDesktop;
  const shouldAnimateBackdrop = animate;
  return (
    <>
      {shouldAnimateBackdrop ? (
        <AnimatePresence>
          {showBackdrop ? (
            <motion.button
              type="button"
              aria-label={t("close")}
              className="fixed inset-0 z-[110] bg-black/40 md:hidden"
              onClick={() => setOpen(false)}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            />
          ) : null}
        </AnimatePresence>
      ) : showBackdrop ? (
        <button
          type="button"
          aria-label={t("close")}
          className="fixed inset-0 z-[110] bg-black/40 md:hidden"
          onClick={() => setOpen(false)}
        />
      ) : null}
      <div
        aria-hidden={!isDesktop && !open}
        inert={!isDesktop && !open}
        className={cn(
          "group/sidebar-shell short:py-2 fixed top-(--app-titlebar-height) bottom-0 left-0 z-[120] flex w-[242px] flex-shrink-0 flex-col overflow-hidden px-[6px] py-3 md:translate-x-0",
          open
            ? "bg-sidebar/70 ring-sidebar-border/70 supports-[backdrop-filter]:bg-sidebar/60 rounded-tr-3xl rounded-br-3xl shadow-lg ring-1 backdrop-blur-xs ring-inset"
            : "border-transparent bg-transparent shadow-none",
          transitionClass,
          desktopWidthClass,
          translateClass,
          className,
        )}
        {...props}
      >
        {children}
      </div>
    </>
  );
};

export const SidebarLink = ({
  link,
  className,
  showTooltip = true,
  animateLabel = true,
  ...props
}: {
  link: SidebarLinkItem;
  className?: string;
  /** Disable the collapsed label when a richer adjacent surface owns it. */
  showTooltip?: boolean;
  /** Render the expanded label without an opacity transition when false. */
  animateLabel?: boolean;
} & Omit<React.ComponentProps<"a">, "href">) => {
  const { open } = useSidebar();
  const classNames = cn(
    "group/sidebar flex items-center transition-colors",
    open
      ? "h-[44px] w-full justify-start gap-2 rounded-md px-2.5 pr-3 hover:bg-sidebar-accent/60"
      : "h-11 w-11 justify-center rounded-full border border-border/60 bg-background/60 p-0 text-foreground/80 shadow-sm backdrop-blur-md hover:bg-muted/70 hover:text-foreground short:h-9 short:w-9",
    className,
  );
  const labelClassName = cn(
    "text-sidebar-foreground dark:text-sidebar-foreground !m-0 !p-0 text-sm whitespace-pre transition duration-150 group-hover/sidebar:translate-x-1",
    open ? "inline-block" : "hidden",
  );
  const label = animateLabel ? (
    <motion.span
      animate={{
        opacity: open ? 1 : 0,
      }}
      className={labelClassName}
    >
      {link.label}
    </motion.span>
  ) : (
    <span className={labelClassName}>{link.label}</span>
  );
  const content = (
    <>
      {link.icon}
      {label}
    </>
  );
  const linkNode =
    link.to === "/$animaId" && link.params ? (
      <Link
        to="/$animaId"
        params={link.params}
        className={classNames}
        {...props}
      >
        {content}
      </Link>
    ) : link.to === "/animas" ? (
      <Link to="/animas" className={classNames} {...props}>
        {content}
      </Link>
    ) : link.to === "/animas/$animaId" && link.params ? (
      <Link
        to="/animas/$animaId"
        params={link.params}
        search={{ tab: "overview" }}
        className={classNames}
        {...props}
      >
        {content}
      </Link>
    ) : link.to === "/library" ? (
      <Link to="/library" search={{}} className={classNames} {...props}>
        {content}
      </Link>
    ) : link.to === "/create" ? (
      <Link to="/create" className={classNames} {...props}>
        {content}
      </Link>
    ) : link.to === "/memories" ? (
      <Link
        to="/memories"
        search={{ tab: "memory", mode: "manual" }}
        className={classNames}
        {...props}
      >
        {content}
      </Link>
    ) : (
      <a
        href={link.href ?? "#"}
        className={classNames}
        {...props}
        onClick={(event) => {
          if ((link.href ?? "#") === "#") {
            event.preventDefault();
          }
          link.onClick?.(event);
          props.onClick?.(event);
        }}
      >
        {content}
      </a>
    );

  if (open || !showTooltip) {
    return linkNode;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{linkNode}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>
        {link.label}
      </TooltipContent>
    </Tooltip>
  );
};
