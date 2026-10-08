# Vue 管理页面接口对接

所有地址相对于项目后端，默认同源。Vite 开发环境把 `/customer-service` 代理到 `http://localhost:8080`。「服务设置」中的项目服务地址覆盖这个默认值；模型 Base URL 是后端调用模型的地址，两者独立。

统一请求入口：`src/lib/api.js` 的 `createApiClient`。首页默认读取真实数据库；示例模式由用户显式选择，示例数据操作只发生在浏览器内存中。连接失败显示错误和重试按钮，不自动填入示例数据。

## 路由与页面行为

| 页面行为 | 请求 | 请求内容 | 成功响应 / 处理 |
| --- | --- | --- | --- |
| 恢复 / 同步图谱 | GET `/customer-service/tile/workspace` | 无 | `data: { tiles, edges }`，节点包含完整 `answer`，读取不缓存 |
| 添加便签 | POST `/customer-service/tile/note` | `{ tileId, title, content, relatedTileIds? }` | 新建 NOTE 节点，返回完整节点；ID 冲突拒绝覆盖 |
| 编辑便签 | POST `/customer-service/tile/note/update` | `{ tileId, title, content, relatedTileIds? }` | 更新 NOTE 标题、正文和所选来源；省略关联字段时保留关系，空数组清空来源 |
| 添加画布附件 | POST `/customer-service/tile/file` | FormData，字段 `file`，重复字段 `relatedTileIds`（可选） | 新建 FILE 节点，最大 10 MB；PDF / DOCX 文字提取后写入 `content`，其他格式仅保存附件 |
| 下载画布附件 | GET `/customer-service/tile/{tileId}/file` | 无 | 二进制下载，`Content-Disposition: attachment`；不存在时 404 |
| 生成 Tile | POST `/customer-service/chat/tile/completion` | JSON，见下方 | SSE 流，确认保存后才显示完成 |
| 删除 Tile | POST `/customer-service/tile/delete` | `{ tileId }` | 在同一事务中删除节点、消息及以该节点为端点的全部关系边；页面需要用户确认 |
| 调整 Tile 权重 | POST `/customer-service/tile/weight` | `{ tileId, weight }` | `weight` 仅接受 1、2、3；更新指定节点的权重及修改时间，成功后同步详情和图谱尺寸 |
| 知识文件分页 | POST `/customer-service/md/list` | `{ current: 1, size: 10 }` | `data` 为文件数组；`total/current/size/pages` 与 `data` 同级 |
| 上传 Markdown | POST `/customer-service/md/upload` | FormData，字段 `file` | 上传成功后刷新列表；向量化异步执行 |
| 修改备注 | POST `/customer-service/md/update` | `{ id, remark }` | 成功后刷新当前页 |
| 删除文件 | POST `/customer-service/md/delete` | `{ id }` | 删除文件记录、文件及对应向量；处理中禁止删除 |
| 重置图谱 | POST `/customer-service/tile/reset` | `{}` | 清除所有 Tile、消息、边；页面需要用户确认 |
| 读取模型配置 | GET `/customer-service/model-settings` | 无 | `data: { chat, embedding, dimensions }`，密钥仅返回 `keyConfigured` |
| 保存模型配置 | POST `/customer-service/model-settings` | JSON，见下方 | 持久化并应用，返回脱敏配置 |
| 测试模型连接 | POST `/customer-service/model-settings/test` | 无 | 使用后端已保存的对话模型配置，返回 `data: { model, reply }` |

除附件下载外，非 SSE 响应统一为 `{ success: boolean, message?, data? }`。前端同时检查 HTTP 状态与 `success`，HTTP 200 的业务失败也显示为失败。GET/JSON 请求超时 30 秒、上传 60 秒、流式回答 180 秒；连接中断、超时和错误响应均有提示。

工作区节点新增 `tileType`（`QA` / `NOTE` / `FILE`）、`title`、`content`、`fileName`、`fileContentType`、`fileSize`。旧节点自动标记为 `QA`；`kind` 继续用于图谱样式（便签 `note`，附件 `file`）。便签的 `message` / `answer` 分别映射标题 / 正文，附件映射标题 / 文件名，兼容现有搜索与布局。

这些节点统一保存在 `t_tile`：新增 `tile_type`、`content`、`file_name`、`file_content_type`、`file_size`、`file_data BYTEA`。初始化脚本使用 `ADD COLUMN IF NOT EXISTS` 兼容旧数据库。附件二进制只在下载时读取，工作区 JSON 不包含二进制内容；删除或重置节点会一并删除附件。临时附件不参与向量化；便签通过显式关联作为用户上下文注入，文件节点可选择关联，已有 `content` 正文时作为问答上下文读取。文件不会因浏览器刷新自动清除，使用者可随时删除。

工作区的 `tiles[].weight` 直接读取 `t_tile.weight`，表示 Tile 自身的重要程度：1 普通、2 重要、3 非常重要。节点详情在回答状态下方以小字仅显示对应文案，不带“权重：”前缀；“非常重要”使用红色，其余保持灰色。缺失时显示“未设置”，其他值显示“未知”。此字段与关系边的 `edges[].weight` / `edgeWeight` 独立。

图谱 Tile 按自身权重调整长宽：1 为 260×200，2 为 390×300（1.5 倍），3 为 650×500（2.5 倍）；缺失或其他值沿用普通尺寸。较大的卡片显示更多问题与回答，字号、按钮和原有操作保持一致。自动排列与连线使用实际尺寸，已保存的手动坐标继续保留。

节点详情在 AI 完整回答下方、上下文来源上方提供权重下拉控件：普通 / 重要 / 非常重要分别对应 1 / 2 / 3，常态始终白底，文字为绿 / 橙 / 红；悬停时对应颜色从左向右铺满背景，三档均为白字。沿用项目原生下拉选择、蓝黄焦点环及统一 320ms 强调色扫入动画；键盘、触屏和减少动态效果沿用全局行为。真实模式保存到数据库，失败保留原值并提示；示例模式仅修改内存数据。保存期间禁止重复提交，同步成功后图谱卡片尺寸立即随权重变化。

文件 `status`：0 待处理、1 向量化中、2 已完成、3 处理失败。当前知识库页存在状态 0/1 的文件时每 2 秒刷新；页面隐藏、离开知识库、全部处理完成或请求失败时停止。返回页面或手动重试可重新刷新。

## Tile 与流式完成协议

```json
{
  "tileId": "tile-example",
  "message": "问题内容",
  "relatedTileIds": ["tile-source-a", "tile-source-b"],
  "memoryDepth": 3,
  "edgeDirection": "DIRECTED",
  "relationType": "EXTENDS",
  "edgeWeight": 1,
  "edgeDescription": "关系备注"
}
```

`relatedTileIds` 为空时不读取其他 Tile 的工作记忆，但仍使用共享 RAG 知识库。方向可为 `DIRECTED` 或 `UNDIRECTED`。旧字段 `parentTileId` 仍兼容。

有向边保存为「上下文来源 → 新 Tile」，读取工作记忆时从 `relatedTileIds` 反向追溯来源，只继承所选节点及其祖先，不读取子节点或兄弟分支。例如 `A → B`、`A → C` 时，从 A 延伸 C 不会读取 B；从 B 继续延伸则能读取 B 与 A。只有显式选择其他分支或通过 `UNDIRECTED` 双向关系连接时，才会共享对应上下文。`memoryDepth` 为从所选节点继续追溯的最大边数，0 只读取所选节点，省略时默认 1。

响应 Content-Type 为 `text/event-stream`。事件以空行分隔，可跨多个网络数据包；前端保留 UTF-8 解码和完整事件缓冲。

```text
data: {"v":"回答的一部分"}

data: {"v":"回答的后续内容"}

data: {"done":true}

```

`done:true` 仅在完整回答、Tile 和关系事务保存成功后发出。模型 / 检索 / 保存失败时发送 `{ "error": "可显示给用户的错误" }`，不会再发送成功终止事件。JSON 字段可能带有额外的 `null` 字段，客户端忽略。连接结束但未收到终止事件时保持失败状态；保留部分回答供查看，不将其标记为已完成。原版 `/legacy/index.html` 同样兼容该协议。

## AI 问答 Tile 融合

`POST /customer-service/tile/fusion` 接收 `{ "tileId": "新节点 ID", "sourceTileIds": ["来源 ID 1", "来源 ID 2"] }`，返回普通 JSON `{ "success": true, "data": { "tiles": [新节点], "edges": [融合来源关系] } }`。前端超时为 180 秒；发起请求前必须二次确认，失败不创建前端占位节点，保留弹窗和同一目标 ID 供重试。请求超时或保存结果不确定时先同步图谱，已存在的目标 ID 不会被覆盖。

来源 ID 去重后，后端仅接受两个及以上 `QA`（含历史默认类型）问答，自动排除 `NOTE` 和 `FILE`，缺失节点或没有问题/回答的问答返回错误。读取 `t_tile.user_message` 和最新 `assistant` 消息全文（历史缺失消息时回退摘要）；通过 `prompt/TileFusionPrompts` 和当前已保存对话模型，同时生成新的 `userMessage` 与 `answer`，不读取祖先节点、便签、附件或 RAG。模型异常或字段无效时不写入数据；生成期间来源变化会拒绝保存。新节点权重取参与问答的最高值，原来源不修改；节点、完整 user/assistant 消息和 `DIRECTED` / `FUSES` 来源边在同一事务中保存。成功返回的完整回答和关系可通过工作区快照恢复，无须数据库结构升级。后端需要重新启动以加载新接口。

## 独立的对话与向量模型配置

```json
{
  "chat": {
    "provider": "local",
    "baseUrl": "http://127.0.0.1:11434/v1",
    "model": "llama3:latest",
    "apiKey": ""
  },
  "embedding": {
    "provider": "local",
    "baseUrl": "http://127.0.0.1:11434/v1",
    "model": "qwen3-embedding:4b",
    "apiKey": ""
  },
  "dimensions": 1536
}
```

来源为 `local` 或 `openai`，两种来源均调用 OpenAI 标准协议。本地模型无需实际密钥；OpenAI 标准来源需要有效 Key。密钥留空只在来源与地址都未改变时保留已存密钥。配置保存在后端 PostgreSQL 的 `t_model_api_settings` 表，浏览器不存 Key。保存对话与向量配置是一次原子写入，成功后下一次模型请求立即使用新配置；数据库保存失败返回 HTTP 500 和脱敏错误，原运行配置保持不变。“测试链接”不会提交页面表单，而是让后端使用当前已保存且正在生效的对话模型配置发送固定消息；测试提示词集中维护在后端 `prompt` 包。测试成功返回模型名称和原始回复，供应商异常以脱敏的 HTTP 502 错误返回。服务重启优先恢复数据库配置，空表时迁移旧 JSON 或使用启动参数初始化。模型配置数据库读取或初始化失败时使用 `application.yml` 兜底：`http://192.168.0.106:11434/v1`、对话 `llama3:latest`、向量 `qwen3-embedding:4b`。此时保存仍需要数据库成功写入，否则继续保留当前运行配置。固定向量维度必须与当前数据库一致；换向量模型需重新处理旧文档。

## 已完成的验收

2026-10-04：真实本地模型流式问答、多节点记忆关联、文档上传 / 向量化 / 备注 / 删除、RAG、刷新恢复与配置保存均通过。相同正文的不同文件现在使用各自稳定向量 ID；删除其中一份不会覆盖或删除另一份的新入库向量。已有向量未做自动重写。

联调只清理本次临时记录，保留原有 5 个 Tile、3 条边和 5 份文档。全局重置通过模拟浏览器验证，未在原有数据库上执行。外部 OpenAI 调用未执行，需有效 Key。详细记录见 [LIVE-INTEGRATION.md](LIVE-INTEGRATION.md)。


图谱工具栏的「添加Tile」打开独立弹窗，复用节点配置侧栏的 `QuestionForm` 和同一份草稿、关联状态及 `sendTile` 生成逻辑。弹窗包含提问内容、Tile ID、关联上下文、边方向、关系类型与关系备注，并可在弹窗内选择已完成的问答、便签或文件。取消保留草稿；字段或 ID 校验失败时保留弹窗；通过校验提交后关闭弹窗，在节点详情中显示生成进度和回答。

添加便签、编辑便签、添加文件弹窗与添加Tile共用 `ContextPicker`，提供已选关联标签、逐项移除、清空与折叠的已有节点复选列表。便签/文件的关联草稿独立于提问草稿，可选择已完成的问答、便签及文件；编辑便签排除自身。保存关联到 `t_tile_edge`，默认从所选节点指向新节点，方向 `DIRECTED`、关系 `EXTENDS`、权重 1。更新便签仅调整来源关系，保留仍被选中的边设置及所有出边。关联 ID 去重，缺失节点和自身关联会拒绝保存。文件节点可建立图谱连线；已提取的正文按关联范围加入问答记忆，没有正文的附件仅建立关系。

图谱 DOCX 正文提取统一通过 `TileFileContentReader.extractContent(fileName, fileData)` 完成。上传新 `.docx`（扩展名不区分大小写）时，在插入 `t_tile` 前提取正文段落与表格文字：保留正文顺序、段落换行和制表符，表格行以换行分隔、单元格以制表符分隔。正文中的超链接保留可见文字，图片不进行 OCR，页眉页脚不纳入正文。原始文件仍完整保存到 `file_data`，返回节点和工作区快照中的 `content` 为提取后的纯文本。有效但没有文字的 DOCX 保存空字符串；不支持的其他附件格式 `content` 为 null；损坏或加密的 DOCX 返回解析失败，不创建节点或关联关系。已有附件不自动回填；文件内容通过 `CustomChatMemoryAdvisor` 从 `content` 读取，携带文件名称、来源 Tile ID 和重要程度，按所选节点及其祖先的范围加入模型上下文；不读取二进制，不做向量化。

PDF 使用同一个读取入口，通过 Apache PDFBox 3.0.8 提取新上传 `.pdf`（扩展名不区分大小写）的文字层：按页码及页内文字位置排序，行与页之间以换行分隔。图片、图形等非文字内容忽略，不渲染页面、不执行 OCR。有效但没有文字层的 PDF 保存空字符串，原始附件仍可下载；损坏或加密的 PDF 返回明确的解析失败提示，不创建节点或关联关系。提取文字同样保存在 `content`，可查看、刷新恢复并用于关联问答；原始 PDF 二进制保持完整。已有 PDF 附件需重新上传才能提取文字。提取方式参考 [PDFBox 官方文档](https://pdfbox.apache.org/3.0/migration.html)。

图谱卡片、Tile 列表、添加Tile节点选择器和节点配置的「从此节点延伸」均支持文件节点，不再按 `FILE` 类型禁用。文件详情可展开查看已提取正文，未提取正文的附件显示说明；旧 DOCX / PDF 文件需重新上传提取文字。问答中的文件正文与便签一样作为来源标记的用户上下文注入，原始当前提问、历史角色及图谱记忆范围保持不变。
