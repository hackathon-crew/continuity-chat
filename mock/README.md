# Unigate Chat 前端 mock

可点的前端 mock，用来定界面和交互，后续按它重做正式前端。数据全是假的，没有接任何接口。

```sh
cd mock
pnpm install
pnpm dev        # http://localhost:5288
```

侧栏底部「全部 mock 页面」可以直接跳到每个界面，包括导入的三个步骤、设置的四个分页和登录页。

## 来源

样式和会话组件从 Everplain 原样搬过来，没有另起一套。

| 目录 | 来源 | 说明 |
| --- | --- | --- |
| `src/everplain/styles/` | Everplain `frontend/src/styles/`（`origin/main` 4f891716） | 令牌、基础层、组件层、深浅色切换，未改 |
| `src/everplain/app/` | Everplain 同名路径 | 应用外壳、会话布局、输入框、发送气泡飞入、输入框停靠、流式光扫、思考闪光、工具折叠、设置弹窗 |
| `src/everplain/ui/` | Everplain `frontend/src/ui/` | `usePresence`、`useReducedMotion`，弹层进出动效靠它们 |
| `src/everplain/assets/models/` | Everplain 同名路径 | DeepSeek、ChatGPT 官方标记，附原 LICENSE |
| `src/inkpaw/` | Inkpaw `frontend/src/shared/ui/octopus/`（`origin/main` 8207079） | 3D 像素八爪鱼和静态回退图，Personal Agent 的头像 |
| `src/app/` | 新写 | 页面、mock 数据、`app.css`（只引用 `--qx-*` 令牌） |

## 和原件不一样的地方

只有这几处，正式实现时照 mock 来：

- `ConversationLayout.tsx`：输入框挪进滚动区并吸底（同 Inkpaw 的 `detective-conversation__compose`），对话从输入框底下滚过去，不在输入框上方切边。配套样式在 `app.css` 开头。
- `SettingsModal.tsx`：去掉了读取 Agent 资料的标题区（依赖 react-query 和 Everplain 的 agent-profile），改成传入 `identity` 或标题文字。
- `application-frame.css`：删掉群学品牌标记那一行，Unigate Chat 只用文字字标。
- `i18n/AppLocaleProvider.ts`、`types.ts`、`homeSubmission.ts`：只保留组件用到的最小接口。
- `Octopus.tsx`：去掉 Inkpaw 的多语言依赖，图片改成相对路径。

## 界面

- **Personal Agent（Uni）**：侧栏「新对话」下面那一行。页面顶部浮着八爪鱼和名字，往下是时间分隔、短气泡连发、文件卡、提醒卡、工具调用折叠；八爪鱼按状态切换（输入中 think、回复中 talk、完成 happy）。右上「任务」打开任务与提醒抽屉。开页 25 秒后，周报 PPT 任务完成，Uni 会主动发一条消息加文件卡。
- **普通对话**：Everplain 的会话页。输入框里可选模型（UniGate 的模型列表）、开联网搜索、交给 Uni 去做；交给 Uni 的那一轮会插一张「处理中」任务卡，点了跳到 Uni。
- **新对话**：空状态问候、居中输入框和三个起手建议，第一句发出后输入框停靠到底部、气泡飞入。
- **导入 DeepSeek**：选 ZIP、勾选对话、导入进度、完成，导入的对话在侧栏带历史图标，打开后顶部注明来源和条数。
- **设置**：Uni 的名字、性格、主动消息、记忆；工具开关和 MCP；UniGate 余额、充值跳转、用量明细；深浅色。
- **登录**：只有 UniGate 账号登录一个入口。
