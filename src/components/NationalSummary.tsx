import { useCallback } from 'react';
import type { ProjectionPayload, ViewMode } from '../lib/types';
import type { SandboxPayload } from '../lib/sandboxTypes';
import {
  type AllocationMethodKind,
  METHOD_LABELS,
} from '../lib/methods';
import { displayName } from '../lib/parties';
import { downloadNationalCard, buildNationalTweetIntent } from '../lib/shareNational';
import { downloadProjectionCsv, downloadProjectionJson } from '../lib/exportData';
import { formatSeatPct } from '../lib/format';

const DEFAULT_HOUSE_SIZE = 435;

interface Props {
  payload: ProjectionPayload;
  viewMode?: ViewMode;
  /** When present, render the extended N-party variant for sandbox mode. */
  sandboxPayload?: SandboxPayload | null;
  /** Active allocation method — affects label + share-disable rule. */
  method?: AllocationMethodKind;
  /**
   * Display label for the active method (e.g. "MMD-4" / "MMP-30" when a
   * magnitude/share slider is dialed off a preset). Falls back to the
   * method's canonical label when omitted.
   */
  methodLabel?: string;
  /** Active House size — affects label + share-disable rule. */
  houseSize?: number;
}

export function NationalSummary({
  payload,
  viewMode = 'current',
  sandboxPayload,
  method = 'PR',
  methodLabel,
  houseSize = DEFAULT_HOUSE_SIZE,
}: Props) {
  const { national, meta } = payload;

  const handleDownload = useCallback(() => {
    downloadNationalCard({ national, meta, viewMode });
  }, [national, meta, viewMode]);

  const handleShareTwitter = useCallback(() => {
    const url = buildNationalTweetIntent({ national, meta, viewMode });
    window.open(url, '_blank', 'noopener,noreferrer');
  }, [national, meta, viewMode]);

  // Data download — always emits the *unmodified* pipeline payload, not the
  // effective (sandbox-mutated) one. Researchers want the canonical numbers,
  // not whatever the user's slider is on.
  const handleDownloadCsv = useCallback(() => {
    downloadProjectionCsv(payload);
  }, [payload]);

  const handleDownloadJson = useCallback(() => {
    downloadProjectionJson(payload);
  }, [payload]);
  // "Has minors" controls UI shape (N-party stat cards vs. two-party).
  // "Sandbox totals" controls DATA SOURCE — when in sandbox mode we always
  // want projected seat counts to come from sandboxPayload (so method +
  // house-size flow through), even when no minors are active.
  const hasMinors = !!sandboxPayload && sandboxPayload.minors.length > 0;
  const sandboxTotals = sandboxPayload?.national ?? null;
  // Projected D / R seat counts: from sandbox totals when available;
  // otherwise from the static national.projected (Current / Retrospective).
  // D and R are always slots 0 and 1 of the canonical parties array.
  const projectedD = sandboxTotals ? sandboxTotals.parties[0]?.seats ?? 0 : national.projected.d_seats;
  const projectedR = sandboxTotals ? sandboxTotals.parties[1]?.seats ?? 0 : national.projected.r_seats;
  // Total seats for the "Projected" card — accounts for House expansion under
  // sandbox. The "Actual" card uses its own (fixed-at-435) total below.
  const projectedTotal = sandboxTotals
    ? sandboxTotals.total_seats
    : national.projected.d_seats + national.projected.r_seats;
  const actualTotal = national.actual.d_seats + national.actual.r_seats;
  // Baseline for the "shift under PR" difference. In sandbox we compare against
  // today's delegation *scaled to the projected House size* (actual_scaled) so
  // a bigger House isn't mistaken for a partisan swing; outside sandbox this is
  // just the real 435-seat actual. Identical to the raw actual at House = 435.
  const baselineD = sandboxTotals ? sandboxTotals.actual_scaled.d_seats : national.actual.d_seats;
  const baselineR = sandboxTotals ? sandboxTotals.actual_scaled.r_seats : national.actual.r_seats;
  const dGain = projectedD - baselineD;
  const houseExpanded = !!sandboxPayload && sandboxPayload.house_size !== DEFAULT_HOUSE_SIZE;
  const generic = meta.generic_ballot_margin;
  const genericLabel = generic >= 0 ? `D+${generic.toFixed(1)}` : `R+${Math.abs(generic).toFixed(1)}`;
  const baseline = meta.baseline_2024_margin;
  const baselineLabel = baseline >= 0 ? `D+${baseline.toFixed(1)}` : `R+${Math.abs(baseline).toFixed(1)}`;

  // The active method's display label. Prefer the explicit override (which
  // carries slider-dialed values like "MMD-4"), keeping "PR" short for the
  // default so the common case still reads "… under PR".
  const activeMethodLabel = methodLabel ?? (method === 'PR' ? 'PR' : METHOD_LABELS[method]);

  // Projected stat-card label. In sandbox, surface the active method and
  // any house expansion so the user sees what's driving the numbers.
  let projectedLabel: string;
  if (viewMode === 'retrospective') {
    projectedLabel = 'Projected under PR (2024)';
  } else if (viewMode === 'sandbox') {
    const parts = ['sandbox'];
    if (houseSize !== DEFAULT_HOUSE_SIZE) parts.push(`${houseSize} seats`);
    projectedLabel = `Projected under ${activeMethodLabel} (${parts.join(' · ')})`;
  } else {
    projectedLabel = 'Projected under PR';
  }

  // Extended-sandbox rendering: when minors are active, show one stat
  // card per party (filtered to seats > 0) using the canonical party
  // colors. The "Actual today" and "Difference" cards stay two-party
  // because actual House membership is inherently D/R.
  const extendedParties = hasMinors
    ? sandboxPayload!.national.parties.filter((p) => p.seats > 0)
    : null;

  // Share / export rule: disable when the user's view diverges from
  // the canonical two-party Pure PR at 435 seats. Export contract
  // stays pinned to pipeline data; a tweak that doesn't make it into
  // the export would be misleading.
  const inExtendedSandbox =
    hasMinors || method !== 'PR' || houseSize !== DEFAULT_HOUSE_SIZE;
  const disabledTooltip = hasMinors
    ? 'Disabled while minor parties are active'
    : method !== 'PR'
      ? `Disabled under ${activeMethodLabel}`
      : houseSize !== DEFAULT_HOUSE_SIZE
        ? `Disabled with House size = ${houseSize}`
        : '';

  return (
    <section aria-label="National summary">
      <div className="max-w-6xl mx-auto px-6 pt-5 pb-2">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <SummaryStat
            label={projectedLabel}
            emphasis
            primary={
              extendedParties ? (
                <span className="inline-flex items-baseline gap-2 flex-wrap">
                  {extendedParties.map((p, i) => (
                    <span key={p.party.id} className="inline-flex items-baseline gap-2">
                      {i > 0 && <span className="text-stone-400 text-base">·</span>}
                      <span style={{ color: p.party.color }}>
                        {displayName(p.party)} {p.seats}
                        <Pct value={formatSeatPct(p.seats, projectedTotal)} />
                      </span>
                    </span>
                  ))}
                </span>
              ) : (
                <>
                  <span className="text-blue-700">
                    D {projectedD}<Pct value={formatSeatPct(projectedD, projectedTotal)} />
                  </span>
                  <span className="text-stone-400"> · </span>
                  <span className="text-red-700">
                    R {projectedR}<Pct value={formatSeatPct(projectedR, projectedTotal)} />
                  </span>
                </>
              )
            }
          />
          <SummaryStat
            label="Actual House today"
            primary={
              <>
                <span className="text-blue-700">
                  D {national.actual.d_seats}
                  <Pct value={formatSeatPct(national.actual.d_seats, actualTotal)} />
                </span>
                <span className="text-stone-400"> · </span>
                <span className="text-red-700">
                  R {national.actual.r_seats}
                  <Pct value={formatSeatPct(national.actual.r_seats, actualTotal)} />
                </span>
              </>
            }
          />
          <SummaryStat
            label={viewMode === 'sandbox' ? `Difference under ${activeMethodLabel}` : 'Difference under PR'}
            note={houseExpanded ? `vs. today’s split scaled to ${projectedTotal} seats` : undefined}
            primary={
              extendedParties ? (
                <span className="inline-flex items-baseline gap-2 flex-wrap text-base">
                  {extendedParties.map((p, i) => {
                    // Compare each party's projected seats to its actual
                    // baseline scaled to the projected House size (so chamber
                    // growth isn't read as a partisan shift). Minors are new,
                    // so their baseline is 0.
                    const baseline =
                      p.party.id === 'D'
                        ? baselineD
                        : p.party.id === 'R'
                          ? baselineR
                          : 0;
                    const delta = p.seats - baseline;
                    return (
                      <span key={p.party.id} className="inline-flex items-baseline gap-1">
                        {i > 0 && <span className="text-stone-400 text-sm">·</span>}
                        <span className="text-stone-500 text-xs uppercase tracking-wider">{displayName(p.party)}</span>
                        <span
                          className="font-semibold"
                          style={{ color: delta === 0 ? '#888780' : p.party.color }}
                        >
                          {delta > 0 ? '+' : ''}{delta}
                        </span>
                      </span>
                    );
                  })}
                </span>
              ) : (
                <span className={dGain >= 0 ? 'text-blue-700' : 'text-red-700'}>
                  {dGain > 0 ? '+' : ''}{dGain} D / {dGain > 0 ? '-' : '+'}{Math.abs(dGain)} R
                </span>
              )
            }
          />
        </div>

        <div className="mt-4 text-xs text-stone-500">
          {viewMode === 'retrospective' ? (
            <>
              <span className="font-medium text-stone-700">No swing applied</span>
              {': pure PR allocation of 2024’s actual votes'}
              {' · '}2024 baseline:{' '}
              <span className="font-medium text-stone-700">{baselineLabel}</span>
              {' · '}Method:{' '}
              <span className="font-medium text-stone-700">Sainte-Laguë</span>
            </>
          ) : viewMode === 'sandbox' ? (
            <>
              Hypothetical generic ballot:{' '}
              <span className="font-medium text-stone-700">{genericLabel}</span>
              {' · '}2024 baseline:{' '}
              <span className="font-medium text-stone-700">{baselineLabel}</span>
              {' · '}Swing applied:{' '}
              <span className={meta.swing >= 0 ? 'font-medium text-blue-700' : 'font-medium text-red-700'}>
                {meta.swing >= 0 ? '+' : ''}{meta.swing.toFixed(1)} pts toward {meta.swing >= 0 ? 'D' : 'R'}
              </span>
              {' · '}Method:{' '}
              <span className="font-medium text-stone-700">
                {method === 'PR' ? 'Sainte-Laguë' : activeMethodLabel}
              </span>
            </>
          ) : (
            <>
              Generic ballot today:{' '}
              <span className="font-medium text-stone-700">{genericLabel}</span>
              {' · '}2024 baseline:{' '}
              <span className="font-medium text-stone-700">{baselineLabel}</span>
              {' · '}Swing applied:{' '}
              <span className={meta.swing >= 0 ? 'font-medium text-blue-700' : 'font-medium text-red-700'}>
                {meta.swing >= 0 ? '+' : ''}{meta.swing.toFixed(1)} pts toward {meta.swing >= 0 ? 'D' : 'R'}
              </span>
              {' · '}Method:{' '}
              <span className="font-medium text-stone-700">Sainte-Laguë</span>
            </>
          )}
        </div>

        {/* Share / download buttons. In extended sandbox (minors active),
          * disable them — the share PNGs, CSV, JSON, and tweet text are
          * all hardcoded two-party right now; emitting them with a 3- or
          * 4-party projection would be misleading. */}
        <div className="mt-3 flex justify-end gap-1">
          {inExtendedSandbox ? (
            <span className="text-xs text-stone-400 italic self-center pr-2">
              Share &amp; export use the canonical two-party Pure PR projection.
            </span>
          ) : null}
          <button
            type="button"
            onClick={handleDownloadCsv}
            disabled={inExtendedSandbox}
            className="text-stone-500 hover:text-stone-900 hover:bg-stone-100 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-stone-500 disabled:cursor-not-allowed rounded-full h-9 px-2 flex items-center justify-center text-xs font-medium tracking-wide"
            aria-label="Download projection as CSV"
            title={inExtendedSandbox ? disabledTooltip : 'Download projection as CSV'}
          >
            CSV
          </button>
          <button
            type="button"
            onClick={handleDownloadJson}
            disabled={inExtendedSandbox}
            className="text-stone-500 hover:text-stone-900 hover:bg-stone-100 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-stone-500 disabled:cursor-not-allowed rounded-full h-9 px-2 flex items-center justify-center text-xs font-medium tracking-wide"
            aria-label="Download projection as JSON"
            title={inExtendedSandbox ? disabledTooltip : 'Download projection as JSON'}
          >
            JSON
          </button>
          <button
            type="button"
            onClick={handleShareTwitter}
            disabled={inExtendedSandbox}
            className="text-stone-500 hover:text-stone-900 hover:bg-stone-100 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-stone-500 disabled:cursor-not-allowed rounded-full h-9 w-9 flex items-center justify-center"
            aria-label="Share on X (Twitter)"
            title={inExtendedSandbox ? disabledTooltip : 'Share on X (Twitter)'}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
          </button>
          <button
            type="button"
            onClick={handleDownload}
            disabled={inExtendedSandbox}
            className="text-stone-500 hover:text-stone-900 hover:bg-stone-100 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-stone-500 disabled:cursor-not-allowed rounded-full h-9 w-9 flex items-center justify-center"
            aria-label="Save as image"
            title={inExtendedSandbox ? disabledTooltip : 'Save as image'}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </button>
        </div>
      </div>
    </section>
  );
}

function SummaryStat({
  label,
  primary,
  emphasis = false,
  note,
}: {
  label: string;
  primary: React.ReactNode;
  /** The headline finding card — gets a navy left-accent so it reads as primary. */
  emphasis?: boolean;
  /** Optional small caption under the value (e.g. a baseline clarification). */
  note?: string;
}) {
  return (
    <div
      className={[
        'rounded-lg border border-stone-200 bg-white px-5 py-4 shadow-sm',
        emphasis ? 'border-l-4 border-l-brand-navy' : '',
      ].join(' ')}
    >
      <div className="text-xs uppercase tracking-wider text-stone-500 font-medium">{label}</div>
      <div className="text-2xl font-semibold mt-1 tabular-nums">{primary}</div>
      {note && <div className="text-[11px] text-stone-500 mt-1">{note}</div>}
    </div>
  );
}

/**
 * Small muted percentage next to a stat-card seat integer. Inherits the
 * stat card's color via the wrapping <span>, but switches to a lighter
 * weight + smaller size so the integer still reads as the headline.
 * Renders nothing when the formatter returned "" (total <= 0).
 */
function Pct({ value }: { value: string }) {
  if (!value) return null;
  return (
    <span className="ml-1.5 text-sm font-normal text-stone-400 tabular-nums">{value}</span>
  );
}
