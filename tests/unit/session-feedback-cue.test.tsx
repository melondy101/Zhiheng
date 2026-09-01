// #50 (#24-1): component contract tests for SessionFeedbackCue.
//
// These tests pin the stable, side-effect-free contract that #48 wires into
// the existing state machine: exactly four cue states, text that is always
// present (the image is never the sole information carrier), accessible
// status semantics, official transparent GIF assets under public/feedback/official/,
// and graceful degradation when motion is reduced or the image is unavailable/failed.
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import SessionFeedbackCue, {
  FEEDBACK_CUE_CONTENT,
  FEEDBACK_CUE_STATES,
  FeedbackCueState,
} from '../../src/app/components/SessionFeedbackCue';

function render(props: Parameters<typeof SessionFeedbackCue>[0]): string {
  return renderToStaticMarkup(createElement(SessionFeedbackCue, props));
}

const STATE_KEYWORD: Record<FeedbackCueState, string> = {
  retrieving: '检索',
  questioning: '提问',
  challenging: '挑战',
  completed: '完成',
};

describe('SessionFeedbackCue — stable state contract (#50)', () => {
  it('exposes exactly the four contracted states, in canonical order', () => {
    assert.deepStrictEqual([...FEEDBACK_CUE_STATES], [
      'retrieving',
      'questioning',
      'challenging',
      'completed',
    ]);
    assert.deepStrictEqual(Object.keys(FEEDBACK_CUE_CONTENT).sort(), [...FEEDBACK_CUE_STATES].sort());
  });

  for (const state of FEEDBACK_CUE_STATES) {
    describe(`state=${state}`, () => {
      it('renders an accessible polite status region carrying the state key', () => {
        const html = render({ state });
        assert.match(html, /role="status"/);
        assert.match(html, /aria-live="polite"/);
        assert.match(html, new RegExp(`data-cue-state="${state}"`));
        assert.match(html, /data-testid="session-feedback-cue"/);
      });

      it('always renders semantic text (image is never the sole carrier)', () => {
        const html = render({ state });
        const content = FEEDBACK_CUE_CONTENT[state]!;
        assert.ok(content.label.length > 0, 'label must be non-empty');
        assert.ok(content.description.length > 0, 'description must be non-empty');
        assert.ok(html.includes(content.label), `label missing: ${content.label}`);
        assert.ok(html.includes(content.description), `description missing: ${content.description}`);
        assert.ok(html.includes(STATE_KEYWORD[state]!), `state keyword ${STATE_KEYWORD[state]} missing`);
      });

      it('renders a controlled local official GIF asset with proper alt and lazy-loading hints', () => {
        const html = render({ state, reducedMotion: false });
        const content = FEEDBACK_CUE_CONTENT[state]!;
        assert.match(content.asset, /^\/feedback\/official\/[\w-]+\.gif$/);
        assert.doesNotMatch(content.asset, /^https?:/);
        assert.ok(content.alt.length > 0, 'alt text must be non-empty');
        assert.match(html, new RegExp(`src="${content.asset}"`));
        assert.match(html, new RegExp(`alt="${content.alt}"`));
        assert.match(html, /loading="lazy"/);
        assert.match(html, /decoding="async"/);
        assert.match(html, /width="96"/);
        assert.match(html, /height="96"/);
      });

      it('never uses 瞌睡 or 运球 GIFs', () => {
        const content = FEEDBACK_CUE_CONTENT[state]!;
        assert.ok(!content.asset.includes('瞌睡'), 'must not use 瞌睡 GIF');
        assert.ok(!content.asset.includes('运球'), 'must not use 运球 GIF');
      });

      it('never references docs/ runtime paths', () => {
        const content = FEEDBACK_CUE_CONTENT[state]!;
        assert.ok(!content.asset.startsWith('/docs/'), 'must not reference docs/ runtime path');
        assert.ok(!content.asset.includes('docs/'), 'must not reference docs/ runtime path');
      });

      it('renders no interactive controls (no business side effects, no blocking)', () => {
        const html = render({ state });
        assert.doesNotMatch(html, /<button/);
        assert.doesNotMatch(html, /<a[\s>]/);
        assert.doesNotMatch(html, /<input/);
        assert.doesNotMatch(html, /fetch\(|setInterval|setTimeout/);
      });

      it('never advertises unimplemented modes', () => {
        const html = render({ state });
        for (const banned of ['快速模式', '深度模式', '趣味', 'GalGame', 'galgame', 'Galgame']) {
          assert.ok(!html.includes(banned), `must not render unimplemented mode: ${banned}`);
        }
      });
    });
  }
});

describe('SessionFeedbackCue — degradation (#50)', () => {
  it('imageUnavailable renders text-only output with no <img>, text intact', () => {
    const html = render({ state: 'retrieving', imageUnavailable: true });
    assert.doesNotMatch(html, /<img/);
    assert.ok(html.includes(FEEDBACK_CUE_CONTENT.retrieving!.label));
    assert.ok(html.includes(FEEDBACK_CUE_CONTENT.retrieving!.description));
    assert.match(html, /data-testid="session-feedback-cue-text-art"/);
  });

  it('defaults (SSR-safe first render) hide GIF and show glyph fallback', () => {
    const html = render({ state: 'questioning' });
    assert.doesNotMatch(html, /<img/);
    assert.match(html, /data-testid="session-feedback-cue-text-art"/);
    assert.ok(html.includes(FEEDBACK_CUE_CONTENT.questioning!.label));
    assert.ok(html.includes(FEEDBACK_CUE_CONTENT.questioning!.description));
  });

  it('reducedMotion=true hides GIF and shows glyph fallback with text intact', () => {
    const html = render({ state: 'questioning', reducedMotion: true });
    assert.doesNotMatch(html, /<img/);
    assert.match(html, /data-testid="session-feedback-cue-text-art"/);
    assert.ok(html.includes(FEEDBACK_CUE_CONTENT.questioning!.label));
    assert.ok(html.includes(FEEDBACK_CUE_CONTENT.questioning!.description));
  });

  it('reducedMotion=false shows the official GIF image', () => {
    const html = render({ state: 'completed', reducedMotion: false });
    assert.match(html, /data-testid="session-feedback-cue-image"/);
    assert.match(html, new RegExp(`src="${FEEDBACK_CUE_CONTENT.completed!.asset}"`));
    assert.ok(html.includes(FEEDBACK_CUE_CONTENT.completed!.label));
    assert.ok(html.includes(FEEDBACK_CUE_CONTENT.completed!.description));
  });

  it('text-only mode (reducedMotion + imageUnavailable) shows glyph and no img', () => {
    const html = render({ state: 'challenging', reducedMotion: true, imageUnavailable: true });
    assert.doesNotMatch(html, /<img/);
    assert.match(html, /data-testid="session-feedback-cue-text-art"/);
    assert.ok(html.includes(FEEDBACK_CUE_CONTENT.challenging!.label));
    assert.ok(html.includes(FEEDBACK_CUE_CONTENT.challenging!.description));
  });

  it('normal motion renders the GIF while preserving full text', () => {
    // The browser-level route-abort Golden Path covers the onError transition.
    // This server-rendered contract test only pins the normal-image structure.
    const html = render({ state: 'retrieving', reducedMotion: false });
    assert.match(html, /data-testid="session-feedback-cue-image"/);
    assert.ok(html.includes(FEEDBACK_CUE_CONTENT.retrieving!.label));
    assert.ok(html.includes(FEEDBACK_CUE_CONTENT.retrieving!.description));
  });
});

describe('SessionFeedbackCue — asset constraints (#50)', () => {
  it('all four assets are GIFs in the official directory', () => {
    for (const state of FEEDBACK_CUE_STATES) {
      const asset = FEEDBACK_CUE_CONTENT[state]!.asset;
      assert.match(asset, /^\/feedback\/official\/.+\.gif$/,
        `${state} asset must be a GIF in /feedback/official/`);
    }
  });

  it('no 瞌睡 or 运ball GIFs in any state', () => {
    for (const state of FEEDBACK_CUE_STATES) {
      const asset = FEEDBACK_CUE_CONTENT[state]!.asset;
      assert.ok(!asset.includes('瞌睡'), `${state} must not use 瞌睡`);
      assert.ok(!asset.includes('运球'), `${state} must not use 运球`);
    }
  });

  it('no docs/ runtime paths in any state', () => {
    for (const state of FEEDBACK_CUE_STATES) {
      const asset = FEEDBACK_CUE_CONTENT[state]!.asset;
      assert.ok(!asset.includes('docs/'), `${state} must not reference docs/`);
    }
  });
});
