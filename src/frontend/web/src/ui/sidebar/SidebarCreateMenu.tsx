"use client";

import { Link, useLocation } from "@tanstack/react-router";
import {
  ChevronRight,
  Hand,
  HeartPulse,
  Sparkles,
  UsersRound,
  WandSparkles,
} from "lucide-react";
import { motion, useReducedMotion, type Variants } from "motion/react";
import { useEffect, useId, useRef, useState } from "react";

import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/ui/components/popover";
import { useRuntimeFeatureEnabled } from "@/ui/app/RuntimeFeatureGate";
import { EffectTemplatePickerDialog } from "@/ui/create/EffectTemplatePickerDialog";
import {
  SidebarLink,
  useCloseMobileSidebar,
  type SidebarLinkItem,
} from "@/ui/sidebar/Sidebar";

const CLOSE_DELAY_MS = 140;

const MENU_VARIANTS: Variants = {
  closed: {
    transition: { staggerChildren: 0.025, staggerDirection: -1 },
  },
  open: {
    transition: { delayChildren: 0.02, staggerChildren: 0.045 },
  },
};

const CARD_VARIANTS: Variants = {
  closed: { opacity: 0, scale: 0.94, x: -12 },
  open: {
    opacity: 1,
    scale: 1,
    x: 0,
    transition: { type: "spring", stiffness: 520, damping: 32, mass: 0.7 },
  },
};

const PRIMARY_CREATE_LINKS = [
  {
    label: "Anima",
    to: "/animas/new" as const,
    icon: UsersRound,
    iconClassName: "bg-primary text-primary-foreground",
  },
  {
    label: "Gesture",
    to: "/gestures/new" as const,
    icon: Hand,
    iconClassName: "bg-secondary text-secondary-foreground",
  },
  {
    label: "Reaction",
    to: "/reactions/new" as const,
    icon: HeartPulse,
    iconClassName: "bg-secondary text-secondary-foreground",
  },
] as const;

const MENU_ITEM_CLASS_NAME =
  "group/create-item border-border/60 bg-popover/95 hover:bg-muted focus-visible:bg-muted focus-visible:ring-ring flex items-center gap-2.5 rounded-lg border px-2 py-1.5 text-sm font-medium shadow-md backdrop-blur-md transition-[background-color,box-shadow,transform] outline-none hover:translate-x-0.5 hover:shadow-lg focus-visible:ring-2";

/**
 * Hover, click, and keyboard-accessible creation destinations. **Effects**
 * opens the Effects template picker in place; closing it leaves the user on
 * the current page.
 */
export function SidebarCreateMenu() {
  const [open, setOpen] = useState(false);
  const [effectsPickerOpen, setEffectsPickerOpen] = useState(false);
  const pathname = useLocation({ select: (location) => location.pathname });
  const reduceMotion = useReducedMotion();
  const contentId = useId();
  const closeTimerRef = useRef<number | null>(null);
  const triggerRef = useRef<HTMLAnchorElement>(null);
  /** Focus returned from the picker must not reopen the hover menu. */
  const suppressFocusOpenRef = useRef(false);
  const closeMobileSidebar = useCloseMobileSidebar();
  const animaCreation = useRuntimeFeatureEnabled("anima_creation");
  const primaryLinks = PRIMARY_CREATE_LINKS.filter(
    (item) => animaCreation || item.to !== "/animas/new",
  );
  const trigger: SidebarLinkItem = {
    label: "Create",
    to: "/create",
    icon: (
      <Sparkles className="text-sidebar-foreground dark:text-sidebar-foreground h-6 w-6 flex-shrink-0" />
    ),
  };

  const cancelClose = () => {
    if (closeTimerRef.current === null) return;
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  };

  const openMenu = () => {
    cancelClose();
    setOpen(true);
  };

  const scheduleClose = () => {
    cancelClose();
    closeTimerRef.current = window.setTimeout(() => {
      setOpen(false);
      closeTimerRef.current = null;
    }, CLOSE_DELAY_MS);
  };

  const closeMenu = () => {
    cancelClose();
    setOpen(false);
  };

  useEffect(
    () => () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
      }
    },
    [],
  );

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverAnchor asChild>
          <div onMouseEnter={openMenu} onMouseLeave={scheduleClose}>
            <SidebarLink
              link={trigger}
              className={
                pathname === "/create" || pathname === "/effects/new"
                  ? "bg-accent/70 text-accent-foreground hover:bg-accent/80"
                  : undefined
              }
              showTooltip={false}
              animateLabel={false}
              aria-label="Create"
              aria-haspopup="menu"
              aria-expanded={open}
              aria-controls={open ? contentId : undefined}
              onClick={closeMenu}
              ref={triggerRef}
              onFocus={() => {
                if (suppressFocusOpenRef.current) {
                  suppressFocusOpenRef.current = false;
                  return;
                }
                openMenu();
              }}
              onBlur={scheduleClose}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  cancelClose();
                  closeMenu();
                }
              }}
            />
          </div>
        </PopoverAnchor>
        <PopoverContent
          id={contentId}
          role="menu"
          aria-label="Create"
          side="right"
          align="start"
          sideOffset={4}
          collisionPadding={12}
          className="z-[130] w-44 border-0 bg-transparent p-0 shadow-none"
          onOpenAutoFocus={(event) => event.preventDefault()}
          onMouseEnter={openMenu}
          onMouseLeave={scheduleClose}
          onFocusCapture={openMenu}
          onBlurCapture={scheduleClose}
          onEscapeKeyDown={() => {
            cancelClose();
            closeMenu();
          }}
        >
          <motion.div
            className="space-y-1"
            initial={reduceMotion ? false : "closed"}
            animate={reduceMotion ? undefined : open ? "open" : "closed"}
            variants={MENU_VARIANTS}
          >
            {primaryLinks.map((item) => {
              const Icon = item.icon;
              return (
                <motion.div key={item.to} variants={CARD_VARIANTS}>
                  <Link
                    to={item.to}
                    role="menuitem"
                    activeOptions={{ exact: true }}
                    activeProps={{
                      className: "bg-muted/80 text-foreground",
                    }}
                    className={MENU_ITEM_CLASS_NAME}
                    onClick={closeMenu}
                  >
                    <span
                      className={`${item.iconClassName} flex size-7 shrink-0 items-center justify-center rounded-md shadow-sm ring-1 ring-black/5 transition-transform group-hover/create-item:scale-105`}
                    >
                      <Icon className="size-3.5" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1 whitespace-nowrap">
                      {item.label}
                    </span>
                    <ChevronRight
                      className="text-muted-foreground size-4 shrink-0 -translate-x-1 opacity-0 transition-all group-hover/create-item:translate-x-0 group-hover/create-item:opacity-100 group-focus-visible/create-item:translate-x-0 group-focus-visible/create-item:opacity-100 group-data-[status=active]/create-item:translate-x-0 group-data-[status=active]/create-item:opacity-100"
                      aria-hidden="true"
                    />
                  </Link>
                </motion.div>
              );
            })}
            <motion.div variants={CARD_VARIANTS}>
              <button
                type="button"
                role="menuitem"
                aria-haspopup="dialog"
                className={`${MENU_ITEM_CLASS_NAME} w-full`}
                onClick={() => {
                  closeMenu();
                  // The picker opens in place, so the mobile drawer must not
                  // stay drawn over it.
                  closeMobileSidebar();
                  setEffectsPickerOpen(true);
                }}
              >
                <span className="bg-accent text-accent-foreground flex size-7 shrink-0 items-center justify-center rounded-md shadow-sm ring-1 ring-black/5 transition-transform group-hover/create-item:scale-105">
                  <WandSparkles className="size-3.5" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1 text-left whitespace-nowrap">
                  Effects
                </span>
                <ChevronRight
                  className="text-muted-foreground size-4 shrink-0 -translate-x-1 opacity-0 transition-all group-hover/create-item:translate-x-0 group-hover/create-item:opacity-100 group-focus-visible/create-item:translate-x-0 group-focus-visible/create-item:opacity-100"
                  aria-hidden="true"
                />
              </button>
            </motion.div>
          </motion.div>
        </PopoverContent>
      </Popover>
      <EffectTemplatePickerDialog
        open={effectsPickerOpen}
        onOpenChange={setEffectsPickerOpen}
        onChoose={() => setEffectsPickerOpen(false)}
        // The Effects item unmounts with the menu; return to the Create trigger.
        returnFocus={() => {
          const trigger = triggerRef.current;
          if (trigger?.isConnected) suppressFocusOpenRef.current = true;
          return trigger;
        }}
      />
    </>
  );
}
