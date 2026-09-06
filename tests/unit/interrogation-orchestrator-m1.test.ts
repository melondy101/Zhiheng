import { describe, it } from 'node:test';
import assert from 'node:assert';
import { handleInterrogate } from '../../src/lib/interrogation-orchestrator';
import type { Report, Session, StorageProvider, Viewpoint } from '../../src/lib/providers';

class MockStorageProvider implements StorageProvider {
  private sessions = new Map<string, Session>();
  async loadSession(id: string): Promise<Session | null> {
    const s = this.sessions.get(id);
    return s ? JSON.parse(JSON.stringify(s)) : null;
  }
  async saveSession(session: Session): Promise<void> {
    this.sessions.set(session.id, JSON.parse(JSON.stringify(session)));
  }
  async listSessions(): Promise<Session[]> {
    return Array.from(this.sessions.values());
  }
  async deleteSession(id: string): Promise<void> {
    this.sessions.delete(id);
  }
}

const mockReport: Report = {
  title: '远程办公效率研究',
  question: '远程办公是否真正提高了工作效率？',
  content: '关于远程办公效率存在正反两方面的数据实证支持。',
  knowledgePoints: [
    '工时与产出：远程工作使专注时间增加，但跨部门协作沟通成本有所提升。',
    '管理信任：缺乏过程可见度导致部分管理层倾向于微操或强化监控。',
  ],
  viewpoints: [
    '远程办公有效减少通勤损耗并显著提高个人专注度',
    '远程办公割裂了实时沟通，显著降低了创新协同效应',
  ],
  references: [],
  citations: {},
};

const viewpoint: Viewpoint = {
  id: 'v1',
  text: '远程办公有效减少通勤损耗并显著提高个人专注度',
  source: 'ai_suggested_and_selected',
};

function createInitialSession(sessionId: string): Session {
  return {
    id: sessionId,
    question: mockReport.question,
    initialOpinion: null,
    report: mockReport,
    selectedViewpoint: null,
    messages: [],
    resultCard: null,
    completed: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

const mockGenerateQuestion = async (strategy: string) => `[Question for ${strategy}] 请阐述具体论据。`;

describe('Interrogation Orchestrator M1 Modes (#Q-01, #Q-02, #F-01, #G-00 through #G-05)', () => {
  it('starts interrogation in quick mode and initiates with quick round strategy', async () => {
    const storage = new MockStorageProvider();
    const initialSession = createInitialSession('quick-sess-1');

    const result = await handleInterrogate({
      sessionId: 'quick-sess-1',
      sessionSnapshot: initialSession,
      action: 'start',
      viewpoint,
      mode: 'quick',
      target: 'understand_report',
      storage,
      generateQuestion: mockGenerateQuestion,
    });

    assert.strictEqual(result.ok, true);
    if (!result.ok) return;
    assert.strictEqual(result.body.session.mode, 'quick');
    assert.strictEqual(result.body.session.target, 'understand_report');
    assert.ok(result.body.question);
    assert.strictEqual(result.body.session.messages.length, 1);
  });

  it('triggers transition choice phase in quick mode after report understanding', async () => {
    const storage = new MockStorageProvider();
    const initialSession = createInitialSession('quick-sess-2');

    const startResult = await handleInterrogate({
      sessionId: 'quick-sess-2',
      sessionSnapshot: initialSession,
      action: 'start',
      viewpoint,
      mode: 'quick',
      target: 'understand_report',
      storage,
      generateQuestion: mockGenerateQuestion,
    });

    assert.strictEqual(startResult.ok, true);
    if (!startResult.ok) return;

    const answerResult = await handleInterrogate({
      sessionId: 'quick-sess-2',
      sessionSnapshot: startResult.body.session,
      action: 'answer',
      answer: '我理解了报告的核心矛盾在于个体专注与组织协同之间的权衡。',
      storage,
      generateQuestion: mockGenerateQuestion,
    });

    assert.strictEqual(answerResult.ok, true);
    if (!answerResult.ok) return;
    assert.strictEqual(answerResult.body.session.phase, 'transitionChoice');

    const transitionResult = await handleInterrogate({
      sessionId: 'quick-sess-2',
      sessionSnapshot: answerResult.body.session,
      action: 'transition',
      transitionChoice: 'start_challenge',
      storage,
      generateQuestion: mockGenerateQuestion,
    });

    assert.strictEqual(transitionResult.ok, true);
    if (!transitionResult.ok) return;
    assert.strictEqual(transitionResult.body.session.mode, 'deep');
    assert.strictEqual(transitionResult.body.session.phase, 'interrogation');
    assert.ok(transitionResult.body.question);
  });

  it('handles Fun Mode with character persona applied to questions', async () => {
    const storage = new MockStorageProvider();
    const initialSession = createInitialSession('fun-sess-1');

    const startResult = await handleInterrogate({
      sessionId: 'fun-sess-1',
      sessionSnapshot: initialSession,
      action: 'start',
      viewpoint,
      mode: 'fun',
      character: 'ancient_scholar',
      storage,
      generateQuestion: mockGenerateQuestion,
    });

    assert.strictEqual(startResult.ok, true);
    if (!startResult.ok) return;
    assert.strictEqual(startResult.body.session.mode, 'fun');
    assert.strictEqual(startResult.body.session.character, 'ancient_scholar');
    assert.ok(startResult.body.question?.includes('【古风辩友】'));
  });

  it('orchestrates GalGame Story Run mode from start to choice to completion', async () => {
    const storage = new MockStorageProvider();
    const initialSession = createInitialSession('story-sess-1');

    const startResult = await handleInterrogate({
      sessionId: 'story-sess-1',
      sessionSnapshot: initialSession,
      action: 'start',
      viewpoint,
      mode: 'story',
      world: 'future_city',
      storage,
      generateQuestion: mockGenerateQuestion,
    });

    assert.strictEqual(startResult.ok, true);
    if (!startResult.ok) return;
    assert.strictEqual(startResult.body.session.mode, 'story');
    assert.ok(startResult.body.session.storyRun);
    const storyRun = startResult.body.session.storyRun;
    assert.strictEqual(storyRun.status, 'in_progress');
    assert.strictEqual(storyRun.acts.length, 3);

    const choice = storyRun.acts[0].choices[0];
    const option = choice.options[0];

    const choiceResult = await handleInterrogate({
      sessionId: 'story-sess-1',
      sessionSnapshot: startResult.body.session,
      action: 'story_choice',
      choiceId: choice.id,
      optionId: option.id,
      storage,
      generateQuestion: mockGenerateQuestion,
    });

    assert.strictEqual(choiceResult.ok, true);
    if (!choiceResult.ok) return;
    assert.strictEqual(choiceResult.body.session.storyRun?.chosenOptionIds.length, 1);

    const completeResult = await handleInterrogate({
      sessionId: 'story-sess-1',
      sessionSnapshot: choiceResult.body.session,
      action: 'story_complete',
      storage,
      generateQuestion: mockGenerateQuestion,
    });

    assert.strictEqual(completeResult.ok, true);
    if (!completeResult.ok) return;
    assert.strictEqual(completeResult.body.session.storyRun?.status, 'completed');
    assert.strictEqual(completeResult.body.session.completed, true);
    assert.ok(completeResult.body.session.resultCard);
  });
});
