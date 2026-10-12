const { app, BrowserWindow, dialog } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");
const { BackendRuntime, findJava } = require("./backend.cjs");
const { PostgresRuntime } = require("./postgres.cjs");
const { executableName, developmentResources } = require("./runtime-paths.cjs");

let backend;
let database;
let backendUrl;
let quitting = false;
let mayQuit = false;
const development = !app.isPackaged && process.env.AURELI_DESKTOP_DEV === "1";
const frontendUrl = development ? process.env.AURELI_DEV_FRONTEND_URL : undefined;
if (development && (!frontendUrl || !process.env.AURELI_DEV_CLASSPATH)) {
  throw new Error("请通过 desktop 目录中的 npm run dev 启动桌面开发版。");
}

app.setName(development ? "Aureli Dev" : "Aureli");
// Allows isolated installation checks without touching the user's actual workspace.
if (process.env.AURELI_DATA_DIR || development) {
  const dataRoot = path.resolve(process.env.AURELI_DATA_DIR || path.join(app.getPath("appData"), "Aureli-dev"));
  fs.mkdirSync(dataRoot, { recursive: true, mode: 0o700 });
  app.setPath("userData", dataRoot);
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1400,
    height: 900,
    title: development ? "Aureli · 开发版" : "Aureli",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  if (development) window.on("page-title-updated", (event) => event.preventDefault());

  const windowUrl = frontendUrl || backendUrl;
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (new URL(url).origin !== new URL(windowUrl).origin) event.preventDefault();
  });
  window.loadURL(windowUrl).catch(() => {
    if (!quitting) {
      dialog.showErrorBox("工作台加载失败", `请退出应用后重新启动，并检查 ${backend.logPath}。`);
      app.quit();
    }
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const window = BrowserWindow.getAllWindows()[0];
    if (window) {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    }
  });

  app.whenReady().then(async () => {
    try {
      const resourcesRoot = app.isPackaged ? process.resourcesPath : developmentResources(__dirname);
      const dataRoot = app.getPath("userData");
      const onUnexpectedExit = (error) => {
        if (!quitting) {
          dialog.showErrorBox("本地服务已停止", error.message);
          app.quit();
        }
      };
      database = new PostgresRuntime({
        resourcesRoot, dataRoot,
        port: Number(process.env.AURELI_DATABASE_PORT || (development ? 54330 : 54329)),
        onUnexpectedExit,
      });
      console.log("正在启动内置 PostgreSQL…");
      const connection = await database.start();
      if (quitting) return;
      backend = new BackendRuntime({
        projectRoot: path.resolve(__dirname, ".."),
        port: Number(process.env.AURELI_DESKTOP_PORT || (development ? 18081 : 18080)),
        jarPath: path.join(resourcesRoot, "backend", "aureli.jar"),
        classPath: development ? process.env.AURELI_DEV_CLASSPATH : undefined,
        javaPath: development ? findJava() : path.join(resourcesRoot, "java", "bin", executableName("java")),
        workDir: dataRoot,
        logPath: path.join(dataRoot, "logs", "backend.log"),
        profile: "desktop",
        env: {
          SPRING_CONFIG_ADDITIONAL_LOCATION: pathToFileURL(path.join(development ? __dirname : resourcesRoot, "config") + path.sep).href,
          AURELI_DATABASE_URL: connection.url,
          AURELI_DATABASE_PASSWORD: connection.password,
          AURELI_MARKDOWN_PATH: path.join(dataRoot, "Markdown"),
          AURELI_MODEL_SETTINGS_PATH: path.join(dataRoot, "config", "model-api-settings.json"),
        },
        onUnexpectedExit,
      });
      console.log("正在启动 Aureli 后端…");
      backendUrl = await backend.start();
      if (!quitting) {
        console.log(`Aureli 后端已就绪：${backendUrl}`);
        if (development) console.log(`开发版数据目录：${dataRoot}`);
        createWindow();
      }
    } catch (error) {
      if (!quitting) {
        dialog.showErrorBox("Aureli 启动失败", error.message);
        app.quit();
      }
    }
  });

  app.on("activate", () => {
    if (backendUrl && !quitting && BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
}

app.on("before-quit", (event) => {
  if (mayQuit || (!backend && !database)) return;
  event.preventDefault();
  if (quitting) return;
  quitting = true;
  (async () => {
    try { await backend?.stop(); }
    finally { await database?.stop(); }
  })().finally(() => {
    mayQuit = true;
    app.quit();
  });
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => app.quit());
}

if (development) {
  process.on("message", (message) => {
    if (message === "aureli:quit") app.quit();
  });
  process.on("disconnect", () => app.quit());
}

app.on("window-all-closed", () => {
  if (development || process.platform !== "darwin") app.quit();
});
