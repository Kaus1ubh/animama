import { Field, FieldLabel } from "@/ui/components/field";
import { Switch } from "@/ui/components/switch";

/** Shared labeled switch row for creator boolean settings. */
export function CreatorToggleRow({
  label,
  description,
  checked,
  disabled,
  onChecked,
}: {
  label: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  onChecked: (checked: boolean) => void;
}) {
  return (
    <Field orientation="horizontal" className="items-center gap-3">
      <div>
        <FieldLabel className="text-xs">{label}</FieldLabel>
        {description ? (
          <p className="text-muted-foreground text-xs">{description}</p>
        ) : null}
      </div>
      <Switch
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChecked}
        aria-label={label}
      />
    </Field>
  );
}
