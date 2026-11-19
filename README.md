# Unigate Chat

用 UniGate 账户登录，导入 DeepSeek 网页导出的 ZIP，再接着原来的对话聊。历史、回复和附件保存在 Unigate Chat 自己的 PostgreSQL，模型用量和扣费由 UniGate 处理。

## 本地运行

需要 Node.js 22、pnpm 和独立的 PostgreSQL 数据库。先在 UniGate 配置第一方客户端 `unigate-chat`，给它选一个按余额计费的可用分组。回调地址为 `PUBLIC_URL` 加 `/api/auth/callback`，与 UniGate 登记的地址精确一致。

```sh
cp .env.example .env
openssl rand -hex 32
pnpm install
pnpm dev
```

把随机值填到 `APP_ENCRYPTION_KEY`，再设置 `DATABASE_URL` 和与 UniGate 一致的 `UNIGATE_OAUTH_CLIENT_SECRET`。聊天服务会在启动时建表。默认地址是 `http://localhost:3080`，同一对话使用登录用户自己的 UniGate Key。

运行 `pnpm build` 然后 `pnpm start` 可预览生产构建。界面和动效的参照见 [mock README](mock/README.md)。

## 导入

侧栏打开「导入 DeepSeek 记录」，选择 ZIP 和想导入的会话。保留原消息分支与时间，从导出时选中的分支继续聊。重复导入同一会话会打开已有的记录。若在同一浏览器和同一站点运行过旧版，导入弹窗会提供本机旧对话的迁移入口。
