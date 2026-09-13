// Question Rewriter & Subtitle Generator
// Converts casual user inputs or Zhihu hotlist headlines into refined core questions
// Supports Version 1 (Academic & Mechanism Inquiry) and Version 2 (Factual Grounding & Natural Inquiry)
// and generates concise, punchy subtitles (小标题) for research reports.

import type { LLMProvider } from './providers';

export interface QuestionRewriteVersionItem {
  rewrittenQuestion: string;
  styleName: string;
  description: string;
}

export interface QuestionRewriteResult {
  original: string;
  rewrittenQuestion: string; // The active version (defaults to V2)
  subtitle: string;
  background: string | null;
  focusSummary: string;
  activeVersion: 'v1' | 'v2';
  v1: QuestionRewriteVersionItem;
  v2: QuestionRewriteVersionItem;
}

/** Clean title string of trailing punctuation and whitespace. */
function clean(str: string): string {
  return str.replace(/\s+/g, ' ').trim().replace(/[。！!]+$/, '');
}

/**
 * O-3: extract a JSON object payload out of a raw model response.
 *
 * Real providers wrap the payload in markdown fences, prose ("好的，以下是结果："),
 * reasoning tags (`<think>…</think>`), or trailing pleasantries; some also emit a
 * trailing comma. `JSON.parse` rejects all of those, so the caller silently fell
 * back to the local heuristic after paying for the request.
 *
 * This strips packaging ONLY. It never invents or repairs meaning: input with no
 * balanced object, or an object that still fails `JSON.parse`, returns null so the
 * caller degrades honestly.
 */
export function extractJsonObject(rawText: string): string | null {
  if (typeof rawText !== 'string') return null;

  // Drop reasoning blocks and markdown fences before scanning.
  const cleaned = rawText
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/```(?:json)?/gi, '');

  // Scan for the first balanced object, honouring string literals and escapes
  // so braces inside values (e.g. "含{符号}的标题") never break the balance.
  for (let start = cleaned.indexOf('{'); start !== -1; start = cleaned.indexOf('{', start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < cleaned.length; i++) {
      const char = cleaned[i]!;

      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
        continue;
      }

      if (char === '"') inString = true;
      else if (char === '{') depth++;
      else if (char === '}') {
        depth--;
        if (depth === 0) {
          const candidate = cleaned.slice(start, i + 1);
          // Tolerate a trailing comma before a closing brace/bracket.
          const normalized = candidate.replace(/,(\s*[}\]])/g, '$1');
          try {
            const parsed: unknown = JSON.parse(normalized);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
              return normalized;
            }
          } catch {
            // Not a valid payload — keep scanning from the next '{'.
          }
          break;
        }
      }
    }
  }

  return null;
}

/**
 * Deterministic heuristic question rewriter & subtitle generator.
 * Used when LLM is offline, unavailable, or in unit tests.
 */
export function rewriteQuestionHeuristic(
  rawInput: string,
  preferredVersion: 'v1' | 'v2' = 'v2'
): QuestionRewriteResult {
  const original = clean(rawInput);
  if (!original) {
    const emptyV1: QuestionRewriteVersionItem = {
      rewrittenQuestion: '',
      styleName: '第一版：学术机制与深度探究',
      description: '深入因果底层机制、边界条件与多维推演',
    };
    const emptyV2: QuestionRewriteVersionItem = {
      rewrittenQuestion: '',
      styleName: '第二版：事实锚定与自然思辨',
      description: '主体事实前置、去噱头降噪，经典知乎自然追问',
    };
    return {
      original: '',
      rewrittenQuestion: '',
      subtitle: '深度议题探究',
      background: null,
      focusSummary: '明确核心研讨对象与思辨维度',
      activeVersion: preferredVersion,
      v1: emptyV1,
      v2: emptyV2,
    };
  }

  // Strip conversational / rhetorical prefixes
  let core = original
    .replace(/^(如何看待|如何评价|请问|我想知道|大家觉得|为什么说|为什么|怎么看|大家怎么看|求问|如何理解|聊聊|谈谈|关于)\s*/, '')
    .replace(/[？?]+$/, '')
    .trim();

  // Extract background if original was declarative or a news event
  const isDeclarative = !/^(如何|为什么|是否|能否|怎么|哪|何|到底|算不算|值不值)/.test(original) && !/[？?]/.test(original);
  const background = isDeclarative && original.length > 8 ? `原始议题背景：${original}` : null;

  let subtitle = '深度议题探究';
  let v1Question = '';
  let v2Question = '';
  let focusSummary = '从底层机制、现实约束与价值取向展开系统性剖析';

  // Domain & Pattern Matching for high quality V1 and V2 rewrites
  if (/(酸菜|白宫.*酸菜|万斯.*酸菜|酸菜.*减肥)/.test(core)) {
    subtitle = '发酵膳食与减重循证';
    v2Question = '美国副总统万斯自称吃酸菜减肥成功，可是吃酸菜真的能减肥吗？';
    v1Question = '围绕发酵膳食对体重管理的影响，其背后的生物代谢机制、个体差异与循证医学支持度究竟如何？';
    focusSummary = '从名人饮食效应、肠道菌群代谢机制与循证医学事实切入思辨';
  } else if (/(AI|人工智能|大模型|GPT|ChatGPT|Claude|DeepSeek|算力|生成式|Agent|智能体)/i.test(core)) {
    if (/(取代|失业|就业|工作|程序员|打工人)/.test(core)) {
      subtitle = '智能演进与认知劳动重构';
      v2Question = '在AI大模型代码生成与推理能力快速演进的背景下，程序员等专业脑力工作真的会被全面取代吗？';
      v1Question = '在AI大模型能力快速演进的背景下，人类专业劳动与认知能力的不可替代性边界究竟何在？';
      focusSummary = '聚焦人机分工演变、能力替代边界与职业范式重塑';
    } else if (/(创造力|艺术|意识|思考|灵魂)/.test(core)) {
      subtitle = '机器认知与创造力边界';
      v2Question = '生成式AI已经能创作出媲美人类水准的画作与文本，可是AI真的具备人类意义上的创造力吗？';
      v1Question = '如何界定大模型生成内容的创造力属性，其对人类认知与原创价值生态带来何种深层冲击？';
      focusSummary = '从创造力哲学定义、生成机理与原创性评估展开思辨';
    } else if (/(落地|商业|变现|泡沫|投资|成本)/.test(core)) {
      subtitle = '大模型商业化与价值落地';
      v2Question = '各行各业都在加速引入大模型，可是AI技术在实际商业落地中真的能实现正向ROI与盈利闭环吗？';
      v1Question = '当前AI大模型在产业垂直落地中面临的核心技术瓶颈、ROI成本效益与商业闭环挑战是什么？';
      focusSummary = '聚焦产业落地阻力、算力成本收益与商业化可行路径';
    } else {
      subtitle = '人工智能演进与认知边界';
      v2Question = `围绕“${core.slice(0, 24)}”，这背后真正引发行业关注的核心事实是什么，又该如何理性审视？`;
      v1Question = `围绕“${core.slice(0, 28)}”，其核心技术突破机制、现实约束条件与长期影响是什么？`;
      focusSummary = '剖析底层技术原理、发展约束与潜在社会影响';
    }
  } else if (/(电车|油车|新能源|电池|续航|特斯拉|比亚迪|自动驾驶|智驾)/.test(core)) {
    subtitle = '能源转型与出行博弈';
    v2Question = '新能源汽车在续航与智能化上突飞猛进，可是从全生命周期综合成本与保值率来看，电车真的比油车更划算吗？';
    v1Question = '从全生命周期成本、补能基础设施与技术迭代速度来看，新能源汽车相对传统燃油车的综合竞争力与适用边界如何？';
    focusSummary = '聚焦全生命周期成本、技术成熟度与场景适配差异';
  } else if (/(35岁|职业|转型|裁员|内卷|大厂|薪资|跳槽|发展)/.test(core)) {
    subtitle = '职业发展与结构性跃迁';
    v2Question = '职场“35岁门槛”与大厂裁员转型频频引发焦虑，个体究竟如何才能跨越职场周期实现稳定发展？';
    v1Question = '面对行业周期波动与技术代际更替，个体如何构建抗周期的核心竞争壁垒与长效职业发展路径？';
    focusSummary = '聚焦人力资本积累、周期应对策略与结构性转型路径';
  } else if (/(消费|降级|买房|房价|理财|股市|经济|通胀)/.test(core)) {
    subtitle = '经济周期与消费价值回归';
    v2Question = '在消费观念转变与资产收益波动的背景下，“消费降级”与极简生活方式真的是当下最理性的选择吗？';
    v1Question = '在宏观经济环境与预期变化下，大众消费决策与资产配置的核心逻辑经历了怎样的价值重塑？';
    focusSummary = '分析宏观预期演变、风险偏好转移与理性决策边界';
  } else if (/(教育|高考|考研|留学|内卷|鸡娃|文凭|学历)/.test(core)) {
    subtitle = '教育评价与阶层流动机制';
    v2Question = '高学历带来的就业溢价似乎在逐步收窄，可是对于普通家庭而言，学历还依然是实现上升流动的关键杠杆吗？';
    v1Question = '如何评估当前教育评价体系在人才选拔、能力培养与社会阶层流动中的实际效能与结构性矛盾？';
    focusSummary = '探讨评价标准多元化、教育投资回报与人才供需匹配';
  } else if (/(健康|减肥|饮食|运动|熬夜|焦虑|睡眠)/.test(core)) {
    subtitle = '生理机理与健康生活方式';
    v2Question = `网络上流传着各种关于“${core.slice(0, 18)}”的说法，可是这些做法真的有科学依据和实际效果吗？`;
    v1Question = `围绕“${core.slice(0, 25)}”，其背后被现代医学与实证研究支撑的关键生理机制与认知误区有哪些？`;
    focusSummary = '基于循证研究澄清认知误区，提炼科学健康决策依据';
  } else {
    // General semantic synthesis for arbitrary topics
    const cleanNoun = core.slice(0, 18).replace(/的|了|在|是|和|与|被/g, '');
    subtitle = cleanNoun.length >= 4 ? `${cleanNoun.slice(0, 6)}之辨` : '核心议题探究';

    if (/[？?]$/.test(original)) {
      v2Question = `针对近期关于“${core.slice(0, 26)}”的讨论，这一现象背后的核心争议究竟是什么，真的能成立吗？`;
      v1Question = `围绕“${core.slice(0, 30)}”，其深层因果机制、关键支撑论据与争议焦点是什么？`;
    } else {
      v2Question = `围绕“${core.slice(0, 26)}”，事实真相究竟如何，这真的具有普适性或现实可行性吗？`;
      v1Question = `如何全面审视“${core.slice(0, 30)}”的核心事实依据、推导逻辑与边界条件？`;
    }
    focusSummary = '从核心事实依据、论证逻辑与现实约束展开多维研讨';
  }

  const v1: QuestionRewriteVersionItem = {
    rewrittenQuestion: v1Question,
    styleName: '第一版：学术机制与深度探究',
    description: '深入因果底层机制、边界条件与多维推演',
  };

  const v2: QuestionRewriteVersionItem = {
    rewrittenQuestion: v2Question,
    styleName: '第二版：事实锚定与自然思辨',
    description: '主体事实前置、去噱头降噪，经典知乎自然追问',
  };

  return {
    original,
    rewrittenQuestion: preferredVersion === 'v1' ? v1Question : v2Question,
    subtitle,
    background,
    focusSummary,
    activeVersion: preferredVersion,
    v1,
    v2,
  };
}

/**
 * System prompt for LLM question rewriting and subtitle generation.
 */
export function buildQuestionRewriteMessages(inputQuestion: string): Array<{ role: 'system' | 'user'; content: string }> {
  const systemPrompt = `你是一个严谨的深度研报与思辨研讨问题重构专家。
你的任务是将用户输入的原始问题或知乎热榜标题重构为具备深度研讨价值的问题，并同时产出【第二版（事实锚定与自然思辨版，推荐/默认）】与【第一版（学术机制与深度探究版）】，并生成一个【4-14字的凝练小标题】。

【改写版本规范】：
1. 第二版（v2 - 事实锚定与自然思辨版，推荐/默认）：
   - 核心原则：
     a. 主体与事实补全：补充核心主体完整身份（如“万斯”规范化补全为“美国副总统万斯”），提取前因事实；
     b. 去除噱头与杂音：去掉“为啥白宫流行...”、“大家都说...”等口语化抓眼球噱头，提炼核心事实陈述；
     c. 经典自然转折追问：使用“【事实背景陈述】，可是/然而【核心问题真的...吗？】”等通俗生动、切中痛点的经典知乎好问题句式。
   - 典型示例：
     输入："为啥白宫开始流行吃酸菜了？万斯自称吃酸菜减重成功，酸菜真能减肥吗？"
     第二版输出："美国副总统万斯自称吃酸菜减肥成功，可是吃酸菜真的能减肥吗？"

2. 第一版（v1 - 学术机制与深度探究版）：
   - 核心原则：
     将问题重构为直指底层因果机制、边界条件、结构性矛盾或价值取向的学术/研究型研讨问题。
   - 典型示例：
     输入："为啥白宫开始流行吃酸菜了？万斯自称吃酸菜减重成功，酸菜真能减肥吗？"
     第一版输出："围绕发酵膳食对体重管理的影响，其背后的生物代谢机制、个体差异与循证医学支持度究竟如何？"

3. subtitle（小标题）：4-14 个汉字，高度凝练，体现议题的核心矛头、关键冲突或学术研讨主题（例如：“发酵膳食与减重循证”、“认知外包与思维惰性”、“全生命周期成本与补能博弈”）。严禁带标点符号，严禁空泛。

4. background（背景上下文）：提取简短背景陈述；若无特定背景则返回 null。
5. focusSummary（聚焦维度）：10-25字，一句话概括本次重写重点聚焦的分析维度。

【严格输出格式】：
必须只输出合法 JSON，禁止包含任何 Markdown 代码块标记（如 \`\`\`json），格式如下：
{
  "subtitle": "小标题文本",
  "activeVersion": "v2",
  "v2": {
    "rewrittenQuestion": "第二版重写问题文本？",
    "styleName": "第二版：事实锚定与自然思辨",
    "description": "主体事实前置、去噱头降噪，经典知乎自然追问"
  },
  "v1": {
    "rewrittenQuestion": "第一版重写问题文本？",
    "styleName": "第一版：学术机制与深度探究",
    "description": "深入因果底层机制、边界条件与多维推演"
  },
  "rewrittenQuestion": "第二版重写问题文本？",
  "background": "背景说明或null",
  "focusSummary": "聚焦维度说明"
}`;

  const userPrompt = `用户输入的原始议题或热榜问题：
"${inputQuestion.trim()}"

请严格按照上述规范生成第二版与第一版重写，并输出标准 JSON。`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];
}

/**
 * Parses and validates LLM response for question rewriting.
 */
export function parseQuestionRewriteResponse(
  rawText: string,
  originalInput: string,
  preferredVersion: 'v1' | 'v2' = 'v2'
): QuestionRewriteResult {
  try {
    // O-3: tolerate prose, reasoning tags, fences and trailing commas around
    // the payload. Unparseable input still throws and degrades honestly below.
    const cleanJson = extractJsonObject(rawText);
    if (cleanJson === null) {
      throw new Error('No JSON object found in the model response');
    }

    const parsed = JSON.parse(cleanJson);
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Parsed result is not an object');
    }

    const subtitle =
      typeof parsed.subtitle === 'string' && parsed.subtitle.trim().length >= 2
        ? parsed.subtitle.trim().slice(0, 20)
        : '核心议题探究';

    // Parse V2
    const v2Raw = parsed.v2;
    const v2Question =
      v2Raw && typeof v2Raw.rewrittenQuestion === 'string' && v2Raw.rewrittenQuestion.trim().length >= 4
        ? v2Raw.rewrittenQuestion.trim()
        : typeof parsed.rewrittenQuestion === 'string' && parsed.rewrittenQuestion.trim().length >= 4
        ? parsed.rewrittenQuestion.trim()
        : rewriteQuestionHeuristic(originalInput, 'v2').v2.rewrittenQuestion;

    const v2: QuestionRewriteVersionItem = {
      rewrittenQuestion: v2Question,
      styleName: (v2Raw && v2Raw.styleName) || '第二版：事实锚定与自然思辨',
      description: (v2Raw && v2Raw.description) || '主体事实前置、去噱头降噪，经典知乎自然追问',
    };

    // Parse V1
    const v1Raw = parsed.v1;
    const v1Question =
      v1Raw && typeof v1Raw.rewrittenQuestion === 'string' && v1Raw.rewrittenQuestion.trim().length >= 4
        ? v1Raw.rewrittenQuestion.trim()
        : rewriteQuestionHeuristic(originalInput, 'v1').v1.rewrittenQuestion;

    const v1: QuestionRewriteVersionItem = {
      rewrittenQuestion: v1Question,
      styleName: (v1Raw && v1Raw.styleName) || '第一版：学术机制与深度探究',
      description: (v1Raw && v1Raw.description) || '深入因果底层机制、边界条件与多维推演',
    };

    const activeVersion = preferredVersion;
    const rewrittenQuestion = activeVersion === 'v1' ? v1.rewrittenQuestion : v2.rewrittenQuestion;

    const background =
      typeof parsed.background === 'string' && parsed.background.trim().length > 0
        ? parsed.background.trim()
        : null;

    const focusSummary =
      typeof parsed.focusSummary === 'string' && parsed.focusSummary.trim().length > 0
        ? parsed.focusSummary.trim()
        : '从核心事实依据、论证逻辑与现实约束展开多维研讨';

    return {
      original: originalInput.trim(),
      rewrittenQuestion,
      subtitle,
      background,
      focusSummary,
      activeVersion,
      v1,
      v2,
    };
  } catch (err) {
    console.warn('[question-rewriter] Failed to parse LLM rewrite response, falling back to heuristic:', err);
    return rewriteQuestionHeuristic(originalInput, preferredVersion);
  }
}

/**
 * Main entrance: rewrites a question and generates its subtitle with LLM support and deterministic fallback.
 */
export async function rewriteQuestionAndSubtitle(
  rawInput: string,
  llmProvider?: LLMProvider | null,
  preferredVersion: 'v1' | 'v2' = 'v2'
): Promise<QuestionRewriteResult> {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    return rewriteQuestionHeuristic('', preferredVersion);
  }

  // If no LLM provider
  if (!llmProvider) {
    return rewriteQuestionHeuristic(trimmed, preferredVersion);
  }

  // If LLM provider provides generateQuestionRewrite or custom request
  const providerWithCustom = llmProvider as unknown as {
    generateQuestionRewrite?: (q: string) => Promise<QuestionRewriteResult | null>;
    generateCustomCompletion?: (messages: Array<{ role: string; content: string }>) => Promise<string | null>;
  };

  if (typeof providerWithCustom.generateQuestionRewrite === 'function') {
    try {
      const result = await providerWithCustom.generateQuestionRewrite(trimmed);
      if (result) {
        return {
          ...result,
          activeVersion: preferredVersion,
          rewrittenQuestion: preferredVersion === 'v1' && result.v1 ? result.v1.rewrittenQuestion : (result.v2 ? result.v2.rewrittenQuestion : result.rewrittenQuestion),
        };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[question-rewriter] provider.generateQuestionRewrite fallback to heuristic: ${msg}`);
    }
  }

  if (typeof providerWithCustom.generateCustomCompletion === 'function') {
    try {
      const messages = buildQuestionRewriteMessages(trimmed);
      const rawText = await providerWithCustom.generateCustomCompletion(messages);
      if (rawText) {
        return parseQuestionRewriteResponse(rawText, trimmed, preferredVersion);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[question-rewriter] provider.generateCustomCompletion fallback to heuristic: ${msg}`);
    }
  }

  return rewriteQuestionHeuristic(trimmed, preferredVersion);
}

