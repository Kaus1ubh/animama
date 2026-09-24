import * as React from "react";

import { cn } from "@/lib/utils";
import { canPublishNumberInput } from "./number-input-draft";

type InputProps = React.ComponentProps<"input"> & {
  /** Optional numeric fields may publish an intentional empty value instead of restoring it. */
  allowEmptyNumber?: boolean;
};

/** Keep native number-editing drafts separate from the consumer's committed value. */
const ControlledNumberInput = React.forwardRef<HTMLInputElement, InputProps>(
  ({ value, onChange, onBlur, onKeyDown, allowEmptyNumber, ...props }, ref) => {
    const [draft, setDraft] = React.useState<{ text: string } | null>(null);
    const previousValue = React.useRef(value);
    const publishingChange = React.useRef(false);

    React.useLayoutEffect(() => {
      // Keep the user's text through synchronous rounding/clamping by its owner.
      // A later external change (reset, undo, slider) replaces the local draft.
      if (!Object.is(value, previousValue.current) && !publishingChange.current)
        setDraft(null);
      previousValue.current = value;
      publishingChange.current = false;
    }, [value, draft]);

    const settle = (input: HTMLInputElement) => {
      // Explicit assignment also clears the browser's hidden badInput buffer
      // when a minus/decimal/exponent has an empty DOM value.
      input.value = String(value ?? "");
      setDraft(null);
    };

    return (
      <input
        {...props}
        ref={ref}
        value={draft?.text ?? value}
        onChange={(event) => {
          // A fresh object ensures even same-value native edits finish a render
          // before a later external update is mistaken for this input's callback.
          setDraft({ text: event.currentTarget.value });
          if (canPublishNumberInput(event.currentTarget, allowEmptyNumber)) {
            publishingChange.current = true;
            onChange?.(event);
          }
        }}
        onBlur={(event) => {
          settle(event.currentTarget);
          onBlur?.(event);
        }}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (
            !event.defaultPrevented &&
            (event.key === "Enter" || event.key === "Escape")
          )
            settle(event.currentTarget);
        }}
      />
    );
  },
);
ControlledNumberInput.displayName = "ControlledNumberInput";

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, allowEmptyNumber, ...props }, ref) => {
    const Element =
      type === "number" && props.value != null && props.onChange
        ? ControlledNumberInput
        : "input";
    return (
      <Element
        ref={ref}
        type={type}
        {...(Element === ControlledNumberInput ? { allowEmptyNumber } : {})}
        data-slot="input"
        className={cn(
          "border-input selection:bg-primary selection:text-primary-foreground file:text-foreground placeholder:text-muted-foreground dark:bg-input/30 h-9 w-full min-w-0 rounded-md border bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
          "aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
          className,
        )}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
