# 仓库约定

- `src/app/` 负责应用外壳、会话状态和跨模块组装。`src/modules/` 只写各自的业务，不互相导入；共用代码放 `src/shared/`。依赖只往下走：app → modules → shared → vendor。
- `src/vendor/everplain/` 和 `src/vendor/inkpaw/` 是原件区，不改内容，不批量格式化。`contract/` 只放前后端共用类型。
- 新接口登记在 `server/routes.ts`。`handlers/` 管 HTTP 进出，业务流程进 `services/` 或 `agent/`；简单增删改查可由 handler 直接调 `db/`。
- SQL 只在 `server/db/`。查询函数只使用收到的 `db`，不拿连接、不开始事务；原事务的语句、顺序和连接必须一起保留。
- 本机联调用 `pnpm dev:fake`，四项检查是 `pnpm lint`、`pnpm type`、`pnpm test`、`pnpm build`。

消息、任务和各目录的入口见 [架构地图](docs/architecture.md)。
