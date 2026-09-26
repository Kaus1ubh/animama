const STANDARD_REMINDER_HOURS = [0.5, 1, 2, 3] as const;

/**
 * Reminder intervals the owner may choose: never longer than the operator's
 * interval, which is always offered (spec R8).
 */
export function reminderHourOptions(operatorHours: number): number[] {
  const shorter = STANDARD_REMINDER_HOURS.filter(
    (hours) => hours < operatorHours,
  );
  return [...shorter, operatorHours];
}
