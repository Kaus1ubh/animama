import type { CSSProperties, ReactNode } from "react";

import { cn } from "@/lib/utils";

const clampLayoutSize = (value: number, min: number, max: number) =>
  `${Math.min(max, Math.max(min, value))}px`;

type CreatorWorkspaceShellProps = {
  canvas: ReactNode;
  toolbar: ReactNode;
  leftPanel?: ReactNode;
  rightPanel?: ReactNode;
  canvasControls?: ReactNode;
  previewBar?: ReactNode;
  overlays?: ReactNode;
  leftPanelWidth?: number;
  rightPanelWidth?: number;
  bottomChromeHeight?: number;
  busy?: boolean;
  className?: string;
};

/**
 * One-Canvas creator hierarchy. The Canvas remains full bleed while desktop
 * chrome follows the translucent app-sidebar inset and phone content scrolls.
 */
export function CreatorWorkspaceShell({
  canvas,
  toolbar,
  leftPanel,
  rightPanel,
  canvasControls,
  previewBar,
  overlays,
  leftPanelWidth = 330,
  rightPanelWidth = 360,
  bottomChromeHeight = 92,
  busy = false,
  className,
}: CreatorWorkspaceShellProps) {
  const style = {
    "--creator-left-panel-width": clampLayoutSize(leftPanelWidth, 280, 440),
    "--creator-right-panel-width": clampLayoutSize(rightPanelWidth, 300, 480),
    "--creator-bottom-chrome-height": clampLayoutSize(
      bottomChromeHeight,
      72,
      260,
    ),
  } as CSSProperties;

  return (
    <div
      className={cn(
        "bg-background text-foreground relative h-full min-h-0 overflow-y-auto overscroll-contain lg:min-h-[640px] lg:overflow-hidden",
        className,
      )}
      style={style}
    >
      {toolbar}

      <div className="contents" aria-busy={busy} inert={busy || undefined}>
        <div className="absolute inset-0 z-0 h-[58vh] min-h-[430px] lg:h-full">
          {canvas}
        </div>

        <main className="relative z-20 mt-[58vh] flex min-h-0 flex-col gap-3 px-3 pb-[calc(var(--creator-bottom-chrome-height)+1.5rem)] lg:pointer-events-none lg:mt-0 lg:h-full lg:px-5 lg:pt-20">
          {leftPanel ? (
            <section className="pointer-events-auto min-h-0 lg:absolute lg:top-20 lg:bottom-[calc(var(--creator-bottom-chrome-height)+1.75rem)] lg:left-[calc(var(--app-shell-sidebar-inset)+1.25rem)] lg:flex lg:w-[var(--creator-left-panel-width)] lg:flex-col lg:overflow-visible lg:transition-[left] lg:duration-150 lg:ease-in-out xl:left-[calc(var(--app-shell-sidebar-inset)+2rem)]">
              {leftPanel}
            </section>
          ) : null}

          {rightPanel ? (
            <section className="pointer-events-auto min-h-0 lg:absolute lg:top-20 lg:right-5 lg:bottom-[calc(var(--creator-bottom-chrome-height)+1.75rem)] lg:flex lg:w-[var(--creator-right-panel-width)] lg:flex-col lg:overflow-visible xl:right-8">
              {rightPanel}
            </section>
          ) : null}
        </main>

        {canvasControls ? (
          <div className="pointer-events-auto absolute right-1/2 bottom-[calc(var(--creator-bottom-chrome-height)+1.75rem)] z-30 hidden max-w-[calc(100%-2rem)] translate-x-1/2 justify-center lg:flex">
            {canvasControls}
          </div>
        ) : null}

        {previewBar ? (
          <div className="pointer-events-auto absolute right-3 bottom-3 left-3 z-40 h-[var(--creator-bottom-chrome-height)] lg:right-5 lg:left-[calc(var(--app-shell-sidebar-inset)+1.25rem)] lg:transition-[left] lg:duration-150 lg:ease-in-out xl:right-8 xl:left-[calc(var(--app-shell-sidebar-inset)+2rem)]">
            {previewBar}
          </div>
        ) : null}
      </div>

      {overlays}
    </div>
  );
}
