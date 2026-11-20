# 历史导入

chat-demo 使用 `export_format_version: 3` 的历史会话 ZIP，导出文件名为 `deepseek_data-日期.zip`。字段定义见 [format.ts](./format.ts)，实际校验规则见 [schema.ts](./schema.ts)。

## 归档结构

导入支持以下条目顺序：

```text
manifest.json                                      格式版本，必须是首个条目
chat_sessions/{session_id}.json                    全部会话 JSON（含消息树）
chat_session_index.json                            会话索引
chat_sessions/{session_id}_files/{file_id}_{file_name}  全部图片原件
```

导入也支持“会话 JSON → 该会话图片”交错排列、索引在末尾的顺序。`user.json` 可位于 manifest 与会话之间，导入时跳过。图片按 `FILE.export_path` 匹配。

可选字段允许缺省；时间接受以 `Z` 结尾、带可选小数秒的 UTC 时间。校验后只保留已定义字段，未知类型或无法解析的内容片段直接丢弃；容器和元数据字段不合法仍会导致导入失败。

## 导入与替换

1. 用户确认覆盖后，先读取首个条目检查格式与版本；不符合时直接失败，不中止正在生成的回答。
2. 检查通过后停止生成，导入期间禁止修改会话。逐条解析会话并写入 IndexedDB 暂存区，按 `FILE.is_image` 保留图片身份，再读取图片原件并回填 MIME。图片按文件 ID 去重；字节识别仅补充具体 MIME，无法识别时仍按图片处理。
3. 校验索引与会话一一对应、消息树和 ZIP 完整性后，在同一个事务中用暂存内容替换全部本地会话与附件。校验或提交失败时保留原有记录；中断遗留的暂存在下次导入前清理。

消息树以 `id` / `parent_id` 还原，父消息 ID 必须小于子消息 ID、角色交替、根为提问。`current_message_id` 决定当前分支；其他节点默认选中 ID 最大的子消息。缺失原件的附件保留文件名和大小，不进入后续请求；有原件的导入图片在首次用于请求时上传。

导入时一次性转换为正式消息，正文、思考用时、模板标识、工具结果与阅读链接签名都保存在本地消息字段中，不保留原始消息副本。展示和请求统一读取这份消息。只支持当前数据格式，不提供旧数据库迁移。

## 展示与上下文

- 展示提问、正文、思考、附件，以及搜索、打开网页、页内查找步骤。搜索状态和查找词存在时用于展示；`READ_LINK` 有合法 URL 时展示链接与标题，仅含签名的记录用于请求上下文。展示链接仅接受 HTTP / HTTPS。
- `TIP`、`CONTENT_RISK`、`PARTIAL_FILE_READ`、`TOOL_IMAGE_SEARCH` 等没有对应展示的内容直接丢弃，不显示占位或提示；工具分组等未映射到本地消息的元数据也不保留。完整转换规则见 [toLocal.ts](./toLocal.ts)。
- `FINISHED` 转成已完成，`INCOMPLETE` / `WIP` 转成已停止，`FAILED` / `CONTEXT_LENGTH_EXCEEDED` / `TIMEOUT` 转成错误，`CONTENT_FILTER` 转成拒绝。思考与搜索开关保存在回复中。
- 错误回复的模板文案显示为红字和感叹号提示，正文和思考独立展示。拒绝及其他非错误模板使用正文样式，拒绝回复丢弃普通正文和思考，可复制模板，不能重新生成。模板统一单独展示，不混入工具步骤前的说明文字。
- 错误与模板回复保留在消息树中，其所在轮次不进入后续请求上下文。
- 已完成或已停止、有正文、非拒绝且不含服务端模板的回复可以进入上下文。
- 续写统一由本地消息的 `prefix` 与回复状态、内容决定：新生成的回复设置 `prefix: true`，导入的回复统一设置 `prefix: false`，不能继续生成。模板回复与含工具块的回复也不能续写。`prefix` 不发送到 API；只有允许续写的回复才会作为末尾 assistant 发送。
- 请求从当前消息回传正文及 `READ_LINK` 工具块中的签名、URL 和标题，供服务端恢复网页上下文。历史思考和其他工具块不回传。

## 模块与 ZIP 支持

| 文件 | 职责 |
| --- | --- |
| [format.ts](./format.ts)、[schema.ts](./schema.ts) | 归档类型与字段校验 |
| [toLocal.ts](./toLocal.ts) | 归档与本地消息转换 |
| [importArchive.ts](./importArchive.ts) | 条目读取与暂存 |
| [zipReader.ts](./zipReader.ts) | ZIP 读取及路径、大小、CRC 校验 |

支持单卷 ZIP32 的 STORE / DEFLATE。ZIP64、加密、分卷及非 UTF-8 的非 ASCII 文件名不支持；条目名统一按 NFC 比较。不另设业务大小上限，但受 ZIP32 容量和浏览器资源限制。
