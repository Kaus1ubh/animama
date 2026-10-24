import type { ReactNode } from "react";

import { SidebarMenuButton } from "@/ui/sidebar/SidebarMenuButton";

export function CreateAnimaWorkspace({
  panel,
  namePlate,
  stage,
}: {
  panel: ReactNode;
  namePlate: ReactNode;
  stage: ReactNode;
}) {
  return (
    <div
      data-testid="create-anima-workspace"
      className="grid min-h-full min-w-0 grid-cols-1 bg-transparent pl-[var(--app-shell-sidebar-inset)] lg:h-full lg:min-h-[620px] lg:grid-cols-[calc(clamp(380px,40vw,620px)+var(--app-shell-sidebar-inset))_minmax(0,1fr)] lg:overflow-hidden lg:pl-0"
    >
      <aside className="relative z-20 order-2 min-w-0 bg-transparent p-0 lg:order-1 lg:my-4 lg:mr-0 lg:ml-[calc(var(--app-shell-sidebar-inset)+1rem)] lg:min-h-0 lg:transition-[margin-left] lg:duration-150 lg:ease-in-out">
        <div className="bg-card flex min-h-full min-w-0 flex-col border-t shadow-xl lg:h-full lg:min-h-0 lg:overflow-hidden lg:rounded-2xl lg:border">
          {panel}
        </div>
      </aside>
      <div className="relative order-1 min-h-[390px] min-w-0 overflow-hidden bg-transparent lg:order-2 lg:min-h-0">
        <SidebarMenuButton className="bg-background/80 absolute top-6 left-2 z-30 backdrop-blur-sm" />
        <div className="absolute inset-x-0 top-4 z-20 flex justify-center px-12 md:px-4">
          {namePlate}
        </div>
        {stage}
      </div>
    </div>
  );
}
