import type { Session, Source } from './providers';
import { buildDetailedResultCard } from './result-card-builder';
import { TRAJECTORY_TYPE_LABELS } from './cognitive-trajectory';

function clean(value: string | null | undefined): string {
  return (value ?? '').trim() || '（未记录）';
}

function sourceLine(source: Source, index: number): string {
  const link = source.url ? `[原始链接](${source.url})` : '无原始链接';
  return `${index}. ${clean(source.title)}；${clean(source.author)}；${link}\n   - ${clean(source.excerpt)}`;
}

export function buildSessionMarkdown(session: Session): string {
  const card = buildDetailedResultCard(session);
  const report = session.report;
  const graph = session.knowledgeGraph;
  const trajectory = session.cognitiveTrajectory ?? [];
  const aiMessages = session.messages.filter((message) => message.role === 'assistant');
  const userMessages = session.messages.filter((message) => message.role === 'user');
  const viewpoints = report?.synthesis?.viewpoints ?? [];

  const battlefield = viewpoints.length > 0
    ? viewpoints.map((viewpoint, index) => {
        const evidence = viewpoint.evidence
          .map((item) => `${item.summary} ${item.citationIds.map((id) => `[${id}]`).join('')}`)
          .join('；');
        return `### 战场 ${index + 1}：${viewpoint.conclusion}\n- 支持依据：${evidence || '未记录'}`;
      }).join('\n\n')
    : '暂无通过证据校验的 AI 观点。';

  const evolution = trajectory.length > 0
    ? trajectory.map((event, index) => `${index + 1}. **${event.label || TRAJECTORY_TYPE_LABELS[event.type]}**：${event.text}`).join('\n')
    : '暂无独立的观点演变记录。';

  const aiReview = aiMessages.length > 0
    ? aiMessages.map((message, index) => `${index + 1}. ${message.text}`).join('\n')
    : '本场没有保存 AI 发言记录。';

  return [
    '# 知研思辨记录',
    '',
    `- 会话 ID：${session.id}`,
    `- 完成时间：${new Date(session.updatedAt).toLocaleString('zh-CN')}`,
    '',
    '## 一、辩题 / 话题',
    '',
    `**${clean(report?.question ?? session.question)}**`,
    '',
    '## 二、相关文献图谱 PNG',
    '',
    '图谱文件：`knowledge-graph.png`（与本文档同时下载）',
    graph ? `节点 ${graph.nodes.length} 个，关系 ${graph.edges.length} 条。` : '本场没有可导出的知识图谱。',
    '',
    '## 三、AI 观点和用户观点',
    '',
    '### AI 观点',
    viewpoints.length > 0 ? viewpoints.map((v, i) => `${i + 1}. ${v.conclusion}`).join('\n') : '暂无 AI 观点。',
    '',
    '### 用户观点',
    `- 初始观点：${clean(card.initialExpression?.text ?? session.initialOpinion)}`,
    `- 起始立场：${clean(card.startingStance?.text)}`,
    `- 最终观点：${clean(card.finalPosition?.text)}`,
    '',
    '## 四、辩论观点演变',
    '',
    evolution,
    '',
    '## 五、论点争论战场',
    '',
    battlefield,
    '',
    '## 六、AI 整场点评',
    '',
    '以下为本场 AI 追问与回应记录，按原始顺序保留，未将 AI 内容伪装成用户观点：',
    '',
    aiReview,
    '',
    '## 附录：相关文献',
    '',
    report?.references?.length
      ? report.references.map((source, index) => sourceLine(source, index + 1)).join('\n')
      : '暂无相关文献。',
    '',
    '## 附录：用户回答记录',
    '',
    userMessages.length > 0 ? userMessages.map((message, index) => `${index + 1}. ${message.text}`).join('\n') : '暂无用户回答。',
    '',
  ].join('\n');
}

export function downloadText(filename: string, text: string, mime = 'text/markdown;charset=utf-8'): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function downloadKnowledgeGraphPng(session: Session, filename = 'knowledge-graph.png'): Promise<boolean> {
  const graph = session.knowledgeGraph;
  if (!graph || graph.nodes.length === 0) return false;
  const width = 1200;
  const height = 720;
  const center = { x: width / 2, y: height / 2 };
  const positions = new Map(graph.nodes.map((node, index) => {
    if (index === 0) return [node.id, center] as const;
    const angle = ((index - 1) / Math.max(1, graph.nodes.length - 1)) * Math.PI * 2;
    return [node.id, { x: center.x + Math.cos(angle) * 280, y: center.y + Math.sin(angle) * 220 }] as const;
  }));
  const esc = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char] ?? char));
  const lines = graph.edges.map((edge) => {
    const from = positions.get(edge.from)!;
    const to = positions.get(edge.to)!;
    return `<line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" stroke="#94a3b8" stroke-width="3" opacity=".75"/>`;
  }).join('');
  const nodes = graph.nodes.map((node, index) => {
    const point = positions.get(node.id)!;
    const fill = index === 0 ? '#e9d5ff' : '#dbeafe';
    const stroke = index === 0 ? '#9333ea' : '#2563eb';
    return `<g><circle cx="${point.x}" cy="${point.y}" r="${index === 0 ? 46 : 34}" fill="${fill}" stroke="${stroke}" stroke-width="4"/><text x="${point.x}" y="${point.y + 5}" text-anchor="middle" font-family="Arial,sans-serif" font-size="18" fill="#0f172a">${esc(node.label.slice(0, 10))}</text></g>`;
  }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#f8fafc"/>${lines}${nodes}</svg>`;
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const image = new Image();
  image.src = url;
  await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('图谱渲染失败')); });
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')!.drawImage(image, 0, 0);
  URL.revokeObjectURL(url);
  const pngUrl = canvas.toDataURL('image/png');
  const anchor = document.createElement('a');
  anchor.href = pngUrl;
  anchor.download = filename;
  anchor.click();
  return true;
}
