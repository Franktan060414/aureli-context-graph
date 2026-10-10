const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn, execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { setTimeout: delay } = require("node:timers/promises");
const { checkPort } = require("./backend.cjs");
const { executableName } = require("./runtime-paths.cjs");
const run = promisify(execFile);

class PostgresRuntime {
  constructor({ resourcesRoot, postgresRoot, dataRoot, port = 54329, onUnexpectedExit = () => {} }) {
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("数据库端口无效。");
    this.bin = path.join(postgresRoot || path.join(resourcesRoot, "postgres"), "bin");
    this.dataRoot = dataRoot;
    this.dataDir = path.join(dataRoot, "postgres-data");
    this.passwordPath = path.join(dataRoot, "config", "database-password");
    this.logPath = path.join(dataRoot, "logs", "postgres.log");
    this.port = port;
    this.onUnexpectedExit = onUnexpectedExit;
    this.stopping = false;
    this.ready = false;
    this.failure = null;
  }

  tool(name, args, database = "postgres") {
    return run(path.join(this.bin, executableName(name)), args, {
      cwd: this.dataRoot, timeout: 20000, maxBuffer: 1024 * 1024,
      windowsHide: true,
      env: { ...process.env, PGHOST: "127.0.0.1", PGPORT: String(this.port),
        PGUSER: "aureli", PGPASSWORD: this.password, PGDATABASE: database, PGCONNECT_TIMEOUT: "2" },
    });
  }

  sql(query, database = "postgres") {
    return this.tool("psql", ["-X", "-w", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", query], database);
  }

  async startWindowsPostgres() {
    const pidPath = path.join(this.dataDir, "postmaster.pid");
    if (fs.existsSync(pidPath)) throw new Error("数据库目录存在进程锁，请先检查之前的数据库是否仍在运行。");
    try {
      // pg_ctl starts Windows PostgreSQL with a restricted token, including on an elevated build runner.
      await run(path.join(this.bin, "pg_ctl.exe"), [
        "-D", this.dataDir, "-l", this.logPath,
        "-o", `-h 127.0.0.1 -p ${this.port}`, "-w", "-t", "30", "start",
      ], { cwd: this.dataRoot, timeout: 40000, windowsHide: true });
    } finally {
      if (fs.existsSync(pidPath)) {
        this.ownedPid = Number(fs.readFileSync(pidPath, "utf8").split(/\r?\n/)[0]);
      }
    }
    this.windowsMonitor = setInterval(() => {
      try { process.kill(this.ownedPid, 0); }
      catch {
        clearInterval(this.windowsMonitor);
        this.failure = new Error(`内置数据库已停止，请检查 ${this.logPath}`);
        if (this.ready && !this.stopping) this.onUnexpectedExit(this.failure);
      }
    }, 1000);
    this.windowsMonitor.unref();
  }

  start() {
    this.startPromise ||= this.startInner();
    return this.startPromise;
  }

  async startInner() {
    for (const name of ["postgres", "initdb", "psql", "pg_ctl"]) {
      if (!fs.existsSync(path.join(this.bin, executableName(name)))) throw new Error("内置 PostgreSQL 尚未准备好，请先准备应用资源。");
    }
    fs.mkdirSync(this.dataRoot, { recursive: true, mode: 0o700 });
    for (const name of ["config", "logs", "Markdown"]) {
      fs.mkdirSync(path.join(this.dataRoot, name), { recursive: true, mode: 0o700 });
    }
    const versionPath = path.join(this.dataDir, "PG_VERSION");
    if (fs.existsSync(versionPath) && !fs.existsSync(this.passwordPath)) {
      throw new Error("内置数据库的凭据文件缺失，请恢复 config/database-password；应用不会重新初始化已有数据库。");
    }
    if (!fs.existsSync(this.passwordPath)) {
      fs.writeFileSync(this.passwordPath, crypto.randomBytes(32).toString("hex"), { mode: 0o600, flag: "wx" });
    }
    fs.chmodSync(this.passwordPath, 0o600);
    this.password = fs.readFileSync(this.passwordPath, "utf8").trim();
    if (!/^[a-f0-9]{64}$/.test(this.password)) throw new Error("内置数据库凭据文件格式不正确。");
    await checkPort(this.port);
    if (!fs.existsSync(versionPath)) {
      if (fs.existsSync(this.dataDir) && fs.readdirSync(this.dataDir).length) {
        throw new Error("数据库目录含有未完成的初始化文件，请先备份并检查；应用不会覆盖它们。");
      }
      if (this.stopping) throw new Error("数据库启动已取消。");
      await run(path.join(this.bin, executableName("initdb")), [
        "-D", this.dataDir, "--username=aureli", "--auth=scram-sha-256",
        `--pwfile=${this.passwordPath}`, "--encoding=UTF8", "--locale=C",
      ], { cwd: this.dataRoot, timeout: 60000, maxBuffer: 1024 * 1024, windowsHide: true });
    }
    const { stdout: binaryVersion } = await run(path.join(this.bin, executableName("postgres")), ["--version"], { windowsHide: true });
    if (fs.readFileSync(versionPath, "utf8").trim() !== binaryVersion.match(/PostgreSQL\) (\d+)/)?.[1]) {
      throw new Error("数据库程序与数据目录的主版本不同，需要先迁移，不能直接替换数据库程序。");
    }
    if (this.stopping) throw new Error("数据库启动已取消。");
    if (process.platform === "win32") {
      await this.startWindowsPostgres();
    } else {
      const fd = fs.openSync(this.logPath, "a", 0o600);
      try {
        this.child = spawn(path.join(this.bin, "postgres"), [
          "-D", this.dataDir, "-h", "127.0.0.1", "-p", String(this.port), "-k", "",
        ], { cwd: this.dataRoot, stdio: ["ignore", fd, fd], shell: false });
      } finally { fs.closeSync(fd); }
      this.exited = new Promise((resolve) => {
        this.child.once("error", () => {
          this.failure = new Error(`内置数据库未能启动，请检查 ${this.logPath}`);
          resolve();
        });
        this.child.once("exit", () => {
          this.failure = new Error(`内置数据库已停止，请检查 ${this.logPath}`);
          resolve();
          if (this.ready && !this.stopping) this.onUnexpectedExit(this.failure);
        });
      });
    }
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      if (this.stopping) throw new Error("数据库启动已取消。");
      if (this.failure) throw this.failure;
      try {
        await this.sql("SELECT 1");
        break;
      } catch { await delay(300); }
    }
    if (Date.now() >= deadline) throw new Error(`数据库启动超时，请检查 ${this.logPath}`);
    const { stdout } = await this.sql("SELECT 1 FROM pg_database WHERE datname = 'robot'");
    if (stdout.trim() !== "1") await this.sql("CREATE DATABASE robot");
    await this.sql('CREATE EXTENSION IF NOT EXISTS vector; CREATE EXTENSION IF NOT EXISTS "uuid-ossp";', "robot");
    if (this.failure) throw this.failure;
    if (this.stopping) throw new Error("数据库启动已取消。");
    this.ready = true;
    return { url: `jdbc:postgresql://127.0.0.1:${this.port}/robot`, password: this.password };
  }

  stop() {
    this.stopping = true;
    this.stopPromise ||= this.stopInner();
    return this.stopPromise;
  }

  async stopInner() {
    await this.startPromise?.catch(() => {});
    if (process.platform === "win32") {
      clearInterval(this.windowsMonitor);
      if (!this.ownedPid) return;
      const pidPath = path.join(this.dataDir, "postmaster.pid");
      if (!fs.existsSync(pidPath)) return;
      const pid = Number(fs.readFileSync(pidPath, "utf8").split(/\r?\n/)[0]);
      if (pid !== this.ownedPid) throw new Error("数据库进程锁已改变，应用不会停止其他进程。");
      // Node's Windows SIGINT terminates a process; pg_ctl requests a real clean shutdown.
      await run(path.join(this.bin, executableName("pg_ctl")), [
        "-D", this.dataDir, "-m", "fast", "-w", "-t", "30", "stop",
      ], { cwd: this.dataRoot, timeout: 40000, windowsHide: true });
      this.ownedPid = null;
      return;
    }
    const child = this.child;
    if (!child || child.exitCode !== null || child.signalCode !== null || this.failure) return;
    // PostgreSQL SIGINT rolls back sessions and checkpoints before exiting.
    child.kill("SIGINT");
    await this.exited;
  }
}

module.exports = { PostgresRuntime };
