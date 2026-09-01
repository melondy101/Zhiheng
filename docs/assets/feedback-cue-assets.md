# 刘看山状态反馈资源策略（#50 / #24-1）

本文件记录 `SessionFeedbackCue` 组件（`src/app/components/SessionFeedbackCue.tsx`）所用静态资源的来源、许可与加载策略，供审计与后续替换。

## 资源清单

| 文件（运行时） | 对应状态 | 原始文件（素材来源） | 尺寸 | 体积量级 |
| --- | --- | --- | --- | --- |
| `/feedback/official/retrieving_6s_320x320_20fps_transparent.gif` | `retrieving` 报告检索中 | `docs/kanshan-animations/电脑_6秒_320x320_20fps_透明.gif` | 320×320，GIF | ~940 KB |
| `/feedback/official/questioning_5s_320x320_20fps_transparent.gif` | `questioning` 正常提问中 | `docs/kanshan-animations/待机_5秒_320x320_20fps_透明.gif` | 320×320，GIF | ~950 KB |
| `/feedback/official/challenging_3s_320x320_20fps_transparent.gif` | `challenging` 挑战/反方追问中 | `docs/kanshan-animations/晃悠_320x320_3秒_20fps_透明.gif` | 320×320，GIF | ~938 KB |
| `/feedback/official/completed_4s_320x320_20fps_transparent.gif` | `completed` 会话完成 | `docs/kanshan-animations/打招呼_4秒_320x320_20fps_透明.gif` | 320×320，GIF | ~957 KB |

## 来源与许可

- **官方提供**：上述 4 个透明 GIF 由官方提供（刘看山动画素材），原始文件位于 `docs/kanshan-animations/`。
- **著作权处置**：原始素材由官方提供，随本仓库源码以同一许可授权使用。素材仅供本项目内部原型使用。
- **商标与 IP 边界（重要）**：「刘看山」是知乎的 IP/商标。当前素材为官方提供的动画文件，仅用于本 MVP 内部原型，不宣称获得知乎官方授权用于公开分发或商用。若项目公开发布，必须在上线前确认合法授权。
- 资源内不包含任何脚本、外链、字体引用、跟踪像素或网络请求。

## 原始来源目录

- 原始文件位置：`docs/kanshan-animations/`（主仓工作区，含 6 个 GIF 文件）。
- 运行时资源位置：`public/feedback/official/`（仅复制 4 个所需 GIF）。
- **三视图目录 `docs/kanshan-ortho-views/` 仅作参考，绝不作为运行时资源**。该目录包含静态 JPG 三视图参考图，与运行时反馈动画无关。
- **未使用「瞌睡」「运球」GIF**：`docs/kanshan-animations/` 中的 `瞌睡_5秒_320x320_20fps_透明.gif` 和 `运球_4秒_320x320_20fps_透明.gif` 未被复制到运行时资源目录，也不在 `FEEDBACK_CUE_CONTENT` 的 asset 映射中。

## 运行时资源路径

- 资源通过 Next.js `public/feedback/official/` 由同源静态路径 `/feedback/official/*.gif` 提供，**无跨域请求、无 CDN 依赖、无运行时拼接 URL**。
- 组件以 `<img loading="lazy" decoding="async" width={96} height={96}>` 加载，显式宽高避免布局偏移（CLS）；GIF 内嵌固定尺寸，缩放不失真。
- **不预加载全部六个 GIF**：仅每个状态在当前显示时按需加载对应的 GIF 文件；未显示状态的 GIF 不下载。组件通过 `loading="lazy"` 和状态切换时重置 `imageLoadError` 实现按需加载。
- 运行时目录中只有 4 个 GIF（对应四状态），无其他动画文件。

## 加载策略

- GIF 自带动画，组件不应用额外的 CSS 关键帧动画。
- 当 `prefers-reduced-motion: reduce` 时，组件不显示 GIF，改为显示装饰性文本符号（`aria-hidden`），**始终保留文字状态与说明**——图像从来不是唯一信息载体。
- 组件接受 `reducedMotion` 布尔属性，允许调用方（#48）与测试确定性覆盖媒体检测。

## 失败与降级

- 图片加载失败（`onError`）或调用方显式传入 `imageUnavailable` 时，组件不显示破碎图标，改为渲染纯装饰性文本符号（`aria-hidden`），并**始终保留文字状态与说明**——图像从来不是唯一信息载体。
- 容器使用 `role="status"` + `aria-live="polite"`，状态切换由读屏礼貌播报；区域内无任何可交互元素，不占用 Tab 焦点，不阻塞键盘操作。

## 非目标（明确不做）

- 不实现可配置表情包、剧情、成就或动画引擎。
- 不出现快速、深度、趣味、GalGame 等未实现模式的入口或文案。
- 组件不发起业务网络请求、不做轮询、不持有会话业务状态。
- 不从 `docs/` 运行时引用资源。
