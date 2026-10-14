# Aureli 桌面应用

应用包含前端、后端 JAR、Java 21 运行环境和 PostgreSQL（含 pgvector）。第一次运行会创建空数据库，不导入 Docker 中的测试数据。使用者无需安装 Java、PostgreSQL 或 Docker。

## 安装与使用

1. 退出先前通过 `npm start` 打开的开发版桌面应用。
2. 打开 `dist/Aureli-0.13.0-arm64.dmg`，将 Aureli 拖到 Applications。
3. 从 Applications 打开 Aureli，等待内置数据库和后端启动。
4. 在“服务设置”中配置对话模型与向量模型。

## 日常桌面开发

在已准备桌面运行环境的源码目录中运行：

```sh
cd desktop
npm run dev
```

第一次使用源码需要在 `frontend` 和 `desktop` 分别执行 `npm ci`，并准备 JDK 21、Maven 和对应平台的桌面 PostgreSQL 资源（见后面的构建说明）。开发启动会编译 Java 源码、生成依赖列表、启动 Vite，并打开标题为“开发版”的 Aureli 窗口。不生成前端发布资源、后端 JAR 或安装包；不要求运行环境中已有发布用 JAR。

- 修改 `frontend/src` 中的界面、样式和交互，保存后直接在应用窗口里查看更新。
- 修改 Java 后端、桌面入口或开发配置后，关闭开发版窗口，再运行 `npm run dev`，重新编译并启动。
- 关闭开发版窗口或在启动终端按 Ctrl+C，会先停止后端和数据库，再退出界面服务。
- 开发版是独立的空工作区，需要在“服务设置”中单独配置模型连接。

开发数据在 Mac 上位于 `~/Library/Application Support/Aureli-dev/`，Windows 上位于 `%APPDATA%\Aureli-dev\`。正式版仍使用 `Aureli` 目录。开发版默认界面端口为 `5174`、后端为 `18081`、数据库为 `54330`，可以和正式版同时运行。可通过 `AURELI_DEV_FRONTEND_PORT`、`AURELI_DESKTOP_PORT`、`AURELI_DATABASE_PORT` 指定其他端口，通过 `AURELI_DATA_DIR` 指定独立开发目录；不要指向正式版数据目录。

`npm start` 仍用于检查已构建的发布资源。只有准备发布给用户时，才运行 `npm run dist:mac` 或 Windows 构建流程。

桌面开发模式已在 Apple Silicon Mac 验证启动、窗口内热更新和正常退出；Windows 开发入口尚待实机验证。

当前安装包适用于 Apple Silicon（M 系列）Mac，要求 macOS 13 或以上。当前采用临时签名，未配置 Apple Developer ID 签名和公证；正式对外分发前需要补充这两项。

AI 模型没有包含在安装包里。可连接自行安装的本地 Ollama，也可配置远程模型 API。选择远程 API 时仍需联网；若要完全离线使用，需要在目标 Mac 上另外准备本地模型。

退出应用请使用菜单“退出 Aureli”或 `⌘Q`，应用会先停止后端，再关闭数据库。只关闭窗口时应用仍在运行。

## 数据存储

每位 Mac 用户的数据存放在 `~/Library/Application Support/Aureli/`：

- `postgres-data/`：内置数据库数据。
- `config/database-password`：本地数据库的自动生成凭据。
- `config/model-api-settings.json`：模型连接设置。
- `Markdown/`：知识库文件。
- `logs/`：数据库和后端日志。

数据库默认使用本机端口 `54329`，后端使用 `18080`，均只监听 `127.0.0.1`。不要删除数据目录或只保留数据库而丢弃凭据文件。备份前先退出应用，再复制整个 Aureli 数据目录。替换应用程序不会清空这个目录。

## 重新构建

在 Apple Silicon Mac 上准备 Node/npm、Java 21、Maven，以及包含 pgvector 的 Postgres.app。`resources/java/` 应是已生成的 Java 21 运行环境。默认 PostgreSQL 来源为 `/Applications/Postgres.app/Contents/Versions/18`，其他安装路径可通过 `AURELI_POSTGRES_SOURCE` 指定。

```sh
cd desktop
npm ci
npm run dist:mac
```

构建流程依次生成前端、打包后端、复制运行环境、运行内置数据库集成测试，然后生成 DMG。发布用 JAR 会移除开发和生产环境专用配置，应用使用 `config/application-desktop.yml`；原始后端 JAR 不会被修改。运行环境准备脚本可以重复执行，只替换生成的程序文件，不触碰应用用户数据。

```sh
npm run prepare:desktop
npm test
npm start
```

上面三条命令适用于已完成前端与 JAR 构建后的开发验证。

可使用以下环境变量进行独立测试：`AURELI_DATA_DIR`、`AURELI_DESKTOP_PORT`、`AURELI_DATABASE_PORT`。这会改变测试应用的数据目录及端口。

发布其他架构或 PostgreSQL 主版本时，需要重新准备对应运行环境，并单独验证兼容性；已有数据库跨 PostgreSQL 主版本升级需要迁移。

## 只有 Mac 时构建 Windows 安装包

项目提供 `.github/workflows/windows-installer.yml`，名称为 **Windows installer**。它只在手动点击后运行。

1. 将应用源码和本次新增的打包文件提交、推送到 GitHub 仓库的默认分支。不要上传 `node_modules`、`desktop/resources`、用户数据库、密码或本机环境配置。
2. 在 GitHub 仓库打开 **Actions → Windows installer → Run workflow**。
3. 等待任务通过，打开该次运行，在 **Artifacts** 中下载 **Aureli-Windows-x64**。
4. 解压下载的 ZIP，将里面的 `Aureli-Setup-0.13.0-x64.exe` 交给 Windows 用户安装。

工作流在 GitHub 的 Windows x64 机器上准备 Java 21 运行环境，使用该机器自带的 PostgreSQL 17 编译 pgvector 0.8.6，并复制所需的 Microsoft CRT DLL。接着构建前端、后端和 NSIS 安装包，验证内置数据库创建、持久化及正常退出。测试还会对打包后的资源执行一次。Mac 版 Java 和 Postgres.app 不会进入 Windows 安装包。

后端打包前会在临时目录创建独立的 PostgreSQL 测试库，使用随机端口和密码，并通过仅用于测试的 `application-ci.yml` 提供配置。Maven 测试成功或失败后都会停止该数据库；成功时删除临时数据，失败时保留日志并上传 **Aureli-Windows-diagnostics**。这一过程不依赖本机 `application-dev.yml` 或 Docker 数据库，测试配置不会进入发布 JAR。不要通过跳过测试来绕过数据库配置错误。

Windows 与 Mac 都使用由 `frontend/public/favicon.svg` 转换的 `build/icon.png` 图标。Windows 安装包的数据库是全新创建的，用户数据默认保存在 `%APPDATA%\Aureli\`，卸载时保留用户数据。AI 模型需要另外配置。

Windows 异常退出或断电后，可能留下 `postgres-data/postmaster.pid`。启动时会先用 PostgreSQL 自带的 `pg_ctl status` 检查进程；确认进程已退出后，由 PostgreSQL 在启动时校验并处理旧锁文件，继续使用原有数据库和凭据。若进程仍在运行或无法确认状态，应用会停止启动并提示检查，不会强制删除锁文件或停止其他数据库进程。不要删除整个 `postgres-data` 目录来解决启动问题。

Windows 构建目前只完成了配置、脚本和 Mac 上的兼容性验证；必须等上述 Windows 工作流实际成功后，才能确认 `.exe` 构建通过。工作流不自动发布 GitHub Release，当前未配置 Windows 代码签名。正式发布前还需在目标 Windows 电脑上验证安装和首次启动。

## 在 Windows 电脑本地构建

准备 Node 24、JDK 21、Maven、PostgreSQL（包括匹配主版本的 pgvector 和 uuid-ossp），以及 Visual Studio x64 CRT 可分发 DLL。设置以下环境变量后，在 `desktop` 中运行 `npm ci`、`npm run dist:win`：

```powershell
$env:AURELI_JAVA_SOURCE = 'C:\runtimes\java-21'
$env:AURELI_POSTGRES_SOURCE = 'C:\Program Files\PostgreSQL\17'
$env:AURELI_VC_REDIST_SOURCE = 'C:\path\to\Microsoft.VC143.CRT'
npm ci
npm run dist:win
```

`AURELI_JAVA_SOURCE` 也可以指向完整的 Windows x64 JDK 21；工作流使用 jlink 生成较小的运行环境。输出位于 `desktop/dist/windows/`，其中 `Aureli-Setup-版本-x64.exe` 是供用户安装的文件，`win-unpacked/` 仅用于开发验证。该入口需要 Windows 环境；Mac 用户使用上述 GitHub Actions 流程。
