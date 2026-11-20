# 架构地图

| 目录 | 管什么 |
| --- | --- |
| `contract/` | `User`、`Billing`、`Turn`、`ChatEvent` 等前后端共用类型。 |
| `src/app/` | `App` 组装页面、侧栏和弹窗；`SessionContext` 管登录态、模型和余额；`ChatWorkspace` 将 Uni 的任务状态投到对话页。 |
| `src/modules/chat/` | 普通对话。页面入口是 `ChatPage.tsx`，一轮消息在 `TurnView.tsx`，重命名等菜单在 `ChatActions.tsx`，读写会话和接收流在 `useConversations.ts`。 |
| `src/modules/agent/` | Uni 对话、消息列表、任务抽屉和设置。`useAgent.ts` 发消息并轮询任务状态。 |
| `src/modules/import/` | `ImportDialog.tsx` 选文件和会话，`historyImport.ts` 转成应用数据并保存，`deepseek/` 读 ZIP 和旧版浏览器数据。 |
| `src/shared/`、`src/vendor/` | 前者是 HTTP 客户端和共用输入框、模型选择器等组件；后者是未经修改的 Everplain 和 Inkpaw 原件。 |
| `server/`、`server/handlers/` | `index.ts` 启动服务和静态资源，`routes.ts` 登记接口，`http.ts` 管同源、鉴权和解析；按资源找对应 handler。 |
| `server/services/`、`server/agent/` | 前者管登录会话、UniGate、流式聊天和导入；后者管 pg-boss、模型循环、工具和提醒。 |
| `server/db/`、`scripts/` | 前者放表定义、连接、事务原语和查询；后者放开发启动、假 UniGate 和旧数据迁移。 |

## 普通对话怎么走

1. `ChatPage` 用共享的 `Composer` 和 `useComposer` 接收文本、附件和发送动作。`ChatWorkspace` 接上当前会话，`useConversations.send` 先保存新对话，再 POST `/api/conversations/:id/turns`。
2. `routes.ts` 匹配方法和路径。`handlers/conversations.ts` 读请求并打开 NDJSON；`services/chat.ts` 的 `beginTurn` 在同一个事务中锁对话、读取历史、写附件和消息，再更新会话。之后 `agent/model.ts` 用当前用户的 UniGate Key 请求模型。
3. 模型文本和工具进度以 `delta`、`step` 事件回浏览器，完成时同一事务写工具产物和最终消息，再发 `done`。`src/shared/api.ts` 解出这些事件，`useConversations` 更新对应轮次，`TurnView` 显示。

## Uni 任务怎么走

1. Uni 页发消息走 `/api/agent/messages`；普通对话的「交给 Uni」走原发送接口。两条路径分别进 `agent/queue.ts` 的 `send` 和 `handoff`。
2. 队列在调用方事务里写任务、消息和票据，用同一条事务连接提交 pg-boss 的任务。唤醒后 `runTicket` 读票据、历史和设定，交给模型循环；提醒在同一处处理静默时段和下次唤醒。
3. 这次任务成功或最终失败时，队列在事务里写回消息、任务状态和票据；与普通对话关联的状态也一并更新。`useAgent` 轮询 `/api/agent`，Uni 页显示结果，`ChatWorkspace` 更新普通对话里的任务卡。队列保留在一个文件里，方便顺着同一张票据查它的多个事务。

## 从哪下手

- 给聊天页加按钮：页面工具去 `src/modules/chat/ChatPage.tsx`，会话菜单去 `ChatActions.tsx`，单条回复的按钮去 `TurnView.tsx`。
- 加接口：在 `server/routes.ts` 登记方法和路径，在 `server/handlers/` 做请求与响应。普通查改直接调 `db/`；有业务流程再调 `services/` 或 `agent/`。新增或改变前后端共享载荷时，从 `contract/types.ts` 核对两端。
- 查事务：先找调用处的 `store.transaction`，再沿它传入的 `db` 查每条 SQL；不要换成连接池。
