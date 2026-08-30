// Result card builder for ticket #11, extended by #17.
// Strictly traces each item to a user message or selected viewpoint.
// Assistant messages cannot be misattributed as user views.

import type { Session, Message, Viewpoint, ResultCard } from './providers';
import { isRoundAnswer } from './providers';

interface MessageTrace {
  messageId: string;
  text: string;
  timestamp: number;
}

export interface DetailedResultCard extends Omit<ResultCard, 'finalPosition' | 'messageIds'> {
  /** User's initial opinion before seeing the report. */
  initialExpression: MessageTrace | null;
  /** Viewpoint the user selected to start the interrogation. */
  startingStance: {
    text: string;
    source: Viewpoint['source'];
    messageId: string | null;
    selectedAt?: number;
  } | null;
  /** User messages that introduced new evidence (substantive answers). */
  newEvidence: MessageTrace[];
  /** Pairs of (before, after) user messages indicating stance shifts. */
  stanceRevisions: Array<{ from: MessageTrace; to: MessageTrace }>;
  /** Last round-advancing user message is treated as the final position. */
  finalPosition: MessageTrace | null;
  /** All user message ids — including uncertain inputs (#17). */
  messageIds: string[];
  /** #17: inputs recorded while uncertain, kept for full traceability. */
  uncertainAnswers: MessageTrace[];
  /** #17: questions the user left unanswered (the pending question, if any). */
  unresolved: string[];
}

const userMessages = (session: Session): Message[] =>
  session.messages.filter((m) => m.role === 'user');

/** Round-advancing answers only — uncertain inputs are excluded (#17). */
const roundAnswers = (session: Session): Message[] =>
  session.messages.filter(isRoundAnswer);

const isSubstantive = (m: Message): boolean => m.text.trim().length >= 8;

const trace = (m: Message): MessageTrace => ({
  messageId: m.id,
  text: m.text,
  timestamp: m.timestamp,
});

export function buildDetailedResultCard(session: Session): DetailedResultCard {
  const users = userMessages(session);
  const answers = roundAnswers(session);
  const initialExpression = session.initialOpinion
    ? {
        messageId: 'initial_opinion',
        text: session.initialOpinion,
        timestamp: session.createdAt,
      }
    : null;

  const startingStance = session.selectedViewpoint
    ? {
        text: session.selectedViewpoint.text,
        source: session.selectedViewpoint.source,
        messageId: 'selected_viewpoint',
        ...(session.selectedViewpoint.selectedAt
          ? { selectedAt: session.selectedViewpoint.selectedAt }
          : {}),
      }
    : null;

  const newEvidence: MessageTrace[] = answers
    .filter(isSubstantive)
    .filter((m) => answers.indexOf(m) !== answers.length - 1) // exclude final position
    .map(trace);

  // Detect stance revisions: pairs of consecutive round answers where the
  // topic shifted (#17: uncertain inputs never create revision pairs).
  const stanceRevisions: Array<{ from: MessageTrace; to: MessageTrace }> = [];
  for (let i = 1; i < answers.length; i++) {
    const a = answers[i - 1]!;
    const b = answers[i]!;
    if (a.text !== b.text) {
      stanceRevisions.push({ from: trace(a), to: trace(b) });
    }
  }

  const finalPosition = answers.length > 0 ? trace(answers[answers.length - 1]!) : null;

  // #17: every uncertain input stays traceable in the card.
  const uncertainAnswers = users.filter((m) => m.uncertain === true).map(trace);

  // #17: the question that was still pending when the session completed is
  // the honest content of the "unresolved questions" section — taken
  // verbatim from the saved conversation, never invented.
  const pendingQuestion = session.interrogation?.assistantQuestion?.trim();
  const unresolved = pendingQuestion ? [pendingQuestion] : [];

  return {
    sessionId: session.id,
    initialStance: initialExpression
      ? { text: initialExpression.text, source: 'user_authored' as const }
      : null,
    selectedStartingStance: startingStance
      ? {
          text: startingStance.text,
          source:
            startingStance.source === 'user_authored'
              ? 'user_authored'
              : 'ai_suggested_and_selected',
        }
      : null,
    initialExpression,
    startingStance,
    newEvidence,
    stanceRevisions,
    finalPosition,
    messageIds: users.map((m) => m.id),
    uncertainAnswers,
    unresolved,
  };
}

/**
 * The simple persisted card shape, built server-side by the complete action
 * (#17). Pure projection of the detailed card; safe for any runtime.
 */
export function buildSimpleResultCard(session: Session): ResultCard {
  const detailed = buildDetailedResultCard(session);
  return {
    sessionId: detailed.sessionId,
    initialStance: detailed.initialStance,
    selectedStartingStance: detailed.selectedStartingStance,
    finalPosition: detailed.finalPosition ? detailed.finalPosition.text : null,
    messageIds: detailed.messageIds,
  };
}
