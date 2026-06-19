import { useState } from 'react';
import { Link } from 'react-router-dom';
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
import { METHOD_DESCRIPTIONS } from '../lib/methods';
import { SegmentedControl } from './SegmentedControl';

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

const TOTAL_SEATS = 435;

// One charted series per allocation method. `id` matches the history.json
// `methods` keys (and 'PR' for the top-level Pure-PR line). Colors are chosen
// to stay distinguishable when overlaid in Compare mode.
const SERIES = [
  { id: 'PR', label: 'Pure PR', color: '#2166ac' },
  { id: 'MMD-3', label: 'MMD-3', color: '#d97706' },
  { id: 'MMD-5', label: 'MMD-5', color: '#059669' },
  { id: 'MMP-50', label: 'MMP-50', color: '#7c3aed' },
] as const;

type MethodId = (typeof SERIES)[number]['id'];
type Selection = MethodId | 'compare';

// Per-option hover tooltips reuse METHOD_DESCRIPTIONS (same copy as the Sandbox
// + comparison table), so the one-liners never diverge.
const SELECT_OPTIONS: { value: Selection; label: string; title: string }[] = [
  ...SERIES.map((s) => ({ value: s.id as Selection, label: s.label, title: METHOD_DESCRIPTIONS[s.id] })),
  {
    value: 'compare' as Selection,
    label: 'Compare',
    title: 'Overlay all four methods to compare how each has moved over time.',
  },
];

// Row carries each method's projected D-seat count (R is TOTAL_SEATS − D).
type Row = {
  date: string;
  margin: number;
  reconstructed: boolean;
} & Partial<Record<MethodId, number>>;

interface TooltipEntry {
  dataKey: MethodId;
  value: number;
  color: string;
  payload: Row;
}

function HistTooltip({ active, payload }: { active?: boolean; payload?: TooltipEntry[] }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="bg-white border border-stone-200 rounded-md px-2 py-1.5 text-xs shadow-sm">
      <div className="font-medium text-stone-900">{fmtDate(row.date)}</div>
      <div className="mt-0.5 space-y-0.5">
        {payload.map((e) => {
          if (typeof e.value !== 'number') return null;
          const label = SERIES.find((s) => s.id === e.dataKey)?.label ?? e.dataKey;
          return (
            <div key={e.dataKey}>
              <span className="font-medium" style={{ color: e.color }}>{label}</span>{' '}
              <span className="text-blue-700">D {e.value}</span>
              <span className="text-stone-400"> · </span>
              <span className="text-red-700">R {TOTAL_SEATS - e.value}</span>
            </div>
          );
        })}
      </div>
      <div className="text-stone-500 mt-0.5">Generic ballot: {fmtMargin(row.margin)}</div>
      {row.reconstructed && (
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
 * Projected Democratic House seats over time — how the projection has moved as
 * polling updates. A method selector switches between Pure PR, MMD-3, MMD-5,
 * MMP-50, or a "Compare" overlay of all four; the alternative-method series are
 * precomputed by the pipeline (history.json `methods`). A dashed 218 line marks
 * the majority threshold. Lazy-loaded (recharts is its own chunk).
 */
const COMPARE_EXPLAINER =
  'MMD-3 / MMD-5 split each state into 3- or 5-seat districts (less proportional than statewide PR); MMP-50 mixes single-member-district seats with party-list seats. Pure PR is statewide proportional.';

function explainerFor(sel: Selection): string {
  return sel === 'compare' ? COMPARE_EXPLAINER : METHOD_DESCRIPTIONS[sel];
}

export function ProjectionHistoryChart({ points, height = 260 }: Props) {
  const [selection, setSelection] = useState<Selection>('PR');
  // Hovered/focused method (from the selector) — drives a live explainer that's
  // far more discoverable than the native `title` tooltip. Falls back to the
  // current selection when nothing is hovered.
  const [hovered, setHovered] = useState<Selection | null>(null);

  const data: Row[] = points.map((p) => {
    const row: Row = {
      date: p.date,
      margin: p.generic_ballot_margin,
      reconstructed: p.reconstructed === true,
      PR: p.projected_d,
    };
    if (p.methods) {
      for (const s of SERIES) {
        if (s.id !== 'PR' && p.methods[s.id]) row[s.id] = p.methods[s.id].d;
      }
    }
    return row;
  });

  // Which method lines to draw. A single non-PR selection also shows Pure PR
  // faint as a reference; Compare draws all four.
  const selectedIds: MethodId[] =
    selection === 'compare' ? SERIES.map((s) => s.id) : [selection];
  const showPrReference = selection !== 'PR' && selection !== 'compare';
  const visibleIds: MethodId[] = showPrReference ? ['PR', ...selectedIds] : selectedIds;

  // Auto-scale the y-domain over whatever's visible (MMD/MMP land well off the
  // Pure-PR ~218 band), but always keep the 218 majority line in frame.
  const vals: number[] = [];
  for (const row of data) {
    for (const id of visibleIds) {
      const v = row[id];
      if (typeof v === 'number') vals.push(v);
    }
  }
  const yMin = Math.floor(Math.min(218, ...vals) - 4);
  const yMax = Math.ceil(Math.max(218, ...vals) + 4);

  const showLegend = visibleIds.length > 1;

  return (
    <div className="w-full">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <SegmentedControl<Selection>
          label="Method"
          value={selection}
          options={SELECT_OPTIONS}
          onChange={setSelection}
          onHover={setHovered}
        />
        {showLegend && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone-600">
            {visibleIds.map((id) => {
              const s = SERIES.find((x) => x.id === id)!;
              const faint = showPrReference && id === 'PR';
              return (
                <span key={id} className="inline-flex items-center gap-1.5">
                  <span
                    className="inline-block w-3 h-0.5 rounded"
                    style={{ backgroundColor: s.color, opacity: faint ? 0.4 : 1 }}
                  />
                  <span style={{ opacity: faint ? 0.6 : 1 }}>{s.label}{faint ? ' (reference)' : ''}</span>
                </span>
              );
            })}
          </div>
        )}
      </div>
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
          <ReferenceLine
            y={218}
            stroke="#a8a29e"
            strokeDasharray="3 3"
            label={{ value: '218 = majority', position: 'insideTopRight', fontSize: 10, fill: '#a8a29e' }}
          />
          {visibleIds.map((id) => {
            const s = SERIES.find((x) => x.id === id)!;
            const isReference = showPrReference && id === 'PR';
            return (
              <Line
                key={id}
                type="monotone"
                dataKey={id}
                name={s.label}
                stroke={s.color}
                strokeOpacity={isReference ? 0.35 : 1}
                strokeWidth={isReference ? 1.5 : 2}
                strokeDasharray={isReference ? '4 3' : undefined}
                dot={false}
                isAnimationActive={false}
              />
            );
          })}
          <Tooltip content={<HistTooltip />} cursor={{ stroke: '#d6d3d1', strokeDasharray: '3 3' }} />
        </LineChart>
      </ResponsiveContainer>
      {/* Brief explainer — these acronyms first appear here, so name what they
        * mean and deep-link to the full Methodology section. Updates live as you
        * hover/focus a method in the selector (native `title` is too slow to
        * notice), falling back to the current selection. */}
      <p className="mt-2 text-xs text-stone-500">
        {explainerFor(hovered ?? selection)}{' '}
        <Link to="/methodology#methods" className="underline hover:text-brand-navy">
          What do MMD &amp; MMP mean? →
        </Link>
      </p>
    </div>
  );
}

// Default export so React.lazy(() => import('./ProjectionHistoryChart')) works.
export default ProjectionHistoryChart;
