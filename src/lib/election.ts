/**
 * The election lifecycle, client side.
 *
 * The pipeline stamps `meta.election` into projection.json (see
 * data-pipeline/election.py). Its `phase` is the phase as of the run that wrote
 * the file — but at freeze_at (5 AM ET on election day) the site has to switch
 * without waiting for a pipeline run or a deploy. So the phase is read through
 * `electionPhase`, which promotes a 'projection' payload to 'counting' once the
 * clock passes freeze_at. The v1 API does the same (functions/api/v1).
 *
 * After the freeze, projection.json is the final pre-election projection,
 * republished unchanged. Nothing about it is "today's" or "current" any more,
 * which is what `projectionCopy` is for: every string whose meaning changes at
 * the freeze comes from here, so the two phases can't drift apart.
 */
import type { ElectionMeta, ElectionPhase, ProjectionMeta } from './types';

export function electionPhase(
  election: ElectionMeta | null | undefined,
  now: number = Date.now(),
): ElectionPhase {
  if (!election) return 'projection';
  if (election.phase && election.phase !== 'projection') return election.phase;
  const freezeMs = Date.parse(election.freeze_at);
  return Number.isFinite(freezeMs) && now >= freezeMs ? 'counting' : 'projection';
}

/** True once the projection is frozen for the election (counting or results). */
export function isFrozen(
  meta: Pick<ProjectionMeta, 'election'> | null | undefined,
  now: number = Date.now(),
): boolean {
  return electionPhase(meta?.election, now) !== 'projection';
}

/**
 * Calendar date of a timestamp in Eastern time, e.g. "Nov 3, 2026". Eastern
 * because the freeze is an Election Day event; a 1 AM ET run is "Nov 3" to
 * the reader even though it's Nov 3 06:00 UTC.
 */
export function easternDate(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  return new Date(ms).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'America/New_York',
  });
}

export interface ProjectionCopy {
  frozen: boolean;
  /** The election year the projection is for. */
  cycle: number;
  /** Tab / card heading: "Current Projection" → "Final Projection". */
  viewLabel: string;
  /** One-line descriptor under the tab label. */
  viewDesc: string;
  /** Inline prose: "today's polling" → "the final pre-election polling". */
  pollingPhrase: string;
  /** Sentence-start label: "Current polling" → "Final pre-election polling". */
  pollingLabel: string;
  /** Uppercase share-card label: "CURRENT POLLING" → "FINAL PROJECTION". */
  shareLabel: string;
  /** Footer timestamp prefix: "Updated" → "Final projection published". */
  updatedLabel: string;
  /** Date the frozen projection was published (Eastern), or '' before the freeze. */
  frozenOn: string;
}

export function projectionCopy(
  meta: Pick<ProjectionMeta, 'election' | 'generated_at'> | null | undefined,
  now: number = Date.now(),
): ProjectionCopy {
  const cycle = meta?.election?.cycle ?? 2026;
  if (!isFrozen(meta, now)) {
    return {
      frozen: false,
      cycle,
      viewLabel: 'Current Projection',
      viewDesc: 'Today’s polling',
      pollingPhrase: 'today’s polling',
      pollingLabel: 'Current polling',
      shareLabel: 'CURRENT POLLING',
      updatedLabel: 'Updated',
      frozenOn: '',
    };
  }
  const frozenOn = meta?.generated_at ? easternDate(meta.generated_at) : '';
  return {
    frozen: true,
    cycle,
    viewLabel: 'Final Projection',
    viewDesc: frozenOn ? `Polls as of ${frozenOn.replace(/, \d{4}$/, '')}` : 'Final pre-election polls',
    pollingPhrase: 'the final pre-election polling',
    pollingLabel: 'Final pre-election polling',
    shareLabel: 'FINAL PROJECTION',
    updatedLabel: 'Final projection published',
    frozenOn,
  };
}
