# 知研 UI 重设计计划

> 设计方向：**温暖精确 (Warm Precision)**
> Linear 的信息密度 + Things 3 的温暖质感 + Perplexity 的信任优先
> 亮色 + 暗色双主题同步交付

---

## 一、问题诊断

当前 UI 存在的核心问题：

1. **配色冷且泛化**：纯 Tailwind `blue-600` / `gray-50` 默认色板，缺乏品牌辨识度，"看起来像任何一个蓝色 SaaS"
2. **缺乏设计系统**：颜色、间距、圆角全部硬编码在组件内，8 个文件里散落着不同的值
3. **布局僵硬**：QAPanel 固定 450px，不适配不同屏幕；首页 max-width 偏窄，留白不足
4. **卡片扁平**：`bg-white rounded-lg border p-6 mb-4` 千篇一律，信息层级无法区分
5. **消息气泡突兀**：蓝底白字 vs 灰底黑字对比过强，缺乏温暖感
6. **知识图谱简陋**：列表式渲染，无交互感，与产品定位不匹配
7. **无暗色模式**：CSS 变量体系缺失，无法支持主题切换

---

## 二、设计系统

### 2.1 色彩系统

**设计理念**：用深暖靛蓝（Warm Indigo）替代标准蓝作为品牌主色——保留专业可信感，但比冷蓝更有温度。琥珀色（Amber）作为暖色点缀，用于需要吸引注意力的交互元素。语义色保持功能直觉，但全部调暖。

#### CSS 变量定义

```css
:root {
  /* ── Brand ── */
  --color-primary:         #4338CA;   /* 深靛蓝 - 品牌/导航/主按钮 */
  --color-primary-hover:   #3730A3;
  --color-primary-light:   #EEF2FF;   /* 轻触背景 */
  --color-primary-subtle:  #C7D2FE;   /* 边框/强调 */
  --color-accent:          #D97706;   /* 琥珀 - 热榜/点赞/高亮 */
  --color-accent-hover:    #B45309;
  --color-accent-light:    #FFFBEB;

  /* ── Surfaces (Light) ── */
  --color-bg:              #FAF9F7;   /* 暖白底 - 页面背景 */
  --color-bg-elevated:     #FFFFFF;   /* 浮层白 - 卡片/弹窗 */
  --color-bg-subtle:       #F5F3F0;   /* 柔灰底 - 代码块/侧栏 */
  --color-bg-muted:        #E8E5E0;   /* 暗灰底 - hover 态 */

  /* ── Text ── */
  --color-text-primary:    #1C1917;   /* 暖黑 - 标题/正文 */
  --color-text-secondary:  #57534E;   /* 暖灰 - 次要文字 */
  --color-text-tertiary:   #A8A29E;   /* 浅灰 - 占位符/时间戳 */
  --color-text-on-primary: #FFFFFF;   /* 主色上的文字 */

  /* ── Borders ── */
  --color-border:          #E7E5E4;   /* 默认边框 */
  --color-border-strong:   #D6D3D1;   /* 强调边框 */

  /* ── Semantic ── */
  --color-success:         #059669;
  --color-success-light:   #ECFDF5;
  --color-warning:         #D97706;
  --color-warning-light:   #FFFBEB;
  --color-error:           #DC2626;
  --color-error-light:     #FEF2F2;
  --color-info:            #7C3AED;   /* 紫色 - AI/洞察 */
  --color-info-light:      #F5F3FF;

  /* ── Spacing ── */
  --space-xs:  4px;
  --space-sm:  8px;
  --space-md:  16px;
  --space-lg:  24px;
  --space-xl:  32px;
  --space-2xl: 48px;
  --space-3xl: 64px;

  /* ── Radius ── */
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 14px;
  --radius-xl: 20px;
  --radius-full: 9999px;

  /* ── Shadow (仅用于浮层) ── */
  --shadow-sm: 0 1px 2px rgba(28, 25, 23, 0.04);
  --shadow-md: 0 4px 12px rgba(28, 25, 23, 0.08);
  --shadow-lg: 0 12px 32px rgba(28, 25, 23, 0.12);

  /* ── Font ── */
  --font-sans: 'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  --font-mono: 'Geist Mono', 'JetBrains Mono', 'Fira Code', monospace;
}
```

#### 暗色主题

```css
.dark {
  --color-primary:         #818CF8;   /* 亮靛蓝 */
  --color-primary-hover:   #A5B4FC;
  --color-primary-light:   rgba(129, 140, 248, 0.12);
  --color-primary-subtle:  rgba(129, 140, 248, 0.25);
  --color-accent:          #FBBF24;
  --color-accent-hover:    #F59E0B;
  --color-accent-light:    rgba(251, 191, 36, 0.12);

  --color-bg:              #0C0A09;   /* 深暖黑 */
  --color-bg-elevated:     #1C1917;   /* 卡片背景 */
  --color-bg-subtle:       #292524;   /* 柔灰底 */
  --color-bg-muted:        #44403C;   /* hover 态 */

  --color-text-primary:    #FAFAF9;
  --color-text-secondary:  #A8A29E;
  --color-text-tertiary:   #78716C;

  --color-border:          #292524;
  --color-border-strong:   #44403C;

  --color-success:         #34D399;
  --color-success-light:   rgba(52, 211, 153, 0.12);
  --color-warning:         #FBBF24;
  --color-warning-light:   rgba(251, 191, 36, 0.12);
  --color-error:           #F87171;
  --color-error-light:     rgba(248, 113, 113, 0.12);
  --color-info:            #A78BFA;
  --color-info-light:      rgba(167, 139, 250, 0.12);

  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.2);
  --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.3);
  --shadow-lg: 0 12px 32px rgba(0, 0, 0, 0.4);
}
```

#### 色彩使用规则

| 用途 | 亮色模式 | 暗色模式 |
|---|---|---|
| 品牌标题 "知研" | `--color-primary` | `--color-primary` |
| 主按钮背景 | `--color-primary` | `--color-primary` |
| 热榜序号/热度 | `--color-accent` | `--color-accent` |
| AI 内容标签 | `--color-info` + `--color-info-light` | 同 |
| 引用来源徽章 | `--color-primary-light` + `--color-primary` | 同 |
| 用户消息气泡 | `--color-primary` + 白色文字 | `--color-primary` + 深色文字 |
| AI 回复气泡 | `--color-bg-subtle` | `--color-bg-subtle` |
| 成功/实时状态 | `--color-success` + `--color-success-light` | 同 |
| 错误状态 | `--color-error` + `--color-error-light` | 同 |

### 2.2 字体系统

```
标题层级:
  H1 (页面标题)     → text-2xl font-bold tracking-tight     (24px / 700)
  H2 (区块标题)     → text-lg font-semibold                  (18px / 600)
  H3 (小节标题)     → text-base font-semibold                (16px / 600)

正文:
  正文-主要         → text-sm leading-relaxed                (14px / 400 / 1.7)
  正文-次要         → text-sm text-secondary                 (14px / 400 / secondary色)
  正文-等宽         → font-mono text-xs                      (12px / mono)

辅助:
  标签/Badge        → text-xs font-medium                    (12px / 500)
  时间戳/元信息     → text-xs text-tertiary                  (12px / 400 / tertiary色)
```

行高：长文本 `leading-relaxed`（1.625），短文本 `leading-normal`（1.5）。
正文最大宽度：680px（阅读舒适度最优区间）。

### 2.3 间距与圆角

**间距节奏**：基于 8px 网格

```
组件内边距:  16px (sm) / 24px (md)
卡片间距:    16px
区块间距:    32px
页面边距:    24px (mobile) / 32px (desktop)
```

**圆角体系**：

```
小元素 (badge/tag):    6px   (--radius-sm)
卡片/容器:             10px  (--radius-md)
按钮:                  10px  (--radius-md)
输入框:                10px  (--radius-md)
模态框/大面板:         14px  (--radius-lg)
头像/圆形:             9999px (--radius-full)
```

---

## 三、布局重设计

### 3.1 首页 (HomePage)

**当前问题**：max-w-2xl 偏窄，卡片缺乏层次，热榜项间距太紧。

**重设计方向**：参考 Perplexity 的居中英雄区 + Kagi 的留白克制感。

```
结构:
┌─────────────────────────────────────────────────┐
│  Header (透明底, 无 border)                       │
│    "知研" + tagline         [暗色切换] [头像]      │
├─────────────────────────────────────────────────┤
│                                                 │
│           (垂直留白 64-80px)                      │
│                                                 │
│         知研 (大标题, text-3xl, 居中)              │
│     AI 问人，让观点经得起追问 (subtitle)            │
│                                                 │
│  ┌─────────────────────────────────────┐        │
│  │  📝 输入你想思考的问题...              │        │
│  │                                     │        │
│  │  [▶ 补充我的初步看法（可选）]          │        │
│  │                                     │        │
│  │  [ 开始思考 ]  (主按钮, 居中)         │        │
│  └─────────────────────────────────────┘        │
│                                                 │
│  ┌── 知乎热榜 ──────────────── 演示数据 ──┐     │
│  │                                        │     │
│  │  01  2026年AI大模型竞争格局...     🔥   │     │
│  │  02  为什么越来越多的人学习Rust?        │     │
│  │  03  如何评价OpenAI最新推理模型?        │     │
│  │  ...                                   │     │
│  └────────────────────────────────────────┘     │
│                                                 │
└─────────────────────────────────────────────────┘
```

**关键改动**：
- Header 去掉 border-bottom，改用透明背景融入页面
- 输入区改为 max-w-xl 居中卡片，增加 padding（p-8）
- 热榜卡片 max-w-xl 居中，热榜项增加 py-3 间距
- 热榜序号用 `--color-accent` 着色（替代 gray-400）
- 整体背景用 `--color-bg`（暖白），不是纯白
- 暗色模式下整体氛围参考 Linear 的深色优雅感

### 3.2 会话页 (Session)

**当前问题**：57px 固定 header + `flex h-[calc(100vh-57px)]` 僵硬；QAPanel 固定 450px。

**重设计方向**：参考 Claude Artifacts 的 split panel + NotebookLM 的可折叠侧栏。

```
结构:
┌──────────────────────────────────────────────────────────┐
│  Header (h-14, border-bottom)                            │
│    ← "知研"  |  当前问题 (truncate)  |  [存储提示] [☀/🌙] │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  ┌── ReportPanel (flex-1) ──┐  ┌── RightPanel ─────────┐ │
│  │                          │  │                        │ │
│  │  核心知识点               │  │  StanceSelector        │ │
│  │  ──────────              │  │  (观点选择/AI建议)      │ │
│  │  话题概述                 │  │                        │ │
│  │  ──────────              │  │  ───────────           │ │
│  │  核心观点 + 引证材料       │  │                        │ │
│  │  ──────────              │  │  QAPanel               │ │
│  │  知识图谱                 │  │  (多轮追问对话)         │ │
│  │  ──────────              │  │                        │ │
│  │                          │  │  [输入框 + 发送]        │ │
│  └──────────────────────────┘  └────────────────────────┘ │
│                                                          │
│  比例: 60% / 40%  (替代固定 450px)                         │
│  右面板 min-width: 380px, max-width: 520px                │
│  支持折叠按钮 (chevron icon)                               │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

**关键改动**：
- Header 高度从 57px 调为 56px (h-14)，增加内间距
- QAPanel 从固定 450px 改为 `flex-[2] min-w-[380px] max-w-[520px]`
- ReportPanel 为 `flex-[3]`，内容最大宽度 680px + 自动居中
- 两面板间增加 1px 分割线 + 可折叠 chevron 按钮
- Header 增加暗色模式切换图标
- 存储提示改用更柔和的样式（去掉 amber 文字，改为 subtle badge）

---

## 四、组件重设计

### 4.1 卡片系统 (统一规范)

```css
/* 基础卡片 */
.card {
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);       /* 10px */
  padding: 24px;
}

/* 交互卡片 (可点击) */
.card-interactive {
  /* 同上 + */
  transition: all 200ms ease;
}
.card-interactive:hover {
  border-color: var(--color-border-strong);
  background: var(--color-bg-subtle);
}

/* 强调卡片 (当前选中/AI内容) */
.card-accented {
  /* 同上 + */
  border-left: 3px solid var(--color-primary);
}
```

**原则**：去掉所有 `shadow-sm`，改用 hairline border + 背景色差异来区分层级。只在 popover/dropdown 使用 shadow。

### 4.2 按钮系统

```
主按钮:    bg-primary text-white  hover:bg-primary-hover  rounded-md(10px)
           px-4 py-2 text-sm font-medium transition-all duration-200

次要按钮:  border border-border-strong text-text-primary  hover:bg-bg-muted
           rounded-md px-4 py-2 text-sm

Ghost:     text-text-secondary hover:bg-bg-muted hover:text-text-primary
           rounded-md px-3 py-1.5 text-sm

危险:      bg-error text-white hover:opacity-90 rounded-md

禁用:      opacity-50 cursor-not-allowed (不用改背景色)
```

### 4.3 消息气泡 (QAPanel)

**当前**：用户 = 蓝底白字 ml-8 / AI = 灰底黑字 mr-8（太突兀）

**重设计**：
```
用户消息:
  bg-primary-light (亮) / bg-primary-light (暗)
  text-text-primary
  border-left: 3px solid var(--color-primary)
  rounded-r-md
  px-4 py-3
  ml-auto max-w-[85%]

AI 回复:
  bg-bg-subtle
  text-text-primary
  rounded-md
  px-4 py-3
  max-w-[85%]
  (左侧有小 AI icon)
```

去掉强对比，改用左侧色条 + 微妙背景差异来区分角色。

### 4.4 引用徽章

**当前**：`bg-blue-100 text-blue-700` 圆形

**重设计**：
```
引用标记: 
  inline-flex items-center justify-center
  w-5 h-5 rounded-full
  bg-primary-light text-primary
  text-xs font-semibold
  hover:bg-primary-subtle cursor-pointer
  transition-colors

引用卡片 (展开时):
  card 样式 + 左侧 2px 色条
  favicon + 域名 + 摘要
```

### 4.5 来源状态标签

```
实时 (Live):   bg-success-light text-success  · 绿色圆点
缓存 (Cache):  bg-warning-light text-warning  · 琥珀圆点
演示 (Demo):   bg-bg-muted text-text-tertiary · 灰色圆点

统一: px-2.5 py-1 rounded-full text-xs font-medium inline-flex items-center gap-1.5
```

### 4.6 AI 建议卡片 (StanceSelector)

**当前**：普通 border 按钮，hover 变蓝

**重设计**：
```
AI 建议卡片:
  card 样式
  border-left: 3px solid var(--color-info)   /* 紫色 = AI 生成 */
  bg-info-light (subtle 紫底)
  
  "AI 建议" badge: bg-info/10 text-info px-2 py-0.5 rounded-full text-[10px]
  
  标题: font-semibold text-sm
  描述: text-text-secondary text-xs mt-1

选中态:
  border-color: var(--color-primary)
  bg-primary-light

hover:
  border-color: var(--color-primary-subtle)
```

### 4.7 暗色模式切换

```
位置: Header 右侧
样式: Ghost button + Sun/Moon icon (lucide-react)
逻辑: document.documentElement.classList.toggle('dark')
存储: localStorage('theme') + 系统偏好 fallback
```

---

## 五、知识图谱重设计

当前列表式渲染改为更具视觉感的卡片网络：

```
┌── 知识图谱 ────────────────────────────────┐
│                                            │
│  ● 引用支持  ● AI推断  ● 用户主张           │
│                                            │
│  ┌──────────┐  ──相关──▶  ┌──────────┐     │
│  │ 为什么押注 │             │ 华为云    │     │
│  │ 大模型?   │  ──相关──▶  ┌──────────┐     │
│  └──────────┘             │ 知乎社区   │     │
│       │                   └──────────┘     │
│       └──相关──▶  ┌──────────┐             │
│                   │ DeepSeek │             │
│                   └──────────┘             │
│                                            │
│  ┌─ 节点详情 ──────────────────────────┐   │
│  │ 名称: xxx                          │   │
│  │ 关联: 3 条边                        │   │
│  │ 引用: [1] [3]                       │   │
│  └────────────────────────────────────┘   │
│                                            │
└────────────────────────────────────────────┘
```

改动：
- 节点改为圆角卡片（`--radius-sm`），可点击高亮
- 边用缩进 + 箭头符号表示（暂不做 SVG/Canvas，保持 DOM 渲染）
- 选中节点后下方展开详情面板
- 暗色模式下节点用 `--color-bg-subtle`，边框用 `--color-border`

---

## 六、交互与动效

### 6.1 过渡动效

```css
/* 全局过渡 */
* { transition-property: background-color, border-color, color; transition-duration: 150ms; }

/* 卡片 hover */
.card-interactive:hover { transform: translateY(-1px); }

/* 按钮 active */
button:active { transform: scale(0.98); }

/* 面板折叠 */
.panel-collapse { transition: width 300ms cubic-bezier(0.4, 0, 0.2, 1); }
```

### 6.2 加载状态

**替换 spinner 为骨架屏**：
```
骨架屏: bg-bg-muted animate-pulse rounded-md
  - 标题行: h-6 w-2/3
  - 正文行: h-4 w-full, h-4 w-5/6, h-4 w-4/6 (递减宽度)
  - 间距: space-y-3
```

**流式文本**：使用 2px 宽的光标闪烁（500ms），不用 typewriter 效果。

### 6.3  phased 进度提示

```
阶段提示 (搜索中):
  inline-flex items-center gap-2
  text-text-secondary text-sm
  animate-pulse

  "正在检索知乎..."  →  "正在分析观点..."  →  "正在生成报告..."
```

---

## 七、Tailwind 配置更新

```typescript
// tailwind.config.ts
import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: 'class',
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: 'var(--color-primary)',
          hover: 'var(--color-primary-hover)',
          light: 'var(--color-primary-light)',
          subtle: 'var(--color-primary-subtle)',
        },
        accent: {
          DEFAULT: 'var(--color-accent)',
          hover: 'var(--color-accent-hover)',
          light: 'var(--color-accent-light)',
        },
        surface: {
          DEFAULT: 'var(--color-bg)',
          elevated: 'var(--color-bg-elevated)',
          subtle: 'var(--color-bg-subtle)',
          muted: 'var(--color-bg-muted)',
        },
        content: {
          primary: 'var(--color-text-primary)',
          secondary: 'var(--color-text-secondary)',
          tertiary: 'var(--color-text-tertiary)',
          inverse: 'var(--color-text-on-primary)',
        },
        line: {
          DEFAULT: 'var(--color-border)',
          strong: 'var(--color-border-strong)',
        },
        semantic: {
          success: 'var(--color-success)',
          'success-light': 'var(--color-success-light)',
          warning: 'var(--color-warning)',
          'warning-light': 'var(--color-warning-light)',
          error: 'var(--color-error)',
          'error-light': 'var(--color-error-light)',
          info: 'var(--color-info)',
          'info-light': 'var(--color-info-light)',
        },
      },
      fontFamily: {
        sans: ['var(--font-geist-sans)', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        mono: ['var(--font-geist-mono)', 'JetBrains Mono', 'Fira Code', 'monospace'],
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
      },
      boxShadow: {
        sm: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
      },
    },
  },
  plugins: [],
};
export default config;
```

---

## 八、实施任务清单

### T1: 设计系统基础设施 (预估: 30min)

**范围**：
1. 在 `globals.css` 中写入完整 CSS 变量（亮 + 暗）
2. 更新 `tailwind.config.ts`（上面的配置）
3. 在 `layout.tsx` 中增加 `darkMode: 'class'` 支持
4. 创建 `src/app/components/ThemeToggle.tsx` 组件

**验收**：
- [x] `npm run typecheck` 通过
- [x] `npm run build` 通过
- [x] 手动在浏览器 DevTools 加 `class="dark"` 到 `<html>`，所有变量生效
- [x] ThemeToggle 组件能切换主题并持久化到 localStorage

**禁区**：不改任何业务组件的 Tailwind 类名

---

### T2: 首页重设计 (预估: 30min)

**范围**：`src/app/components/HomePage.tsx` 全文重写

**改动清单**：
1. Header 去 `border-b`，改透明背景
2. 增加暗色切换按钮到 Header 右侧
3. 主区域 `max-w-xl mx-auto`，顶部留白 `pt-16`（从 12 改为 16）
4. 输入卡片 padding 从 `p-6` 增到 `p-8`
5. 热榜卡片 padding 从 `p-6` 增到 `p-6`，项间距从 `py-2` 增到 `py-3`
6. 热榜序号颜色从 `text-gray-400` 改为 `text-accent`
7. 所有 `text-blue-600` / `text-blue-700` 替换为 `text-brand`
8. 所有 `bg-gray-50` 替换为 `bg-surface`
9. 所有 `bg-white` 卡片替换为 `bg-surface-elevated`
10. 所有 `border` 替换为 `border border-line`
11. 按钮使用新的 button 规范

**验收**：
- [x] 首页亮色模式截图与设计规范一致
- [x] 首页暗色模式截图与设计规范一致
- [x] 热榜 hover 态正常
- [x] 输入框 focus 态使用 `ring-brand` 替代 `ring-blue`

**禁区**：不改热榜数据获取逻辑

---

### T3: Header + Session 布局重设计 (预估: 20min)

**范围**：`src/app/page.tsx` 的 session 布局部分

**改动清单**：
1. Header 高度改为 `h-14`
2. 品牌标题颜色改 `text-brand`
3. 存储提示改为 subtle badge: `px-2.5 py-1 rounded-full bg-surface-subtle text-content-secondary text-xs`
4. 右面板从 `w-[450px]` 改为 `flex-[2] min-w-[380px] max-w-[520px]`
5. 左面板改为 `flex-[3]`
6. 增加 ThemeToggle 到 Header
7. 所有 Tailwind 颜色类替换为 design token 类

**验收**：
- [x] 宽屏(1440px+)下双面板比例约 60:40
- [x] 窄屏(1024px)下右面板不小于 380px
- [x] Header 在暗色模式下正常显示

**禁区**：不改 URL 路由逻辑

---

### T4: ReportPanel 重设计 (预估: 30min)

**范围**：`src/app/components/ReportPanel.tsx`

**改动清单**：
1. 来源状态标签改用新规范 (success/warning/muted + pill shape)
2. Section 卡片: `bg-surface-elevated border-line rounded-md p-6 mb-4`
3. Section 标题: `text-content-primary font-semibold` + 左侧 3px 色条
4. 引用标记: `bg-brand-light text-brand`
5. 引用卡片: `bg-surface-subtle border-line rounded-md p-4`
6. URL 链接: `text-brand hover:underline`
7. 正文: `text-content-primary text-sm leading-relaxed`
8. 次要文字: `text-content-secondary`
9. 去掉所有 `shadow-sm`

**验收**：
- [x] 各 section 视觉层级清晰（标题 > 正文 > 引用 > 元信息）
- [x] 暗色模式下所有文字可读（对比度 > 4.5:1）
- [x] 长报告滚动流畅

**禁区**：不改数据解析和 markdown 渲染逻辑

---

### T5: QAPanel 重设计 (预估: 25min)

**范围**：`src/app/components/QAPanel.tsx`

**改动清单**：
1. 容器: `bg-surface-elevated` (替代 `bg-white`)
2. Header: `bg-surface-subtle border-line` (替代 `bg-gray-50`)
3. 用户消息: `bg-brand-light text-content-primary border-l-3 border-brand rounded-r-md` (替代蓝底白字)
4. AI 回复: `bg-surface-subtle text-content-primary rounded-md` (替代 `bg-gray-100`)
5. 当前问题: `bg-warning-light border-warning/20 rounded-md`
6. 提示框: `bg-info-light border-info/20 rounded-md`
7. 检查点: `bg-info-light border-info/20 rounded-md`
8. 错误框: `bg-error-light border-error/20 rounded-md`
9. 输入框: `border-line rounded-md focus:ring-brand`
10. 发送按钮: 主按钮规范
11. 所有颜色类替换为 token 类

**验收**：
- [x] 用户/AI 消息可通过左侧色条和背景色区分（不再靠强烈色彩对比）
- [x] 各种状态框（问题/提示/检查点/错误）可一眼区分
- [x] 暗色模式下输入框光标可见

**禁区**：不改消息处理逻辑和 WebSocket 通信

---

### T6: StanceSelector 重设计 (预估: 15min)

**范围**：`src/app/components/StanceSelector.tsx`

**改动清单**：
1. AI 建议卡片: `bg-info-light border-info/30 border-l-3 rounded-md p-4`
2. "AI 建议" badge: `bg-info/10 text-info rounded-full px-2 py-0.5 text-[10px]`
3. 选中态: `border-brand bg-brand-light`
4. hover: `border-brand-subtle`
5. 自定义输入区: `border-line rounded-md focus:ring-brand`
6. 提交按钮: 主按钮规范

**验收**：
- [x] 三个 AI 建议视觉上一致且有 AI 标识
- [x] 选中/未选中状态明确
- [x] 自定义输入可获焦

**禁区**：不改 props 接口

---

### T7: KnowledgeGraphView 重设计 (预估: 20min)

**范围**：`src/app/components/KnowledgeGraphView.tsx`

**改动清单**：
1. 标题: `text-content-primary font-semibold`（去掉 emoji，改用图标）
2. 节点卡片: `bg-surface-elevated border-line rounded-sm p-3 hover:bg-surface-subtle cursor-pointer`
3. 选中节点: `border-brand bg-brand-light`
4. 边: 用缩进 + `text-content-tertiary` 箭头符号
5. 图例: `flex gap-4 text-xs`，圆点用新语义色
6. 详情面板: `bg-surface-subtle border-line rounded-md p-4 mt-4`

**验收**：
- [x] 节点可点击选中/取消
- [x] 边关系视觉清晰
- [x] 暗色模式下图谱可读

**禁区**：不改图谱数据结构

---

### T8: ResultCardView 重设计 (预估: 15min)

**范围**：`src/app/components/ResultCardView.tsx`

**改动清单**：
1. 标题: `text-brand`
2. 各阶段色块替换:
   - 初始表达: `bg-surface-subtle` (替代 gray-50)
   - 起始立场: `bg-brand-light` (替代 blue-50)
   - 新证据: `bg-success-light` (替代 green-50)
   - 立场修正: `bg-warning-light` (替代 yellow-50)
   - 最终立场: `bg-info-light` (替代 purple-50)
   - 未解答: `bg-surface-subtle` (替代 gray-50)
3. 来源标签: `bg-surface-muted text-content-secondary rounded-full`
4. 新会话按钮: 主按钮规范

**验收**：
- [x] 结果卡各阶段色彩区分明确
- [x] 暗色模式可读

**禁区**：不改结果数据结构

---

## 九、执行顺序与依赖

```
T1 (设计系统基础)
 ├──▶ T2 (首页)           ← 可与 T3 并行
 ├──▶ T3 (Header+布局)    ← 可与 T2 并行
 │     ├──▶ T4 (ReportPanel)
 │     ├──▶ T5 (QAPanel)
 │     ├──▶ T6 (StanceSelector)
 │     └──▶ T7 (KnowledgeGraph)
 └──▶ T8 (ResultCardView) ← T1 完成后即可开始
```

**总预估**: 约 3 小时

**建议提交粒度**: 每个 T 一个 commit，消息格式 `style(ui): T{N} {组件名} 重设计`

---

## 十、验证清单

每个 T 完成后:
1. `npm run typecheck` ✅
2. `npm run lint` ✅
3. `npm run build` ✅
4. `npm test` ✅
5. 手动检查亮色/暗色模式切换
6. 检查移动端响应（至少 375px 宽度）

全部完成后:
1. `npm run test:e2e` ✅
2. 全流程走一遍：首页 → 选题 → 报告 → 追问 → 结论
3. 暗色模式全流程走一遍
