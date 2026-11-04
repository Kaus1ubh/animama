// Adapted from shadcn/ui (MIT): apps/v4/registry/new-york-v4/ui/popover.tsx.
// See licenses/third-party/adapted-code.md.

import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";

import { cn } from "@/lib/utils";
import { useOptionalAppShell } from "@/ui/app/AppShell";
import { resolveAppShellSidebarLayout } from "@/ui/app/appShellSidebarLayout";

function Popover({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

function PopoverTrigger({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

function PopoverContent({
  className,
  portalContainer,
  align = "center",
  sideOffset = 4,
  avoidSidebar = false,
  collisionPadding,
  style,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content> & {
  portalContainer?: HTMLElement | null;
  /** Keep creator load panels inside the usable viewport beside the sidebar. */
  avoidSidebar?: boolean;
}) {
  const appShell = useOptionalAppShell();
  // Portals do not inherit the creator surface's inset. Use viewport geometry,
  // including when an expanded sidebar already offsets the underlying canvas.
  const sidebarInset = Number.parseFloat(
    resolveAppShellSidebarLayout({
      behavior: "inset",
      isDesktop: appShell?.isDesktop === true,
      sidebarOpen: appShell?.sidebarOpen === true,
    })["--app-shell-sidebar-inset"],
  );
  const padding =
    typeof collisionPadding === "number"
      ? {
          top: collisionPadding,
          right: collisionPadding,
          bottom: collisionPadding,
          left: collisionPadding,
        }
      : { top: 8, right: 8, bottom: 8, left: 8, ...collisionPadding };

  return (
    <PopoverPrimitive.Portal container={portalContainer}>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        collisionPadding={
          avoidSidebar
            ? { ...padding, left: sidebarInset + padding.left }
            : collisionPadding
        }
        style={{
          ...style,
          ...(avoidSidebar
            ? { maxWidth: "var(--radix-popover-content-available-width)" }
            : {}),
        }}
        className={cn(
          "bg-popover text-popover-foreground data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 z-50 w-72 origin-(--radix-popover-content-transform-origin) rounded-md border p-4 shadow-md outline-hidden",
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

function PopoverAnchor({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />;
}

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor };
