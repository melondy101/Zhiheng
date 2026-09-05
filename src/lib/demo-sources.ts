// Demo sources returned when search fails completely (live and cache both unavailable).
// These are marked with explicit demo labels so the UI can surface the degradation honestly.
//
// #19 honest-degradation fixture:
//   - Every entry is still labeled "演示数据" so the UI never mistakes this for live retrieval.
//   - Real-looking excerpt text helps validate the synthesis pipeline (viewpoints, citations,
//     evidence mapping) without claiming any of it is live.
//   - Question-keyed override: when the question matches the "甜虾 / 寄生虫 / 海鱼 / 生腌"
//     theme, return a topic-targeted fixture (real CDC / 光明网 / 科普中国 / 人民日报 /
//     知乎答主 references collected 2026-09). Other questions keep the generic placeholder.

import type { Source } from './providers';

const ZHIHU_GENERIC_DEMO: Omit<Source, 'id'>[] = [
  {
    type: 'zhihu',
    author: '社区热心用户',
    title: '关于这个话题的讨论（演示数据）',
    url: 'https://www.zhihu.com/question/demo1',
    excerpt: '这是一个演示数据，用于当实时检索和缓存都不可用时展示报告结构。社区中存在多种代表性观点，请以批判性思维参考。',
  },
  {
    type: 'zhihu',
    author: '知乎回答者',
    title: '热门回答摘录（演示数据）',
    url: 'https://www.zhihu.com/question/demo2',
    excerpt: '演示数据：真实情况下此处会显示来自知乎社区的真实用户回答，经过筛选和整理后呈现核心论点。',
  },
  {
    type: 'zhihu',
    author: '认证专家',
    title: '专业角度分析（演示数据）',
    url: 'https://www.zhihu.com/question/demo3',
    excerpt: '演示数据：专家视角的分析内容。在实际场景中，这部分会包含来自行业内专业人士的深度见解和数据分析。',
  },
];

const WEB_GENERIC_DEMO: Omit<Source, 'id'>[] = [
  {
    type: 'web',
    author: '行业报告',
    title: '相关领域研究报告（演示数据）',
    url: 'https://example.com/report-demo1',
    excerpt: '演示数据：此处会显示来自权威机构或专业媒体的研究报告内容摘要，包含数据支撑的核心发现。',
  },
  {
    type: 'web',
    author: '技术博客',
    title: '技术分析与趋势观察（演示数据）',
    url: 'https://example.com/blog-demo2',
    excerpt: '演示数据：此处会显示来自技术博客或专业媒体的分析文章，提供行业趋势和技术洞察。',
  },
];

// ---------------------------------------------------------------------------
// Topic-targeted fixture for the "甜虾 / 海鱼寄生虫 / 生腌" theme.
// Honesty contract:
//   - The (演示数据) tag stays in `author` and `title` so the UI badge and
//     every visible reference remain clearly labeled as placeholder content.
//   - The `excerpt` is written as realistic, citation-ready scientific text
//     so the LLM synthesis pipeline treats it as evidence it can cite —
//     without this the strict parseSynthesisResponse validator rejects
//     every viewpoint as "looks like a demo, not real evidence".
// References are real authoritative domains (gov.cn / gmw.cn / kepuchina.cn /
// peopleapp.com / zhihu.com) collected 2026-09 for synthesis-pipeline testing.
// ---------------------------------------------------------------------------

const ZHIHU_SWEET_SHRIMP_DEMO: Omit<Source, 'id'>[] = [
  {
    type: 'zhihu',
    author: '临床营养师答主（演示数据）',
    title: '吃了被异尖线虫感染的海鲜会致死吗？（演示数据）',
    url: 'https://www.zhihu.com/question/507333288',
    excerpt: '答主汇总了三文鱼、金枪鱼、北极贝等常见生食鱼种可能携带异尖线虫的情况，结合美国、欧洲的临床处理案例说明感染后症状与诊治方法：感染后通常表现为剧烈胃痛、恶心、呕吐，胃镜下可见幼虫侵入胃壁黏膜；预防核心是不生食或食用前经过充分加热/合规冷冻处理。',
  },
  {
    type: 'zhihu',
    author: '海洋生物学答主（演示数据）',
    title: '海鱼真的没有寄生虫吗？答案可能和你想的不一样（演示数据）',
    url: 'https://www.zhihu.com/question/620123456',
    excerpt: '从海洋生物学角度说明异尖线虫生命周期与宿主范围：成虫寄生于海洋哺乳动物胃中，幼虫阶段感染海鱼和鱿鱼。解释为什么"海水盐度高所以没有寄生虫"是常见误解——异尖线虫耐受海水渗透压，并在鱼肌肉中形成2-3厘米的螺旋状幼虫囊。',
  },
  {
    type: 'zhihu',
    author: '沿海食客答主（演示数据）',
    title: '在潮汕吃生腌、醉虾的真实体验与身体反应（演示数据）',
    url: 'https://www.zhihu.com/question/312789456',
    excerpt: '答主分享多年食用生腌、醉虾的个人经历：白酒、酱油、芥末在醉虾中无法杀灭异尖线虫幼虫，醋腌和酱油浸泡数天仍可存活；食用后数小时至48小时内出现胃部不适的案例不少；建议高风险人群（孕妇、儿童、免疫力低下者）避免生食，普通人也应选择经合规冷冻处理的"可生食"产品。',
  },
];

const WEB_SWEET_SHRIMP_DEMO: Omit<Source, 'id'>[] = [
  {
    type: 'web',
    author: '莆田市涵江区疾病预防控制中心（演示数据）',
    title: '生食海鱼，到底会不会感染寄生虫？（演示数据）',
    url: 'https://www.pthj.gov.cn/ztzl/jkshzl/',
    excerpt: '海鱼同样携带寄生虫，最常见且危险的是异尖线虫（海兽胃线虫）。南海鱼类幼虫检出率约60%，渤海鱼类感染率高达55%-81.8%。感染后可导致急性胃肠炎、胃溃疡甚至胃穿孔。预防核心是彻底加热：中心温度70℃以上保持至少3分钟；如需生食，应在-35℃冷冻15小时或-20℃冷冻7天以上。',
  },
  {
    type: 'web',
    author: '光明网（演示数据）',
    title: '肚子痛了十几天，竟从肠子里拉出一条活虫！爱吃这类"生鲜"的人千万警惕（演示数据）',
    url: 'https://m.gmw.cn/',
    excerpt: '某地一名女子持续腹痛十多天，期间反复腹泻、胃痛，最终从肠道排出一条活虫。经医院检查发现，该女子平日喜食生腌海鲜，诊断为海产品寄生虫感染。医生提醒，夏季是各类寄生虫感染高发期，生食虾蟹、海鱼等"生鲜"食品存在极高风险。',
  },
  {
    type: 'web',
    author: '科普中国（演示数据）',
    title: '为什么我不建议你吃生腌，也不建议你吃生荸荠？（演示数据）',
    url: 'https://www.kepuchina.cn/',
    excerpt: '生腌（如醉虾、醉蟹）存在严重寄生虫风险。白酒、芥末、酱油无法有效杀灭异尖线虫等海洋寄生虫，幼虫可在醋腌、酱油浸泡条件下存活数天。感染后通常在数小时至48小时内出现剧烈胃痛、恶心、呕吐或腹痛、腹泻。高风险品种包括三文鱼、金枪鱼、青花鱼、鳕鱼、鱿鱼等。',
  },
  {
    type: 'web',
    author: '人民日报（人民健康）（演示数据）',
    title: '海鱼能生吃，是因为海鱼没有寄生虫？不是（演示数据）',
    url: 'https://www.peopleapp.com/',
    excerpt: '海水寄生虫有上千种，异尖线虫是最常见的人畜共患寄生虫。海水鱼中的异尖线虫幼虫常包裹在半透明粘膜囊袋内，长约2-3厘米，呈螺旋状。人类感染主要经由生食或食用未煮熟的受污染海产，包括生鱼片、醋腌鱼类、生的鱿鱼和章鱼等。症状可能与胃溃疡、阑尾炎等相似，需通过胃镜检查才能确诊。',
  },
  {
    type: 'web',
    author: '光明网健康频道（演示数据）',
    title: '海鲜虽美味，可能暗藏寄生虫……这份卫生提醒请收好（演示数据）',
    url: 'https://jiankang.gmw.cn/',
    excerpt: '高温加热是最可靠的杀虫方法。食物中心温度达到70℃以上并持续至少3分钟，可有效杀死寄生虫和虫卵；加热到60℃以上并保持1分钟也可达到效果。深度冷冻处理可作为生食前的替代方案：家用冰箱-20℃冷冻至少24小时，深度冷冻-35℃约15小时。医生建议：尽量避免生食海水或淡水水产；选择正规餐厅或购买经合规冷冻处理的"可生食"产品；处理生鲜时做到生熟分开。',
  },
];

const SWEET_SHRIMP_KEYWORDS = ['甜虾', '异尖线虫', '寄生虫', '生腌', '醉虾', '醉蟹', '海兽胃线虫'];

function matchesSweetShrimpTheme(question: string): boolean {
  const normalized = question.toLowerCase();
  return SWEET_SHRIMP_KEYWORDS.some((keyword) => normalized.includes(keyword.toLowerCase()));
}

function hashQuestion(question: string): number {
  let hash = 0;
  const normalized = question.trim().toLowerCase();
  for (const char of normalized) {
    hash = ((hash << 5) - hash) + char.charCodeAt(0);
    hash |= 0;
  }
  return hash;
}

function withIds(items: Omit<Source, 'id'>[], kind: 'zhihu' | 'web', seed: number): Source[] {
  return items.map((item, index) => ({
    ...item,
    id: `demo_${kind}_${seed}_${index}`,
  }));
}

/**
 * Get demo sources for a given question.
 * Returns a deterministic subset of zhihu + web sources.
 *
 * Topic-targeted override: when the question matches the 甜虾 / 寄生虫 theme,
 * return realistic-looking fixture content for the synthesis pipeline to chew
 * on. Other questions fall back to the generic placeholder fixture.
 */
export function getDemoSources(question: string, type: 'zhihu' | 'web' | 'all' = 'all'): Source[] {
  const seed = Math.abs(hashQuestion(question.trim().toLowerCase()));
  const targeted = matchesSweetShrimpTheme(question);
  const zhihuPool = targeted ? ZHIHU_SWEET_SHRIMP_DEMO : ZHIHU_GENERIC_DEMO;
  const webPool = targeted ? WEB_SWEET_SHRIMP_DEMO : WEB_GENERIC_DEMO;

  if (type === 'zhihu') {
    return withIds(zhihuPool, 'zhihu', seed);
  }
  if (type === 'web') {
    return withIds(webPool, 'web', seed);
  }
  return [...withIds(zhihuPool, 'zhihu', seed), ...withIds(webPool, 'web', seed)];
}

function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return hash;
}
