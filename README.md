# 续伴 · Continuity

面向 DeepSeek 限额迁移用户的 SaaS Demo：导入原来的对话，保留当前分支并继续聊天，同时提供可编辑的 Soul、Memory、Tools、主动消息和独立 Personal Agent。

本项目基于 [DeepSeek 官方 MIT Chat Demo](https://github.com/deepseek-ai/chat-demo) 二次开发，不是 DeepSeek 官方产品。

## 已实现

- 邮箱注册、登录、退出与 HttpOnly 会话 Cookie；账户数据按用户隔离。
- 平台 API Key / 自有 API Key 两种模式；自有 Key 校验后使用 AES-256-GCM 加密保存。
- DeepSeek v3 历史 ZIP 导入、原会话续聊、消息分支、流式回复、附件与语音等原有能力。
- Soul、可编辑/启停 Memory、主动消息免打扰时段。
- 当前时间、计算器、公开网页读取工具，以及自定义 Webhook 工具。
- 一次性、间隔、每日定时任务；可投递到普通会话或独立 Personal Agent。
- Personal Agent 拥有独立使命、历史、工具调用轨迹和任务记录；可在普通会话中直接调用，并把带身份标识的结果与工具卡插回当前会话。
- 套餐、演示订阅、取消/恢复续费、账单记录；支持配置 Stripe Checkout、Portal 和签名 Webhook。
- 桌面与移动端布局、深浅色主题、历史导出备份。

## 本地启动

要求 Node.js 22.12+ 和 pnpm。

```sh
git clone git@github.com:hackathon-crew/continuity-chat.git
cd continuity-chat
pnpm install
cp .env.example .env
pnpm dev
```

打开 http://localhost:8090 。可以注册新账户，也可以点击“直接进入产品 Demo”。

- 不配置平台 Key 时，注册后进入“账户与计费”，选择“使用我自己的 API Key”。
- 配置 `DEEPSEEK_API_KEY` 后，平台模式即可使用。
- 聊天不设置应用层消息条数限制；上游模型的余额、可用性与服务条款仍然适用。

## 使用 Unigate / OpenAI 兼容上游

将以下配置放入本地 `.env`，密钥单独填写，不要提交：

```sh
DEEPSEEK_API_BASE=https://unigate.top/v1
DEEPSEEK_API_KEY=你的上游密钥
MODEL_API_FORMAT=openai
MODEL_ID=gpt-5.6-sol
```

服务端会将现有 Anthropic 聊天协议转换为 OpenAI Chat Completions 与 SSE。聊天输入区和“账户与计费”页面均可手动切换模型，也可输入自定义模型 ID；普通聊天、主动消息、定时任务和 Personal Agent 共用当前选择。OpenAI 兼容文本模式下会停用上游未提供的原生附件、语音和搜索能力。

## 生产形态启动

```sh
pnpm build
pnpm start
```

默认打开 http://localhost:3080 。`pnpm start` 会读取项目根目录的 `.env`，同一个 Node 服务提供静态页面、鉴权、模型代理和后台任务。

公开部署前至少应：

1. 设置 `DEMO_MODE=false`，关闭共享演示账户和演示支付。
2. 设置随机 `APP_SECRET`；HTTPS 环境设置 `COOKIE_SECURE=true`。
3. 将 `PUBLIC_URL` 设为公开来源，并配置真实支付参数。
4. 将 JSON 文件存储替换为正式数据库，为托管 Key 增加防滥用、成本预算与公平使用策略。

## Stripe 配置

在 `.env` 中设置：

```sh
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PLUS_PRICE_ID=price_...
STRIPE_PRO_PRICE_ID=price_...
```

Webhook 地址为 `POST /api/billing/webhook`，订阅事件包括 `checkout.session.completed`、`customer.subscription.updated` 和 `customer.subscription.deleted`。未配置 Stripe 且 `DEMO_MODE=true` 时，套餐走明确标记的演示支付，不发生真实扣款。

## 数据与架构

```text
src/                    React / TypeScript 前端与 DeepSeek 聊天实现
  components/platform/  登录、伙伴工作区、Agent、任务、账户与计费
  services/chat/        会话分支、IndexedDB、官方历史格式导入导出
server/
  index.js              同源 HTTP 服务与鉴权路由
  model.js              DeepSeek 代理、模型调用与工具循环
  workspace.js          Soul/Memory、Agent、定时任务与 Outbox
  billing.js            套餐、演示订阅与 Stripe
  store.js              Demo 用原子 JSON 存储
scripts/dev.mjs         同时启动前端与 API 服务
```

普通聊天记录和附件原件保存在 IndexedDB，按登录用户使用独立数据库；Soul、Memory、Agent、任务与计费数据保存在服务端。导入只在本机解析 ZIP，不会把整份归档额外上传到平台。

Personal Agent 借鉴 [DeepSeek dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype) 的触发、授权、执行和 Outbox 思路，但本 Demo 未直接嵌入 DeepSeek Harness。

## 开发校验

```sh
pnpm lint
pnpm type
pnpm build
```

历史归档的字段和保留范围见[原历史格式说明](src/services/chat/history/README.md)。

## License

[MIT](LICENSE)。保留 DeepSeek 原项目的许可证与归属；第三方依赖遵循各自许可证。
