# Aureli iOS 原生客户端

使用 SwiftUI、Observation 和 URLSession，直接调用项目现有的 Java 后端。最低支持 iOS 17，支持 iPhone / iPad；没有 WebView、Electron 或第三方 UI 依赖。`Core/` 是本地 Swift Package，包含模型、接口、SSE 协议和图谱布局。

这是原生移植的第一阶段，可以继续在 Xcode 中开发；尚未达到桌面版的全部功能。

## 用 Xcode 打开

1. 打开 `ios/Aureli.xcodeproj`，选择 **Aureli** scheme。
2. 在 **Xcode → Settings → Components** 中准备 iOS 平台组件；若使用模拟器，另外准备对应的 iOS Simulator runtime。
3. 在 target 的 **Signing & Capabilities** 中选择自己的 **Team**。如果默认 Bundle Identifier 被占用，改成自己的唯一标识。
4. 连接 iPhone，并按手机和 Xcode 的提示完成信任、Developer Mode 等设置；选择手机作为运行目标。
5. 点击 Run。进入应用的「服务连接」，填写 Aureli **后端**地址，而不是 Vite 页面地址。

工程使用 Swift 6、MainActor 默认隔离和 Approachable Concurrency。应用不在手机上启动 Java、PostgreSQL、Ollama；模型密钥继续保存在后端。Debug 支持 HTTP，用于局域网联调；Release 的地址校验要求 HTTPS，且没有全局 ATS 例外。

## 连接 Mac 上的桌面开发版

在项目根目录打开两个终端。

第一个终端启动原有桌面开发版：

```sh
cd desktop
npm run dev
```

第二个终端启动 iPhone 调试转发入口：

```sh
node ios/scripts/dev-proxy.cjs
```

脚本打印 Mac 的局域网 IP。Mac 和 iPhone 连接同一 Wi-Fi，在手机的「服务连接」填写例如 `http://192.168.1.23:18082`，将示例 IP 换成实际地址；首次访问时允许本地网络权限。如果无法连接，确认 macOS 防火墙允许该入口，且 Wi-Fi 没有开启设备隔离。

模拟器可直接使用 `http://127.0.0.1:18081`，不需要转发。手机上的 `localhost` / `127.0.0.1` 指向手机自己。

转发的默认上游为 `http://127.0.0.1:18081`，监听所有 IPv4 接口的 `18082` 端口，仅转发 `/customer-service/` API。数据库继续只监听本机。按 Ctrl+C 可关闭入口。

如果开发后端端口不同：

```sh
AURELI_IOS_BACKEND_URL=http://127.0.0.1:18083 \
AURELI_IOS_PROXY_PORT=18082 \
node ios/scripts/dev-proxy.cjs
```

现有后端没有登录和用户隔离。此转发仅适用于可信的开发局域网；可访问入口的设备可以调用后端接口。长期使用或公网部署需要后端访问控制和 HTTPS。Mac 睡眠、退出开发版或关闭转发后，手机将无法连接。

## 首版使用流程

- 左上角「工作空间」切换或新建图谱，也可修改服务连接。
- 列表中搜索节点，点击阅读完整内容和上下文来源。
- 右上角「新增与同步」新建问答、便签或同步图谱。
- 阅读节点时点击「关联提问」，该节点会预选为上下文；可继续选择多个来源并调整追溯深度。
- 流式回答只在收到后端 `done: true` / 协议兼容的 `[DONE]` 后显示已保存。错误、停止或断流会保留已接收的文字，并提示先同步图谱确认结果，避免重复提交。
- 便签支持创建、编辑以及上下文关联。关闭未保存的表单时提供放弃确认。
- 「图谱」支持滑动、双指缩放，以及放大、缩小、重置按钮；列表视图提供不依赖图谱手势的阅读入口。

应用使用系统字号、语义颜色和原生导航，支持深色模式、Dynamic Type、VoiceOver 控件标签和横屏。图谱坐标为手机端独立计算，包含循环关系的安全布局；不读取浏览器本地保存的桌面坐标。双向关系使用虚线，有向关系使用实线和箭头。

## 当前边界和后续适配

| 能力 | 首版状态 |
| --- | --- |
| 服务连接、图谱列表 / 切换 / 新建 | 已接入现有 API |
| 节点搜索、完整回答 / 便签 / 网页正文阅读 | 已接入 |
| 多节点关联、流式问答与保存确认 | 已接入 |
| 便签创建、编辑、关联 | 已接入 |
| 图谱关系展示、滑动、缩放 | 已实现原生布局 |
| 附件文字阅读 | 显示后端已提取正文 |
| 附件上传、原附件预览 / 下载 | 待接入 Files / Quick Look / 分享菜单 |
| 完整 Markdown 代码块 / 表格渲染 | 当前支持行内样式和保留换行，复杂块级排版待补齐 |
| 知识库、模型 / Tavily 设置 | 继续在桌面端管理 |
| 标签、权重编辑、融合 / 拆分、自动拆分建议 | 待移植 |
| 自由拖动节点、桌面布局同步、图谱导入导出 / 删除 | 待移植 |
| 登录、多用户、离线缓存、后台生成恢复 | 尚未实现，需同时设计后端和客户端行为 |

切到后台或停止接收可能中断回答流；不承诺后台继续生成或自动恢复。回到应用后请手动同步确认保存结果。

## 验证

核心协议测试在 Mac 上直接运行，不需要模拟器：

```sh
swift test --package-path ios/Core
node --test ios/scripts/dev-proxy.test.cjs
node ios/scripts/verify-api.cjs
```

使用正在运行的开发后端做额外的只读验证：

```sh
AURELI_IOS_TEST_SERVICE_URL=http://127.0.0.1:18081 \
swift test --package-path ios/Core
```

该验证读取图谱和快照，不新建节点、不调用模型、不修改数据。`verify-api.cjs` 另启动仅监听本机的模拟 API，验证 URLSession 的 JSON 失败、HTTP 错误、实际中文分片接收、保存失败及断流，不访问真实后端数据。协议测试覆盖中文 / emoji 分片、LF / CRLF / CR、SSE 多行、缺少保存信号、服务端失败、非法地址、正式版 HTTPS 限制、请求字段和循环图布局。

准备好平台组件后的 Xcode 构建检查：

```sh
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
xcodebuild -project ios/Aureli.xcodeproj -scheme Aureli \
  -configuration Debug -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath ios/DerivedData CODE_SIGNING_ALLOWED=NO build
```

本次验证通过：Debug / Release 的 SwiftUI 源码 iOS SDK 检查、Swift 核心和模拟 HTTP 接口测试、当前桌面开发版真实数据的只读契约检查、两个转发测试、工程与 Info.plist 格式检查，以及 Xcode 工程 / scheme / 本地 package 识别。

完整 Xcode 构建尚未通过：通用运行目标提示 iOS 26.5 平台未就绪，直接构建 target 又在图标资源编译时提示没有可用 simulator runtime。因此源码检查和核心 / 转发测试不能替代完整 Xcode 打包、安装及真机验收。仍需在真机检查首次网络授权、键盘、双指缩放、后台断流、最大字号、深色模式和横屏。
