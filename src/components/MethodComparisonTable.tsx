/**
 * Comparison table showing national seat totals under every allocation
 * method (today's SMD baseline + Pure PR + MMD-3 + MMD-5 + MMP-50).
 *
 * Renders inside the Sandbox view so users can see proportionality
 * differences across reform models without flipping the method picker.
 * The row matching the currently-selected method gets a subtle highlight
 * to tie the table back to the map above.
 */
import type { ProjectionPayload } from '../lib/types';
import type { SandboxPayload } from '../lib/sandboxTypes';
import {
  type AllocationMethodKind,
  METHOD_DESCRIPTIONS,
  METHOD_LABELS,
} from '../lib/methods';
import { PARTY_D, PARTY_R, displayName } from '../lib/parties';

interface MethodRow {
  method: AllocationMethodKind;
  payload: SandboxPayload;
}

interface Props {
  /** Base payload for the "Actual today" row (always two-party). */
  basePayload: ProjectionPayload;
  /** One entry per method; produced by Home from buildSandboxPayload. */
  comparison: MethodRow[];
  /** The currently-selected method — its row gets highlighted. */
  currentMethod: AllocationMethodKind;
}

export function MethodComparisonTable({ basePayload, comparison, currentMethod }: Props) {
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
              Huntington-Hill apportionment; the "Actual today" row stays at 435 since that's the
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
                  </td>
                );
              })}
              <td className="text-right px-4 py-2 tabular-nums text-stone-700">
                {basePayload.national.actual.d_seats + basePayload.national.actual.r_seats}
              </td>
            </tr>
            {comparison.map((row) => {
              const total = row.payload.national.parties.reduce((s, p) => s + p.seats, 0);
              const isActive = row.method === currentMethod;
              return (
                <tr
                  key={row.method}
                  className={[
                    'border-t border-stone-200',
                    isActive ? 'bg-amber-50/60' : '',
                  ].join(' ')}
                >
                  <th
                    scope="row"
                    className="text-left px-4 py-2 font-medium text-stone-700"
                    title={METHOD_DESCRIPTIONS[row.method]}
                  >
                    {METHOD_LABELS[row.method]}
                    {isActive && (
                      <span className="text-stone-500 text-xs font-normal ml-2">
                        ← current view
                      </span>
                    )}
                  </th>
                  {row.payload.national.parties.map((p) => (
                    <td
                      key={p.party.id}
                      className="text-right px-3 py-2 tabular-nums"
                      style={{ color: p.seats > 0 ? p.party.color : '#a8a29e' }}
                    >
                      {p.seats}
                    </td>
                  ))}
                  <td className="text-right px-4 py-2 tabular-nums text-stone-700">{total}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="px-4 py-2 border-t border-stone-200 bg-stone-50 text-[11px] text-stone-500">
        Hover a method label for a one-line definition. MMP totals may slightly exceed 435 in extreme
        overhang cases — the model holds total seats fixed for cleanliness.{' '}
        {/* If we ever model Ausgleichsmandate (Germany's overhang-compensation seats), this caveat changes. */}
        D / R columns reference {PARTY_D.label} and {PARTY_R.label}.
      </div>
    </section>
  );
}
