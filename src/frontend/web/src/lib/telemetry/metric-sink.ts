export type MetricAttributes = Record<string, string | number | boolean>;

/** One browser metric; the exporter aggregates counters as sums and histograms. */
export type MetricInstrument = {
  readonly name: string;
  readonly description: string;
  readonly unit: string;
  readonly kind: "counter" | "histogram";
};

/** Receives each measurement while an exporter is active. */
export type MetricSink = (
  instrument: MetricInstrument,
  value: number,
  attributes?: MetricAttributes,
) => void;

let sink: MetricSink | null = null;

/**
 * Installs the active exporter's sink. Without one, every record call is a
 * no-op: no exporter starts unless the serving origin advertises one.
 */
export function setMetricSink(next: MetricSink | null): void {
  sink = next;
}

/** Whether `candidate` is installed, so a stopped exporter never clears a newer one. */
export function isMetricSink(candidate: MetricSink): boolean {
  return sink === candidate;
}

/** Forwards one measurement to the active exporter, if any. */
export function recordMetric(
  instrument: MetricInstrument,
  value: number,
  attributes?: MetricAttributes,
): void {
  sink?.(instrument, value, attributes);
}
