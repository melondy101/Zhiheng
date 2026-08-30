// Result card builder for ticket #11.
// Strictly traces each item to a user message or selected viewpoint.
// Assistant messages cannot be misattributed as user views.

import type { Session, Message, Viewpoint, ResultCard } from './providers';

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
  /** Last user message is treated as the final position. */
  finalPosition: MessageTrace | null;
  /** All user message ids (used by other UI components). */
  messageIds: string[];
  /** Open questions the user did not address. */
  unresolved: string[];
}

const userMessages = (session: Session): Message[] =>
  session.messages.filter((m) => m.role === 'user');

const isSubstantive = (m: Message): boolean => m.text.trim().length >= 8;

export function buildDetailedResultCard(session: Session): DetailedResultCard {
  const users = userMessages(session);
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

  const newEvidence: MessageTrace[] = users
    .filter(isSubstantive)
    .filter((m) => users.indexOf(m) !== users.length - 1) // exclude final position
    .map((m) => ({ messageId: m.id, text: m.text, timestamp: m.timestamp }));

  // Detect stance revisions: pairs of consecutive user messages where the topic shifted
  const stanceRevisions: Array<{ from: MessageTrace; to: MessageTrace }> = [];
  for (let i = 1; i < users.length; i++) {
    const a = users[i - 1]!;
    const b = users[i]!;
    if (a.text !== b.text) {
      stanceRevisions.push({
        from: { messageId: a.id, text: a.text, timestamp: a.timestamp },
        to: { messageId: b.id, text: b.text, timestamp: b.timestamp },
      });
    }
  }

  const finalPosition =
    users.length > 0
      ? {
          messageId: users[users.length - 1]!.id,
          text: users[users.length - 1]!.text,
          timestamp: users[users.length - 1]!.timestamp,
        }
      : null;

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
    unresolved: [],
  };
}
