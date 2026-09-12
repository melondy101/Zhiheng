# CloudBase 云托管（CloudRun）部署

本项目同时支持 Vercel 和 CloudBase 云托管。CloudBase 使用仓库根目录的多阶段 `Dockerfile`，不会替换或修改 `vercel.json`。镜像运行 Next.js standalone 服务器，监听 `0.0.0.0:3000`。

## 环境变量

在 CloudBase 控制台的云托管服务详情中打开**环境变量**，逐项添加下列变量名及对应的私密值；或在本机已登录 CloudBase CLI 后，使用 CLI 的环境变量参数/控制台配置完成注入。不要把值写入 Dockerfile、Git、镜像构建参数或文档。变量缺失时，应用保持既有的 fixture、localStorage 或功能不可用降级语义。

| 变量名 | 用途 |
| --- | --- |
| `DATABASE_URL` | Neon 持久化连接；缺失时使用 localStorage 降级。 |
| `SINK_BASE_URL` | Sink 短链接服务地址。 |
| `SINK_API_KEY` | Sink 短链接服务鉴权。 |
| `SHARE_BASE_URL` | 公开分享链接的应用外部地址。 |
| `LLM_API_KEY` | 通用 LLM 服务鉴权。 |
| `LLM_BASE_URL` | 通用 LLM 服务端点。 |
| `LLM_MODEL` | 通用 LLM 模型标识。 |
| `LLM_SYNTHESIS_TIMEOUT_MS` | 报告综合请求超时设置。 |
| `LLM_TIMEOUT_MS` | 常规 LLM 请求超时设置。 |
| `GRAPH_LLM_API_KEY` | 可选知识图谱 LLM 鉴权；缺失时继承通用 LLM 配置。 |
| `GRAPH_LLM_BASE_URL` | 可选知识图谱 LLM 端点；缺失时继承通用 LLM 配置。 |
| `GRAPH_LLM_MODEL` | 可选知识图谱 LLM 模型；缺失时继承通用 LLM 配置。 |
| `GRAPH_LLM_TIMEOUT_MS` | 可选知识图谱 LLM 超时设置。 |
| `SMTP_USER` | SMTP 发信账号。 |
| `SMTP_PASS` | SMTP 发信凭据。 |
| `SMTP_HOST` | SMTP 主机。 |
| `SMTP_PORT` | SMTP 端口。 |
| `SMTP_SECURE` | SMTP TLS 安全模式开关。 |
| `SMTP_FROM` | SMTP 发件人地址。 |
| `RESEND_API_KEY` | Resend 发信鉴权。 |
| `RESEND_FROM_EMAIL` | Resend 发件人地址。 |
| `ZHIHU_OAUTH_APP_ID` | 知乎 OAuth 应用标识。 |
| `ZHIHU_OAUTH_APP_KEY` | 知乎 OAuth 应用密钥。 |
| `ZHIHU_OAUTH_REDIRECT_URI` | 知乎 OAuth HTTPS 回调地址；须与开放平台登记值完全一致。 |
| `ZHIHU_ACCESS_SECRET` | 知乎授权用户执行创作、关注或收藏时所需的访问密钥。 |
| `ZHIHU_API_BASE_URL` | 知乎 API 服务端点覆盖项。 |

CloudBase 会提供容器端口映射；本镜像已固定监听 `PORT=3000`。请不要通过环境变量覆盖 `PORT` 或 `HOSTNAME`，部署命令应与容器端口一致。

## 首次部署

1. 在 CloudBase 创建或选择环境，并在云托管中创建服务。
2. 选择从代码仓库或本地源码构建，构建文件指定为仓库根目录的 `Dockerfile`。
3. 配置上一节所需的环境变量。生产环境至少按实际启用的 Provider 配置；未启用的 Provider 可以留空以沿用应用降级行为。
4. 将服务端口设置为 `3000`。使用 CLI 时，以 `tcb cloudrun deploy --port 3000` 为准，并按团队的 CloudBase CLI 认证与服务名参数补全命令。
5. 为 CloudBase 分配的公网 HTTPS 域名或自定义域名更新 `SHARE_BASE_URL`；若启用知乎 OAuth，同步在知乎开放平台登记该域名下与 `ZHIHU_OAUTH_REDIRECT_URI` 完全一致的回调地址。
6. 部署后访问 `/api/health`，再按 README 的演示路径验证应用和已启用的外部 Provider。真实 Provider 验收应在受控环境单独记录。

## 本地容器验证

在不传入任何真实凭据的前提下，可构建镜像并启动容器，再访问 `http://localhost:3000/api/health`。该检查只验证容器和既有降级路径，不能证明 Neon、知乎、LLM 或邮件 Provider 的生产连通性。

## Vercel 兼容性

`vercel.json` 保持原样。`output: 'standalone'` 仅额外生成 `.next/standalone` 供 Docker 运行，`npm run build` 仍是标准的 `next build`，Vercel 继续按其原有 Next.js 框架识别、构建命令与 `.next` 输出部署。
