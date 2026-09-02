# 知研 UI 深度审计 — frontend-design 方法论补充

> 基于 frontend-design skill 的 "反 AI 千篇一律审美" 框架，对现有 `ui-redesign-plan.md` 的逐层审计。
> 本文档**补充**而非替代原计划。

---

## 一、审计结论

原方案在色彩系统和组件规范上已经扎实，但存在四个 "看起来不错但记不住" 的盲区：

| # | 盲区 | 原方案状态 | 风险 |
|---|---|---|---|
| 1 | **缺乏 Signature Moment** | 没有让人记住的视觉锚点 | 用户用完不会跟别人提起 |
| 2 | **空间构成太安全** | 全部对称居中、标准卡片网格 | 跟任何 SaaS 后台无法区分 |
| 3 | **背景只是纯色** | `--color-bg` 一抹到底 | 缺乏纵深感和氛围 |
| 4 | **动效只有 hover** | 无入场编排、无流式文本、无阶段过渡 | 静态感强，不像"活的"AI 产品 |

---

## 二、Signature Moment 设计

### 2.1 品牌视觉锚："追问光标"

知研的核心体验是"追问"。把这个概念变成视觉语言：

**设计元素**：在所有 AI 生成的追问问题前面，放一个 2px 宽的竖线光标，以 800ms 间隔闪烁，颜色为 `--color-primary`。这不是普通光标——它代表"AI 正在追问你"。

```css
.question-cursor {
  display: inline-block;
  width: 2px;
  height: 1em;
  background: var(--color-primary);
  animation: blink 800ms step-end infinite;
  margin-right: 6px;
  vertical-align: text-bottom;
}

@keyframes blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}
```

这个光标同时用于：
- 首页输入框 placeholder 前面（静态，不闪烁）
- QAPanel 的追问问题框前面（闪烁）
- 报告生成中的流式文本末尾（闪烁）

### 2.2 品牌几何装饰："思辨弧线"

在首页 hero 区域背后，放一条极淡的 SVG 弧线（opacity 0.04），从左下到右上，暗示"思维的弧线路径"。暗色模式下 opacity 提升到 0.08。

```
颜色: var(--color-primary)
粗细: 1.5px
形状: 二次贝塞尔曲线，起点 (0%, 80%)，控制点 (50%, -20%)，终点 (100%, 60%)
```

这条弧线不出现在任何其他页面——它是首页的独有记忆点。

---

## 三、空间构成升级

### 3.1 首页：打破完美对称

**问题**：当前方案完全居中对称，安全但缺乏张力。

**改动**：
- 品牌标题 "知研" 微微偏左（margin-left: -8px），打破绝对居中
- Hotlist 和 Input 的 max-width 做差异化：Input 区 580px，Hotlist 区 640px（略宽），形成微妙的宽度节奏
- Hotlist 上方加一个右对齐的装饰性小标签："今日思辨素材"，字体极小（10px），颜色 `--color-text-tertiary`，打破纯标题式布局

### 3.2 Session 页：Report 区增加"呼吸感"

**问题**：ReportPanel 的 section 全部紧贴，没有"段落间的呼吸"。

**改动**：
- Section 之间间距从 16px 增大到 24px
- 每个 section 顶部加一条 40px 宽的细色条（section label 左侧的竖线），替代全宽分割线
- 长引用文本增加 `text-indent: 2em` + 首行不缩进，形成中文排版传统的段落感

### 3.3 QAPanel：消息间距的节奏

**问题**：所有消息等间距排列，缺乏对话"呼吸"。

**改动**：
- 用户消息 → AI追问 之间：24px（思考空间）
- AI追问 → 用户回答 之间：12px（紧凑对话）
- 提示框 (hint) 前后：20px + 上下细线分割
- 新 Round 开始时：32px + 一条 "Round N" 小标签居中

---

## 四、背景与纵深

### 4.1 暖色微噪纹理

在 `body` 上加一层极淡的噪点纹理（opacity 0.015），让纯色背景有"纸"的质感而非"屏幕"的平滑感。暗色模式下关闭（暗色本身就有足够纵深）。

```css
body::before {
  content: '';
  position: fixed;
  inset: 0;
  opacity: 0.015;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E");
  pointer-events: none;
  z-index: 0;
}

.dark body::before { display: none; }
```

### 4.2 首页 Hero 渐变底色

首页 hero 区域用极淡的暖色渐变，从顶部 `var(--color-bg)` 到中部微暖（`rgba(217, 119, 6, 0.02)`），到底部回到 `var(--color-bg)`。暗色模式下不启用。

```css
.home-hero {
  background: linear-gradient(
    180deg,
    var(--color-bg) 0%,
    rgba(217, 119, 6, 0.02) 50%,
    var(--color-bg) 100%
  );
}
```

### 4.3 Session Header 的微妙分割

Header 底部 1px border 改为 1px 的渐变线（从透明 → border色 → 透明），比硬线条更优雅：

```css
.session-header::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 10%;
  right: 10%;
  height: 1px;
  background: linear-gradient(
    90deg,
    transparent,
    var(--color-border),
    transparent
  );
}
```

---

## 五、动效编排

### 5.1 入场编排 (Staggered Entry)

首页加载时，元素按序淡入，每个元素延迟 80ms：

```css
@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.home-hero > * { animation: fadeInUp 400ms ease-out backwards; }
.home-hero > *:nth-child(1) { animation-delay: 0ms; }    /* 标题 */
.home-hero > *:nth-child(2) { animation-delay: 80ms; }   /* 副标题 */
.home-hero > *:nth-child(3) { animation-delay: 160ms; }  /* 输入卡 */

.hotlist-card .hotlist-item {
  animation: fadeInUp 300ms ease-out backwards;
}
.hotlist-item:nth-child(1) { animation-delay: 300ms; }
.hotlist-item:nth-child(2) { animation-delay: 360ms; }
.hotlist-item:nth-child(3) { animation-delay: 420ms; }
/* ...每个 +60ms */
```

Session 页 ReportPanel 的 section 也做类似编排（delay 100ms/section）。

### 5.2 流式文本光标

AI 生成报告时，文本末尾显示闪烁光标。完成后光标淡出：

```css
.streaming-cursor {
  display: inline-block;
  width: 2px;
  height: 1.1em;
  background: var(--color-primary);
  animation: blink 500ms step-end infinite;
  vertical-align: text-bottom;
  margin-left: 1px;
  transition: opacity 600ms;
}

.streaming-done .streaming-cursor { opacity: 0; }
```

### 5.3 来源卡片 hover 微动

引用来源卡片 hover 时，不做大位移，只做微妙的边框亮色 + 背景加深：

```css
.source-item {
  transition: all 200ms cubic-bezier(0.4, 0, 0.2, 1);
}
.source-item:hover {
  border-color: var(--color-primary-subtle);
  background: var(--color-bg-muted);
}
```

### 5.4 Stance 卡片选中过渡

选中 stance 卡片时，左边条从 info 色过渡到 primary 色：

```css
.stance-card {
  transition: border-left-color 300ms, background-color 300ms;
}
```

### 5.5 主题切换过渡

切换亮暗主题时，全局 300ms 过渡，不做闪烁式瞬间切换：

```css
body, .card, .btn-primary, .badge, input, textarea {
  transition: background-color 300ms, color 300ms, border-color 300ms;
}
```

---

## 六、字体系统深化

### 6.1 当前选择评估

Geist Sans + Geist Mono 是 Vercel 开源字体，特点：
- 几何无衬线，字形干净
- 内建 tabular numbers（等宽数字）
- 中文 fallback 靠系统字体

**评估**：Geist 作为 UI 字体优秀（辨识度高、字形锐利），但**长文阅读**体验偏弱——字重偏轻、x-height 偏小。

### 6.2 建议：双字体策略

```
UI 元素（标题、按钮、标签、导航）: Geist Sans ✓ (保持)
长文正文（报告内容、引用摘录、对话文本）: 系统默认宋体/黑体 fallback
等宽/数字（序号、时间戳、代码）: Geist Mono ✓ (保持)
```

具体 CSS：

```css
/* 正文长段落 */
.prose-body {
  font-family: var(--font-sans);
  font-size: 14px;
  line-height: 1.8;       /* 从 1.6 增到 1.8，中文阅读最优 */
  letter-spacing: 0.02em; /* 微调字间距，中文更透气 */
}
```

### 6.3 中文排版规则

```
- 标点挤压：全角标点间不加额外 space（浏览器默认已处理）
- 段首缩进：报告正文段首不缩进（现代 web 惯例），引用文本段首缩进 2em
- 中英文混排：英文/数字两侧加 0.25em 间距（通过 font-feature-settings 或手动 space）
- 数字：统计数字用 tabular figures（Geist 内建），序号用 font-mono
```

---

## 七、响应式断点

原方案未覆盖。补充三个断点：

```
Desktop (≥1280px):  完整双面板，Report flex-3 / QA flex-2
Laptop (1024-1279px): QA 面板 min-width 340px，Report 内容 max-width 600px
Tablet (768-1023px): QA 面板改为底部抽屉（slide-up），高度 50vh
Mobile (<768px):    单列布局，Report 和 QA 通过 tab 切换
```

### Tablet / Mobile 的 Tab 切换

```
┌─────────────────────────────┐
│  Header                      │
├─────────────────────────────┤
│  [ 报告 ]  [ 追问 ]  ← tabs  │
├─────────────────────────────┤
│                              │
│  (当前 tab 内容)              │
│                              │
└─────────────────────────────┘
```

```css
@media (max-width: 1023px) {
  .session-body { flex-direction: column; }
  .report-panel { border-right: none; }
  .qa-panel { max-width: none; min-width: 0; }
  
  .tab-report .qa-panel { display: none; }
  .tab-qa .report-panel { display: none; }
}
```

---

## 八、组件状态矩阵（补充）

每个组件需要覆盖的状态：

| 组件 | 默认 | Hover | Active | Focus | Disabled | Loading | Error |
|---|---|---|---|---|---|---|---|
| 按钮 | ✓ | ✓ | ✓ (scale 0.98) | ✓ (ring) | ✓ (opacity 0.5) | ✓ (spinner) | — |
| 输入框 | ✓ | ✓ (border-strong) | — | ✓ (border-primary + ring) | ✓ (bg-muted) | — | ✓ (border-error) |
| 卡片 | ✓ | ✓ (bg-subtle) | — | — | — | ✓ (skeleton) | ✓ (border-error) |
| Stance | ✓ | ✓ (border-subtle) | — | — | — | — | — |
| 消息气泡 | ✓ | — | — | — | — | ✓ (streaming cursor) | — |
| 热榜项 | ✓ | ✓ (bg-subtle) | ✓ (bg-muted) | — | — | ✓ (skeleton) | — |
| 引用徽章 | ✓ | ✓ (bg-primary-subtle) | — | — | — | — | — |

---

## 九、对原计划的具体修改

### 9.1 globals.css 补充

在原计划的 CSS 变量之后，追加：

```css
/* ── 噪点纹理（仅亮色） ── */
body::before {
  content: '';
  position: fixed;
  inset: 0;
  opacity: 0.015;
  background-image: url("data:image/svg+xml,...(同上)");
  pointer-events: none;
  z-index: 0;
}
.dark body::before { display: none; }

/* ── 追问光标 ── */
@keyframes questionBlink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}

/* ── 入场动画 ── */
@keyframes fadeInUp {
  from { opacity: 0; transform: translateY(12px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* ── 全局过渡 ── */
body, .card, button, input, textarea, .badge {
  transition: background-color 300ms, color 300ms, border-color 300ms;
}

/* ── 中文正文排版 ── */
.prose-body {
  font-size: 14px;
  line-height: 1.8;
  letter-spacing: 0.02em;
}
```

### 9.2 HomePage 补充

- 追加 "思辨弧线" SVG 装饰（section 二 2.2）
- 热榜标题改为右对齐 "今日思辨素材" 小标签（section 三 3.1）
- 入场动画 stagger 序列（section 五 5.1）

### 9.3 Session 页补充

- Header 底部渐变线（section 四 4.3）
- Section 间距从 16px → 24px（section 三 3.2）
- 追问问题前加闪烁光标（section 二 2.1）
- QA 消息间距节奏（section 三 3.3）
- 响应式断点 + tablet/mobile tab 切换（section 七）

---

## 十一、better-ui 组件级审计（15 条原则逐项检查）

基于 better-ui skill 的组件打磨原则，对 `ui-redesign-plan.md` 和 Mockup 的逐项审查：

### 11.1 同心圆角 (Concentric Border Radius)

**原则**：外层 radius = 内层 radius + padding。嵌套元素圆角不匹配是界面"感觉不对"最常见的原因。

| 严重度 | 位置 | 当前 | 修正 | 原因 |
|---|---|---|---|---|
| MEDIUM | `ReportPanel` source-item | 卡片 `rounded-md`(10px)，内部 source-item `rounded-sm`(6px)，padding 10px | 内部改为 `rounded-md`(10px)，因为 6+10=16≈外层 10 不匹配；或直接统一用 `rounded-sm`(6px) + padding 6px | 嵌套圆角不匹配使内层看起来被挤压 |
| LOW | `StanceSelector` AI 建议卡 | 卡片 `rounded-sm`(6px)，内部 badge `rounded-full` | badge 保持 `rounded-full`（pill 是独立语义），不改 | pill badge 不受同心圆角约束 |

**修正规范**：
```
容器 rounded-md(10px) + padding 12px → 内部 rounded-sm(6px) ✓ (6+12=18>10, 不冲突)
容器 rounded-md(10px) + padding 6px  → 内部 rounded-[4px]  ✓ (4+6=10=外层)
```

### 11.2 阴影 vs 边框

**原则**：仅用于制造深度的 border 应改为分层透明 box-shadow。保留结构性 border（分割线、选中态、focus 态）。

| 严重度 | 位置 | 当前 | 修正 | 原因 |
|---|---|---|---|---|
| MEDIUM | `HomePage` 热榜卡片 | `border: 1px solid var(--color-border)` 作为唯一视觉分隔 | 改为 `box-shadow: var(--shadow-sm)` + 去掉 border；hover 态加 `box-shadow: var(--shadow-md)` | 卡片 border 仅用于制造层级感，应交给 shadow |
| LOW | `ReportPanel` section 卡片 | 同上 | 同上处理 | 一致性 |
| — | 保留 border 的位置 | Header 底部、面板分割线、输入框、选中态 | 不动 | 这些是结构性/状态性 border，应保留 |

**修正规范**：
```css
/* 非结构性卡片 */
.card-float {
  background: var(--color-bg-elevated);
  border: none;
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
  transition: box-shadow 200ms;
}
.card-float:hover {
  box-shadow: var(--shadow-md);
}
```

### 11.3 过渡属性精确化

**原则**：永远不用 `transition: all`。明确指定属性。

| 严重度 | 位置 | 当前 | 修正 | 原因 |
|---|---|---|---|---|
| HIGH | Mockup 全局 `.nb` 按钮 | `transition: all .2s` | `transition: background-color 200ms, color 200ms, border-color 200ms` | `transition: all` 会导致所有属性变化都触发过渡，产生不预期的动画 |
| HIGH | Mockup `.hl-i` 热榜项 | `transition: background .15s` | `transition: background-color 150ms` | 明确属性名 |
| MEDIUM | Mockup `.card` | `transition: border-color .2s, background .2s` | `transition: border-color 200ms, background-color 200ms, box-shadow 200ms` | `background` 是 shorthand，应明确 |

**在全局 CSS 中的修正**：
```css
/* ❌ 禁止 */
* { transition: all ... }

/* ✅ 正确 — 按元素类型指定 */
button, .btn-p, .nb { transition: background-color 200ms, color 200ms, border-color 200ms, box-shadow 200ms, transform 100ms; }
.card, .rp-sec { transition: border-color 200ms, background-color 200ms, box-shadow 200ms; }
input, textarea { transition: border-color 200ms, box-shadow 200ms; }
.badge { transition: background-color 200ms, color 200ms; }
```

### 11.4 按压缩放 (Scale on Press)

**原则**：按钮点击时 `scale(0.96)` 提供触觉反馈。不得小于 0.95。

| 严重度 | 位置 | 当前 | 修正 | 原因 |
|---|---|---|---|---|
| MEDIUM | 所有按钮 | Mockup 中 `.btn-p:hover { transform: scale(.98) }` | hover 不加 scale；改在 `:active` 加 `transform: scale(0.96)` | scale 应在按压时（active）而非悬浮时（hover） |
| LOW | 热榜项 | 无按压反馈 | `.hl-i:active { transform: scale(0.99); }` | 列表项的按压反馈应更微妙 |

**修正**：
```css
button:active, .btn-p:active, .nb:active { transform: scale(0.96); }
.hl-i:active { transform: scale(0.99); }
```

### 11.5 入场动画修正

**原则**：
- 低频入场用 stagger ~100ms
- 高频交互不做自定义动画
- 首次渲染可用 `initial={false}` 跳过

| 严重度 | 位置 | 当前 | 修正 | 原因 |
|---|---|---|---|---|
| LOW | 热榜 stagger | 每个 item 延迟 60ms | 改为 80-100ms | better-ui 推荐 ~100ms；60ms 太急促 |
| LOW | 首页入场 | `fadeUp` 400ms | 改为 350ms | 入场应快于 400ms，避免用户等"动画播完" |

### 11.6 退出动画

**原则**：退出比进入更柔和。用固定小位移 + `ease-out`。

**补充规范**（原计划未覆盖）：
```css
/* 弹出层/下拉菜单关闭 */
.exit {
  opacity: 0;
  transform: translateY(-4px);  /* 小位移，不是 full height */
  transition: opacity 200ms ease-out, transform 200ms ease-out;
}

/* 面板折叠 */
.panel-collapse-exit {
  opacity: 0;
  transform: translateX(8px);
  transition: opacity 250ms ease-out, transform 250ms ease-out;
}
```

### 11.7 图标规范

**原则**：
- 描边匹配文字粗细：1.5px stroke 配 regular(400)，2px 配 semibold(600)
- 一套图标只用一个库；outline 为默认，fill 仅用于 active 态
- 用 `currentColor`，通过 CSS 颜色/透明度实现状态变化

**补充规范**：
```
图标库: lucide-react (项目已引入 Next.js 生态)
默认描边: 1.5px (配合 400 weight 正文)
Header 图标: 1.5px (配合 600 weight → 可接受，因为 Header 图标较小)
尺寸: 16px(正文内) / 20px(导航/按钮) / 24px(标题旁)
颜色: currentColor (继承父元素色)
状态: outline → fill (active) / opacity 0.4 (disabled)
```

### 11.8 图片描边

**原则**：图片加 1px 低透明度描边，增加一致的深度感。

**补充规范**（如果后续有头像/图片出现）：
```css
img, .avatar {
  outline: 1px solid oklch(0 0 0 / 0.1);  /* light mode */
}
.dark img, .dark .avatar {
  outline: 1px solid oklch(1 0 0 / 0.1);  /* dark mode */
}
```

### 11.9 动画性能

**原则**：
- `will-change` 仅用于 `transform`、`opacity`、`filter`
- 只在观察到首帧卡顿时才加

**补充规范**：
```css
/* 仅在这些元素上考虑 will-change */
.streaming-cursor { will-change: opacity; }
.panel-collapse { will-change: transform; }

/* 不要在这些元素上加 */
/* ❌ .card { will-change: all; } */
/* ❌ body { will-change: background-color; } */
```

### 11.10 完整组件状态矩阵（按 better-ui 要求）

| 组件 | Default | Hover | Active | Focus | Disabled | Loading | Error | Selected |
|---|---|---|---|---|---|---|---|---|
| 主按钮 | bg-pri | bg-pri-h | scale(0.96) | ring-2 ring-pri-s | opacity(0.5) | spinner + "处理中" | — | — |
| Ghost 按钮 | transparent | bg-bg4 | scale(0.96) | ring-2 ring-pri-s | opacity(0.5) | — | — | — |
| 输入框 | border-bd | border-bd2 | — | border-pri + ring | bg-bg4 + cursor-not | — | border-err + ring-err | — |
| 热榜项 | default | bg-bg3 | scale(0.99) | — | — | skeleton | — | bg-pri-l |
| 来源卡片 | bg-bg3 | border-pri-s + bg-bg4 | scale(0.99) | — | — | skeleton | — | — |
| Stance 卡片 | border-bd + info-l | border-pri-s | — | — | — | — | — | border-pri + pri-l |
| 消息气泡 | — | — | — | — | — | streaming cursor | — | — |
| 主题切换 | bg-bg3 | bg-bg4 | scale(0.96) | ring-2 | — | — | — | — |

---

## 十二、不做什么清单（合并版）

| 不建议的设计 | 原因 |
|---|---|
| 大面积渐变背景 | 知识平台的正文阅读会被干扰 |
| Brutalist/粗野主义 | 目标用户是中文知识消费者，不是设计师 |
| 自定义光标 (cursor: url) | 干扰阅读，降低可访问性 |
| 视差滚动 | 工具型产品不需要叙事式滚动 |
| 大量 emoji 装饰 | 降低专业感 |
| Glassmorphism（毛玻璃） | 在报告长文场景下降低可读性 |
| 暗黑模式用纯黑 #000000 | 已用暖黑 #0C0A09 避免 |
| `transition: all` | better-ui 明确要求禁止 |
| hover 态加 scale | scale 只属于 active/press 态 |
| 高频交互做自定义动画 | 注意力成本每次触发都重复 |
| 混用图标库 | 一套 lucide-react 走到底 |
| filled 图标做默认态 | outline 为默认，fill 仅用于 selected/active |
