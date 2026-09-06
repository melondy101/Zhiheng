// Cognitive Trajectory Engine (#D-03, #D-04)
//
// Records traceable evolution of the user's articulated positions:
// claims, evidence, premises, counterarguments, and unresolved questions.
//
// Strict guardrails (PRD v4.2 §5):
// - Every event MUST trace to an explicit user message or selected viewpoint.
// - AI must NEVER diagnose user personality, assign scores, or invent unsaid claims.
// - Purely reflective and transparent.

import type { Message, Session } from './providers';
import type { StrategyId } from './strategy-engine';

export type TrajectoryEventType =
  | 'claim'
  | 'evidence'
  | 'premise'
  | 'counterargument'
  | 'unresolved_question';

export interface CognitiveTrajectoryEvent {
  id: string;
  type: TrajectoryEventType;
  label: string;
  text: string;
  sourceMessageId: string;
  timestamp: number;
  strategy?: StrategyId;
  summary?: string;
  description?: string;
  messageId?: string;
}

export const TRAJECTORY_TYPE_LABELS: Record<TrajectoryEventType, string> = {
  claim: '核心主张',
  evidence: '论据支持',
  premise: '隐含前提',
  counterargument: '反方审视',
  unresolved_question: '待解疑问',
};

export const COGNITIVE_EVENT_LABELS = TRAJECTORY_TYPE_LABELS;

/**
 * Extract cognitive trajectory events from a session's recorded messages.
 * Deterministic, source-grounded, and non-judgmental.
 */
export function extractCognitiveTrajectory(session: Session): CognitiveTrajectoryEvent[] {
  const events: CognitiveTrajectoryEvent[] = [];

  // 1. Initial viewpoint as the baseline claim
  if (session.selectedViewpoint) {
    const text = session.selectedViewpoint.text;
    events.push({
      id: `traj_base_${session.selectedViewpoint.id}`,
      type: 'claim',
      label: '立论起点',
      text,
      summary: '立论起点',
      description: text,
      sourceMessageId: 'viewpoint_selection',
      messageId: 'viewpoint_selection',
      timestamp: session.selectedViewpoint.selectedAt ?? session.createdAt,
    });
  }

  // 2. Derive events from user messages
  const userMessages = session.messages.filter((m) => m.role === 'user');

  for (let i = 0; i < userMessages.length; i++) {
    const msg = userMessages[i]!;
    const cleanText = msg.text.trim();
    if (cleanText.length < 2) continue;

    // Attribute event type based on conversation progression or text indicators
    let eventType: TrajectoryEventType = 'claim';
    let label = '观点阐述';

    if (msg.uncertain) {
      eventType = 'unresolved_question';
      label = '不确定性记录';
    } else if (i === 0) {
      // First substantive round usually elaborates evidence or reasons
      eventType = 'evidence';
      label = '初步依据';
    } else if (cleanText.includes('如果') || cleanText.includes('前提') || cleanText.includes('假设') || cleanText.includes('基于')) {
      eventType = 'premise';
      label = '前提识别';
    } else if (cleanText.includes('反方') || cleanText.includes('质疑') || cleanText.includes('反驳') || cleanText.includes('但是') || cleanText.includes('不同意') || cleanText.includes('冲击')) {
      eventType = 'counterargument';
      label = '反方回应';
    } else if (cleanText.endsWith('？') || cleanText.endsWith('?') || cleanText.includes('疑问') || cleanText.includes('不确定')) {
      eventType = 'unresolved_question';
      label = '深入探问';
    } else if (i >= 2) {
      eventType = 'claim';
      label = `演进主张 (${i + 1})`;
    }

    const displayText = cleanText.length > 120 ? `${cleanText.slice(0, 117)}...` : cleanText;

    events.push({
      id: `traj_msg_${msg.id}`,
      type: eventType,
      label,
      text: displayText,
      summary: label,
      description: displayText,
      sourceMessageId: msg.id,
      messageId: msg.id,
      timestamp: msg.timestamp,
      strategy: msg.strategy,
    });
  }

  return events;
}
