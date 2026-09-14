import type { GeneratedStoryTurn, StoryRun } from './story-run';
import type { LLMProvider } from './providers';

const MAX_SCENE_CHARS = 900;
const MAX_DIALOGUE_CHARS = 280;
const MAX_OPTION_CHARS = 200;

const SYSTEM = `你是知研的剧情推演导演。基于用户在推演中的决策，生成下一轮可继续探索的思辨场景。
硬性规则：不做心理诊断、道德评判或人格定论；不把虚构情景说成现实事实；不给唯一正确答案；建议必须有真实取舍；允许用户自由作答；不要编造引用或统计数据。
输出严格 JSON：{"scene":string,"dialogue":[{"speaker":string,"text":string,"role":"support"|"oppose"|"neutral"}],"reasoningGoal":"fact_check"|"premise"|"counterargument"|"tradeoff","suggestions":[{"text":string,"premise":string,"benefit":string,"cost":string}],"revealedAssumptions":[string],"uncertainties":[string],"reflection":string,"citationIds":[number]}。suggestions 必须为2到3项。`;

const goalSet = new Set<GeneratedStoryTurn['reasoningGoal']>(['fact_check', 'premise', 'counterargument', 'tradeoff']);
const roleSet = new Set<GeneratedStoryTurn['dialogue'][number]['role']>(['support', 'oppose', 'neutral']);
const string = (value: unknown, max: number) => typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;

function parseGeneratedTurn(value: unknown): GeneratedStoryTurn | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const scene = string(raw.scene, MAX_SCENE_CHARS);
  const reflection = string(raw.reflection, 480);
  const reasoningGoal = typeof raw.reasoningGoal === 'string' && goalSet.has(raw.reasoningGoal as GeneratedStoryTurn['reasoningGoal']) ? raw.reasoningGoal as GeneratedStoryTurn['reasoningGoal'] : null;
  if (!scene || !reflection || !reasoningGoal || !Array.isArray(raw.dialogue) || !Array.isArray(raw.suggestions)) return null;
  const dialogue = raw.dialogue.flatMap((line): GeneratedStoryTurn['dialogue'] => {
    if (!line || typeof line !== 'object') return [];
    const entry = line as Record<string, unknown>;
    const speaker = string(entry.speaker, 40); const text = string(entry.text, MAX_DIALOGUE_CHARS);
    const role = typeof entry.role === 'string' && roleSet.has(entry.role as GeneratedStoryTurn['dialogue'][number]['role']) ? entry.role as GeneratedStoryTurn['dialogue'][number]['role'] : null;
    return speaker && text && role ? [{ speaker, text, role }] : [];
  }).slice(0, 4);
  const suggestions = raw.suggestions.flatMap((item): GeneratedStoryTurn['suggestions'] => {
    if (!item || typeof item !== 'object') return [];
    const entry = item as Record<string, unknown>;
    const text = string(entry.text, MAX_OPTION_CHARS); const premise = string(entry.premise, MAX_OPTION_CHARS);
    const benefit = string(entry.benefit, MAX_OPTION_CHARS); const cost = string(entry.cost, MAX_OPTION_CHARS);
    return text && premise && benefit && cost ? [{ text, premise, benefit, cost }] : [];
  }).slice(0, 3);
  if (dialogue.length === 0 || suggestions.length < 2) return null;
  const strings = (input: unknown) => Array.isArray(input) ? input.flatMap((item) => string(item, 160) ? [string(item, 160)!] : []).slice(0, 3) : [];
  const citationIds = Array.isArray(raw.citationIds) ? raw.citationIds.filter((id): id is number => typeof id === 'number' && Number.isInteger(id) && id > 0).slice(0, 5) : [];
  return { scene, dialogue, reasoningGoal, suggestions, revealedAssumptions: strings(raw.revealedAssumptions), uncertainties: strings(raw.uncertainties), reflection, citationIds };
}

export async function generateStoryAdvance(provider: LLMProvider, story: StoryRun, userText: string): Promise<GeneratedStoryTurn | null> {
  if (!provider.generateStructuredJson) return null;
  const result = await provider.generateStructuredJson(SYSTEM, JSON.stringify({
    world: story.worldName,
    currentScene: story.acts[story.acts.length - 1]?.narrative,
    recentDecisions: (story.decisionTraces ?? []).slice(-6),
    userDecision: userText.slice(0, 2000),
    previousScenes: (story.dynamicTurns ?? []).slice(-4).map((turn) => turn.scene),
  }));
  const parsed = parseGeneratedTurn(result);
  if (!parsed) return null;
  if (new Set((story.dynamicTurns ?? []).map((turn) => turn.scene.trim())).has(parsed.scene.trim())) return null;
  return parsed;
}
