"use client";

import { Menu } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";
import { useOptionalAppShell } from "@/ui/app/AppShell";
import { Button } from "@/ui/components/button";

/**
 * Opens the sidebar drawer on phone-width layouts, where the sidebar is off
 * screen; hidden from the `md` breakpoint, where the icon rail is visible.
 * Pages place it at the start of their own header.
 */
export function SidebarMenuButton({ className }: { className?: string }) {
  const { t } = useTranslation("sidebar");
  const appShell = useOptionalAppShell();
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn("shrink-0 md:hidden", className)}
      aria-label={t("open")}
      onClick={appShell?.openSidebar}
    >
      <Menu aria-hidden="true" />
    </Button>
  );
}
