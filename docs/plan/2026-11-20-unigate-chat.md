# Unigate Chat 实施计划

产品是一个 Personal Agent 加多个独立对话，主要接住被 DeepSeek 网页限额挤出来的用户：导入原来的对话直接接着聊，账户和计费用 UniGate 的，登录即可用，不用填 API Key。界面以 `mock/` 为准，照它实现，不另做视觉。

## 已经核实的外部事实

- **UniGate**（`xiaocheny214/UniGate`，本地 `~/Documents/ChatGPT/unigate/console-ui`）基于 sub2api，Go + Gin + PostgreSQL。已有用户接口：`GET /api/v1/auth/me`（返回 `balance`、`frozen_balance`）、`GET/POST /api/v1/keys`、`GET /api/v1/usage`、`GET /api/v1/usage/stats`、`GET /api/v1/subscriptions`。它现在只作为 OAuth 客户端接入 LinuxDo、GitHub、Google 登录，自己还不能给第三方应用发授权。仓库可以改。
- **DeepSeek Harness**（`deepseek-ai/deepseek-harness`，MIT，`npx @deepseek-ai/dsh`，开发者预览，会有破坏性变更）：一切皆插件的 agent 运行时。用得上的包有 `schedule`（一次性、每日、每周、cron 提醒，Host 重启后保留，到期作为普通消息进入原对话，正好是主动消息）、`skill/skill-office`（Word、PowerPoint、Excel 工作流）、`web`（`web_search`、`web_fetch`，提供方可选 DeepSeek、Exa、Perplexity）、`mcp`、`jobs`、`subagent`，以及 `sdk`（另一个进程通过 stdio 上的 JSON-RPC 驱动运行时，有 TS 客户端和服务端）。本地参考副本在 `~/Developer/dsh-upstream-reference`。
- **dsh-superagent-prototype**（`deepseek-ai/dsh-superagent-prototype`，MIT，官方注明是研究原型、不适合直接上生产）：跑在 dsh 上的主动式编程 agent，只服务一个 GitHub 仓库。值得借的是它的领域模型：Source 产生 Trigger，Trigger 归入 Thread，Eval 判断要不要接，接了就生成 Ticket，Ticket 分配给 Executor 会话执行，结果从 Channel 写回原对话；面板只展示需要人处理的事。它的执行器按操作系统用户直接跑 shell 命令，依赖 gh、tmux，这部分不能搬进多用户产品。
- **DeepSeek 历史导入**：现仓库 `src/services/chat/history/` 是 chat-demo 自带的 ZIP 导入导出实现，原样复用。上一轮在 Chrome 里跑通过「导入、恢复原会话、接着发一句」，但没有记录用的是不是 DeepSeek 网页真实导出的文件，落地时要用真实文件再验一次。

## 关键决定

1. **账户和计费全部交给 UniGate。** UniGate 增加 OAuth2 授权码加 PKCE，只登记 Unigate Chat 一个第一方客户端。用户首次登录后，后端用他的身份在 UniGate 建一把名为 Unigate Chat 的 key，加密存在服务端；所有模型请求走 `unigate.top/v1` 并带上这把 key，计费和扣余额由 UniGate 现有逻辑完成。余额、用量、充值页直接读 UniGate 接口，充值跳转 UniGate。现仓库里的套餐、Stripe、演示支付、本地账号全部删除。
2. **前端照 mock 重做。** 换成 React 19 + Vite，`mock/src/everplain`、`mock/src/inkpaw` 的组件和样式整体搬进正式前端，页面结构照 `mock/src/app`。chat-demo 的旧界面删掉，只保留历史导入模块。mock 和 Everplain 原件不一样的几处写在 `mock/README.md`，照 mock 来。
3. **Personal Agent 跑在 DeepSeek Harness 上，领域模型借 superagent。** 每个用户一个长期 agent，Source 有三种：用户在 agent 页发的消息、普通对话里「交给团子」、schedule 到期。Ticket 就是界面上的「任务」，Channel 就是 agent 页的消息流。工具只开 `web`、`skill-office`、`schedule`、`mcp`，shell、文件系统、子进程类插件一律不加载。第一版每个活跃用户起一个 dsh 会话、闲置回收，跑通后量一下单个会话的内存再决定要不要做池化。
4. **工具按现有规范接。** 内置能力用 dsh 插件和 skill，用户自己的工具走 MCP，不自定义工具协议。
5. **存储用 PostgreSQL。** 对话、agent 消息、记忆、任务存自己的库，和 UniGate 的库分开。现在的 JSON 文件和 IndexedDB 只在迁移时读一次。

## 分 PR 做

每个 PR 先开 issue，按仓库惯例走分支和 PR，合并前在浏览器里把对应流程点一遍。

1. **UniGate：第一方 OAuth。** 授权页、授权码、换 token、PKCE 校验，以及给该客户端建 key 的接口。在 UniGate 仓库提 PR。
2. **后端：UniGate 登录和计费。** 登录回调、per-user key、`/v1` 代理、余额和用量接口、PostgreSQL 表结构；删掉套餐、Stripe 和本地账号。
3. **前端：照 mock 落地。** 外壳、会话页、Agent 页、导入、设置、登录接上第 2 步的接口，DeepSeek 导入复用现有模块；模型列表来自 UniGate `/v1/models`。
4. **Personal Agent。** dsh 会话管理、三种 Source、任务与提醒抽屉、主动消息、PPT 和联网搜索、记忆与性格编辑。

## 完成标准

新用户用 UniGate 账号登录，不填任何 key，导入一份真实的 DeepSeek ZIP，打开其中一段接着聊，用量出现在 UniGate 控制台并扣了余额；在普通对话里把一件事交给团子，团子做完后主动在自己那里发消息并附上 PPT。

## 要拍板的

- 字标写法：现在是「Unigate」加反色「chat」，和 UniGate 控制台的大小写不同，要不要统一。
- UniGate 仓库归 xiaocheny214，第 1 步的 OAuth 改动要不要先跟他打招呼。
- dsh 还在开发者预览，接受跟着它的破坏性变更走，还是锁定一个版本。
