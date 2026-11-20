# Unigate Chat 架构整理

这次整理只解决一件事：让第一次打开仓库的人知道东西在哪、改一处功能该进哪个目录、改了不会悄悄弄坏另一头。全程只搬家、不改行为。接口路径和载荷、状态码、表结构、环境变量、界面像素和文案都保持原样。整件事一个分支（`refactor/architecture`）、一个 PR，按下面的顺序分几次提交，每次提交都要通过当时的全部检查。

## 现在最大的问题

前端没有分层，所有状态压在 `src/app/App.tsx` 一个文件上。它有 532 行、17 个 state，登录态、余额、模型列表、侧栏、抽屉、搜索、主题、当前视图都归它管，再靠 props 一层层往下传，`ChatPage` 一个组件就要接 13 个 props。`ChatPage.tsx`（600 行）和 `AgentPage.tsx`（535 行）各自塞了四五个子组件，两边的输入框状态（文本、附件、工具菜单、文件按钮）也各写了一份。`ChatPage` 还从 `AgentPage` 里导入 `FileCard`。想改一块界面，得先把这三个文件全读懂。

其余几处乱是在这个基础上叠出来的：

- `mock/` 是定界面时用的一次性原型，正式前端做完后没删。它有 62 个文件，其中 44 个跟 `src/` 逐字节相同，仓库里等于并排放着两套前端。
- 导出 ZIP 那一串（`exportArchive.ts`、`toArchive.ts`、`zipWriter.ts`，共 445 行）没有任何地方用。
- i18n 有两套：Everplain 组件用 `AppLocaleProvider`，chat-demo 留下的导入代码用 `src/i18n`。
- 服务端 18 个 `.js` 文件不在类型检查范围内，前后端共用的数据结构只在前端有类型，两边改字段时没有任何东西帮忙对账。
- SQL 散在 8 个文件里，路由处理函数、agent 工具，连 UniGate 客户端都在直接写 SQL。`server/index.js` 和 `server/agent/routes.js` 是一长串 `if` 加正则，要知道一共有哪些接口只能从头读到尾。
- 没有 `AGENTS.md`，也没有架构说明，CI 也不跑测试。"everplain 和 inkpaw 不能改"这条规矩，只能从 `package.json` 的 lint 命令里看出来。

## 整理后的样子

```
contract/
  types.ts           前后端共用的接口类型：User、Billing、Model、Conversation、Turn、AgentState、ChatEvent 等
src/
  main.tsx
  app/               外壳和组装：App（≤200 行）、AppSidebar、SessionContext、LoginPage、
                     SettingsDialog（拼各模块的四个分页）、主题与窄屏 hook、app.css
  modules/
    chat/            ChatPage、TurnView、ChatActions、useConversations
    agent/           AgentPage、AgentItems、JobsPanel、AgentSettings、useAgent（原 useUni）
    import/          ImportDialog、historyImport、deepseek/（原 src/services/chat 去掉死代码）
  shared/
    api.ts           请求封装、NDJSON 流式事件读取、ApiError
    ui/              共用输入框、ModelPicker、ModelMark、Markdown、Popover、BrandName、OctoMark、FileCard
  vendor/
    everplain/       从 Everplain 原样搬来，内容不改
    inkpaw/          从 Inkpaw 原样搬来，内容不改
server/
  index.ts           起服务、静态资源、信号处理
  routes.ts          一张路由表，全部接口在这里一眼看完
  http.ts            请求解析、响应、同源校验、路由匹配
  config.ts  security.ts
  handlers/          按资源分：auth、conversations、billing、agent、proxy，只管 HTTP 进出
  services/          UniGate 客户端、流式对话、导入
  agent/             任务队列（pg-boss）、模型循环、工具、PPT、网页读取、时间
  db/                schema.sql、连接与事务、各组表的读写函数；SQL 只准出现在这里
  test/
scripts/             dev.mjs、import-legacy.ts、fake-unigate.ts
```

依赖只能单向流动。前端是 app 依赖 modules，modules 依赖 shared，shared 依赖 vendor，不能反过来；模块之间不互相导入，跨模块的事（比如聊天页显示 Uni 任务的状态、设置弹窗里的 Uni 分页）放到 `app/` 里拼。服务端是 handlers 调 services 和 agent，它们再调 db。`contract/` 只放类型，谁都可以引用。

几个具体取舍：

- **原件区保留，不拆散。** `everplain/`、`inkpaw/` 整体挪进 `src/vendor/`，里面一行不改，`package.json` 里的 lint 忽略路径跟着改过去。这样以后 Everplain 改了样式，还能对着原件同步，lint 也不会把整块搬来的代码重新格式化一遍。两个目录只在自己内部互相引用，整体挪位置不会断。
- **i18n 收成一套。** 删掉 `src/i18n`，导入模块的报错直接写中文。Everplain 那个 `useAppLocale` 是原件接口，留在 vendor 里不动。
- **命名跟服务端对齐。** 前端模块叫 `agent`，跟 `/api/agent`、`agent_*` 表一致；Uni 只是产品给它起的名字，留在界面文案里。
- **App.tsx 只做组装。** 登录态、余额、模型列表收进 `SessionContext`，主题和窄屏判断拆成 hook，侧栏拆成 `AppSidebar`。登录页和设置弹窗留在 `app/`，它们属于外壳，不另开模块。业务文件超过 300 行要有理由。
- **输入框共用一份。** 文本、附件、文件按钮、工具菜单开合这些状态抽成 `shared/ui` 里的一个 hook 加一个外壳组件，两页只传自己的工具菜单项。`FileCard` 下沉到 `shared/ui`。
- **SQL 只进 db/，handlers 可以直接调 db/。** 对话列表、重命名这类纯增删改查，handler 直接调 `db/` 里的函数就行，不为了分层在 `services/` 里加原样转发的函数。`services/` 只放真有逻辑的东西。
- **事务边界原样不动。** 服务端现在有 10 处 `store.transaction(async (db) => …)`，在 `chat`、`archive`、`unigate`、`agent/queue`、`store` 和 `import-legacy` 里，其中两处带 `pg_advisory_xact_lock`。SQL 挪进 `db/` 以后，事务仍由调用方开启，`db/` 里的每个函数都只用调用方传进来的 `db`，绝不自己从连接池拿连接。一个事务原来包住哪几条语句，挪完还得包住同样的几条。这条类型检查和点页面都查不出来，review 时要逐处对照。
- **服务端转 TypeScript，不加编译步骤。** Node 22.22.2 能直接跑 `.ts`（本机试过），CI 也锁的这个版本。服务端单独一份 `tsconfig.server.json`（不带 DOM），打开 `erasableSyntaxOnly`、`verbatimModuleSyntax`、`allowImportingTsExtensions`；`pnpm type` 同时检查两份。补 `@types/pg`。
- **路由不引入框架。** 现在的流式输出和 `/v1` 代理都直接写 `res`，换 Hono 之类的框架要改掉每个处理函数，风险比收益大。这次只写一张路由表加一个几十行的匹配函数，路径参数里的 UUID 校验统一在匹配时做。
- **规矩用工具卡住。** 前端依赖方向用 `.oxlintrc.json` 的 `no-restricted-imports` 卡，写代码时编辑器当场就会报；oxlint 做不到的部分，再在 `pnpm test` 里补一个扫 import 的测试。SQL 边界在 `server/test/` 里加一个测试：`server/db/` 以外出现 SQL 语句就失败。

## 分几步提交

纯改名和改内容分开提交，这样 git 能认出改名，文件历史不断，review 的人也能确认"这一步只挪了位置"。每一步做完都跑 `pnpm lint`、`pnpm type`、`pnpm test`、`pnpm build`，全过才提交。

1. **清场。** 删 `mock/`、`README.zh-CN.md`、导出那一串死代码以及 `history/README.md` 里对应的说明；删 `src/i18n`，导入报错改成直接写中文。
2. **前端搬家，只改路径。** `everplain/`、`inkpaw/` 挪进 `src/vendor/`，`src/services/chat` 挪进 `modules/import/deepseek/`，`src/app` 里的文件按上面的结构分进 `app/`、`modules/`、`shared/`，`data.ts` 里的跨端类型挪进 `contract/types.ts`，同步改 lint 忽略路径。除了 import 路径，不改任何一行代码。
3. **前端拆大文件。** 拆 `App.tsx`、`ChatPage.tsx`、`AgentPage.tsx`，抽出 `SessionContext`、`AppSidebar`、共用输入框，`FileCard` 下沉；加上依赖方向的 lint 规则。
4. **服务端改名，只改名。** `server/**/*.js` 和 `scripts/import-legacy.mjs` 改成 `.ts`，import 写法改成带 `.ts` 后缀，同步改 `package.json` 的 `start`、`test`、`import:legacy`，还有 `scripts/dev.mjs` 里写死的 `server/index.js`。这一步还不开服务端类型检查，只要 Node 能跑、测试能过。
5. **服务端补类型。** 加 `tsconfig.server.json` 和 `@types/pg`，接上 `contract/types.ts`，`pnpm type` 覆盖服务端和脚本。
6. **服务端分层。** 写 `routes.ts` 路由表，HTTP 处理挪进 `handlers/`，SQL 收进 `db/`（守住上面的事务规矩），加 SQL 边界测试。
7. **本地假 UniGate。** 写 `scripts/fake-unigate.ts`，照 `services/unigate.ts` 和 `handlers/auth.ts` 实际调用的接口，返回固定的 OAuth 换 token、用户信息、建 key、余额用量、模型列表和一段流式回复。加 `pnpm dev:fake`，用本机 PostgreSQL 起整套服务。这是这次唯一新增的功能：验收不花钱，王超凡本地开发也不用 UniGate 账号。
8. **文档和 CI。** 写 `AGENTS.md`，写目录规矩、依赖方向、vendor 不改、SQL 只进 `db/`、事务规矩，不超过一屏。写 `docs/architecture.md` 作一页地图：一条消息从输入框到数据库再流回界面怎么走，一个 Uni 任务从创建、pg-boss 唤醒到写回消息怎么走，每个目录管什么。README 去掉 mock 的引用，加上 `pnpm dev:fake` 的用法，链到这页地图。CI 的 `verify.yml` 补上 `pnpm test`。

## 不做的事

不改接口路径、请求和返回的字段、状态码；不改 `schema.sql`；不改环境变量；不改界面和文案；不加网址路由，单开一个 PR；不引入 Web 框架和状态管理库；不改 vendor 里的内容；除 `@types/pg` 外不加不升依赖。

## 部署时要注意

启动入口从 `server/index.js` 变成 `server/index.ts`，服务器的 Node 不能低于 22.18，低于这个版本跑不了 `.ts`。部署脚本和进程管理里写死入口的地方都要跟着改。

## 执行时会动到本机的地方

`pnpm dev:fake` 会在本机 PostgreSQL 里建一个开发用的库，占 3080、3081 和假 UniGate 的端口。全程不调用真实 UniGate 和 Tavily，不花钱。检查和构建只跑仓库自己的四条命令，不跑别的重活。

## 完成标准

四项检查和 CI 全绿。用 `pnpm dev:fake` 起服务，在浏览器里点一遍：未登录看到登录页，登录后进 Uni 页；新建对话发一句，看到流式回复；切模型；重命名、置顶、删除对话；导入一份 DeepSeek ZIP，打开其中一段接着聊；在聊天里交给 Uni，聊天页的任务状态跟着变；在 Uni 页发消息，打开任务与提醒抽屉；设置弹窗四个分页都能切；深浅色切换；窄屏下侧栏抽屉能开能关。每一处表现都要跟整理前的 main 一样。

最后一条才是这次整理真正的验收：一个新人只读 `AGENTS.md` 和 `docs/architecture.md`，就能说出"给聊天页加一个按钮该改哪个文件"和"加一个接口要动哪几层"。
