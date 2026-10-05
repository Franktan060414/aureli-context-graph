# AURELI Vue 管理控制台

基于 Vue 3 Composition API、Vite 和 Lucide SVG 图标的知识图谱管理页面。采用 Accessible & Ethical 高对比风格：白底黑字、超粗标题、蓝色边界、黄色选中与焦点提示，所有面板为扁平几何构成。首页直接呈现管理工作台，不放置独立产品预览或宣传区。

## 开发与使用

```sh
cd frontend
npm ci
npm run dev
```

打开开发服务显示的地址（默认 http://127.0.0.1:5173）。`/customer-service` 请求代理到 http://localhost:8080。可在「服务设置」中覆盖接口地址；跨域地址需要后端允许 CORS。

```sh
npm run build
npm run preview
```

构建直接生成到 `src/main/resources/static/index.html` 和 `static/vue-assets`。因此后端重新打包/启动后，同源首页即为 Vue 管理页面，不依赖运行时 CDN。`emptyOutDir: false` 保留原有静态文件。原版页面仍可通过 `/legacy/index.html` 访问。

初次打开默认连接真实工作区并恢复数据库中的图谱；后续打开保留示例/真实模式选择。点击「查看示例」可切换到标注清晰的示例模式；示例模式下点击「进入工作区」返回实际接口。示例 Tile、知识文件和所有示例操作仅保留在浏览器内存，不发送到后端。

## 页面与功能

- 图谱工作台：节点和关系统计、自动分层布局、缩放/适应画布、关键词搜索、类型筛选、Tile 列表、完整回答与来源链、图谱 JSON 导出。
- Tile 提问：独立问题、多节点关联、从单个节点延伸、单向/双向边、关系类型与备注、深度 3 / 权重 1、SSE 流式回答与失败重试。
- 知识库管理：Markdown 上传、分页、当前页搜索、异步向量化状态自动刷新、备注编辑与删除确认。处理中的文件无法删除，与后端规则一致。
- 服务设置：仅 API 配置，独立选择对话模型与向量模型，保存并应用到后端。

`GET /customer-service/tile/workspace` 返回数据库中的节点、关系和最新完整回答。进入真实工作区、刷新页面或点击同步时恢复图谱；使用只读一致性事务并禁止响应缓存。导出 JSON 用于留存，当前未实现导入。

## 验证

```sh
npm test
```

10 个测试覆盖 Vue / 原版页面 SSE 的网络分片、中文 UTF-8、CRLF、保存完成信号、中断与业务错误，以及统一客户端的服务地址、JSON / 上传协议、离线与响应校验。

`tests/ui.smoke.mjs` 使用 Playwright 执行浏览器验收，模拟真实 API 响应，不访问实际数据库；覆盖示例隔离、多节点选择、流式问答、知识文件编辑/上传/删除、失败状态、重置、搜索、375/768/1024/1440px 布局、弹窗键盘与 reduced-motion。需要可用的 Playwright 模块和 Chromium；可通过 `PLAYWRIGHT_MODULE_PATH` 和 `BROWSER_EXECUTABLE_PATH` 指定已有安装。默认测试地址为 http://127.0.0.1:4173，可用 `UI_TEST_URL` 覆盖。

```sh
node tests/ui.smoke.mjs
```

本次已在本机 Chrome、实际 Spring Boot 服务、PostgreSQL/PGVector 与 Ollama 上完成联调，详见 [联调验收](LIVE-INTEGRATION.md) 与 [接口对接说明](API-CONTRACT.md)。`tests/connection.smoke.mjs` 验证真实模式默认启用、离线重试、自动状态刷新和失败流保持失败。

设计规范位于 `design-system/aureli-console/MASTER.md`。工程组织参考 [Vue 官方快速开始](https://vuejs.org/guide/quick-start.html)，构建输出配置参考 [Vite 官方构建选项](https://vite.dev/config/build-options.html)。

## 全页面查看与模型 API 配置

图谱工具栏可切换全页面图谱；每个 Tile 右上角可打开完整问答阅读视图。通过退出按钮或 Esc 返回原工作区，关联选择和问答状态保持不变。

「服务设置」仅保留 API 配置表单，分别选择对话模型和向量模型的来源（本地 / OpenAI 标准接口），填写各自的 Base URL、API Key 和模型 ID。本地默认采用项目已有的 llama3:latest 与 qwen3-embedding:4b；OpenAI 标准接口填入的示例名称为 gpt-4.1-mini 与 text-embedding-3-small，支持手动更改为服务提供的模型。

- `GET /customer-service/model-settings` 读取当前配置，只返回 `keyConfigured`，不会返回密钥。
- `POST /customer-service/model-settings` 校验、保存并应用配置。密钥留空时，仅在来源与接口地址均未改变时保留原密钥。
- 配置由后端保存到 PostgreSQL 的 `t_model_api_settings` 表，保存成功后下一次请求立即生效，无需刷新页面或重启；服务重启会恢复数据库配置。表为空时自动迁移旧 `config/model-api-settings.json`，否则使用启动参数初始化。模型配置数据库读取或初始化失败时使用 `application.yml` 的局域网 Ollama 兜底配置：`http://192.168.0.106:11434/v1`、`llama3:latest`、`qwen3-embedding:4b`。建表 SQL 见 `src/main/resources/db/model-api-settings.sql`。
- 对话请求、文档向量化和 RAG 检索使用保存后的模型。向量维度保持与 PGVector 数据库一致（当前默认 1536）；更换向量模型后需重新向量化原文档。
- 浏览器保存项目服务地址与示例/真实模式选择，不保存模型 API Key。示例图谱与真实工作区分开，API 配置始终针对真实后端。

后端定向测试：`mvn -Dtest=ModelApiSettingsServiceTest test`，无需数据库或真实模型；覆盖持久化恢复、密钥脱敏/保留、地址和维度校验、失败写入回滚，以及文档入库/查询使用新向量模型。

`tests/views.smoke.mjs` 验证全页面图谱/Tile、退出与 Esc、配置来源切换、密钥校验、保存应用及手机布局。

接口语义参考 [OpenAI API 认证说明](https://developers.openai.com/api/reference/overview) 与 [向量模型维度配置](https://developers.openai.com/api/docs/guides/embeddings)。

## Accessible & Ethical 全局主题

`src/accessible.css` 统一覆盖页面与模块标题、Dock、按钮、Lucide SVG 图标、图谱节点、知识库表格、API表单、弹窗和全页面视图。蓝 #0066CC、黄 #FFBE00、黑 #101010、灰 #C5C5C5、白 #FFFFFF；正文深色，边界清晰。移除旧材质样式和立体视角控件，图谱默认100%阅读，保留缩放、滚动、适应画布与全页面查看。

页面标题桌面42–64px / 900、手机36px；正文15–17px，常规按钮44px以上、主按钮48px。焦点由蓝色外描边与黄色内环共同表示，选中节点有蓝边与黄色外环。正文 / 说明文字对白底至少7:1，主按钮白底蓝字与悬停蓝底白字达到4.5:1；不宣称整个应用已通过WCAG AAA认证。

只保留功能性短距离切入、节点出现、全页面进退动效。键盘操作即时完成，系统减少动态效果设置关闭动画；不使用三维材质、阴影、纹理、霓虹与装饰性循环动画。原生dialog保留焦点管理和Esc，退出后恢复触发按钮焦点。

`tests/accessible.smoke.mjs` 验证全部页面、对话框和全页面视图的标题、配色、蓝黄焦点、大尺寸操作区、文字对比及375/768/1024/1440px布局，并生成1920×1080的桌面预览。`tests/studio.smoke.mjs` 继续验证预览模块移除、首屏图谱、快速切换、焦点恢复、键盘与减少动态效果。

## 按钮强调色滑入

`src/button-motion.css` 统一控制主次按钮、图标按钮、Dock导航、页签、节点操作和模型来源控件：常态白底蓝字，鼠标悬停时对应蓝 / 黄背景层从左向右平移铺满，文字和图标同步变为白 / 黑。背景层使用transform，文字和按钮尺寸保持不动；所有按钮统一使用320ms背景平移与文字变色过渡，移出反向恢复，尺寸、图谱缩放或所在页面不改变时长。选中状态保留边框 / 标记，禁用控件不播放；键盘聚焦即时反馈，触屏无悬停残留，减少动态效果设置关闭平移。

`tests/button-motion.smoke.mjs` 验证实际过渡的中间帧、蓝黄文字变化、退出从当前进度接续、快速反复悬停、几何位置、不同宽度的320ms实际动画时长、播放期间尺寸变化、移入与移出时长、动态控件、键盘与鼠标切换、禁用与触屏状态。


图谱工作台采用画布优先布局：删除可见的大标题、说明、工作区提示条及四张统计卡片，仅保留紧凑的新建 / 导出工具栏。画布按视口高度扩展，节点与关系数量仍可在图谱底部查看；示例 / 真实工作区切换移至使用指南。保留屏幕阅读器页面标题和键盘定位。

## Tile 自由移动

鼠标移到 Tile 主体上显示抓取光标，按住左键即可拖动。画布随位置扩展，靠近边缘时自动滚动；缩放后拖动仍按实际鼠标位置计算。连线、关系文字与单向 / 双向箭头实时跟随节点，根据上下左右位置选择连接边。拖动有5px启动阈值，普通点击继续查看 Tile，关联、延伸和展开按钮保留原有操作。拖动中按 Esc 或触屏手势取消时恢复起始位置。

聚焦 Tile 主体后可用 Alt + 方向键移动10px，配合 Shift 移动40px；画布控制栏中的移动按钮提供四个方向的点击操作。选中与正在拖动的 Tile 显示在其他 Tile 上方。

位置在普通图谱、全页面图谱和列表切换间共享，保存在当前浏览器中，刷新或同步后可恢复；示例与不同服务地址的真实工作区分别保存。重置画布同时清除对应布局，导出 JSON 包含手动位置。位置未写入后端数据库，不在不同浏览器或设备间同步。

`tests/graph-drag.smoke.mjs` 验证实时连线、点击阈值、缩放坐标、Esc取消、键盘与方向按钮、原有操作、视图切换与刷新恢复。`npm test` 也验证节点跨越上下左右后的连线边界及重叠时的有效坐标。
