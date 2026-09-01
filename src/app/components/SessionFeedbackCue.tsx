'use client';

// #47 (#24-1): SessionFeedbackCue — a small, side-effect-free 刘看山 status
// cue. The component only renders a visual + text description for one of four
// contracted states; it owns no session business state, makes no network
// requests beyond loading its own local static asset, and never blocks input.
//
// Accessibility contract:
// - role="status" + aria-live="polite" so screen readers announce transitions.
// - The text label/description are ALWAYS rendered: the image is reinforcement,
//   never the sole information carrier.
// - When the image fails to load (onError) or is explicitly unavailable the
//   component degrades to a text-only cue with a decorative emoji glyph.
// - Motion is opt-in: the first (SSR-safe) render assumes reduced motion; a
//   client effect flips it on only when the OS media query allows motion. The
//   `reducedMotion` prop lets callers/tests override detection deterministically.

import { useEffect, useState } from 'react';

export const FEEDBACK_CUE_STATES = [
  'retrieving',
  'questioning',
  'challenging',
  'completed',
] as const;

export type FeedbackCueState = (typeof FEEDBACK_CUE_STATES)[number];

export interface FeedbackCueContent {
  /** Stable state key, also exposed as data-cue-state. */
  key: FeedbackCueState;
  /** Always-visible short status text (semantic equivalent of the image). */
  label: string;
  /** Always-visible one-line explanation. */
  description: string;
  /** Controlled local static asset (see docs/assets/feedback-cue-assets.md). */
  asset: string;
  /** Descriptive alternative text for the image. */
  alt: string;
  /** Decorative text glyph used only when the image cannot be shown. */
  fallbackGlyph: string;
}

/**
 * The single source of truth for per-state copy and assets. #48 must derive
 * WHICH state to show from the existing loading/strategy/completed state — it
 * must never extend this contract with unimplemented modes.
 */
export const FEEDBACK_CUE_CONTENT: Record<FeedbackCueState, FeedbackCueContent> = {
  retrieving: {
    key: 'retrieving',
    label: '刘看山正在检索资料',
    description: '正在汇总知乎与全网资料，请稍候。',
    asset: '/feedback/liukanshan-retrieving.svg',
    alt: '刘看山抱着放大镜，正在检索资料',
    fallbackGlyph: '🔎',
  },
  questioning: {
    key: 'questioning',
    label: '刘看山正在向你提问',
    description: '请结合报告证据，继续你的思考。',
    asset: '/feedback/liukanshan-questioning.svg',
    alt: '刘看山举起一块写着问号的提示牌，正在提问',
    fallbackGlyph: '💬',
  },
  challenging: {
    key: 'challenging',
    label: '刘看山提出反方挑战',
    description: '试着站到对立立场，回应最有力的反驳。',
    asset: '/feedback/liukanshan-challenging.svg',
    alt: '刘看山举出一块方向相反的箭头牌，表示反方挑战',
    fallbackGlyph: '⇄',
  },
  completed: {
    key: 'completed',
    label: '刘看山陪你完成了本次思辨',
    description: '本次思辨已完成，可以查看思辨成果卡。',
    asset: '/feedback/liukanshan-completed.svg',
    alt: '刘看山举着带对勾的小旗，表示思辨完成',
    fallbackGlyph: '✅',
  },
};

export interface SessionFeedbackCueProps {
  /** The feedback state to display (derived by the caller in #48). */
  state: FeedbackCueState;
  /**
   * Deterministic override for prefers-reduced-motion.
   * - undefined: detect on the client (SSR-safe default = reduced).
   * - true/false: skip detection and use the given value.
   */
  reducedMotion?: boolean;
  /** Force text-only rendering (asset disabled/unavailable). */
  imageUnavailable?: boolean;
  /** Extra layout classes supplied by the integrating view (#48). */
  className?: string;
}

export default function SessionFeedbackCue({
  state,
  reducedMotion,
  imageUnavailable = false,
  className,
}: SessionFeedbackCueProps) {
  // SSR-safe default: assume motion is reduced until a client effect confirms
  // the OS allows motion, preventing any animation flash on first paint.
  const [motionReducedBySystem, setMotionReducedBySystem] = useState(true);
  const [imageLoadError, setImageLoadError] = useState(false);

  useEffect(() => {
    if (typeof reducedMotion === 'boolean') return;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setMotionReducedBySystem(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, [reducedMotion]);

  // A different state means a different asset URL — retry loading it.
  useEffect(() => {
    setImageLoadError(false);
  }, [state]);

  const reduceMotion = reducedMotion ?? motionReducedBySystem;
  const showImage = !imageUnavailable && !imageLoadError;
  const content = FEEDBACK_CUE_CONTENT[state];
  const containerClass = [
    'session-feedback-cue',
    reduceMotion ? '' : 'session-feedback-cue--animated',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      data-testid="session-feedback-cue"
      data-cue-state={state}
      role="status"
      aria-live="polite"
      className={containerClass}
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element -- controlled local SVG assets; next/image is unnecessary for tiny in-repo graphics
        <img
          data-testid="session-feedback-cue-image"
          className="session-feedback-cue-art"
          src={content.asset}
          alt={content.alt}
          width={96}
          height={96}
          loading="lazy"
          decoding="async"
          onError={() => setImageLoadError(true)}
        />
      ) : (
        <span
          data-testid="session-feedback-cue-text-art"
          className="session-feedback-cue-art session-feedback-cue-art--text"
          aria-hidden="true"
        >
          {content.fallbackGlyph}
        </span>
      )}
      <div className="session-feedback-cue-text">
        <p
          data-testid="session-feedback-cue-label"
          className="session-feedback-cue-label"
        >
          {content.label}
        </p>
        <p
          data-testid="session-feedback-cue-description"
          className="session-feedback-cue-description"
        >
          {content.description}
        </p>
      </div>
    </div>
  );
}
