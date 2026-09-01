# 刘看山状态反馈资源策略（#47 / #24-1）

本文件记录 `SessionFeedbackCue` 组件（`src/app/components/SessionFeedbackCue.tsx`）所用静态资源的来源、许可与加载策略，供审计与后续替换。

## 资源清单

| 文件 | 对应状态 | 尺寸 | 体积量级 |
| --- | --- | --- | --- |
| `public/feedback/liukanshan-retrieving.svg` | `retrieving` 报告检索中 | 96×96 viewBox，渲染 48×48 | < 2 KB |
| `public/feedback/liukanshan-questioning.svg` | `questioning` 正常提问中 | 同上 | < 2 KB |
| `public/feedback/liukanshan-challenging.svg` | `challenging` 挑战/反方追问中 | 同上 | < 2 KB |
| `public/feedback/liukanshan-completed.svg` | `completed` 会话完成 | 同上 | < 2 KB |

## 来源与许可

- 上述 4 个 SVG 均为本仓库**原创的简化示意图形**（几何白狐形象 + 状态徽章），于 2026-09-01 随 #47 首次引入，由代码内联绘制，不来自任何第三方网站、素材库或下载渠道。
- 著作权处置：随本仓库源码以同一许可授权使用，无额外第三方条款，不涉及任何 npm/字体/图片依赖。
- **商标与 IP 边界（重要）**：「刘看山」是知乎的 IP/商标。当前素材是**非官方的简化占位示意**，仅用于本 MVP 内部原型，不宣称获得知乎官方授权，也不得对外分发或商用。若项目公开发布，必须在上线前替换为取得合法授权的官方素材，或改为不使用刘看山形象的中性图形；该替换属于后续独立工作，不在 #47 范围内。
- 资源内不包含任何脚本、外链、字体引用、跟踪像素或网络请求。

## 加载策略

- 资源位于 Next.js `public/feedback/`，由同源静态路径 `/feedback/*.svg` 提供，**无跨域请求、无 CDN 依赖、无运行时拼接 URL**。
- 组件以 `<img loading="lazy" decoding="async" width={96} height={96}>` 加载，显式宽高避免布局偏移（CLS）；SVG 内联固定 viewBox，缩放不失真。
- 不使用 GIF、视频、APNG 或表情包配置系统；唯一动效是容器层 CSS `session-feedback-cue-nudge`（2.4s 轻微上下浮动）。
- 动效双重关闭：
  1. 组件仅在客户端检测到 `prefers-reduced-motion: no-preference` 时才添加 `session-feedback-cue--animated` 类，首屏（SSR）默认无动效，避免动画闪烁；
  2. `globals.css` 另设 `@media (prefers-reduced-motion: reduce)` 兜底，系统级关闭动效时动画恒为 none。
- 组件接受 `reducedMotion` 布尔属性，允许调用方（#48）与测试确定性覆盖媒体检测。

## 失败与降级

- 图片加载失败（`onError`）或调用方显式传入 `imageUnavailable` 时，组件不显示破碎图标，改为渲染纯装饰性文本符号（`aria-hidden`），并**始终保留文字状态与说明**——图像从来不是唯一信息载体。
- 容器使用 `role="status"` + `aria-live="polite"`，状态切换由读屏礼貌播报；区域内无任何可交互元素，不占用 Tab 焦点，不阻塞键盘操作。

## 非目标（明确不做）

- 不实现可配置表情包、剧情、成就或动画引擎。
- 不出现快速、深度、趣味、GalGame 等未实现模式的入口或文案。
- 组件不发起业务网络请求、不做轮询、不持有会话业务状态。
