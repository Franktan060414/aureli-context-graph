const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");

// Test Windows decisions on any host, using real files and controlled pg_ctl
// responses. embedded-runtime.test.cjs also exercises native stale-lock recovery.
function fixture(t, command) {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aureli-lock-test-"));
  t.after(() => fs.rmSync(dataRoot, { recursive: true, force: true }));
  const filename = path.resolve(__dirname, "../postgres.cjs");
  const localRequire = createRequire(filename);
  const calls = [];
  const timers = new Set();
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), {
    module,
    require(name) {
      if (name !== "node:child_process") return localRequire(name);
      return {
        execFile(file, args, options, callback) {
          calls.push({ file, args, options });
          queueMicrotask(() => {
            try { command(args.at(-1), args); }
            catch (error) { callback(error, "", ""); return; }
            callback(null, "", "");
          });
        },
      };
    },
    process: { platform: "win32", kill() {} },
    setInterval() {
      const timer = { unref() {} };
      timers.add(timer);
      return timer;
    },
    clearInterval(timer) { timers.delete(timer); },
  }, { filename });
  const runtime = new module.exports.PostgresRuntime({ resourcesRoot: dataRoot, dataRoot });
  fs.mkdirSync(runtime.dataDir);
  return { runtime, pidPath: path.join(runtime.dataDir, "postmaster.pid"), calls, timers };
}

function stopped() { throw Object.assign(new Error("no server running"), { code: 3 }); }
function lock(pid, started = 1700000000) { return `${pid}\n/data/postgres\n${started}\n54329\n\n127.0.0.1\n0\nready\n`; }

test("Windows stale lock is left for PostgreSQL to recover, then stops the new owner", async (t) => {
  const oldLock = lock(11111);
  const f = fixture(t, (action) => {
    if (action === "status") stopped();
    if (action === "start") {
      assert.equal(fs.readFileSync(f.pidPath, "utf8"), oldLock);
      fs.writeFileSync(f.pidPath, lock(22222));
    }
    if (action === "stop") fs.unlinkSync(f.pidPath);
  });
  fs.writeFileSync(f.pidPath, oldLock);
  await f.runtime.startWindowsPostgres();
  assert.equal(f.runtime.ownedPid, 22222);
  await f.runtime.stop();
  assert.deepEqual(f.calls.map(c => c.args.at(-1)), ["status", "start", "stop"]);
  assert.equal(fs.existsSync(f.pidPath), false);
  assert.equal(f.timers.size, 0);
});

test("Windows refuses a live database and does not stop it during cleanup", async (t) => {
  const f = fixture(t, () => {});
  const original = lock(11111);
  fs.writeFileSync(f.pidPath, original);
  await assert.rejects(f.runtime.startWindowsPostgres(), /仍有进程正在运行/);
  await f.runtime.stop();
  assert.deepEqual(f.calls.map(c => c.args.at(-1)), ["status"]);
  assert.equal(fs.readFileSync(f.pidPath, "utf8"), original);
});

test("Windows status errors fail closed instead of assuming a stale lock", async (t) => {
  for (const code of [4, "ENOENT", "EACCES", null]) {
    const f = fixture(t, () => { throw Object.assign(new Error("status failed"), { code }); });
    fs.writeFileSync(f.pidPath, lock(11111));
    await assert.rejects(f.runtime.startWindowsPostgres(), /无法确认数据库进程状态/);
    await f.runtime.stop();
    assert.equal(f.calls.length, 1);
    assert.equal(fs.existsSync(f.pidPath), true);
  }
});

test("Windows failed launch never claims or stops an unchanged stale PID", async (t) => {
  const f = fixture(t, (action) => {
    if (action === "status") stopped();
    if (action === "start") throw new Error("launch failed");
  });
  fs.writeFileSync(f.pidPath, lock(11111));
  await assert.rejects(f.runtime.startWindowsPostgres(), /launch failed/);
  await f.runtime.stop();
  assert.equal(f.runtime.ownedPid, undefined);
  assert.deepEqual(f.calls.map(c => c.args.at(-1)), ["status", "start"]);
});

test("Windows startup timeout still cleans up the newly launched database", async (t) => {
  const f = fixture(t, (action) => {
    if (action === "start") {
      fs.writeFileSync(f.pidPath, lock(22222));
      throw new Error("startup timed out");
    }
    if (action === "stop") fs.unlinkSync(f.pidPath);
  });
  await assert.rejects(f.runtime.startWindowsPostgres(), /startup timed out/);
  assert.equal(f.runtime.ownedPid, 22222);
  await f.runtime.stop();
  assert.deepEqual(f.calls.map(c => c.args.at(-1)), ["start", "stop"]);
});

test("Windows shutdown rejects a replaced lock even when its PID is reused", async (t) => {
  const f = fixture(t, (action) => {
    if (action === "start") fs.writeFileSync(f.pidPath, lock(22222));
  });
  await f.runtime.startWindowsPostgres();
  fs.writeFileSync(f.pidPath, lock(22222, 1700000001));
  await assert.rejects(f.runtime.stop(), /进程锁已改变/);
  assert.deepEqual(f.calls.map(c => c.args.at(-1)), ["start"]);
  assert.equal(f.timers.size, 0);
});
