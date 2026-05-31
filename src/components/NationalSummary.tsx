import { useCallback, useState } from 'react';
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
import { Term } from './Term';

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
  /**
   * Structural component of the Current-view gap (D seats): PR of the actual
   * 2024 vote minus today's House. Used to annotate the "Difference under PR"
   * card with the structural-vs-swing split. Current view only.
   */
  structuralDGain?: number;
  /** Selected cycle for the Retrospective view (labels the settings line). */
  retroYear?: number;
}

export function NationalSummary({
  payload,
  viewMode = 'current',
  sandboxPayload,
  method = 'PR',
  methodLabel,
  houseSize = DEFAULT_HOUSE_SIZE,
  structuralDGain,
  retroYear = 2024,
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

  // Copy a link to the current view. The whole scenario (view, color, sandbox
  // ballot/minors/threshold/method/house, open state) round-trips through the
  // URL — Home syncs it on every change — so window.location.href captures it
  // exactly. Unlike the PNG/CSV/JSON/tweet, this works for ANY scenario, so
  // it's never disabled. (localhost + https are both secure clipboard contexts.)
  const [copied, setCopied] = useState(false);
  const handleCopyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard unavailable (insecure context / denied) — no-op.
    }
  }, []);
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
  // Current-view decomposition: the gap = structural (PR of the 2024 vote vs.
  // today's House) + the swing since 2024. Annotate the Difference card so the
  // gap isn't read as purely structural (it mostly isn't).
  const showDecomposition = viewMode === 'current' && !sandboxPayload && structuralDGain != null;
  const swingDGain = structuralDGain != null ? dGain - structuralDGain : 0;
  const signedD = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v)} D`;
  const differenceNote = houseExpanded
    ? `vs. today’s split scaled to ${projectedTotal} seats`
    : showDecomposition
      ? `≈ ${signedD(structuralDGain as number)} structural · ${signedD(swingDGain)} since 2024`
      : undefined;
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
    projectedLabel = `Projected under PR (${retroYear})`;
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

  // The three stat values, extracted so the scoreboard markup stays readable.
  const projectedValue = extendedParties ? (
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
  );

  const actualValue = (
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
  );

  const diffValue = extendedParties ? (
    <span className="inline-flex items-baseline gap-2 flex-wrap text-base">
      {extendedParties.map((p, i) => {
        // Compare each party's projected seats to its actual baseline scaled to
        // the projected House size (so chamber growth isn't read as a partisan
        // shift). Minors are new, so their baseline is 0.
        const base = p.party.id === 'D' ? baselineD : p.party.id === 'R' ? baselineR : 0;
        const delta = p.seats - base;
        return (
          <span key={p.party.id} className="inline-flex items-baseline gap-1">
            {i > 0 && <span className="text-stone-400 text-sm">·</span>}
            <span className="text-stone-500 text-xs uppercase tracking-wider">{displayName(p.party)}</span>
            <span className="font-semibold" style={{ color: delta === 0 ? '#888780' : p.party.color }}>
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
  );

  const diffLabel = viewMode === 'sandbox' ? `Difference under ${activeMethodLabel}` : 'Difference under PR';

  return (
    <section aria-label="National summary">
      <div className="max-w-6xl mx-auto px-6 pt-3 pb-2">
        {/* Compact scoreboard: the three national stats in one divided row
          * (stacks on mobile) so the map below sits higher. A navy left spine
          * marks it as the key readout; the projected total leads. */}
        <div className="rounded-lg border border-stone-200 border-l-4 border-l-brand-navy bg-white shadow-sm overflow-hidden grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-stone-200">
          <ScoreCell label={projectedLabel} value={projectedValue} />
          <ScoreCell
            label={viewMode === 'retrospective' ? `Actual ${retroYear} House` : 'Actual House today'}
            value={actualValue}
          />
          <ScoreCell label={diffLabel} value={diffValue} note={differenceNote} />
        </div>

        {/* Settings line + share/export on one row to keep the band compact.
          * Exports disable in extended sandbox (minors / non-PR / resized
          * House) — the share PNG, CSV, JSON, and tweet are two-party-only. */}
        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="text-xs text-stone-500 min-w-0">
            {viewMode === 'retrospective' ? (
              <>
                <span className="font-medium text-stone-700">No swing applied</span>
                {`: pure PR allocation of ${retroYear}’s actual votes`}
                {' · '}{retroYear} national House vote:{' '}
                <span className="font-medium text-stone-700">{baselineLabel}</span>
                {' · '}Method:{' '}
                <span className="font-medium text-stone-700"><Term id="sainte-lague">Sainte-Laguë</Term></span>
              </>
            ) : viewMode === 'sandbox' ? (
              <>
                Hypothetical <Term id="generic-ballot">generic ballot</Term>:{' '}
                <span className="font-medium text-stone-700">{genericLabel}</span>
                {' · '}<Term id="baseline-2024">2024 baseline</Term>:{' '}
                <span className="font-medium text-stone-700">{baselineLabel}</span>
                {' · '}<Term id="swing">Swing</Term> applied:{' '}
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
                <Term id="generic-ballot">Generic ballot</Term> today:{' '}
                <span className="font-medium text-stone-700">{genericLabel}</span>
                {' · '}<Term id="baseline-2024">2024 baseline</Term>:{' '}
                <span className="font-medium text-stone-700">{baselineLabel}</span>
                {' · '}<Term id="swing">Swing</Term> applied:{' '}
                <span className={meta.swing >= 0 ? 'font-medium text-blue-700' : 'font-medium text-red-700'}>
                  {meta.swing >= 0 ? '+' : ''}{meta.swing.toFixed(1)} pts toward {meta.swing >= 0 ? 'D' : 'R'}
                </span>
                {' · '}Method:{' '}
                <span className="font-medium text-stone-700"><Term id="sainte-lague">Sainte-Laguë</Term></span>
              </>
            )}
          </div>

          <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={handleCopyLink}
            className={[
              'rounded-full h-9 px-2.5 flex items-center gap-1.5 text-xs font-medium tracking-wide',
              copied ? 'text-green-700' : 'text-stone-500 hover:text-stone-900 hover:bg-stone-100',
            ].join(' ')}
            aria-label="Copy a link to this view"
            title="Copy a link to this view (captures the current scenario)"
          >
            {copied ? (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
              </svg>
            )}
            {copied ? 'Copied!' : 'Copy link'}
          </button>
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
      </div>
    </section>
  );
}

function ScoreCell({
  label,
  value,
  note,
}: {
  label: string;
  value: React.ReactNode;
  /** Optional small caption under the value (e.g. the structural/swing split). */
  note?: string;
}) {
  return (
    <div className="px-4 py-2.5">
      <div className="text-[11px] uppercase tracking-wider text-stone-500 font-medium">{label}</div>
      <div className="text-xl font-semibold mt-0.5 tabular-nums">{value}</div>
      {note && <div className="text-[11px] text-stone-500 mt-0.5 leading-snug">{note}</div>}
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
