// #48 (#24-2): Pure derivation from the EXISTING page/interrogation state to
// the #47 SessionFeedbackCue contract. This module owns no state and performs
// no side effects: page.tsx feeds its current loading / selected viewpoint /
// completed / persisted strategy values in and receives a cue state (or null
// when no cue applies). It must never invent a parallel business state
// machine — "challenging" is decided solely by the persisted strategy plan
// (M4 steel-man / M6 reversal are the adversarial rounds), never by guessing
// question text.

import type { StrategyId } from './strategy-engine';
import type { FeedbackCueState } from '../app/components/SessionFeedbackCue';

/**
 * Adversarial rounds of the fixed five-round plan (strategy-engine.ts):
 * M4_steelman asks for the strongest opposing view, M6_reversal asks the user
 * to defend the reverse stance. M1 evidence / M2 premise / M5 restate are
 * normal questioning rounds.
 */
export const CHALLENGE_STRATEGIES: readonly StrategyId[] = ['M4_steelman', 'M6_reversal'];

export interface FeedbackCueDerivationInput {
  /** A report retrieval/regeneration request is in flight (page-level loading). */
  loading: boolean;
  /** A stance has been chosen and the interrogation view is active. */
  hasSelectedViewpoint: boolean;
  /** The session reached explicit completion (result card is shown). */
  completed: boolean;
  /** Currently persisted interrogation strategy from the state machine, if any. */
  currentStrategy: StrategyId | null;
}

/**
 * Derive the feedback cue state from existing state only.
 *
 * Precedence: retrieving (request in flight) > completed > interrogation
 * rounds. Before a viewpoint is selected the cue is absent (null). Within a
 * session, M4/M6 map to challenging; every other (including the brief window
 * where the next question is still being fetched and strategy is null) maps
 * to questioning.
 */
export function deriveFeedbackCueState(
  input: FeedbackCueDerivationInput
): FeedbackCueState | null {
  if (input.loading) return 'retrieving';
  if (input.completed) return 'completed';
  if (!input.hasSelectedViewpoint) return null;
  if (input.currentStrategy !== null && CHALLENGE_STRATEGIES.includes(input.currentStrategy)) {
    return 'challenging';
  }
  return 'questioning';
}
