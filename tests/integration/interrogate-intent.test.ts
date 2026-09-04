// Ticket #26/T5: gentle intent integration tests for POST /api/interrogate.
// Verifies that the API classifies user intent, generates gentle responses,
// and tracks directive rounds correctly.

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { handleInterrogate } from '../../src/lib/interrogation-orchestrator';
import type { Session, Viewpoint, StorageProvider } from '../../src/lib/providers';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildSession(overrides: Partial<Session> = {}): Session {
  const base: Session = {
    id: 's_intent_test',
    question: 'Test question',
    initialOpinion: null,
    report: null,
    knowledgeGraph: null,
    selectedViewpoint: null,
    messages: [],
    resultCard: null,
    completed: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  return { ...base, ...overrides };
}

function buildViewpoint(text: string): Viewpoint {
  return {
    id: 'vp_test',
    text,
    source: 'user_authored',
    selectedAt: Date.now(),
  };
}

function fakeStorage(session: Session): StorageProvider {
  return {
    async loadSession() { return session; },
    async saveSession(s: Session) { Object.assign(session, s); },
    async listSessions() { return []; },
    async deleteSession() {},
  } as StorageProvider;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/interrogate: gentle intent (#26/T5)', () => {
  it('classifies a question and returns aiReply + followUp without advancing directiveRound', async () => {
    const session = buildSession({
      selectedViewpoint: buildViewpoint('Test stance'),
      interrogation: {
        round: 1,
        strategy: 'M1_evidence',
        assistantQuestion: 'Q1?',
        usedFallback: false,
        pendingCheckpoint: false,
        uncertainStreak: 0,
      },
    });

    const result = await handleInterrogate({
      sessionId: session.id,
      action: 'answer',
      answer: '什么是热榜缓存？',
      storage: fakeStorage(session),
      generateQuestion: async () => 'fallback question',
    });

    assert.strictEqual(result.ok, true);
    if (!result.ok) return;
    const body = result.body;
    assert.ok(body.aiReply && body.aiReply.length > 0, 'aiReply should be present for questions');
    assert.ok(body.followUp && body.followUp.length > 0, 'followUp should be present');
    assert.strictEqual(body.directiveRound, 0);
    assert.strictEqual(body.suggestSummary, false);
  });

  it('classifies a substantive response and advances directiveRound', async () => {
    const session = buildSession({
      selectedViewpoint: buildViewpoint('Test stance'),
      interrogation: {
        round: 1,
        strategy: 'M1_evidence',
        assistantQuestion: 'Q1?',
        usedFallback: false,
        pendingCheckpoint: false,
        uncertainStreak: 0,
      },
    });

    const result = await handleInterrogate({
      sessionId: session.id,
      action: 'answer',
      answer: '我认为缓存可以减少API调用',
      storage: fakeStorage(session),
      generateQuestion: async () => 'fallback question',
    });

    assert.strictEqual(result.ok, true);
    if (!result.ok) return;
    const body = result.body;
    assert.ok(body.aiReply && body.aiReply.length > 0, 'aiReply should be present for responses');
    assert.ok(body.followUp && body.followUp.length > 0, 'followUp should be present');
    assert.strictEqual(body.directiveRound, 1);
    assert.strictEqual(body.suggestSummary, false);
  });

  it('does not advance directiveRound for non-substantive responses', async () => {
    const session = buildSession({
      selectedViewpoint: buildViewpoint('Test stance'),
      interrogation: {
        round: 1,
        strategy: 'M1_evidence',
        assistantQuestion: 'Q1?',
        usedFallback: false,
        pendingCheckpoint: false,
        uncertainStreak: 0,
      },
    });

    const result = await handleInterrogate({
      sessionId: session.id,
      action: 'answer',
      answer: '不知道',
      storage: fakeStorage(session),
      generateQuestion: async () => 'fallback question',
    });

    assert.strictEqual(result.ok, true);
    if (!result.ok) return;
    const body = result.body;
    assert.strictEqual(body.directiveRound, 0);
    assert.strictEqual(body.suggestSummary, false);
  });

  it('sets suggestSummary after every 3rd directive round', async () => {
    const session = buildSession({
      selectedViewpoint: buildViewpoint('Test stance'),
      interrogation: {
        round: 1,
        strategy: 'M1_evidence',
        assistantQuestion: 'Q1?',
        usedFallback: false,
        pendingCheckpoint: false,
        uncertainStreak: 0,
        directiveRound: 2,
      },
    });

    const result = await handleInterrogate({
      sessionId: session.id,
      action: 'answer',
      answer: '我认为这很有用',
      storage: fakeStorage(session),
      generateQuestion: async () => 'fallback question',
    });

    assert.strictEqual(result.ok, true);
    if (!result.ok) return;
    const body = result.body;
    assert.strictEqual(body.directiveRound, 3);
    assert.strictEqual(body.suggestSummary, true);
  });

  it('persists directiveRound and lastIntent on the session', async () => {
    const session = buildSession({
      selectedViewpoint: buildViewpoint('Test stance'),
      interrogation: {
        round: 1,
        strategy: 'M1_evidence',
        assistantQuestion: 'Q1?',
        usedFallback: false,
        pendingCheckpoint: false,
        uncertainStreak: 0,
      },
    });

    const result = await handleInterrogate({
      sessionId: session.id,
      action: 'answer',
      answer: '什么是缓存？',
      storage: fakeStorage(session),
      generateQuestion: async () => 'fallback question',
    });

    assert.strictEqual(result.ok, true);
    if (!result.ok) return;
    const updatedSession = await fakeStorage(session).loadSession(session.id);
    assert.strictEqual(updatedSession?.interrogation?.directiveRound, 0);
    assert.strictEqual(updatedSession?.interrogation?.lastIntent, 'question');
  });
});

