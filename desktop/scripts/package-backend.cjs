const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");
const { PostgresRuntime } = require("../postgres.cjs");

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function packageBackend() {
  const postgresRoot = process.env.AURELI_POSTGRES_SOURCE || process.env.PGROOT;
  if (!postgresRoot) throw new Error("请设置 AURELI_POSTGRES_SOURCE，指向含 pgvector 的 PostgreSQL 程序目录。");
  const dataRoot = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP || os.tmpdir(), "aureli-maven-"));
  const database = new PostgresRuntime({ postgresRoot, dataRoot, port: await freePort() });
  let passed = false;
  try {
    const connection = await database.start();
    console.log("已启动独立的临时 PostgreSQL，使用 ci 配置执行后端测试和 JAR 打包。");
    await new Promise((resolve, reject) => {
      const windows = process.platform === "win32";
      const child = spawn(windows ? "cmd.exe" : "mvn",
        windows ? ["/d", "/s", "/c", "mvn.cmd package"] : ["package"], {
          cwd: path.resolve(__dirname, "../.."), stdio: "inherit", windowsHide: true,
          env: {
            ...process.env,
            SPRING_PROFILES_ACTIVE: "ci",
            // Load only classpath configuration, never machine-specific external files.
            SPRING_CONFIG_LOCATION: "classpath:/",
            AURELI_CI_DATABASE_URL: connection.url,
            AURELI_CI_DATABASE_PASSWORD: connection.password,
            AURELI_CI_MARKDOWN_PATH: path.join(dataRoot, "Markdown"),
            AURELI_CI_MODEL_SETTINGS_PATH: path.join(dataRoot, "config", "model-api-settings.json"),
          },
        });
      child.once("error", reject);
      child.once("exit", (code, signal) => {
        if (code === 0) resolve();
        else reject(new Error(`Maven 打包失败（${signal || code}），请查看 target/surefire-reports。`));
      });
    });
    passed = true;
  } finally {
    await database.stop();
    if (passed) fs.rmSync(dataRoot, { recursive: true, force: true });
    else console.error(`临时测试库已停止，诊断日志保留在：${path.join(dataRoot, "logs")}`);
  }
}

module.exports = { packageBackend };
if (require.main === module) {
  packageBackend().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
