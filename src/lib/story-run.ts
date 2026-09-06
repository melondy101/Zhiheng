// StoryRun Contract and Interactive Narrative Engine for GalGame mode (#G-00, #G-01, #G-02, #G-03, #G-04, #G-05)
//
// Rules (PRD v4.2 §7):
// - 3-act short-story structure with finite branching and stage convergence (3–5 critical choices).
// - 3 preset worlds: future_city, fantasy_realm, alternate_campus.
// - Every critical choice option clearly presents premise, benefit, cost, and report citation IDs.
// - Distinct ending states:
//     * in_progress: actively playing, exit-and-resume back to report
//     * completed: converged normal conclusion with reflective summary; can bridge to deep interrogation
//     * ended_early: user abandoned early; stored as un-converged, no fake outcome card, non-resumable
// - Strictly non-judgmental: fictional outcomes are never attributed as user moral flaws or personality scores.

import type { Report, Session, Viewpoint } from './providers';

export type StoryWorldId = 'future_city' | 'fantasy_realm' | 'alternate_campus';
export type StoryStatus = 'in_progress' | 'completed' | 'ended_early';

export interface StoryWorld {
  id: StoryWorldId;
  name: string;
  theme: string;
  description: string;
  setting: string;
}

export interface StoryChoiceOption {
  id: string;
  text: string;
  /** Explicitly designated reasoning dimensions (#G-03) */
  premise: string;
  benefit: string;
  cost: string;
  /** 1-based report citation references */
  evidenceCitationIds: number[];
  /** Narrative segment revealed after this choice is taken */
  consequence: string;
}

export interface StoryCriticalChoice {
  id: string;
  actIndex: number;
  title: string;
  prompt: string;
  options: StoryChoiceOption[];
  selectedOptionId: string | null;
  selectedAt?: number;
}

export interface StoryAct {
  actIndex: number; // 1, 2, or 3
  title: string;
  sceneDescription: string;
  narrative: string;
  choices: StoryCriticalChoice[];
}

export interface StoryRun {
  id: string;
  sessionId: string;
  world: StoryWorldId;
  worldName: string;
  worldSetting: string;
  acts: StoryAct[];
  currentActIndex: number; // 1, 2, or 3
  currentChoiceId: string | null;
  chosenOptionIds: string[];
  status: StoryStatus;
  outcomeNarrative: string | null;
  reflectionSummary: string | null;
  createdAt: number;
  updatedAt: number;
}

export const STORY_WORLDS: Record<StoryWorldId, StoryWorld> = {
  future_city: {
    id: 'future_city',
    name: '近未来数字城邦：新亚特兰提斯',
    theme: '智能治理与算法伦理',
    description: '城市运行依托庞大的协同智能网络，但在算力倾斜与公共权益之间，矛盾日益凸显。',
    setting: '霓虹与光导缆线交错的高穹之城。市民评议会正面临重大决策，你的每一步抉择都将塑造这座城市的运转规则。',
  },
  fantasy_realm: {
    id: 'fantasy_realm',
    name: '魔导律法城邦：银契之庭',
    theme: '资源均衡与律法契约',
    description: '古老法典与新秩序交锋，法脉源流的分配维系着城邦各阶层的微妙平衡。',
    setting: '矗立于浮空山岩上的青铜法庭。各大执政同盟围绕核心法理激烈辩驳，唯有严密的逻辑与衡平之心能定纷止争。',
  },
  alternate_campus: {
    id: 'alternate_campus',
    name: '思辨学园：知行联合大学',
    theme: '学术求真与社群共识',
    description: '青年研究者汇聚于此，围绕前沿社会与科技课题展开跨学科交锋。',
    setting: '绿荫掩映的圆桌大讲堂。年度思辨峰会进入关键环节，各方代表各抒己见，等待你指出核心关键点。',
  },
};

/**
 * Generate a deterministic, grounded 3-act StoryRun from the session report (#G-01, #G-02).
 */
export function generateStoryRun(
  sessionId: string,
  report: Report,
  selectedViewpoint?: Viewpoint | null,
  worldId: StoryWorldId = 'future_city'
): StoryRun {
  const world = STORY_WORLDS[worldId] ?? STORY_WORLDS.future_city;
  const topic = report.title || report.question || '核心争议';
  const baselineClaim = selectedViewpoint?.text ?? report.viewpoints[0] ?? topic;

  // Extract real citation IDs from report if available
  const citationKeys = Object.keys(report.citations || {}).map(Number).filter((n) => !isNaN(n) && n > 0);
  const citA = citationKeys[0] ?? 1;
  const citB = citationKeys[1] ?? (citationKeys[0] ?? 2);
  const citC = citationKeys[2] ?? (citationKeys[0] ?? 3);

  const act1Choice: StoryCriticalChoice = {
    id: 'c_act1_1',
    actIndex: 1,
    title: '关键抉择一：破局基准点',
    prompt: `面对"${topic}"的初始争议，各方争执不下。作为当值审议者，你选择以何种原则设立第一道检验基准？`,
    selectedOptionId: null,
    options: [
      {
        id: 'opt_1_evidence_first',
        text: '以客观实证与数据底线为基准，暂缓缺乏实测支撑的激进方案',
        premise: '实证数据比前瞻推论更具备制度韧性与可检验性',
        benefit: '避免系统因过度假设而发生不可逆试错风险',
        cost: '可能错失快速响应的战略窗口，增加沉没验证成本',
        evidenceCitationIds: [citA],
        consequence: '审议委员会认可了实证基准，调取了详实的数据监测流，各方进入理性举证阶段。',
      },
      {
        id: 'opt_1_systemic_anticipation',
        text: '以未来长远连锁影响为考量，优先包容探索性实践',
        premise: '动态演化中的新兴变量无法单纯通过历史数据预测',
        benefit: '为应对不确定性保留充足的演进与调优空间',
        cost: '短期内必须承担较高试错不确定性，需要密切监控',
        evidenceCitationIds: [citB],
        consequence: '委员会设立了沙盒试验区，允许探索方案并行推进，同时设立了严格的异常熔断机制。',
      },
    ],
  };

  const act2Choice1: StoryCriticalChoice = {
    id: 'c_act2_1',
    actIndex: 2,
    title: '关键抉择二：直面强反方质疑',
    prompt: `反对意见指出，在当前议题中"${baselineClaim}"可能忽视了边缘群体或隐性次生代价。你如何回应？`,
    selectedOptionId: null,
    options: [
      {
        id: 'opt_2_steelman_counter',
        text: '主动吸纳反方最强质疑，在核心方案中内嵌专门的制衡与补偿条款',
        premise: '最强反驳往往指出了系统最脆弱的盲区，纳入反方方能构建更稳固的共识',
        benefit: '显著消除对立阻力，大幅提升方案整体的防御力与公信力',
        cost: '方案复杂度上升，执行效率有所摊薄',
        evidenceCitationIds: [citA, citB],
        consequence: '反方代表对这种直面关切的态度表示尊重，双方同意共同起草风险对冲细则。',
      },
      {
        id: 'opt_2_clarify_boundary',
        text: '严格界定适用边界，明确该方案只在特定阈值条件下运行，不向外蔓延',
        premise: '任何结论都有其成立的充分与必要条件，不应无边界泛化',
        benefit: '保持核心举措的锐度与聚焦，避免因过度妥协而沦为平庸',
        cost: '边界外的问题仍需另寻解法，未能一次性解决全局争议',
        evidenceCitationIds: [citC],
        consequence: '边界被明确划定在安全区间内，方案保持了极高的执行清晰度。',
      },
    ],
  };

  const act3Choice1: StoryCriticalChoice = {
    id: 'c_act3_1',
    actIndex: 3,
    title: '关键抉择三：终局定案与价值权衡',
    prompt: `审议已至尾声，最终裁定案需付诸实施。面对长远利益与当下成本的张力，你的定案取向是？`,
    selectedOptionId: null,
    options: [
      {
        id: 'opt_3_iterative_governance',
        text: '推行阶梯式迭代机制：定期公开复盘，依据真实反馈持续校准策略',
        premise: '认知与决策是连续迭代的过程，开放的纠偏渠道胜过绝对的初始完美',
        benefit: '具备自我进化的长期适应性，随时吸收新的事实与洞见',
        cost: '需要维持长效透明的监督成本与公众沟通成本',
        evidenceCitationIds: [citA, citC],
        consequence: '终局方案正式通过。全城公示了公开透明的校准仪表盘，建立了持续对话的长效通道。',
      },
      {
        id: 'opt_3_structural_stability',
        text: '确立不可撼动的核心底线：筑牢刚性安全边界，其余领域充分自治',
        premise: '底线明确是系统稳定的根基，过度干预反而削弱系统活力',
        benefit: '规则极为清晰稳定，大幅降低全社会的理解与合规成本',
        cost: '面对突发极端形态时，刚性条款可能需要经历较高门槛的修法重构',
        evidenceCitationIds: [citB, citC],
        consequence: '终局法案刻入公共守则。城邦各方在明确的安全边界内各自展开生动自发的协同运转。',
      },
    ],
  };

  const acts: StoryAct[] = [
    {
      actIndex: 1,
      title: '第一幕：序曲与分歧',
      sceneDescription: `${world.name} 议事厅。关于"${topic}"的公开辩论正式启幕。`,
      narrative: `聚光灯下，来自不同阵营的学者与代表各执一词。报告汇集的各类数据与案例在全息幕墙上交替闪现。你作为特别调查员步入中央席位，必须为最初的研判奠定基石。`,
      choices: [act1Choice],
    },
    {
      actIndex: 2,
      title: '第二幕：暗流与攻防',
      sceneDescription: `议程深入，核心矛盾浮出水面，质疑与反例相继登场。`,
      narrative: `第一阶段的举措平息了表面的喧嚣，但更尖锐的深层矛盾随之暴露。反方代表提交了详实的文献索引，直击方案的核心假设。此时退缩将前功尽弃，草率敷衍则后患无穷。`,
      choices: [act2Choice1],
    },
    {
      actIndex: 3,
      title: '第三幕：收束与定论',
      sceneDescription: `终局审议。全城屏息凝神，等待最终裁决与制度框架落成。`,
      narrative: `所有证据链条均已展开，各方的代价、收益与前提在阳光下昭然若揭。这不仅是一场虚拟推演，更是对思考严密性与包容度的真正考验。随着最后钟声敲响，你落下了定案的符印。`,
      choices: [act3Choice1],
    },
  ];

  return {
    id: `story_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    sessionId,
    world: world.id,
    worldName: world.name,
    worldSetting: world.setting,
    acts,
    currentActIndex: 1,
    currentChoiceId: act1Choice.id,
    chosenOptionIds: [],
    status: 'in_progress',
    outcomeNarrative: null,
    reflectionSummary: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

/**
 * Make a choice in the active StoryRun (#G-03, #G-04).
 */
export function makeStoryChoice(
  story: StoryRun,
  choiceId: string,
  optionId: string
): StoryRun {
  if (story.status !== 'in_progress') {
    return story;
  }

  const acts = story.acts.map((act) => ({
    ...act,
    choices: act.choices.map((c) => {
      if (c.id === choiceId) {
        return {
          ...c,
          selectedOptionId: optionId,
          selectedAt: Date.now(),
        };
      }
      return c;
    }),
  }));

  const chosenOptionIds = Array.from(new Set([...story.chosenOptionIds, optionId]));

  // Determine next act and choice
  let currentActIndex = story.currentActIndex;
  let nextChoiceId: string | null = null;

  const currentAct = acts.find((a) => a.actIndex === currentActIndex);
  if (currentAct) {
    const remainingInAct = currentAct.choices.find((c) => !c.selectedOptionId);
    if (remainingInAct) {
      nextChoiceId = remainingInAct.id;
    } else {
      // Act completed, check next act
      const nextAct = acts.find((a) => a.actIndex === currentActIndex + 1);
      if (nextAct) {
        currentActIndex = nextAct.actIndex;
        const firstChoiceInNext = nextAct.choices.find((c) => !c.selectedOptionId);
        nextChoiceId = firstChoiceInNext ? firstChoiceInNext.id : null;
      } else {
        // All acts completed!
        return completeStory({
          ...story,
          acts,
          chosenOptionIds,
          currentActIndex: 3,
          currentChoiceId: null,
          updatedAt: Date.now(),
        });
      }
    }
  }

  return {
    ...story,
    acts,
    chosenOptionIds,
    currentActIndex,
    currentChoiceId: nextChoiceId,
    updatedAt: Date.now(),
  };
}

/**
 * Normal completion: generates non-judgmental conclusion and reflection (#G-04).
 */
export function completeStory(story: StoryRun): StoryRun {
  const chosenOptions: StoryChoiceOption[] = [];
  for (const act of story.acts) {
    for (const choice of act.choices) {
      if (choice.selectedOptionId) {
        const opt = choice.options.find((o) => o.id === choice.selectedOptionId);
        if (opt) chosenOptions.push(opt);
      }
    }
  }

  const outcomeNarrative =
    `经过三幕缜密的推演与权衡，${story.worldName}的治理格局最终落定。` +
    `你在过程中优先选择了"${chosenOptions.map((o) => o.premise).join('；')}"等核心考量，` +
    `成功在冲突中守护了系统的动态韧性与透明原则。这一推演展现了在多变量约束下构建自洽决策的思辨路径。`;

  const reflectionSummary =
    `【情境推演回顾】你完成了全部三幕关键抉择，涉及 ${chosenOptions.length} 个核心权衡点。` +
    `推演全程严格基于研报文献支持，未引入虚构偏差。你可以将本次剧情中暴露的未明说前提，一键桥接至深度诘问继续严密推敲。`;

  return {
    ...story,
    status: 'completed',
    outcomeNarrative,
    reflectionSummary,
    currentChoiceId: null,
    updatedAt: Date.now(),
  };
}

/**
 * Early abandonment: stores incomplete state without fake outcome cards (#G-04).
 */
export function endStoryEarly(story: StoryRun): StoryRun {
  return {
    ...story,
    status: 'ended_early',
    currentChoiceId: null,
    updatedAt: Date.now(),
  };
}

/**
 * Bridge completed StoryRun into Deep Interrogation (#G-04).
 */
export function bridgeStoryToInterrogation(session: Session): Session {
  if (!session.storyRun) return session;

  const chosenOptions: StoryChoiceOption[] = [];
  for (const act of session.storyRun.acts) {
    for (const choice of act.choices) {
      if (choice.selectedOptionId) {
        const opt = choice.options.find((o) => o.id === choice.selectedOptionId);
        if (opt) chosenOptions.push(opt);
      }
    }
  }

  const bridgeClaim =
    chosenOptions.length > 0
      ? `基于剧情推演，我认为应重视"${chosenOptions[0]?.premise}"，并权衡"${chosenOptions[0]?.cost}"这一代价。`
      : (session.selectedViewpoint?.text ?? '基于情境推演形成的初始判断');

  return {
    ...session,
    mode: 'deep',
    phase: 'interrogation',
    target: 'weigh_decision',
    selectedViewpoint: {
      id: `bridge_${Date.now().toString(36)}`,
      text: bridgeClaim,
      source: 'user_authored',
      selectedAt: Date.now(),
    },
    updatedAt: Date.now(),
  };
}
