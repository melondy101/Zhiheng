import type { StoryRun } from './story-run';
import type { LLMProvider } from './providers';

export type ThinkingTypeCode = `${'E' | 'N'}${'L' | 'V'}${'S' | 'X'}${'F' | 'G'}`;
export interface ThinkingProfile {
  code: ThinkingTypeCode;
  name: string;
  axes: { key: string; positive: string; negative: string; score: number }[];
  strengths: string[];
  blindSpots: string[];
  sampleSize: number;
  confidence: number;
  trend?: { code: ThinkingTypeCode; at: number }[];
}

const TYPES: Record<ThinkingTypeCode, { name: string; strength: string; blind: string }> = {
  ELSF: { name: '审慎分析者', strength: '重视证据、边界与可逆性', blind: '可能因过度验证而延迟行动' }, ELSG: { name: '系统架构师', strength: '善于拆解系统并推演长期影响', blind: '可能把问题设计得过于复杂' },
  ELXF: { name: '快速验证者', strength: '能把证据快速转成小规模试验', blind: '可能低估长期和二阶风险' }, ELXG: { name: '迭代工程师', strength: '擅长跨领域联结并持续迭代', blind: '可能忽略个体体验与公平分配' },
  EVSF: { name: '守护决策者', strength: '重视安全、责任和受影响者', blind: '可能过于保守，错过试错窗口' }, EVSG: { name: '公共治理者', strength: '能兼顾群体利益与制度约束', blind: '协调成本较高，较难快速取舍' },
  EVXF: { name: '现实协调者', strength: '能在现实限制中平衡各方', blind: '可能妥协过多而弱化主线' }, EVXG: { name: '社会创新者', strength: '用证据推动包容性改变', blind: '可能分散资源与注意力' },
  NLSF: { name: '概念建模者', strength: '善于抽象概念并发现规律', blind: '可能脱离具体事实' }, NLSG: { name: '远景设计者', strength: '擅长趋势判断和长期布局', blind: '预测可能延伸过度' },
  NLXF: { name: '实验探索者', strength: '敢于试错并快速学习', blind: '可能忽视稳定性' }, NLXG: { name: '范式突破者', strength: '能跨领域联结并提出新路径', blind: '可能缺少落地边界' },
  NVSF: { name: '人文审慎者', strength: '重视个体处境与潜在伤害', blind: '面对冲突时可能难以取舍' }, NVSG: { name: '价值整合者', strength: '能统合长期价值与群体影响', blind: '可能迟迟不做最终决定' },
  NVXF: { name: '关系推动者', strength: '善于协调关系并推动改变', blind: '可能受关系压力影响判断' }, NVXG: { name: '叙事变革者', strength: '能重新定义问题并激发共识', blind: '可能高估理念传播的作用' },
};

export function deriveThinkingProfile(story: StoryRun): ThinkingProfile {
  const choices = story.acts.flatMap((a) => a.choices).filter((c) => c.selectedOptionId).map((c) => c.options.find((o) => o.id === c.selectedOptionId)).filter(Boolean);
  const freeform = story.freeformResponses ?? [];
  const traces = story.decisionTraces ?? [];
  const text = [...choices.map((o) => `${o!.premise} ${o!.benefit} ${o!.cost}`), ...freeform.map((r) => r.text), ...traces.map((t) => `${t.freeformText ?? ''} ${t.premise ?? ''} ${t.benefit ?? ''} ${t.cost ?? ''}`)].join(' ');
  const has = (re: RegExp) => re.test(text);
  const e = (has(/证据|数据|验证|审计|引用|事实/) ? 2 : 0) - (has(/直觉|想象|大胆|愿景/) ? 1 : 0);
  const l = (has(/效率|逻辑|规则|结构|因果|系统/) ? 2 : 0) - (has(/公平|弱势|感受|关系|照顾|价值/) ? 1 : 0);
  const s = (has(/稳健|安全|边界|退出|可逆|底线/) ? 2 : 0) - (has(/试验|试错|创新|探索|快速|扩大/) ? 1 : 0);
  const f = (has(/条件|范围|局部|聚焦|具体/) ? 2 : 0) - (has(/长期|系统|整体|连锁|群体|生态/) ? 1 : 0);
  const code = `${e >= 0 ? 'E' : 'N'}${l >= 0 ? 'L' : 'V'}${s >= 0 ? 'S' : 'X'}${f >= 0 ? 'F' : 'G'}` as ThinkingTypeCode;
  const type = TYPES[code];
  const sampleSize = Math.max(choices.length + freeform.length, traces.length);
  return { code, name: type.name, axes: [
    { key: '信息处理', positive: '证据核验', negative: '直觉探索', score: e }, { key: '决策依据', positive: '逻辑分析', negative: '价值关怀', score: l },
    { key: '行动策略', positive: '稳健规划', negative: '试验推进', score: s }, { key: '认知范围', positive: '边界聚焦', negative: '系统联结', score: f },
  ], strengths: [type.strength], blindSpots: [type.blind], sampleSize, confidence: Math.min(0.95, 0.35 + sampleSize * 0.08) };
}

/** Aggregate evidence across completed and in-progress story runs. */
export function deriveThinkingProfileFromHistory(stories: StoryRun[]): ThinkingProfile {
  if (stories.length === 0) return deriveThinkingProfile({ acts: [], freeformResponses: [], status: 'in_progress' } as unknown as StoryRun);
  const merged = stories.reduce((acc, story) => ({
    ...acc,
    acts: [...acc.acts, ...story.acts],
    freeformResponses: [...(acc.freeformResponses ?? []), ...(story.freeformResponses ?? [])],
  }), { ...stories[0], acts: [], freeformResponses: [] } as StoryRun);
  const profile = deriveThinkingProfile(merged);
  const trend = stories.slice().sort((a,b) => a.updatedAt - b.updatedAt).map((story) => { const p = deriveThinkingProfile(story); return { code: p.code, at: story.updatedAt }; });
  return { ...profile, trend };
}

export function collectDecisionTraces(stories: StoryRun[]) {
  return stories.flatMap((story) => (story.decisionTraces ?? []).map((trace) => ({ ...trace, storyId: story.id, topic: story.worldName })));
}

export async function generateThinkingReview(provider: LLMProvider, profile: ThinkingProfile, traces: ReturnType<typeof collectDecisionTraces>) {
  if (!provider.generateStructuredJson || traces.length === 0) return null;
  const result = await provider.generateStructuredJson(
    '你是知研思维人格点评助手。根据用户推演行为做娱乐化、可验证的思维点评，不做心理诊断或道德评价。必须区分观察与推断，每条优势和盲区引用trace id。只输出JSON：{"summary":string,"strengths":[{"title":string,"detail":string,"traceIds":string[]}],"blindSpots":[{"title":string,"detail":string,"suggestion":string,"traceIds":string[]}]}',
    JSON.stringify({ profile, traces: traces.slice(-30) })
  );
  return result && typeof result === 'object' ? result : null;
}
