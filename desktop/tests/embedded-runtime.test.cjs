const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { pathToFileURL } = require("node:url");
const { PostgresRuntime } = require("../postgres.cjs");
const { BackendRuntime } = require("../backend.cjs");
const { executableName, developmentResources } = require("../runtime-paths.cjs");

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test("bundled Java and PostgreSQL initialize, persist and shut down together", { timeout: 180000 }, async (t) => {
  const desktopRoot = path.resolve(__dirname, "..");
  const resourcesRoot = process.env.AURELI_TEST_RESOURCES || developmentResources(desktopRoot);
  const dataRoot = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP || os.tmpdir(), "aureli-embedded-test-"));
  // A machine's legacy client encoding must not change SQL input or output.
  const previousEncoding = process.env.PGCLIENTENCODING;
  process.env.PGCLIENTENCODING = "LATIN1";
  t.after(() => {
    if (previousEncoding === undefined) delete process.env.PGCLIENTENCODING;
    else process.env.PGCLIENTENCODING = previousEncoding;
  });
  const databasePort = await freePort();
  let backendPort = await freePort();
  while (backendPort === databasePort) backendPort = await freePort();
  let database;
  let backend;
  let passed = false;
  t.after(async () => {
    try { await backend?.stop(); }
    finally { await database?.stop(); }
    if (passed) fs.rmSync(dataRoot, { recursive: true, force: true });
    else console.error(`Integration failure. Diagnostic logs: ${dataRoot}/logs`);
  });

  database = new PostgresRuntime({ resourcesRoot, dataRoot, port: databasePort });
  const connection = await database.start();
  assert.ok(connection.url.endsWith(`:${databasePort}/robot`));
  if (process.platform !== "win32") assert.equal(fs.statSync(database.passwordPath).mode & 0o777, 0o600);
  const extensions = await database.sql("SELECT extname FROM pg_extension WHERE extname IN ('vector', 'uuid-ossp') ORDER BY extname", "robot");
  assert.equal(extensions.stdout.replaceAll("\r", "").trim(), "uuid-ossp\nvector");
  const listen = await database.sql("SHOW listen_addresses");
  assert.equal(listen.stdout.trim(), "127.0.0.1");
  assert.equal((await database.sql("SHOW client_encoding")).stdout.trim(), "UTF8");
  const occupied = new PostgresRuntime({ resourcesRoot, dataRoot, port: databasePort });
  await assert.rejects(occupied.start(), /已被占用/);
  await occupied.stop();
  await database.sql("SELECT 1"); // A conflicting instance must not stop the owner.

  backend = new BackendRuntime({
    projectRoot: path.resolve(desktopRoot, ".."), port: backendPort,
    jarPath: path.join(resourcesRoot, "backend", "aureli.jar"),
    javaPath: path.join(resourcesRoot, "java", "bin", executableName("java")),
    workDir: dataRoot, logPath: path.join(dataRoot, "logs", "backend.log"), profile: "desktop",
    env: {
      SPRING_CONFIG_ADDITIONAL_LOCATION: pathToFileURL(path.join(resourcesRoot, "config") + path.sep).href,
      AURELI_DATABASE_URL: connection.url, AURELI_DATABASE_PASSWORD: connection.password,
      AURELI_MARKDOWN_PATH: path.join(dataRoot, "Markdown"),
      AURELI_MODEL_SETTINGS_PATH: path.join(dataRoot, "config", "model-api-settings.json"),
    },
  });
  const url = await backend.start();
  const response = await fetch(`${url}/customer-service/maps`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).success, true);
  const schema = await database.sql("SELECT to_regclass('t_tile'), to_regclass('t_vector_store')", "robot");
  assert.equal(schema.stdout.trim(), "t_tile|t_vector_store");
  await database.sql("CREATE TABLE desktop_persistence_check(value text); INSERT INTO desktop_persistence_check VALUES ('中文数据已保留');", "robot");
  // ASCII hex output distinguishes corrupted stored bytes from display problems.
  const stored = await database.sql("SELECT encode(convert_to(value, 'UTF8'), 'hex') FROM desktop_persistence_check", "robot");
  assert.equal(stored.stdout.trim(), Buffer.from("中文数据已保留", "utf8").toString("hex"));
  const password = connection.password;
  await backend.stop();
  assert.ok(backend.child.exitCode !== null || backend.child.signalCode !== null);
  await database.stop();
  if (process.platform !== "win32") assert.ok(database.child.exitCode !== null || database.child.signalCode !== null);
  assert.equal(fs.existsSync(path.join(database.dataDir, "postmaster.pid")), false);

  database = new PostgresRuntime({ resourcesRoot, dataRoot, port: databasePort });
  assert.equal((await database.start()).password, password);
  const preserved = await database.sql("SELECT value FROM desktop_persistence_check", "robot");
  assert.equal(preserved.stdout.trim(), "中文数据已保留");
  passed = true;
});
