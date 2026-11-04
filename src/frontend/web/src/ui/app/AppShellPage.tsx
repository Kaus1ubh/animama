import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { useOptionalAppShell } from "@/ui/app/AppShell";
import {
  resolveAppShellSidebarLayout,
  type AppShellSidebarBehavior,
} from "@/ui/app/appShellSidebarLayout";

type AppShellPageProps = {
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  backdrop?: ReactNode;
  sidebarBehavior?: AppShellSidebarBehavior;
};

export function AppShellPage({
  children,
  className,
  contentClassName,
  backdrop,
  sidebarBehavior = "inset",
}: AppShellPageProps) {
  const appShell = useOptionalAppShell();
  const pageStyle = resolveAppShellSidebarLayout({
    behavior: sidebarBehavior,
    isDesktop: appShell?.isDesktop === true,
    sidebarOpen: appShell?.sidebarOpen === true,
  });

  return (
    <div
      className={cn(
        "bg-background relative h-full overflow-y-auto transition-[margin-left,width] duration-150 ease-in-out",
        className,
      )}
      style={pageStyle}
    >
      {backdrop ? (
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          {backdrop}
        </div>
      ) : null}
      <div
        className={cn(
          "relative z-10 mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 md:px-6 lg:px-8",
          contentClassName,
        )}
      >
        {children}
      </div>
    </div>
  );
}
