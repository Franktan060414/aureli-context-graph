const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const net = require("node:net");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const run = promisify(execFile);
const launcher = path.resolve(__dirname, "../scripts/dev.cjs");
const defaults = { AURELI_DEV_FRONTEND_PORT: "5174", AURELI_DESKTOP_PORT: "18081", AURELI_DATABASE_PORT: "54330" };

async function rejectsBeforeStartingServices(overrides, message) {
  await assert.rejects(run(process.execPath, [launcher], {
    env: { ...process.env, ...defaults, ...overrides }, timeout: 10000,
  }), (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, message);
    assert.doesNotMatch(error.stdout, /正在编译|正在启动|正在打开/);
    return true;
  });
}

test("desktop development rejects invalid ports before compiling or starting services", async () => {
  await rejectsBeforeStartingServices({ AURELI_DEV_FRONTEND_PORT: "invalid" }, /AURELI_DEV_FRONTEND_PORT/);
});

test("desktop development rejects shared frontend, backend and database ports", async () => {
  await rejectsBeforeStartingServices({ AURELI_DESKTOP_PORT: "5174" }, /不同的端口/);
});

test("desktop development leaves an existing port owner running", async (t) => {
  const server = net.createServer((socket) => socket.end("existing service"));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const port = server.address().port;
  await rejectsBeforeStartingServices({ AURELI_DEV_FRONTEND_PORT: String(port) }, /已被占用/);
  const reply = await new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1");
    let text = "";
    socket.on("data", (data) => { text += data; });
    socket.on("end", () => resolve(text));
    socket.on("error", reject);
  });
  assert.equal(reply, "existing service");
});
