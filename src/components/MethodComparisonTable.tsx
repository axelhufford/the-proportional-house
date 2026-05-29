/**
 * Comparison table showing national seat totals under every allocation
 * method (today's SMD baseline + Pure PR + MMD-3 + MMD-5 + MMP-50).
 *
 * Renders inside the Sandbox view so users can see proportionality
 * differences across reform models without flipping the method picker.
 * The row matching the currently-selected method gets a subtle highlight
 * to tie the table back to the map above.
 */
import type { ReactNode } from 'react';
import type { ProjectionPayload } from '../lib/types';
import type { SandboxPayload } from '../lib/sandboxTypes';
import {
  type AllocationMethodKind,
  METHOD_DESCRIPTIONS,
  METHOD_LABELS,
} from '../lib/methods';
import { PARTY_D, PARTY_R, displayName } from '../lib/parties';
import { formatSeatPct } from '../lib/format';

interface MethodRow {
  method: AllocationMethodKind;
  payload: SandboxPayload;
}

interface Props {
  /** Base payload for the "Actual today" row (always two-party). */
  basePayload: ProjectionPayload;
  /** One entry per canonical method; produced by Home from buildSandboxPayload. */
  comparison: MethodRow[];
  /**
   * The active canonical method (its row gets highlighted), or null when the
   * user has dialed an off-grid magnitude/share — in which case no canonical
   * row is highlighted and `currentRow` supplies the highlighted custom row.
   */
  activeKey: AllocationMethodKind | null;
  /**
   * Off-grid "current" row to insert + highlight (e.g. MMD-4 / MMP-30).
   * Null when the live setting matches a canonical preset.
   */
  currentRow: { label: string; payload: SandboxPayload } | null;
}

export function MethodComparisonTable({ basePayload, comparison, activeKey, currentRow }: Props) {
  // Column set: every party that has seats in at least one row. Ordered
  // canonical (D, R, then minors in the order the sandbox added them).
  // Using the first method's national.parties as the source of truth for
  // ordering — every method produces the same party list (just different
  // seat counts).
  const columnParties = comparison[0]?.payload.national.parties ?? [];

  // For "Actual today" row, only D and R have data; minors are zero.
  const actualSeats = (partyId: string): number => {
    if (partyId === 'D') return basePayload.national.actual.d_seats;
    if (partyId === 'R') return basePayload.national.actual.r_seats;
    return 0;
  };

  return (
    <section
      aria-label="Allocation method comparison"
      className="mt-5 border border-stone-200 bg-white rounded-lg overflow-hidden"
    >
      <div className="px-4 py-3 border-b border-stone-200 bg-stone-50">
        <h2 className="text-sm font-medium text-stone-900">Compare reform models</h2>
        <p className="text-xs text-stone-600 mt-0.5">
          National seat totals under each allocation method, given the current sandbox settings.
          {/* Pull house_size from the first comparison row — all rows share the same value. */}
          {comparison[0] && comparison[0].payload.house_size !== 435 && (
            <>
              {' '}House expanded to <strong>{comparison[0].payload.house_size} seats</strong> via
              Huntington-Hill apportionment; the “Actual today” row stays at 435 since that’s the
              current real House.
            </>
          )}
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase tracking-wider text-stone-500 bg-stone-50/40">
            <tr>
              <th scope="col" className="text-left font-medium px-4 py-2">Method</th>
              {columnParties.map((p) => (
                <th
                  key={p.party.id}
                  scope="col"
                  className="text-right font-medium px-3 py-2 tabular-nums"
                  style={{ color: p.party.color }}
                >
                  {displayName(p.party)}
                </th>
              ))}
              <th scope="col" className="text-right font-medium px-4 py-2 text-stone-500">Total</th>
            </tr>
          </thead>
          <tbody>
            {(() => {
              const actualTotal =
                basePayload.national.actual.d_seats + basePayload.national.actual.r_seats;
              return (
                <tr className="border-t border-stone-200">
                  <th scope="row" className="text-left font-medium px-4 py-2 text-stone-700">
                    Actual today (SMD)
                  </th>
                  {columnParties.map((p) => {
                    const seats = actualSeats(p.party.id);
                    return (
                      <td
                        key={p.party.id}
                        className="text-right px-3 py-2 tabular-nums"
                        style={{ color: seats > 0 ? p.party.color : '#a8a29e' }}
                      >
                        {seats}
                        {seats > 0 && (
                          <span className="ml-1 text-[11px] font-normal text-stone-400">
                            {formatSeatPct(seats, actualTotal)}
                          </span>
                        )}
                      </td>
                    );
                  })}
                  <td className="text-right px-4 py-2 tabular-nums text-stone-700">{actualTotal}</td>
                </tr>
              );
            })()}
            {(() => {
              // Render a parties row (used for both canonical and the custom
              // "current" row). `highlight` adds the amber active background;
              // `label` is the row's method name; `marker` shows "← current
              // view" when this is the active row.
              const renderRow = (
                key: string,
                label: string,
                parties: SandboxPayload['national']['parties'],
                opts: { highlight: boolean; marker: boolean; title?: string },
              ) => {
                const total = parties.reduce((s, p) => s + p.seats, 0);
                return (
                  <tr
                    key={key}
                    className={['border-t border-stone-200', opts.highlight ? 'bg-amber-50/60' : ''].join(' ')}
                  >
                    <th
                      scope="row"
                      className="text-left px-4 py-2 font-medium text-stone-700"
                      title={opts.title}
                    >
                      {label}
                      {opts.marker && (
                        <span className="text-stone-500 text-xs font-normal ml-2">← current view</span>
                      )}
                    </th>
                    {parties.map((p) => (
                      <td
                        key={p.party.id}
                        className="text-right px-3 py-2 tabular-nums"
                        style={{ color: p.seats > 0 ? p.party.color : '#a8a29e' }}
                      >
                        {p.seats}
                        {p.seats > 0 && (
                          <span className="ml-1 text-[11px] font-normal text-stone-400">
                            {formatSeatPct(p.seats, total)}
                          </span>
                        )}
                      </td>
                    ))}
                    <td className="text-right px-4 py-2 tabular-nums text-stone-700">{total}</td>
                  </tr>
                );
              };

              // Insert the off-grid "current" row right after its family's
              // last canonical row (MMD → after MMD-5; MMP → after MMP-50).
              const currentFamily = currentRow
                ? currentRow.label.startsWith('MMD')
                  ? 'MMD'
                  : 'MMP'
                : null;
              const anchorMethod: AllocationMethodKind | null =
                currentFamily === 'MMD' ? 'MMD-5' : currentFamily === 'MMP' ? 'MMP-50' : null;

              const rows: ReactNode[] = [];
              for (const row of comparison) {
                rows.push(
                  renderRow(row.method, METHOD_LABELS[row.method], row.payload.national.parties, {
                    highlight: row.method === activeKey,
                    marker: row.method === activeKey,
                    title: METHOD_DESCRIPTIONS[row.method],
                  }),
                );
                if (currentRow && row.method === anchorMethod) {
                  rows.push(
                    renderRow('__current__', currentRow.label, currentRow.payload.national.parties, {
                      highlight: true,
                      marker: true,
                    }),
                  );
                }
              }
              return rows;
            })()}
          </tbody>
        </table>
      </div>
      <div className="px-4 py-2 border-t border-stone-200 bg-stone-50 text-[11px] text-stone-500">
        Hover a method label for a one-line definition. MMP totals may slightly exceed 435 in extreme
        overhang cases; the model holds total seats fixed for cleanliness.{' '}
        {/* If we ever model Ausgleichsmandate (Germany's overhang-compensation seats), this caveat changes. */}
        D / R columns reference {PARTY_D.label} and {PARTY_R.label}.
      </div>
    </section>
  );
}
