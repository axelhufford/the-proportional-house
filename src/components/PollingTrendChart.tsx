import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  XAxis,
  YAxis,
} from 'recharts';
import { fetchJson } from '../lib/fetchJson';

interface RawPoll {
  date: string;
  pollster: string;
  margin: number;
  sample_size: number;
  population: string;
  url?: string;
}

interface TrendPayload {
  polls: RawPoll[];
}

interface ChartPoint {
  id: number;             // stable index, so the hovered dot can be identified
  ts: number;             // poll midpoint as ms epoch (Recharts numeric X)
  margin: number;         // raw or adjusted net (D - R) in points
  smoothed: number | null; // 14-day weighted moving average up to this point
  pollster: string;
  sample_size: number;
  population: string;
  date: string;           // ISO date for tooltip
}

const POPULATION_WEIGHTS: Record<string, number> = { LV: 1.0, RV: 0.85, A: 0.7 };
const HALF_LIFE_DAYS = 14;
const WINDOW_DAYS = 30;
const MS_PER_DAY = 86_400_000;

// Module-level cache so opening the panel for State A then State B doesn't refetch.
// On failure we clear the cache and rethrow, so a transient error doesn't pin
// the chart to a permanent "Loading…" — the next panel open retries.
let cache: Promise<TrendPayload> | null = null;
function fetchTrend(): Promise<TrendPayload> {
  if (cache) return cache;
  cache = fetchJson<TrendPayload>('/data/polling_trend.json').catch((e) => {
    cache = null;
    throw e;
  });
  return cache;
}

/**
 * Compute the same weighted average the Python pipeline uses
 * (data-pipeline/fetch_polls.py weighted_average): recency exponential
 * decay with 14-day half-life × sqrt(sample_size) × population multiplier.
 * Applied as a trailing window so each point's "smoothed" value reflects
 * polls up to and including that date.
 */
function smoothTrend(polls: RawPoll[]): ChartPoint[] {
  const points = polls
    .map((p) => ({
      ts: Date.parse(p.date),
      margin: p.margin,
      pollster: p.pollster,
      sample_size: p.sample_size,
      population: p.population,
      date: p.date,
    }))
    .filter((p) => Number.isFinite(p.ts))
    .sort((a, b) => a.ts - b.ts);

  return points.map((p, i) => {
    const cutoff = p.ts - WINDOW_DAYS * MS_PER_DAY;
    let wSum = 0;
    let wxSum = 0;
    for (const q of points) {
      if (q.ts < cutoff || q.ts > p.ts) continue;
      const daysAgo = (p.ts - q.ts) / MS_PER_DAY;
      const recency = Math.exp((-Math.LN2 * daysAgo) / HALF_LIFE_DAYS);
      const size = Math.sqrt(Math.max(q.sample_size || 1000, 1));
      const pop = POPULATION_WEIGHTS[q.population?.toUpperCase()] ?? 0.7;
      const w = recency * size * pop;
      wSum += w;
      wxSum += w * q.margin;
    }
    const smoothed = wSum > 0 ? wxSum / wSum : null;
    return { ...p, smoothed, id: i };
  });
}

function fmtMargin(m: number | null | undefined): string {
  if (m == null || !Number.isFinite(m)) return '—';
  if (Math.abs(m) < 0.05) return 'Tie';
  return m >= 0 ? `D+${m.toFixed(1)}` : `R+${Math.abs(m).toFixed(1)}`;
}

// Poll dates are ISO date-only strings, so Date.parse() anchors them to UTC
// midnight; the monthly ticks are likewise UTC first-of-month. Format both in
// UTC so labels land on the true 1st (not shifted a day/month by the local
// timezone — e.g. May 1 00:00 UTC would otherwise read "Apr 30" / "Apr").
function fmtDate(ts: number | string): string {
  const d = typeof ts === 'number' ? new Date(ts) : new Date(Date.parse(ts));
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function fmtMonth(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', timeZone: 'UTC' });
}

/** Return ~5 evenly-spaced first-of-month timestamps spanning [xMin, xMax]. */
function monthlyTicks(xMin: number, xMax: number, count = 5): number[] {
  if (!Number.isFinite(xMin) || !Number.isFinite(xMax) || xMax <= xMin) return [];
  const start = new Date(xMin);
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  const ticks: number[] = [];
  // Walk month by month, then thin to ~count if there are too many.
  for (let i = 0; i < 24; i++) {
    const t = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1)).getTime();
    if (t > xMax) break;
    if (t >= xMin) ticks.push(t);
  }
  if (ticks.length <= count) return ticks;
  const step = Math.ceil(ticks.length / count);
  return ticks.filter((_, i) => i % step === 0);
}

/** Visible dot radius — scales gently with sample size, clamped to 2–6 px. */
function visibleRadius(sampleSize: number): number {
  return Math.min(Math.max(Math.sqrt(sampleSize || 1000) / 14, 2), 6);
}

interface DotProps {
  cx?: number;
  cy?: number;
  payload?: ChartPoint;
  activeId?: number | null;
  onHover?: (point: ChartPoint, cx: number, cy: number) => void;
  onLeave?: () => void;
}

// Each poll is its own dot with a generous transparent hit area, so any single
// poll can be hovered or tapped directly — even when several share a date and
// stack vertically (up to ~8 on busy weeks). Hover/tap drives the tooltip and
// highlight from THIS dot, rather than recharts' axis tooltip which can only
// surface one poll per date. The hovered dot gets a navy ring + full opacity.
function PollDot({ cx, cy, payload, activeId, onHover, onLeave }: DotProps) {
  if (cx == null || cy == null || !payload) return null;
  const r = visibleRadius(payload.sample_size);
  const fill = payload.margin >= 0 ? '#2563EB' : '#DC2626';
  const isActive = payload.id === activeId;
  // Comfortable target, but small enough that stacked neighbors stay reachable.
  const hitR = Math.max(r + 4, 7);
  return (
    <g>
      <circle
        cx={cx}
        cy={cy}
        r={hitR}
        fill="transparent"
        style={{ pointerEvents: 'all', cursor: 'pointer' }}
        onMouseEnter={() => onHover?.(payload, cx, cy)}
        onMouseMove={() => onHover?.(payload, cx, cy)}
        onMouseLeave={() => onLeave?.()}
        onClick={() => onHover?.(payload, cx, cy)}
      />
      <circle
        cx={cx}
        cy={cy}
        r={isActive ? r + 1.5 : r}
        fill={fill}
        fillOpacity={isActive ? 0.95 : 0.45}
        stroke={isActive ? '#1F2E4D' : 'none'}
        strokeWidth={isActive ? 1.5 : 0}
        style={{ pointerEvents: 'none' }}
      />
    </g>
  );
}

function PollTooltipCard({ point }: { point: ChartPoint }) {
  return (
    <div className="bg-white border border-stone-200 rounded-md px-2 py-1.5 text-xs shadow-md">
      <div className="font-medium text-stone-900">{point.pollster}</div>
      <div className="text-stone-600">
        {fmtDate(point.ts)} · n={point.sample_size.toLocaleString()} {point.population}
      </div>
      <div className={point.margin >= 0 ? 'text-blue-700 font-medium' : 'text-red-700 font-medium'}>
        {fmtMargin(point.margin)}
      </div>
    </div>
  );
}

interface Props {
  currentAverageMargin: number;
  /** Chart height in px. Compact (160) in panels; taller on the homepage. */
  height?: number;
}

export function PollingTrendChart({ currentAverageMargin, height = 160 }: Props) {
  const [raw, setRaw] = useState<RawPoll[] | null>(null);
  // The hovered/tapped poll drives the tooltip + highlight. cx/cy are SVG
  // pixel coords (the surface fills the wrapper at 0,0), so they double as the
  // tooltip's position inside the relative wrapper.
  const wrapRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<{ point: ChartPoint; cx: number; cy: number } | null>(null);
  const handleHover = useCallback(
    (point: ChartPoint, cx: number, cy: number) => setActive({ point, cx, cy }),
    [],
  );
  const handleLeave = useCallback(() => setActive(null), []);

  useEffect(() => {
    let alive = true;
    fetchTrend()
      .then((d) => {
        if (alive) setRaw(d.polls);
      })
      .catch(() => {
        // Silently degrade; the rest of the panel still works.
      });
    return () => {
      alive = false;
    };
  }, []);

  const points = useMemo(() => (raw ? smoothTrend(raw) : null), [raw]);

  if (!points || points.length === 0) {
    return <div className="text-xs text-stone-500">Loading polling trend…</div>;
  }

  const xMin = points[0].ts;
  const xMax = points[points.length - 1].ts;
  const margins = points.map((p) => p.margin);
  const lo = Math.min(...margins);
  const hi = Math.max(...margins);
  const yMin = Math.min(-2, Math.floor(lo - 1));
  const yMax = Math.max(10, Math.ceil(hi + 1));

  // Screen-reader equivalent of the scatter (which is otherwise opaque to AT).
  // Mirrors the sr-only table fallback the map uses.
  const srSummary =
    `Generic-ballot polling over the last 180 days, ${fmtDate(xMin)} to ${fmtDate(xMax)}: ` +
    `${points.length} polls. Current 14-day weighted average ${fmtMargin(currentAverageMargin)}. ` +
    `Individual polls range from ${fmtMargin(lo)} to ${fmtMargin(hi)}. ` +
    `Positive values favor Democrats; negative favor Republicans.`;

  // Tooltip placement: centered above the dot, clamped to the wrapper width so
  // it can't run off the edges; flips below when the dot is near the top.
  let tip: { left: number; top: number; below: boolean } | null = null;
  if (active) {
    const w = wrapRef.current?.clientWidth ?? 0;
    const half = 90;
    const left = w ? Math.min(Math.max(active.cx, half), w - half) : active.cx;
    const below = active.cy < 64;
    tip = { left, top: below ? active.cy + 14 : active.cy - 10, below };
  }

  return (
    <div ref={wrapRef} className="w-full relative">
      <p className="sr-only">{srSummary}</p>
      {/* The SVG scatter is conveyed to assistive tech by the sr-only summary
          above; hide the visual chart from AT to avoid a flood of unlabeled nodes. */}
      <div aria-hidden="true">
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart
          data={points}
          margin={{ top: 8, right: 16, bottom: 4, left: 0 }}
          onMouseLeave={handleLeave}
        >
          <XAxis
            dataKey="ts"
            type="number"
            domain={[xMin, xMax]}
            scale="time"
            ticks={monthlyTicks(xMin, xMax, 5)}
            tickFormatter={fmtMonth}
            tick={{ fontSize: 10, fill: '#888' }}
            stroke="#d6d3d1"
            tickLine={false}
            minTickGap={8}
          />
          <YAxis
            type="number"
            domain={[yMin, yMax]}
            tickFormatter={(v: number) => fmtMargin(v)}
            tick={{ fontSize: 10, fill: '#888' }}
            stroke="#d6d3d1"
            tickLine={false}
            width={48}
          />
          <ReferenceLine y={0} stroke="#a8a29e" strokeDasharray="3 3" />
          <ReferenceLine
            y={currentAverageMargin}
            stroke="#1F2E4D"
            strokeWidth={1}
            label={{
              value: `now: ${fmtMargin(currentAverageMargin)}`,
              position: 'insideTopRight',
              fontSize: 10,
              fill: '#1F2E4D',
            }}
          />
          <Line
            type="monotone"
            dataKey="smoothed"
            stroke="#1F2E4D"
            strokeWidth={2}
            dot={false}
            activeDot={false}
            isAnimationActive={false}
            connectNulls
          />
          <Scatter
            dataKey="margin"
            shape={
              <PollDot activeId={active?.point.id ?? null} onHover={handleHover} onLeave={handleLeave} />
            }
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
      </div>
      {active && tip && (
        <div
          className="pointer-events-none absolute z-10"
          style={{
            left: tip.left,
            top: tip.top,
            transform: tip.below ? 'translate(-50%, 0)' : 'translate(-50%, -100%)',
          }}
        >
          <PollTooltipCard point={active.point} />
        </div>
      )}
    </div>
  );
}

// Default export so React.lazy(() => import('./PollingTrendChart')) works.
// The named export is preserved for any callers that import it directly.
export default PollingTrendChart;
