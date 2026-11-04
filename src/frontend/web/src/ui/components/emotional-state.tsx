import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { useFormatters } from "@animama/product-ui/i18n";
import { type EmotionGroup, type TrackedEmotion } from "@/lib/emotion";
import {
  buildEmotionPresentation,
  formatEmotionAverage,
} from "@/lib/emotion/presentation";
import { cn } from "@/lib/utils";
import { EmotionMascot } from "@/ui/components/emotion-mascot";
import {
  MoodBloom,
  type MoodBloomSelectionInput,
} from "@/ui/components/mood-bloom";

type EmotionalStateProps = {
  emotionalState?: unknown;
  className?: string;
  variant?: "default" | "compact" | "showcase" | "inline";
  sourceLabel?: string | null;
};

type EmotionSelection = {
  group: EmotionGroup;
  input: MoodBloomSelectionInput;
  emotion: TrackedEmotion | null;
} | null;

/** Plain-language mood summary shared by the Anima header and detail surfaces. */
export function EmotionSummary({
  emotionalState,
  className,
  headerAction,
}: {
  emotionalState?: unknown;
  className?: string;
  headerAction?: ReactNode;
}) {
  const { t } = useTranslation("emotion");
  const presentation = buildEmotionPresentation(emotionalState, t);
  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 font-medium">
          <span
            aria-hidden="true"
            className="flex size-9 shrink-0 items-center justify-center rounded-full"
          >
            <EmotionMascot
              src={presentation.feeling.mascot}
              className="size-9"
            />
          </span>
          {presentation.feeling.label}
        </p>
        {headerAction}
      </div>
      {presentation.topGroups.length ? (
        <div className="space-y-2.5">
          {presentation.topGroups.map((group) => (
            <div
              key={group.group}
              className="grid grid-cols-[6rem_minmax(0,1fr)] items-center gap-3 text-sm"
            >
              <span className="text-muted-foreground">{group.label}</span>
              <span
                aria-hidden="true"
                className="bg-muted/60 h-1.5 overflow-hidden rounded-full"
              >
                <span
                  className="block h-full rounded-full"
                  style={{
                    backgroundColor: group.color,
                    width: `${(group.average / 30) * 100}%`,
                  }}
                />
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** The mood bloom with interaction details reserved outside the plot. */
export function EmotionDetails({
  emotionalState,
  className,
  showSummary = true,
}: Omit<EmotionalStateProps, "variant"> & { showSummary?: boolean }) {
  const { t } = useTranslation("emotion");
  const formatters = useFormatters();
  // `t` changes with the UI Locale, so a language switch rebuilds the labels.
  const presentation = useMemo(
    () => buildEmotionPresentation(emotionalState, t),
    [emotionalState, t],
  );
  const [selection, setSelection] = useState<EmotionSelection>(null);
  const select = useCallback(
    (
      group: EmotionGroup,
      input: MoodBloomSelectionInput,
      emotion: TrackedEmotion | null,
    ) =>
      // The bloom reports every pointer move; keep the same state unless
      // the group, input or petal actually changed.
      setSelection((current) =>
        current?.group === group &&
        current.input === input &&
        current.emotion === emotion
          ? current
          : { group, input, emotion },
      ),
    [],
  );
  const clearFocus = useCallback(() => setSelection(null), []);
  const clearPointer = useCallback(
    () =>
      setSelection((current) =>
        current?.input === "pointer" ? null : current,
      ),
    [],
  );
  const interactionRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selection?.input !== "touch") return;
    const clearOutside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !interactionRef.current?.contains(event.target)
      )
        setSelection(null);
    };
    document.addEventListener("pointerdown", clearOutside);
    return () => document.removeEventListener("pointerdown", clearOutside);
  }, [selection?.input]);
  const detailId = useId();
  const selected = presentation.groups.find(
    (group) => group.group === selection?.group,
  );
  return (
    <section
      className={cn("space-y-3", className)}
      aria-label={t("details.label")}
    >
      {showSummary ? <EmotionSummary emotionalState={emotionalState} /> : null}
      <div
        ref={interactionRef}
        onPointerLeave={(event) => {
          if (event.pointerType !== "touch")
            setSelection((current) =>
              current?.input === "keyboard" ? current : null,
            );
        }}
      >
        <MoodBloom
          emotionalState={emotionalState}
          selection={{
            group: selection?.group ?? null,
            emotion: selection?.emotion ?? null,
            onSelect: select,
            onBlur: clearFocus,
            onClearPointer: clearPointer,
            describedBy: detailId,
          }}
          className="emotion-bloom h-80"
        />
        {/* A reserved caption never overlaps the bloom or shifts it on hover. */}
        <div
          id={detailId}
          className="min-h-14 px-1 pb-1 text-sm"
          aria-live="polite"
        >
          {selected ? (
            <>
              <p className="mb-2 flex items-center gap-2 font-medium">
                <span
                  aria-hidden="true"
                  className="size-2 rounded-full"
                  style={{ backgroundColor: selected.color }}
                />
                {selected.label}{" "}
                <span className="text-muted-foreground tabular-nums">
                  {formatEmotionAverage(selected.maximum, formatters)}
                </span>
              </p>
              <dl className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
                {selected.emotions.map((emotion) => (
                  <div
                    key={emotion.emotion}
                    data-pointed={
                      emotion.emotion === selection?.emotion
                        ? "true"
                        : undefined
                    }
                    className="data-[pointed=true]:text-foreground flex gap-1.5 data-[pointed=true]:font-medium"
                  >
                    <dt>{emotion.label}</dt>
                    <dd className="tabular-nums">
                      {formatters.number(emotion.value)}
                    </dd>
                  </div>
                ))}
              </dl>
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}

/** Retain the existing consumer API while keeping summaries free of chart diagnostics. */
export function EmotionalState({
  emotionalState,
  className,
  variant = "default",
  sourceLabel = null,
}: EmotionalStateProps) {
  return (
    <EmotionDetails
      emotionalState={emotionalState}
      className={cn(
        (variant === "compact" || variant === "showcase") &&
          "[&_.emotion-bloom]:h-60",
        variant === "inline" && "[&_.emotion-bloom]:h-60",
        className,
      )}
      sourceLabel={sourceLabel}
    />
  );
}
