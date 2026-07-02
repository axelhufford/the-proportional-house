/**
 * Inter-state House apportionment.
 *
 * The actual US House since 1941 uses the **Huntington-Hill** ("Method
 * of Equal Proportions") apportionment algorithm to divide a fixed
 * House size among the 50 states. We use the same method when the
 * Sandbox House-expansion feature changes the total seat count — most
 * reform proposals keep Huntington-Hill, so this matches the spirit of
 * what would actually happen.
 *
 * Algorithm:
 *   1. Each state with population > 0 gets at least `min_seats_per_state`
 *      seats (default 1 — matches the constitutional minimum).
 *   2. Remaining seats are assigned one at a time. Each round, the state
 *      with the highest "priority" wins the next seat. Priority for a
 *      state currently holding n seats:
 *
 *        A(n) = population / sqrt(n × (n + 1))
 *
 *      The geometric-mean divisor `sqrt(n × (n+1))` is what makes this
 *      "Huntington-Hill" rather than, say, Sainte-Laguë (arithmetic mean)
 *      or D'Hondt (just n+1).
 *   3. Continue until all `total_seats` are assigned.
 *
 * Plus two helpers for the Sandbox House-expansion presets:
 *   - `wyomingRuleSize` — cap district population at the smallest state's.
 *   - `cubeRootSize` — House size ≈ ∛(total population).
 */

import {
  TOTAL_APPORTIONMENT_POPULATION_2020,
  WYOMING_POPULATION_2020,
} from './statePopulations';

export interface ApportionmentInput {
  /** Map of state postal code → population. States with population 0 are skipped. */
  state_populations: Record<string, number>;
  /** Total seats to apportion (must be ≥ number of qualifying states × min_seats_per_state). */
  total_seats: number;
  /** Constitutional minimum (default 1). */
  min_seats_per_state?: number;
}

/**
 * Huntington-Hill / Method of Equal Proportions apportionment. Returns
 * a map of state code → seat count summing to `total_seats`.
 *
 * Implementation note: the per-round scan is O(N_states) and we do
 * `total_seats - 50` rounds, so the whole call is O(N × R). For US
 * scale (50 states, up to ~800 seats) that's ≤ 40,000 ops — instant.
 */
export function huntingtonHill(input: ApportionmentInput): Record<string, number> {
  const { state_populations, total_seats, min_seats_per_state = 1 } = input;

  const states = Object.keys(state_populations).filter(
    (s) => state_populations[s] > 0,
  );
  const seats: Record<string, number> = {};
  for (const s of states) seats[s] = min_seats_per_state;

  let assigned = states.length * min_seats_per_state;
  // Pathological case: requested total < combined minimums. Caller error,
  // but bail out cleanly rather than looping negative.
  if (assigned >= total_seats) return seats;

  const remaining = total_seats - assigned;
  for (let r = 0; r < remaining; r++) {
    let bestState = '';
    let bestPriority = -1;
    for (const s of states) {
      const n = seats[s];
      // Huntington-Hill priority: pop / sqrt(n × (n+1))
      const priority = state_populations[s] / Math.sqrt(n * (n + 1));
      if (priority > bestPriority) {
        bestPriority = priority;
        bestState = s;
      }
    }
    if (bestState) {
      seats[bestState]++;
      assigned++;
    }
  }

  return seats;
}

/**
 * Wyoming Rule: cap district population at the smallest state's. The
 * House grows to roughly totalPop / smallestStatePop seats. With the
 * 2020 census numbers, this puts the House at ~573 seats.
 */
export function wyomingRuleSize(totalPop: number, smallestStatePop: number): number {
  if (smallestStatePop <= 0) return 0;
  return Math.round(totalPop / smallestStatePop);
}

/**
 * Cube root rule (Taagepera & Shugart, *Seats and Votes*, 1989): the
 * size of a legislature should scale roughly as the cube root of the
 * population it represents. With the 2020 census this puts the House at
 * ~692 seats.
 */
export function cubeRootSize(totalPop: number): number {
  if (totalPop <= 0) return 0;
  return Math.round(Math.cbrt(totalPop));
}

/** Precomputed Wyoming Rule House size from 2020 census numbers (~573). */
export const WYOMING_RULE_HOUSE_SIZE = wyomingRuleSize(
  TOTAL_APPORTIONMENT_POPULATION_2020,
  WYOMING_POPULATION_2020,
);
/** Precomputed cube root House size from 2020 census numbers (~692). */
export const CUBE_ROOT_HOUSE_SIZE = cubeRootSize(TOTAL_APPORTIONMENT_POPULATION_2020);
