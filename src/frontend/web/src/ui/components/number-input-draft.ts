/** Native incomplete numbers share an empty value, but differ through badInput. */
export function canPublishNumberInput(
  input: Pick<HTMLInputElement, "value" | "valueAsNumber"> & {
    validity: Pick<ValidityState, "badInput">;
  },
  allowEmpty = false,
): boolean {
  if (input.validity.badInput) return false;
  if (input.value === "") return allowEmpty;
  return Number.isFinite(input.valueAsNumber);
}
