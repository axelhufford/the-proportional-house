/**
 * Suspense fallback for the lazily-loaded PollingTrendChart. Kept in its own
 * module with no recharts import, so it stays out of the chart's lazy chunk.
 * The caller sizes it (via `className`) to match the chart height and avoid
 * layout shift when the chunk resolves.
 */
export function ChartSkeleton({ className = 'h-48' }: { className?: string }) {
  return (
    <div className={`w-full ${className} rounded-md bg-stone-100 animate-pulse`} aria-hidden="true" />
  );
}
