// #48 (#24-2): unit tests for the PURE derivation that maps the existing
// page/state-machine values to the #47 SessionFeedbackCue contract. The cue
// must never own business state: these tests pin that every cue state is
// derived solely from loading / selected viewpoint / completed / the
// persisted interrogation strategy.
import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  CHALLENGE_STRATEGIES,
  deriveFeedbackCueState,
} from '../../src/lib/feedback-cue-state';

describe('deriveFeedbackCueState — pure state mapping (#48)', () => {
  it('returns retrieving while a report request is loading', () => {
    assert.strictEqual(
      deriveFeedbackCueState({
        loading: true,
        hasSelectedViewpoint: false,
        completed: false,
        currentStrategy: null,
      }),
      'retrieving'
    );
  });

  it('loading takes priority over completed and strategy (single honest status)', () => {
    assert.strictEqual(
      deriveFeedbackCueState({
        loading: true,
        hasSelectedViewpoint: true,
        completed: true,
        currentStrategy: 'M4_steelman',
      }),
      'retrieving'
    );
  });

  it('returns completed once the session is explicitly complete', () => {
    assert.strictEqual(
      deriveFeedbackCueState({
        loading: false,
        hasSelectedViewpoint: true,
        completed: true,
        currentStrategy: 'M4_steelman',
      }),
      'completed'
    );
    assert.strictEqual(
      deriveFeedbackCueState({
        loading: false,
        hasSelectedViewpoint: false,
        completed: true,
        currentStrategy: null,
      }),
      'completed'
    );
  });

  it('returns null before a viewpoint is selected (stance stage has no cue)', () => {
    assert.strictEqual(
      deriveFeedbackCueState({
        loading: false,
        hasSelectedViewpoint: false,
        completed: false,
        currentStrategy: null,
      }),
      null
    );
    assert.strictEqual(
      deriveFeedbackCueState({
        loading: false,
        hasSelectedViewpoint: false,
        completed: false,
        currentStrategy: 'M1_evidence',
      }),
      null
    );
  });

  for (const strategy of ['M4_steelman', 'M6_reversal'] as const) {
    it(`maps challenge strategy ${strategy} to challenging`, () => {
      assert.strictEqual(
        deriveFeedbackCueState({
          loading: false,
          hasSelectedViewpoint: true,
          completed: false,
          currentStrategy: strategy,
        }),
        'challenging'
      );
    });
  }

  for (const strategy of ['M1_evidence', 'M2_premise', 'M5_restate'] as const) {
    it(`maps normal strategy ${strategy} to questioning`, () => {
      assert.strictEqual(
        deriveFeedbackCueState({
          loading: false,
          hasSelectedViewpoint: true,
          completed: false,
          currentStrategy: strategy,
        }),
        'questioning'
      );
    });
  }

  it('maps an in-flight first question (selected, strategy still null) to questioning', () => {
    assert.strictEqual(
      deriveFeedbackCueState({
        loading: false,
        hasSelectedViewpoint: true,
        completed: false,
        currentStrategy: null,
      }),
      'questioning'
    );
  });

  it('challenge set is exactly the two adversarial strategies (no mode creep)', () => {
    assert.deepStrictEqual([...CHALLENGE_STRATEGIES], ['M4_steelman', 'M6_reversal']);
  });
});
