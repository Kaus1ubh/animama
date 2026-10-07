import { EyeIcon, ListIcon, SlidersHorizontalIcon } from "lucide-react";
import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import { cn } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/components/tabs";
import {
  CreatorCollapsedPanelHeader,
  CreatorPanelCollapseButton,
} from "./CreatorPanelChrome";

const clampLayoutSize = (value: number, min: number, max: number) =>
  `${Math.min(max, Math.max(min, value))}px`;

type CreatorWorkspaceShellProps = {
  canvas: ReactNode;
  toolbar: ReactNode;
  leftPanel?: ReactNode;
  rightPanel?: ReactNode;
  leftPanelLabel?: string;
  rightPanelLabel?: string;
  canvasControls?: ReactNode;
  previewBar?: ReactNode;
  overlays?: ReactNode;
  leftPanelWidth?: number;
  rightPanelWidth?: number;
  bottomChromeHeight?: number;
  busy?: boolean;
  className?: string;
};

/** One canvas and one mounted copy of each tool across desktop and narrow layouts. */
export function CreatorWorkspaceShell({
  canvas,
  toolbar,
  leftPanel,
  rightPanel,
  leftPanelLabel = "Setup",
  rightPanelLabel = "Inspector",
  canvasControls,
  previewBar,
  overlays,
  leftPanelWidth = 330,
  rightPanelWidth = 360,
  bottomChromeHeight = 92,
  busy = false,
  className,
}: CreatorWorkspaceShellProps) {
  const [previewExpanded, setPreviewExpanded] = useState(true);
  const rootRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const canvasControlsRef = useRef<HTMLDivElement>(null);
  // The header can gain a second row as available width or document actions change.
  useLayoutEffect(() => {
    const toolbarElement = toolbarRef.current;
    if (!toolbarElement) return;
    const measure = () =>
      rootRef.current?.style.setProperty(
        "--creator-header-height",
        `${toolbarElement.getBoundingClientRect().height}px`,
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(toolbarElement);
    return () => observer.disconnect();
  }, []);
  // On desktop the floating canvas controls are wider than the stage between
  // the panels, so the panels end above them instead of running underneath.
  const hasCanvasControls = Boolean(canvasControls);
  useLayoutEffect(() => {
    const controls = canvasControlsRef.current;
    if (!controls) return;
    const measure = () =>
      rootRef.current?.style.setProperty(
        "--creator-canvas-controls-height",
        `${controls.getBoundingClientRect().height}px`,
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(controls);
    return () => observer.disconnect();
  }, [hasCanvasControls]);
  const style = {
    "--creator-left-panel-width": clampLayoutSize(leftPanelWidth, 280, 440),
    "--creator-right-panel-width": clampLayoutSize(rightPanelWidth, 300, 480),
    "--creator-bottom-chrome-height": previewBar
      ? previewExpanded
        ? clampLayoutSize(bottomChromeHeight, 72, 260)
        : "56px"
      : "0px",
  } as CSSProperties;
  return (
    <div
      ref={rootRef}
      className={cn(
        "bg-background text-foreground relative flex h-full min-h-0 flex-col overflow-hidden [--creator-canvas-controls-height:0px] [--creator-header-height:80px] [--creator-inset:1rem] xl:[--creator-inset:2rem]",
        className,
      )}
      style={style}
    >
      <div
        ref={toolbarRef}
        className="relative z-50 shrink-0 lg:absolute lg:inset-x-0 lg:top-0"
      >
        {toolbar}
      </div>
      <div className="contents" aria-busy={busy} inert={busy || undefined}>
        <div className="relative z-0 h-[38dvh] min-h-[230px] shrink-0 lg:absolute lg:inset-0 lg:h-full lg:min-h-0">
          {canvas}
        </div>
        <Tabs
          defaultValue={leftPanel ? "setup" : "inspector"}
          className="relative z-20 flex min-h-0 flex-1 flex-col lg:contents"
        >
          <TabsList
            aria-label="Authoring tools"
            className="bg-background h-auto w-full shrink-0 justify-start gap-1 overflow-x-auto rounded-none border-y p-2 sm:pl-16 lg:hidden"
          >
            {leftPanel ? (
              <TabsTrigger value="setup" className="h-10 gap-1.5 text-xs">
                <ListIcon className="size-4" />
                {leftPanelLabel}
              </TabsTrigger>
            ) : null}
            {rightPanel ? (
              <TabsTrigger value="inspector" className="h-10 gap-1.5 text-xs">
                <SlidersHorizontalIcon className="size-4" />
                {rightPanelLabel}
              </TabsTrigger>
            ) : null}
            {canvasControls || previewBar ? (
              <TabsTrigger value="preview" className="h-10 gap-1.5 text-xs">
                <EyeIcon className="size-4" />
                Preview
              </TabsTrigger>
            ) : null}
          </TabsList>
          {leftPanel ? (
            <TabsContent
              value="setup"
              forceMount
              className="m-0 min-h-0 flex-1 overflow-y-auto p-3 data-[state=inactive]:hidden sm:pl-16 lg:absolute lg:top-[var(--creator-header-height)] lg:bottom-[calc(var(--creator-bottom-chrome-height)+var(--creator-canvas-controls-height)+2.75rem)] lg:left-[calc(var(--app-shell-sidebar-inset)+var(--creator-inset))] lg:z-20 lg:flex lg:w-[min(var(--creator-left-panel-width),26vw)] lg:flex-col lg:overflow-visible lg:p-0 lg:data-[state=inactive]:flex"
            >
              {leftPanel}
            </TabsContent>
          ) : null}
          {rightPanel ? (
            <TabsContent
              value="inspector"
              forceMount
              className="m-0 min-h-0 flex-1 overflow-y-auto p-3 data-[state=inactive]:hidden sm:pl-16 lg:absolute lg:top-[var(--creator-header-height)] lg:right-[var(--creator-inset)] lg:bottom-[calc(var(--creator-bottom-chrome-height)+var(--creator-canvas-controls-height)+2.75rem)] lg:z-20 lg:flex lg:w-[min(var(--creator-right-panel-width),27vw)] lg:flex-col lg:overflow-visible lg:p-0 lg:data-[state=inactive]:flex"
            >
              {rightPanel}
            </TabsContent>
          ) : null}
          <TabsContent
            value="preview"
            forceMount
            className="m-0 min-h-0 flex-1 space-y-3 overflow-y-auto p-3 data-[state=inactive]:hidden sm:pl-16 lg:contents lg:data-[state=inactive]:contents"
          >
            {canvasControls ? (
              <div
                ref={canvasControlsRef}
                className="lg:absolute lg:right-1/2 lg:bottom-[calc(var(--creator-bottom-chrome-height)+2rem)] lg:z-30 lg:flex lg:w-max lg:max-w-[calc(100%-2rem)] lg:translate-x-1/2 lg:justify-center"
              >
                {canvasControls}
              </div>
            ) : null}
            {previewBar ? (
              <div className="relative lg:absolute lg:right-[var(--creator-inset)] lg:bottom-4 lg:left-[calc(var(--app-shell-sidebar-inset)+var(--creator-inset))] lg:z-40 lg:!mt-0 lg:h-[var(--creator-bottom-chrome-height)]">
                <div
                  className={cn(
                    "h-full [&>section]:lg:pr-12",
                    !previewExpanded && "lg:hidden",
                  )}
                >
                  {previewBar}
                </div>
                {previewExpanded ? (
                  <div className="absolute top-3 right-3 hidden lg:block">
                    <CreatorPanelCollapseButton
                      label="preview"
                      expanded
                      collapseDirection="down"
                      onExpandedChange={setPreviewExpanded}
                    />
                  </div>
                ) : (
                  <div className="hidden lg:block">
                    <CreatorCollapsedPanelHeader
                      label="Preview"
                      collapseDirection="down"
                      onExpand={() => setPreviewExpanded(true)}
                    />
                  </div>
                )}
              </div>
            ) : null}
          </TabsContent>
        </Tabs>
      </div>
      {overlays}
    </div>
  );
}
