const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const { spawn, execFileSync } = require("node:child_process");
const { setTimeout: delay } = require("node:timers/promises");
const { executableName } = require("./runtime-paths.cjs");

function findJar(projectRoot) {
  const target = path.join(projectRoot, "target");
  const jars = fs.existsSync(target)
    ? fs.readdirSync(target).filter((name) => /^aureli-graph-ai-system-.+\.jar$/.test(name))
    : [];
  if (jars.length !== 1) {
    throw new Error("请先在项目根目录运行 mvn clean package，确保 target 中只有一个应用 JAR。");
  }
  return path.join(target, jars[0]);
}

function findJava() {
  // macOS GUI applications do not inherit a terminal's Java PATH.
  if (process.platform === "darwin") {
    try {
      const home = execFileSync("/usr/libexec/java_home", ["-v", "21"], {
        encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      return path.join(home, "bin", "java");
    } catch {
      throw new Error("未找到 Java 21。当前开发阶段需要安装 Java 21，发布版本会内置运行环境。");
    }
  }
  return process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, "bin", executableName("java")) : executableName("java");
}

async function checkPort(port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", () => reject(new Error(
      `本地端口 ${port} 已被占用，请关闭占用该端口的程序，或通过 AURELI_DESKTOP_PORT 指定其他端口。`,
    )));
    server.listen(port, "127.0.0.1", () => server.close(resolve));
  });
}

class BackendRuntime {
  constructor({ projectRoot, port = 18080, jarPath, javaPath, workDir, logPath, profile = "dev", env = {}, onUnexpectedExit = () => {} }) {
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
      throw new Error("AURELI_DESKTOP_PORT 必须是 1024 到 65535 之间的端口。");
    }
    this.projectRoot = projectRoot;
    this.port = port;
    this.jarPath = jarPath;
    this.javaPath = javaPath;
    this.workDir = workDir || projectRoot;
    this.profile = profile;
    this.env = env;
    this.onUnexpectedExit = onUnexpectedExit;
    this.url = `http://127.0.0.1:${port}`;
    this.child = null;
    this.stopping = false;
    this.ready = false;
    this.failure = null;
    this.logPath = logPath || path.join(projectRoot, "desktop", "backend.log");
  }

  async start({ timeoutMs = 90000 } = {}) {
    const jar = this.jarPath || findJar(this.projectRoot);
    const java = this.javaPath || findJava();
    await checkPort(this.port);
    if (this.stopping) throw new Error("应用启动已取消。");
    const logFd = fs.openSync(this.logPath, "a", 0o600);
    try {
      this.child = spawn(java, [
        "-jar", jar,
        `--spring.profiles.active=${this.profile}`,
        "--server.address=127.0.0.1",
        `--server.port=${this.port}`,
      ], {
        cwd: this.workDir,
        env: { ...process.env, ...this.env },
        stdio: ["ignore", logFd, logFd],
        shell: false,
        windowsHide: true,
      });
    } finally {
      fs.closeSync(logFd);
    }
    this.child.once("error", () => {
      this.failure = new Error("Java 后端未能启动，请检查内置 Java 运行环境是否完整。");
    });
    this.exited = new Promise((resolve) => {
      this.child.once("exit", (code, signal) => {
        this.failure = new Error(`后端已退出（${signal || code}）。请确认 PostgreSQL 正在运行，并检查日志：${this.logPath}`);
        resolve();
        if (this.ready && !this.stopping) this.onUnexpectedExit(this.failure);
      });
      this.child.once("error", resolve);
    });

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.stopping) throw new Error("应用启动已取消。");
      if (this.failure) throw this.failure;
      try {
        const response = await fetch(`${this.url}/customer-service/model-settings`, {
          signal: AbortSignal.timeout(1500),
        });
        const result = response.ok ? await response.json() : null;
        if (result?.success === true && result.data?.chat && !this.failure && !this.stopping) {
          this.ready = true;
          return this.url;
        }
      } catch {
        // Connection refusal is expected while Spring Boot starts.
      }
      await delay(400);
    }
    throw new Error(`后端启动超时，请确认 PostgreSQL 正在运行，并检查日志：${this.logPath}`);
  }

  stop() {
    if (this.stopPromise) return this.stopPromise;
    this.stopping = true;
    this.stopPromise = this.stopChild();
    return this.stopPromise;
  }

  async stopChild() {
    const child = this.child;
    if (!child || child.exitCode !== null || child.signalCode !== null || this.failure) return;
    child.kill("SIGTERM");
    // Allow Spring Boot to finish requests before forcing this owned Java process to exit.
    let timer;
    try {
      await Promise.race([
        this.exited,
        new Promise((resolve) => {
          timer = setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 35000);
        }),
      ]);
      await this.exited;
    } finally {
      clearTimeout(timer);
    }
  }
}

module.exports = { BackendRuntime, findJar, findJava, checkPort };
