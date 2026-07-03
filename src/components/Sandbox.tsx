import type { ReactNode } from 'react';
import {
  ALL_METHODS,
  METHOD_DESCRIPTIONS,
  METHOD_LABELS,
  type AllocationMethodKind,
  type EffectiveMethod,
} from '../lib/methods';
import { fmtMargin } from '../lib/format';
import { SANDBOX_SCENARIOS, scenarioHouseSize, type Scenario } from '../lib/scenarios';
import { Term } from './Term';
import {
  defaultMinorState,
  MinorPartyControls,
  type MinorState,
} from './MinorPartyControls';

interface Props {
  /** Generic-ballot margin the user has chosen (positive = D lead, points). */
  genericBallot: number;
  /** Net swing relative to 2024 baseline, in points. Computed by caller. */
  swing: number;
  /** 2024 baseline margin (negative = R lead). Used to anchor the slider. */
  baseline2024: number;
  /** Today's live polling margin — Reset snaps the ballot slider back to it. */
  liveBallot: number;
  onChange: (genericBallot: number) => void;
  /** Extended-mode controls: minor parties + threshold. */
  minors: MinorState[];
  threshold: number;
  onMinorsChange: (minors: MinorState[]) => void;
  onThresholdChange: (threshold: number) => void;
  /** Allocation method (Pure PR / MMD-3 / MMD-5 / MMP-50). */
  method: AllocationMethodKind;
  onMethodChange: (next: AllocationMethodKind) => void;
  /** Resolved active method (family + magnitude/share + canonical key). */
  effective: EffectiveMethod;
  /** Set the MMD district magnitude (engaged when an MMD method is active). */
  onMmdMagnitudeChange: (magnitude: number) => void;
  /** Set the MMP single-member fraction 0..1 (engaged when MMP is active). */
  onMmpSmdShareChange: (fraction: number) => void;
  /** Total House size — 435 default; reform proposals expand. */
  houseSize: number;
  /** Wyoming Rule preset (~573 today). */
  wyomingRuleHouseSize: number;
  /** Cube root rule preset (~692 today). */
  cubeRootHouseSize: number;
  onHouseSizeChange: (next: number) => void;
}

const MIN = -15;
const MAX = 15;
const STEP = 0.1;

const PRESETS: { label: string; value: number }[] = [
  { label: 'R+10', value: -10 },
  { label: 'R+5', value: -5 },
  { label: 'Tie', value: 0 },
  { label: 'D+5', value: 5 },
  { label: 'D+10', value: 10 },
];

const THRESHOLD_MIN = 0;
const THRESHOLD_MAX = 0.1;
const THRESHOLD_STEP = 0.005;
const DEFAULT_THRESHOLD = 0.05;

const HOUSE_SIZE_MIN = 435;
const HOUSE_SIZE_MAX = 800;
const DEFAULT_HOUSE_SIZE = 435;

// District-magnitude (MMD) and single-member-share (MMP) slider bounds.
const MMD_MIN = 2;
const MMD_MAX = 10;
const MMP_PCT_MIN = 10;
const MMP_PCT_MAX = 90;
const MMP_PCT_STEP = 5;

export function Sandbox({
  genericBallot,
  swing,
  baseline2024,
  liveBallot,
  onChange,
  minors,
  threshold,
  onMinorsChange,
  onThresholdChange,
  method,
  onMethodChange,
  effective,
  onMmdMagnitudeChange,
  onMmpSmdShareChange,
  houseSize,
  wyomingRuleHouseSize,
  cubeRootHouseSize,
  onHouseSizeChange,
}: Props) {
  const addMinor = () => {
    // Defaults: slot 1 → Progressive Left, slot 2 → America First, slot 3
    // → fully-customizable Custom party. Users can change preset via the
    // dropdown.
    const preset =
      minors.length === 0 ? 'PROG' : minors.length === 1 ? 'AF' : 'CUSTOM';
    onMinorsChange([...minors, defaultMinorState(preset)]);
  };
  const updateMinor = (idx: number, next: MinorState) => {
    const copy = minors.slice();
    copy[idx] = next;
    onMinorsChange(copy);
  };
  const removeMinor = (idx: number) => {
    onMinorsChange(minors.filter((_, i) => i !== idx));
  };

  const MAX_MINORS = 3;
  const addButtonLabel =
    minors.length === 0
      ? '+ Add third party'
      : minors.length === 1
        ? '+ Add fourth party'
        : '+ Add fifth party';

  // Quick scenarios — shared registry with the home-view strip (lib/scenarios).
  // Applied through the same callbacks the manual controls use; onMethodChange
  // also clears any magnitude/share override, so these land on canonical
  // methods. The generic-ballot margin is intentionally left untouched.
  const applyScenario = (s: Scenario) => {
    onMinorsChange(s.config.minors.map((id) => defaultMinorState(id)));
    if (s.config.minors.length > 0) onThresholdChange(DEFAULT_THRESHOLD);
    onMethodChange(s.config.method);
    onHouseSizeChange(scenarioHouseSize(s.config));
  };
  const resetSandbox = () => {
    onChange(liveBallot);
    onMinorsChange([]);
    onThresholdChange(DEFAULT_THRESHOLD);
    onMethodChange('PR');
    onHouseSizeChange(DEFAULT_HOUSE_SIZE);
  };

  return (
    <div className="border border-stone-200 bg-stone-50 rounded-lg p-4">
      {/* Orientation: what this is + that everything updates live. */}
      <p className="text-sm text-stone-600 leading-relaxed">
        Build a what-if. Adjust the national mood, the parties, how seats are awarded, and the
        size of the House — the map, the totals above, and the comparison table all update instantly.
      </p>

      {/* Quick scenarios — the approachable entry point. Navy outline pills set
        * them apart from the stone preset/method buttons below. */}
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-stone-500 font-medium self-center">New here? Try —</span>
        {SANDBOX_SCENARIOS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => applyScenario(s)}
            title={s.title}
            className="px-3 py-1.5 sm:py-1 rounded-full border border-brand-navy/30 text-brand-navy hover:bg-brand-navy/5 transition-colors"
          >
            {s.chipLabel}
          </button>
        ))}
        <button
          type="button"
          onClick={resetSandbox}
          className="px-3 py-1.5 sm:py-1 rounded-full border border-stone-300 text-stone-600 hover:bg-stone-100 transition-colors"
        >
          Reset
        </button>
      </div>

      {/* 1 — The national mood (generic ballot). */}
      <Group
        first
        title="The national mood"
        sub="hypothetical generic ballot"
        description={
          <>
            Set a hypothetical national margin. Each state shifts from its 2024 result, scaled by
            how sharply it swings versus the nation (its <Term id="elasticity">elasticity</Term>).
          </>
        }
      >
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div className="text-2xl font-semibold tabular-nums">
            <span className={genericBallot >= 0 ? 'text-blue-700' : 'text-red-700'}>
              {fmtMargin(genericBallot)}
            </span>
          </div>
          <div className="text-xs text-stone-600">
            Resulting national swing vs. 2024 baseline ({fmtMargin(baseline2024)}):{' '}
            <span className={swing >= 0 ? 'text-blue-700 font-medium' : 'text-red-700 font-medium'}>
              {swing >= 0 ? '+' : ''}{swing.toFixed(1)} pts toward {swing >= 0 ? 'D' : 'R'}
            </span>
          </div>
        </div>

        <div className="mt-3 relative">
          <input
            type="range"
            min={MIN}
            max={MAX}
            step={STEP}
            value={genericBallot}
            onChange={(e) => onChange(Number(e.target.value))}
            aria-label="Hypothetical generic ballot margin"
            aria-valuetext={fmtMargin(genericBallot)}
            className="w-full accent-stone-900"
          />
          <div className="mt-1 flex justify-between text-xs text-stone-500 tabular-nums">
            <span>R+{Math.abs(MIN)}</span>
            <span>Tie</span>
            <span>D+{MAX}</span>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <span className="text-stone-500 uppercase tracking-wider self-center">Presets:</span>
          {PRESETS.map((p) => {
            const active = Math.abs(p.value - genericBallot) < STEP / 2;
            return (
              <button
                key={p.label}
                type="button"
                onClick={() => onChange(p.value)}
                className={[
                  'px-3 py-1.5 sm:px-2 sm:py-1 rounded border transition-colors',
                  active
                    ? 'bg-brand-navy text-white border-brand-navy'
                    : 'border-stone-300 text-stone-700 hover:bg-stone-100',
                ].join(' ')}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      </Group>

      {/* 2 — Add more parties (minors + threshold). */}
      <Group
        title="Add more parties"
        description="Split the vote with up to three extra parties and watch the seats divide. The threshold below can shut out the smallest."
        value={
          minors.length < MAX_MINORS ? (
            <button
              type="button"
              onClick={addMinor}
              className="text-xs px-3 py-1.5 sm:py-1 border border-stone-300 rounded text-stone-700 hover:bg-stone-100 flex-shrink-0"
            >
              {addButtonLabel}
            </button>
          ) : undefined
        }
      >
        {minors.length === 0 ? (
          <p className="text-xs text-stone-500">
            No extra parties yet — add one to model a coalition split.
          </p>
        ) : (
          <div className="space-y-3">
            {minors.map((m, i) => (
              <MinorPartyControls
                key={m.id ?? i}
                slot={(i + 1) as 1 | 2 | 3}
                state={m}
                onChange={(next) => updateMinor(i, next)}
                onRemove={() => removeMinor(i)}
              />
            ))}

            <div className="pt-1">
              <div className="flex items-baseline justify-between text-xs text-stone-600 mb-1">
                <span className="font-medium text-stone-700"><Term id="threshold">Threshold</Term> (per state)</span>
                <span className="tabular-nums font-medium text-stone-900">
                  {(threshold * 100).toFixed(1)}%
                </span>
              </div>
              <input
                type="range"
                min={THRESHOLD_MIN}
                max={THRESHOLD_MAX}
                step={THRESHOLD_STEP}
                value={threshold}
                onChange={(e) => onThresholdChange(Number(e.target.value))}
                aria-label="Minor party threshold"
                aria-valuetext={`${(threshold * 100).toFixed(1)} percent`}
                className="w-full accent-stone-900"
              />
              <p className="text-xs text-stone-500 mt-1">
                Parties below this share within a state win no seats. Real PR systems usually set
                this at 4–5%.
              </p>
            </div>
          </div>
        )}
      </Group>

      {/* 3 — How seats are awarded (allocation method). */}
      <Group
        title="How seats are awarded"
        description="From pure proportional to mixed-member districts. Pick a system — the note below explains what it does."
      >
        <div className="flex flex-wrap gap-1.5">
          {ALL_METHODS.map((m) => {
            // Highlight keys off the *effective* method, so MMD-3 lights up
            // only at magnitude 3, MMD-5 at 5, MMP-50 at 50% — and nothing
            // lights up at off-grid slider values (the slider shows them).
            const active = m === effective.canonicalKey;
            return (
              <button
                key={m}
                type="button"
                onClick={() => onMethodChange(m)}
                title={METHOD_DESCRIPTIONS[m]}
                className={[
                  'text-xs px-3 py-1.5 sm:py-1 rounded border tabular-nums transition-colors',
                  active
                    ? 'bg-brand-navy text-white border-brand-navy'
                    : 'border-stone-300 text-stone-700 hover:bg-stone-100',
                ].join(' ')}
                aria-pressed={active}
              >
                {METHOD_LABELS[m]}
              </button>
            );
          })}
        </div>

        {/* Contextual refinement slider. MMD methods expose district
          * magnitude; MMP exposes the single-member share. Dragging off a
          * preset value (e.g. MMD-4, MMP-30) de-highlights the preset
          * buttons and adds a "current" row to the comparison table. */}
        {effective.family === 'MMD' && (
          <div className="mt-3">
            <div className="flex items-baseline justify-between gap-2">
              <label htmlFor="mmd-magnitude" className="text-xs text-stone-600">
                District magnitude
              </label>
              <span className="tabular-nums text-xs font-medium text-stone-900">
                {effective.size}-seat districts
              </span>
            </div>
            <input
              id="mmd-magnitude"
              type="range"
              min={MMD_MIN}
              max={MMD_MAX}
              step={1}
              value={effective.size ?? 3}
              onChange={(e) => onMmdMagnitudeChange(Number(e.target.value))}
              aria-label="District magnitude"
              aria-valuetext={`${effective.size} seats per district`}
              className="w-full accent-stone-900 mt-1"
            />
            <p className="text-xs text-stone-500 mt-1">
              Bigger districts → more proportional. {MMD_MIN} approaches today’s single-member
              map; {MMD_MAX} approaches statewide PR.
            </p>
          </div>
        )}
        {effective.family === 'MMP' && (
          <div className="mt-3">
            <div className="flex items-baseline justify-between gap-2">
              <label htmlFor="mmp-smd-share" className="text-xs text-stone-600">
                Single-member share
              </label>
              <span className="tabular-nums text-xs font-medium text-stone-900">
                {Math.round((effective.smdShare ?? 0.5) * 100)}% district / {100 - Math.round((effective.smdShare ?? 0.5) * 100)}% list
              </span>
            </div>
            <input
              id="mmp-smd-share"
              type="range"
              min={MMP_PCT_MIN}
              max={MMP_PCT_MAX}
              step={MMP_PCT_STEP}
              value={Math.round((effective.smdShare ?? 0.5) * 100)}
              onChange={(e) => onMmpSmdShareChange(Number(e.target.value) / 100)}
              aria-label="Single-member district share"
              aria-valuetext={`${Math.round((effective.smdShare ?? 0.5) * 100)} percent single-member`}
              className="w-full accent-stone-900 mt-1"
            />
            <p className="text-xs text-stone-500 mt-1">
              Fewer single-member seats → more proportional (the list tier compensates further).
            </p>
          </div>
        )}

        <p className="text-xs text-stone-600 mt-2">{METHOD_DESCRIPTIONS[method]}</p>
      </Group>

      {/* 4 — Size of the House. */}
      <Group
        title="Size of the House"
        description="The 435 cap is a 1929 law, not the Constitution. A bigger chamber makes each state’s seats more proportional."
        value={<span className="tabular-nums font-medium text-stone-900">{houseSize} seats</span>}
      >
        <div className="flex flex-wrap gap-1.5">
          {[
            { label: '435 (today)', value: DEFAULT_HOUSE_SIZE, title: 'Current US House size, frozen by the 1929 Permanent Apportionment Act.' },
            { label: `${wyomingRuleHouseSize} (Wyoming Rule)`, value: wyomingRuleHouseSize, title: 'Cap district population at the smallest state’s. ~573 today.' },
            { label: `${cubeRootHouseSize} (Cube root)`, value: cubeRootHouseSize, title: 'House size ≈ ∛(US population). ~692 today (Taagepera and Shugart, 1989).' },
          ].map((p) => {
            const active = p.value === houseSize;
            return (
              <button
                key={p.label}
                type="button"
                onClick={() => onHouseSizeChange(p.value)}
                title={p.title}
                className={[
                  'text-xs px-3 py-1.5 sm:py-1 rounded border tabular-nums transition-colors',
                  active
                    ? 'bg-brand-navy text-white border-brand-navy'
                    : 'border-stone-300 text-stone-700 hover:bg-stone-100',
                ].join(' ')}
                aria-pressed={active}
              >
                {p.label}
              </button>
            );
          })}
        </div>
        <input
          type="range"
          min={HOUSE_SIZE_MIN}
          max={HOUSE_SIZE_MAX}
          step={1}
          value={houseSize}
          onChange={(e) => onHouseSizeChange(Number(e.target.value))}
          aria-label="House size slider"
          aria-valuetext={`${houseSize} seats`}
          className="w-full accent-stone-900 mt-2"
        />
        <p className="text-xs text-stone-500 mt-1">
          Seats reapportion among states via Huntington-Hill, the same method the real US House
          uses. “Actual today” in the comparison table stays at 435; reform rows reflect the chosen
          size.
        </p>
      </Group>
    </div>
  );
}

/**
 * Consistent header + chrome for one Sandbox control group: a bold plain-English
 * title (with an optional secondary technical label), an optional right-aligned
 * value/action, and a readable one-line description. Sections after the first
 * get a top border + spacing so the four levers read as parallel, scannable
 * groups rather than a single wall of inputs.
 */
function Group({
  title,
  sub,
  description,
  value,
  first = false,
  children,
}: {
  title: string;
  sub?: string;
  description?: ReactNode;
  value?: ReactNode;
  first?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className={first ? 'mt-5' : 'mt-5 pt-5 border-t border-stone-200'}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-stone-900">
          {title}
          {sub && <span className="ml-2 text-xs font-normal text-stone-400">{sub}</span>}
        </h3>
        {value}
      </div>
      {description && <p className="text-xs text-stone-600 mt-1 mb-3 max-w-prose">{description}</p>}
      {children}
    </section>
  );
}
