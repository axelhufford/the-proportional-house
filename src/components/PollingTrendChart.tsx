import { useEffect, useMemo, useState } from 'react';
import {
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

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
let cache: Promise<TrendPayload> | null = null;
function fetchTrend(): Promise<TrendPayload> {
  if (cache) return cache;
  cache = fetch('/data/polling_trend.json').then((r) => r.json());
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

  return points.map((p) => {
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
    return { ...p, smoothed };
  });
}

function fmtMargin(m: number | null | undefined): string {
  if (m == null || !Number.isFinite(m)) return '—';
  if (Math.abs(m) < 0.05) return 'Tie';
  return m >= 0 ? `D+${m.toFixed(1)}` : `R+${Math.abs(m).toFixed(1)}`;
}

function fmtDate(ts: number | string): string {
  const d = typeof ts === 'number' ? new Date(ts) : new Date(Date.parse(ts));
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

interface DotProps {
  cx?: number;
  cy?: number;
  payload?: ChartPoint;
}

function PollDot({ cx, cy, payload }: DotProps) {
  if (cx == null || cy == null || !payload) return null;
  const r = Math.min(Math.max(Math.sqrt(payload.sample_size || 1000) / 14, 2), 6);
  const fill = payload.margin >= 0 ? '#2563EB' : '#DC2626';
  return <circle cx={cx} cy={cy} r={r} fill={fill} fillOpacity={0.45} />;
}

interface TooltipPayload {
  payload: ChartPoint;
}

function ChartTooltip({ active, payload }: { active?: boolean; payload?: TooltipPayload[] }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="bg-white border border-stone-200 rounded-md px-2 py-1.5 text-xs shadow-sm">
      <div className="font-medium text-stone-900">{p.pollster}</div>
      <div className="text-stone-600">{fmtDate(p.ts)} · n={p.sample_size.toLocaleString()} {p.population}</div>
      <div className={p.margin >= 0 ? 'text-blue-700 font-medium' : 'text-red-700 font-medium'}>
        {fmtMargin(p.margin)}
      </div>
    </div>
  );
}

interface Props {
  currentAverageMargin: number;
}

export function PollingTrendChart({ currentAverageMargin }: Props) {
  const [raw, setRaw] = useState<RawPoll[] | null>(null);

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
  const yMin = Math.min(-2, Math.floor(Math.min(...points.map((p) => p.margin)) - 1));
  const yMax = Math.max(10, Math.ceil(Math.max(...points.map((p) => p.margin)) + 1));

  return (
    <div className="w-full">
      <ResponsiveContainer width="100%" height={160}>
        <ComposedChart data={points} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
          <XAxis
            dataKey="ts"
            type="number"
            domain={[xMin, xMax]}
            scale="time"
            tickFormatter={fmtDate}
            tick={{ fontSize: 10, fill: '#888' }}
            stroke="#d6d3d1"
            tickLine={false}
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
          <Scatter dataKey="margin" shape={<PollDot />} isAnimationActive={false} />
          <Line
            type="monotone"
            dataKey="smoothed"
            stroke="#1F2E4D"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
            connectNulls
          />
          <Tooltip content={<ChartTooltip />} cursor={{ stroke: '#d6d3d1', strokeDasharray: '3 3' }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
