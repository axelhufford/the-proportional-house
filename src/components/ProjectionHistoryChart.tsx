import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { HistoryPoint } from '../lib/types';

function fmtDate(iso: string): string {
  // iso is YYYY-MM-DD (UTC calendar date); format in UTC to avoid off-by-one.
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function fmtMargin(m: number): string {
  if (Math.abs(m) < 0.05) return 'Tie';
  return m >= 0 ? `D+${m.toFixed(1)}` : `R+${Math.abs(m).toFixed(1)}`;
}

interface Row {
  date: string;
  d: number;
  r: number;
  margin: number;
}

function HistTooltip({ active, payload }: { active?: boolean; payload?: { payload: Row }[] }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="bg-white border border-stone-200 rounded-md px-2 py-1.5 text-xs shadow-sm">
      <div className="font-medium text-stone-900">{fmtDate(p.date)}</div>
      <div className="mt-0.5">
        <span className="text-blue-700 font-medium">D {p.d}</span>
        <span className="text-stone-400"> · </span>
        <span className="text-red-700 font-medium">R {p.r}</span>
      </div>
      <div className="text-stone-500">Generic ballot: {fmtMargin(p.margin)}</div>
    </div>
  );
}

interface Props {
  points: HistoryPoint[];
  height?: number;
}

/**
 * Projected Democratic House seats over time — how the live Current projection
 * has moved as polling updates. A dashed 218 line marks the majority threshold.
 * Lazy-loaded (recharts is its own chunk); the homepage only renders it once
 * the daily pipeline has accumulated at least two days of points.
 */
export function ProjectionHistoryChart({ points, height = 260 }: Props) {
  const data: Row[] = points.map((p) => ({
    date: p.date,
    d: p.projected_d,
    r: p.projected_r,
    margin: p.generic_ballot_margin,
  }));
  const ds = data.map((d) => d.d);
  const yMin = Math.min(212, Math.min(...ds) - 4);
  const yMax = Math.max(224, Math.max(...ds) + 4);

  return (
    <div className="w-full">
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
          <CartesianGrid stroke="#f0ede6" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={fmtDate}
            tick={{ fontSize: 10, fill: '#888' }}
            stroke="#d6d3d1"
            tickLine={false}
            minTickGap={28}
          />
          <YAxis
            domain={[yMin, yMax]}
            tick={{ fontSize: 10, fill: '#888' }}
            stroke="#d6d3d1"
            tickLine={false}
            width={36}
            allowDecimals={false}
          />
          <ReferenceLine
            y={218}
            stroke="#a8a29e"
            strokeDasharray="3 3"
            label={{ value: '218 = majority', position: 'insideTopRight', fontSize: 10, fill: '#a8a29e' }}
          />
          <Line
            type="monotone"
            dataKey="d"
            stroke="#2166ac"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
          <Tooltip content={<HistTooltip />} cursor={{ stroke: '#d6d3d1', strokeDasharray: '3 3' }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// Default export so React.lazy(() => import('./ProjectionHistoryChart')) works.
export default ProjectionHistoryChart;
