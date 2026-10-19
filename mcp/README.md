# Aureli MCP 原型

本地 SQLite 保存节点、关系与冻结任务，Vue 提供画布，宿主负责生成。无需对话模型、向量模型或搜索 API Key。

## 运行与验证

需要 Node.js 24 或以上。在本目录依次运行：

```sh
npm ci
npm run build
npm test
npm start
```

默认本地入口为 `http://127.0.0.1:18765/`，`/host` 是使用真实 MCP HTTP 与官方 AppBridge 的手动验证页，不执行模型推理。`npm run test:ui` 在临时数据库中验证浏览器交互和桥接。

通过 `AURELI_MCP_DB` 指定独立数据库，通过 `AURELI_MCP_PORT` 指定本地端口。`node server/main.js --stdio` 用于本地 MCP 接入；不通过标准输出记录日志。

## 对话归属

- 节点、关系、任务均使用 `conversation_id` 隔离。查询任务、提交答案和重复提交检查也受当前对话约束，不能只凭任务 ID 跨对话访问。
- 工具优先读取调用元数据 `_meta["openai/session"]`；显式参数与宿主元数据不一致时拒绝操作。
- 宿主未提供元数据时，每次调用都必须显式提供 `conversation_id`。不得用 MCP 连接 ID、界面实例 ID 或共享 `main` 代替聊天 ID。
- 当前 Codex 的真实元数据可用性仍需按客户端验证；不能仅凭字段迁移保证所有客户端自动识别聊天。
- 首次访问某个有效对话 ID 时自动准备空画布；再次访问同一 ID 恢复数据，不需要手动新建 Map。
- 独立浏览器验证页将测试 ID 保存在 URL 的 `conversation_id` 参数和当前标签页的 sessionStorage 中，刷新后保持一致。它不代表真实宿主聊天身份。

手动隔离测试：分别打开 `/?conversation_id=test-a` 和 `/?conversation_id=test-b`，只在 A 加载实验图谱，确认 B 仍为空；刷新或返回 A，节点、关系和布局保持原样。桥接验证页使用 `/host?conversation_id=test-a`。新建便签按钮与弹窗已移除，已有节点仍可编辑。

宿主提供元数据时可直接调用 `aureli_open({})`；否则需要类似 `aureli_open({"conversation_id":"当前聊天稳定标识"})`。嵌入画布从首次工具结果获得该标识，后续界面操作自动携带它。此隔离是本地原型的业务边界，不替代多用户身份鉴权。

## 旧原型数据迁移

首次用新版打开旧 SQLite 时，自动把 `maps` 改为 `conversations`，并将节点、关系、任务的 `map_id` 改为 `conversation_id`。保留已有 ID、正文、布局、连线和任务状态，同时转换冻结资料包的归属字段。

旧 `main` 数据仍属于 `conversation_id=main`，不会被自动分配给任何新宿主聊天。需要查看旧数据时，本地页可显式打开 `/?conversation_id=main`。无需删除旧数据库；更改后需重启原 MCP 服务并刷新画布。
