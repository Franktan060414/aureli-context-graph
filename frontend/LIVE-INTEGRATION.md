# Aureli Studio 联调验收

2026-10-04，本机实际环境：Vue/Vite → Spring Boot :8080 → PostgreSQL/PGVector → Ollama :11434。真实接口验收没有使用响应模拟；另有浏览器模拟测试覆盖错误与边界交互。

## 实际结果

| 流程 | 验证结果 |
| --- | --- |
| API 配置 | GET 脱敏读取，POST 保存现有本地模型配置，浏览器保存后表单清空密钥 |
| 对话模型 | llama3:latest，根 Tile 返回 62 个流片段，浏览器提问实际收到回答 |
| 关联记忆 | 新 Tile 关联前一 Tile，正确返回专用代号“苍蓝2048”，关系持久化 |
| 向量模型 | qwen3-embedding:4b 实际返回 1536 维向量，与数据库一致 |
| 文档处理 | API 与页面均真实上传、等待自动刷新为已完成、修改备注、读取并删除成功 |
| 同内容文档 | 上传两份相同正文文件，删除第一份后，第二份仍可通过 RAG 检索 |
| 流式完成 | 成功流包含保存完成信号；模型 / 保存失败和缺少完成信号均不显示成功 |
| RAG | 新独立 Tile 从临时文档检索出专用暗号“银翼松果731” |
| 图谱恢复 | GET 快照包含完整回答与边，新浏览器会话默认真实模式；刷新后恢复真实节点和完整回答；多源提问的两条边持久化 |
| 数据清理 | 删除本次 4 个准确命名的测试 Tile，消息/边级联清理；临时文档及对应向量已删除；原有 5 个 Tile、3 条边和 5 份知识文件保留 |

本次未调用外部 OpenAI 服务。OpenAI 标准来源的表单切换、校验与保存协议经过模拟测试；实际远程模型响应需要有效的对应 API Key。

## 界面验收

- 已移除独立 3D 产品预览、视角滑块和材质控件。首页直接呈现图谱；最新UI统一为白底、黑色粗体标题、蓝色边界与黄色选中 / 焦点环，移除材质与立体视角。
- 动效：侧面板180ms切入、新建节点180ms落位、全页面220ms入场/140ms退出，轻微下压；键盘即时响应与减少动态效果设置，快速切换无残留动画。
- 全页面图谱与 Tile：退出、Esc 和触发按钮焦点恢复。
- 无“操作记录”页；服务设置仅保留 API 配置。
- 375/768/1024/1440px 布局无页面横向溢出；浏览器无运行时错误。
- 前端 10 项协议单测、后端 10 项定向测试（配置、快照、流式保存、文档向量归属、实际数据库持久化与清理）通过；Vue 生产构建通过。
- 断线时显示可重试的中文错误，不自动填充示例；知识库处理状态自动刷新并在完成 / 离开页面后停止。
- 全局重置仅通过模拟接口验收，未在真实原有数据上执行。

最新视觉验收由 `tests/accessible.smoke.mjs` 覆盖标题、Dock、按钮、图标、全部页面 / 对话框 / 全页面视图、焦点、对比与大尺寸操作区；现有业务接口保持不变。

## 重跑

`tests/live.integration.mjs` 会使用当前服务配置创建 3 个临时 Tile 和临时文档，通过实际 Vite 代理测试流式问答、记忆和 RAG。文档在成功后自动删除；专属记录写入 `/tmp/aureli-studio-integration.json` 供随后浏览器验收与精准清理。运行前应确保对应本地模型与数据库可用。

```sh
# frontend 目录；有可用 Playwright/Chrome，并配置相应环境变量
node tests/live.integration.mjs
node tests/live.browser.mjs
```

然后在项目根目录运行 Java 21，传入记录中的 prefix（仅接受 studio-check-数字格式）。此测试只删除本次 4 个确切 ID，绝不调用全局重置：

```sh
mvn -Dtest=TilePersistenceIntegrationTest -Daureli.integration.prefix=studio-check-<timestamp> test
```

如中途失败，应查看记录中的 fileId / fileIds，只对本次创建的文档做删除，不对原有资料做清理。快照单测 `TileWorkspaceControllerTest` 验证完整回答、最新回答覆盖、关联源去重及方向保留。


## 便签与附件持久化

运行以下可选测试验证真实 PostgreSQL 上的便签创建/编辑、BYTEA 保存、MyBatis 二进制下载和工作区恢复，无需调用模型服务：

```sh
mvn -Daureli.artifacts.integration=true -Dtest=TileArtifactPersistenceIntegrationTest test
```

测试只清理自己生成的 UUID 节点，不重置图谱，不修改已有问答和知识库记录。`TileArtifactControllerTest` 另验证空文件、10 MB 限制、节点类型隔离及附件下载响应。
