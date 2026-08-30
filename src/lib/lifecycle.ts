// Session lifecycle manager for ticket #12.
// - Resume incomplete sessions
// - Mark completed sessions read-only
// - Continue from completed → new independent session
// - Build auditable simplified profile after completion

import type { Session, Message, Viewpoint } from './providers';

export type SessionStatus = 'in_progress' | 'completed';

export function getStatus(session: Session): SessionStatus {
  return session.completed ? 'completed' : 'in_progress';
}

/** A completed session must not accept further edits. */
export function isReadOnly(session: Session): boolean {
  return session.completed;
}

export interface ContinueResult {
  ok: true;
  newSession: Session;
}

/** Continue from a completed session: create an independent new session. */
export function continueFromCompleted(completed: Session, nextQuestion: string): ContinueResult {
  return {
    ok: true,
    newSession: {
      id: `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      question: nextQuestion,
      initialOpinion: null,
      report: null,
      knowledgeGraph: null,
      selectedViewpoint: null,
      messages: [],
      resultCard: null,
      completed: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  };
}

// ---------------------------------------------------------------------------
// Simplified profile (ticket #12)
// ---------------------------------------------------------------------------

export interface ProfileConclusion {
  field: 'interest' | 'thinking_style';
  value: string;
  confidence: number; // 0..1
  sourceSessionId: string;
  sourceMessageId: string | null;
  updatedAt: number;
}

export interface UserProfile {
  conclusions: ProfileConclusion[];
  updatedAt: number;
  /** When the profile was deleted; null = active. */
  deletedAt: number | null;
}

const PROFILE_KEY = 'zhiyan_user_profile';

export function loadProfile(): UserProfile | null {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as UserProfile;
  } catch {
    return null;
  }
}

export function saveProfile(profile: UserProfile): void {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  } catch {
    // ignore
  }
}

export function deleteProfile(): void {
  try {
    localStorage.removeItem(PROFILE_KEY);
  } catch {
    // ignore
  }
}

const userMessages = (s: Session): Message[] => s.messages.filter((m) => m.role === 'user');
const lastUser = (s: Session): Message | null => {
  const u = userMessages(s);
  return u.length > 0 ? u[u.length - 1]! : null;
};

const selectedViewpoint = (s: Session): Viewpoint | null => s.selectedViewpoint;

/** Build a profile conclusion list from a completed session. */
export function buildProfileFromSession(session: Session): ProfileConclusion[] {
  if (!session.completed) return [];
  const conclusions: ProfileConclusion[] = [];
  const last = lastUser(session);
  const vp = selectedViewpoint(session);

  // Interest: extract a topic signal from the selected viewpoint or initial opinion
  if (vp) {
    conclusions.push({
      field: 'interest',
      value: extractTopic(vp.text),
      confidence: 0.6,
      sourceSessionId: session.id,
      sourceMessageId: null,
      updatedAt: Date.now(),
    });
  }

  // Thinking style: signal based on message length
  if (last && last.text.trim().length > 20) {
    conclusions.push({
      field: 'thinking_style',
      value: 'elaborative',
      confidence: 0.5,
      sourceSessionId: session.id,
      sourceMessageId: last.id,
      updatedAt: Date.now(),
    });
  } else if (last) {
    conclusions.push({
      field: 'thinking_style',
      value: 'concise',
      confidence: 0.5,
      sourceSessionId: session.id,
      sourceMessageId: last.id,
      updatedAt: Date.now(),
    });
  }

  return conclusions;
}

/** Extract a short topic label from viewpoint text. */
function extractTopic(text: string): string {
  // Take the first 12 chars or first Chinese phrase
  const m = text.match(/[一-龥]{3,12}/);
  if (m) return m[0];
  return text.slice(0, 12);
}

/** Update or insert profile, preserving deletedAt marker if present. */
export function updateProfile(
  current: UserProfile | null,
  newConclusions: ProfileConclusion[]
): UserProfile {
  // If profile was deleted, do not auto-rebuild (per acceptance criterion)
  if (current?.deletedAt != null) {
    return { ...current, updatedAt: Date.now() };
  }

  const existing = current?.conclusions ?? [];
  // Merge: replace same field if newer confidence is higher; otherwise append
  const merged: ProfileConclusion[] = [...existing];
  for (const nc of newConclusions) {
    const i = merged.findIndex((c) => c.field === nc.field && c.value === nc.value);
    if (i >= 0) {
      if (nc.confidence > merged[i]!.confidence) merged[i] = nc;
    } else {
      merged.push(nc);
    }
  }

  return {
    conclusions: merged,
    updatedAt: Date.now(),
    deletedAt: null,
  };
}
