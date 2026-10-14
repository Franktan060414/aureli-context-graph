# Aureli iOS 本地运行版

当前默认入口为 SwiftUI 原生分支对话页，直接调用 Swift 业务核心和 SQLite。iPhone 不需要连接 Mac 的 Java 后端或 PostgreSQL。对话模型和 Tavily 仍通过用户配置的网络服务调用；本次移动端范围不包含向量模型、向量检索和 RAG 知识库。旧 Vue 容器及资源继续保留。

## 原生分支对话交互

- 默认只呈现分支对话，不提供图谱视图或 Tile 列表视图的切换入口。GraphView 源码及后端图谱能力仍保留。
- 工作空间和模型设置合并在左侧抽屉，可点击左上角按钮或从屏幕左缘向右拖动打开；点击右侧遮罩或向左滑可关闭。
- 同一层的 Tile 并排并对齐高度，两列尽量适配屏幕，更多分支可横向浏览。收起的 Tile 在有展开内容时缩为侧栏，仍可点按恢复。
- 移除层级标题，用轻量连线衔接上下层，保留与桌面分支模式相同的层次关系。
- 便签、文件、网页位于输入框旁的“＋”菜单，图谱导入、导出入口暂时隐藏，相关后端接口保留。
- 点按问答卡片可展开或收起正文，不再提供单独的展开按钮；最后一条问答也可以收起。
- 长按约半秒关联或取消关联，不同时触发点按操作。滑动阅读不会触发关联。
- 已关联内容显示在输入框上方，用作下一次提问的上下文；此操作不会修改已保存的关系边。
- 展开状态和关联选择按工作空间存入 SQLite，重新打开 App 后恢复。
- 内容菜单提供完整阅读、复制、便签编辑和附件分享；VoiceOver 提供展开及关联等命名操作。

原生初版已接入工作空间、新建问答、便签、文件、网页和模型/Tavily 设置。JSON 导入导出服务保留，但当前原生界面不提供入口。融合、拆分、标签等高级服务继续保留在 Core 中，其完整原生管理界面尚待接入。

## 项目结构

| 位置 | 职责 |
| --- | --- |
| `Aureli/AureliApp.swift` | iOS 应用入口，启动 NativeConversationView |
| `Aureli/NativeConversationView.swift` | 原生分支对话、输入区及点按/长按手势 |
| `Aureli/NativeConversationDrawer.swift` | 统一工作空间抽屉与屏幕左缘手势 |
| `Aureli/NativeBranchRow.swift` | 同层横向布局、等高 Tile 和上下层连线 |
| `Aureli/NativeConversationStore.swift` | 本地数据、问答生成和工作空间状态 |
| `Aureli/NativeConversationPanels.swift` | 工作空间、模型设置、便签、阅读和分享页面 |
| `Core/Sources/AureliCore/NativeConversation.swift` | 强类型本地客户端、分支层次计算和交互状态 |
| `Aureli/LocalWorkbenchView.swift` | 保留的 Vue 容器，承载 WKWebView 并处理网页偏好和下载 |
| `../frontend/src/` | 桌面与旧 iPhone 网页容器的 Vue 源码；当前原生页面在 Aureli/*.swift |
| `Aureli/Web.bundle/` | 自动生成并随 App 打包的 HTML、JavaScript、CSS 和资源，不应直接编辑 |
| `Core/Package.swift` | 本地 Swift Package 的模块、依赖和测试定义 |
| `Core/Sources/AureliCore/Local/` | Swift 业务逻辑、接口适配和 SQLite 存储 |
| `Core/Sources/CSQLite/` | iOS 系统 SQLite 的 C 接口桥接 |
| `Core/Sources/CZlib/` | 系统 zlib 桥接，用于读取 DOCX 压缩内容 |
| `Core/Sources/AureliBackendHarness/` | 开发验证工具，在 Mac 上运行相同的 Swift 后端；iPhone App 不链接此工具 |
| `Core/Tests/AureliCoreTests/` | 核心、存储、接口、模型协议和附件测试；Fixtures 是测试文件 |

`Local/` 文件夹不是独立命名空间。业务文件目前通过 `extension MobileBackend` 分担职责，共用一个 actor 管理数据库和操作状态。这是迁移初期的集中组织方式，尚未按 Java 的 Controller / Service / Repository 边界逐一拆分服务对象。

旧的 `RootView`、`ConnectionView`、`GraphView`、`Editors`、`WorkspaceStore` 以及远程 `APIClient` 仍保留。当前入口使用新的原生分支页面，并通过 LocalConversationClient 直接调用 MobileBackend；不依赖本地 HTTP 服务。原 Java 桌面后端依然保留在项目根目录 `src/main/java/`。

## Java 职责迁移对应

| Java 职责 | 当前 Swift 实现 |
| --- | --- |
| Controller 和 API 响应 | LocalHTTPServer、MobileBackend.request |
| 工作记忆、问答、融合与节点拆分 | QuestionServices |
| 提问前拆分建议与执行 | QuestionPlans |
| 图谱导入、示例图谱 | GraphImport |
| Mapper、SQL 与数据约束 | SQLiteStore |
| 模型配置、模型协议与安全保存密钥 | MobileBackend、ModelTransport、KeychainVault |
| Tavily 搜索、网页正文读取 | WebTools |
| 提示词 | MobilePrompts |
| PDF / DOCX 正文提取及附件保存 | DocumentReader |

部分请求和节点数据使用 JSONValue 保留 Vue 接口契约，并通过字段校验约束输入；目前未逐一恢复 Java 中所有强类型 VO 和 DO。目录分层和独立服务对象仍可进一步整理。

## Xcode 运行

1. 在项目 `frontend/` 中运行 `npm ci`，准备页面构建依赖。Mac 需要可用的 Node.js 和 npm。
2. 打开 `Aureli.xcodeproj`，选择 **Aureli** scheme；使用支持 Swift 6.2 的 Xcode。
3. 在 Signing & Capabilities 选择自己的 Team，选择可用 iPhone 或模拟器。
4. 点击 Run。构建阶段会自动执行 `scripts/prepare-web.cjs`，将 Vue 页面构建并复制到 Web.bundle。
5. 在应用的服务设置中配置对话模型。无需填写 Mac 管理接口地址。Tavily 按需单独配置。

原生页面请修改 Aureli/NativeConversation*.swift 后重新构建。旧 Vue 页面的 Web.bundle 仍会被构建脚本重建覆盖。

## 数据与功能范围

- 图谱、节点、标签、消息、关系、模型配置元信息和页面偏好保存在 App 的 Application Support/AureliMobile/aureli.sqlite。
- API Key 存入系统 Keychain，不保存在 SQLite 或返回的配置 JSON 中。
- 原附件保存在同一数据目录的 Attachments 子目录；PDF 和 DOCX 可提取正文用于上下文。
- 已实现问答流式生成、关联记忆、便签、标签、权重、节点尺寸、文件上传下载、网页快照、融合、拆分、提问拆分方案、示例图谱和 JSON 导入导出。
- 问答完成后才写入数据库；融合覆盖和方案执行使用事务，失败不会留下部分结果。
- JSON 导入/导出服务仍可恢复图谱内容和附件元信息，但本版手机界面暂时隐藏入口。JSON 不包含附件原文件；此版不提供桌面与手机自动同步。
- 原生界面直接调用 App 内业务核心。保留的网页接口只监听回环地址，并使用授权 Cookie。系统暂停或关闭 App 时，不能保证联网生成继续运行；中断回答不会按完整回答保存。
- Debug 允许 HTTP 联调。Release 允许本地页面通信，公网模型服务应使用 HTTPS。

## 验证

Mac 上运行核心与模型/MCP HTTP 测试：

```sh
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer node ios/scripts/verify-api.cjs
```

在 iOS 模拟器运行相同测试（将设备 ID 换成自己的模拟器 ID）：

```sh
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer AURELI_TEST_IOS_DEVICE_ID=YOUR_SIMULATOR_ID node ios/scripts/verify-api.cjs
```

`scripts/verify-native-ui.mjs` 使用真实 Swift/SQLite 后端和本地模型测试服务验证 Vue 页面创建便签、流式回答、JSON 导出导入和重启恢复。需要可用的 Playwright 与浏览器；可通过 PLAYWRIGHT_MODULE_PATH 和 BROWSER_EXECUTABLE_PATH 指定已有环境。

本轮已通过前端 78 项测试、核心测试、iOS 模拟器上的模型/MCP 通信测试、上述页面流程以及 iPhone Release 无签名构建。付费模型真实调用的可选测试未运行；完整真机触屏、系统文件选择/分享及后台行为仍需设备验收。

原生界面手势和关联回答验证：

```sh
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer AURELI_TEST_NATIVE_UI_DEVICE_ID=YOUR_SIMULATOR_ID node ios/scripts/verify-api.cjs
```

该验证使用独立的 AureliNativeUITests 数据目录和本地模型测试服务，不会修改用户的 AureliMobile 数据，也不会调用付费模型。测试启动参数和示例注入仅编译进 Debug。
