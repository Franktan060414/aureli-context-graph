const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { setTimeout: delay } = require("node:timers/promises");
const { checkPort, findJava } = require("../backend.cjs");
const { developmentResources, executableName } = require("../runtime-paths.cjs");

const desktopRoot = path.resolve(__dirname, "..");
const projectRoot = path.resolve(desktopRoot, "..");
const frontendRoot = path.join(projectRoot, "frontend");
const resourcesRoot = developmentResources(desktopRoot);
const children = new Set();
let stopping = false;
let electron;
let shutdown;

function port(name, fallback) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isInteger(value) || value < 1024 || value > 65535) throw new Error(`${name} 必须是 1024 到 65535 之间的端口。`);
  return value;
}

function launch(command, args, options = {}) {
  if (stopping) throw new Error("开发版启动已取消。");
  const child = spawn(command, args, { cwd: desktopRoot, stdio: "inherit", ...options });
  children.add(child);
  child.finished = new Promise((resolve) => {
    child.once("error", (error) => { child.failure = error; resolve(1); });
    child.once("exit", (code) => resolve(code ?? 1));
  }).then((code) => { children.delete(child); return code; });
  return child;
}

function stop(code = 0) {
  if (shutdown) return shutdown;
  stopping = true;
  process.exitCode = code;
  shutdown = (async () => {
    // Ask Electron to stop its owned Java and database processes before exiting.
    if (electron && children.has(electron)) {
      if (electron.connected) electron.send("aureli:quit", () => {});
      else electron.kill("SIGTERM");
      let timer;
      await Promise.race([
        electron.finished,
        new Promise((resolve) => { timer = setTimeout(() => { electron.kill("SIGKILL"); resolve(); }, 75000); }),
      ]);
      clearTimeout(timer);
    }
    for (const child of children) child.kill("SIGTERM");
    await Promise.all([...children].map((child) => child.finished));
  })();
  return shutdown;
}

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => void stop());

async function main() {
  const frontendPort = port("AURELI_DEV_FRONTEND_PORT", 5174);
  const backendPort = port("AURELI_DESKTOP_PORT", 18081);
  const databasePort = port("AURELI_DATABASE_PORT", 54330);
  if (new Set([frontendPort, backendPort, databasePort]).size !== 3) throw new Error("界面、后端和数据库必须使用不同的端口。");
  for (const value of [frontendPort, backendPort, databasePort]) await checkPort(value);
  const java = findJava();
  const viteEntry = path.join(frontendRoot, "node_modules", "vite", "bin", "vite.js");
  if (!fs.existsSync(viteEntry)) throw new Error("请先在 frontend 目录运行 npm ci。");
  for (const name of ["postgres", "initdb", "psql", "pg_ctl"]) {
    if (!fs.existsSync(path.join(resourcesRoot, "postgres", "bin", executableName(name)))) {
      throw new Error("桌面数据库运行环境尚未准备好，请按照 desktop/README.md 准备资源。");
    }
  }
  const electronPath = require("electron");
  if (!fs.existsSync(electronPath)) throw new Error("请先在 desktop 目录运行 npm ci，准备 Electron。");
  console.log("正在编译 Java 源码（不生成 JAR 或安装包）…");
  const compile = launch("mvn", ["--batch-mode", "--no-transfer-progress", "compile", "dependency:build-classpath", "-Dmdep.outputFile=target/desktop-dev-classpath.txt", "-DincludeScope=runtime"], {
    cwd: projectRoot,
    shell: process.platform === "win32",
    env: { ...process.env, ...(path.isAbsolute(java) ? { JAVA_HOME: path.dirname(path.dirname(java)) } : {}) },
  });
  const compileCode = await compile.finished;
  if (stopping) return;
  if (compileCode !== 0) throw new Error(`Java 编译失败，请检查上面的 Maven 输出。${compile.failure ? ` ${compile.failure.message}` : ""}`);
  const classPath = [path.join(projectRoot, "target", "classes"), fs.readFileSync(path.join(projectRoot, "target", "desktop-dev-classpath.txt"), "utf8").trim()].join(path.delimiter);
  const frontendUrl = `http://127.0.0.1:${frontendPort}`;
  const env = {
    ...process.env,
    AURELI_DESKTOP_DEV: "1",
    AURELI_DEV_FRONTEND_URL: frontendUrl,
    AURELI_DEV_BACKEND_URL: `http://127.0.0.1:${backendPort}`,
    AURELI_DEV_CLASSPATH: classPath,
    AURELI_DESKTOP_PORT: String(backendPort),
    AURELI_DATABASE_PORT: String(databasePort),
  };
  // A shell configured for Node-based Electron tools must still open the desktop app.
  delete env.ELECTRON_RUN_AS_NODE;
  const vite = launch(process.execPath, [viteEntry, "--host", "127.0.0.1", "--port", String(frontendPort), "--strictPort"], { cwd: frontendRoot, env });
  void vite.finished.then(() => {
    if (!stopping) { console.error("界面开发服务已退出。"); void stop(1); }
  });
  let ready = false;
  for (let attempt = 0; attempt < 100 && !stopping; attempt++) {
    try {
      const response = await fetch(`${frontendUrl}/@vite/client`, { signal: AbortSignal.timeout(500) });
      if (response.ok) { ready = true; break; }
    } catch { /* Wait for Vite to bind its local port. */ }
    await delay(200);
  }
  if (stopping) return;
  if (!ready) throw new Error("界面开发服务启动超时。");
  console.log("正在打开 Aureli 开发版。界面保存后自动更新；后端修改后重新运行 npm run dev。关闭开发版窗口可退出全部服务。");
  electron = launch(electronPath, [desktopRoot], { env, stdio: ["inherit", "inherit", "inherit", "ipc"] });
  const code = await electron.finished;
  if (electron.failure) console.error(`桌面窗口未能启动：${electron.failure.message}`);
  await stop(code);
}

main().catch(async (error) => {
  console.error(`桌面开发版启动失败：${error.message}`);
  await stop(1);
});
