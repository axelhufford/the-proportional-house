import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
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
    year: 'numeric',
    timeZone: 'UTC',
  });
}

// X-axis ticks: month + year (the series spans multiple years, and "Feb 24"
// day-of-month ticks read ambiguously like a year).
function fmtAxis(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, {
    month: 'short',
    year: 'numeric',
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
  reconstructed: boolean;
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
      {p.reconstructed && (
        <div className="mt-0.5 text-stone-400 italic">Reconstructed from poll archive</div>
      )}
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
    reconstructed: p.reconstructed === true,
  }));
  const ds = data.map((d) => d.d);
  const yMin = Math.min(212, Math.min(...ds) - 4);
  const yMax = Math.max(224, Math.max(...ds) + 4);

  // The hindcast (reconstructed) span is the leading run of points; shade it so
  // it reads as distinct from live, forward-collected days.
  const reconDates = data.filter((d) => d.reconstructed).map((d) => d.date);
  const reconStart = reconDates[0];
  const reconEnd = reconDates[reconDates.length - 1];

  return (
    <div className="w-full">
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
          <CartesianGrid stroke="#f0ede6" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={fmtAxis}
            tick={{ fontSize: 10, fill: '#888' }}
            stroke="#d6d3d1"
            tickLine={false}
            minTickGap={44}
          />
          <YAxis
            domain={[yMin, yMax]}
            tick={{ fontSize: 10, fill: '#888' }}
            stroke="#d6d3d1"
            tickLine={false}
            width={36}
            allowDecimals={false}
          />
          {reconStart && reconEnd && (
            <ReferenceArea
              x1={reconStart}
              x2={reconEnd}
              fill="#1c2c4c"
              fillOpacity={0.05}
              label={{ value: 'reconstructed', position: 'insideTopLeft', fontSize: 9, fill: '#a8a29e' }}
            />
          )}
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
