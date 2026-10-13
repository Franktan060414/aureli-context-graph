const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const run = promisify(execFile);

test("desktop restarts load the current UI despite a cached entry page and preserve local preferences",
  { timeout: 60000 }, async (t) => {
    const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aureli-page-cache-"));
    t.after(() => fs.rmSync(dataRoot, { recursive: true, force: true }));
    let currentPage = "old-ui";
    let requests = 0;
    // Match the bundled backend: Last-Modified without an explicit cache policy.
    const modified = new Date(Date.now() - 2 * 86400000).toUTCString();
    const server = http.createServer((request, response) => {
      requests++;
      response.setHeader("Last-Modified", modified);
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      if (request.headers["if-modified-since"] === modified) {
        response.writeHead(304);
        response.end();
      } else response.end(`<!doctype html><html><body>${currentPage}</body></html>`);
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const url = `http://127.0.0.1:${server.address().port}/`;
    const electron = require("electron");
    const fixture = path.join(__dirname, "fixtures", "page-cache.cjs");
    async function launch(baseline) {
      const env = {
        ...process.env, AURELI_DATA_DIR: dataRoot,
        AURELI_CACHE_TEST_URL: url, AURELI_CACHE_TEST_BASELINE: baseline ? "1" : "0",
      };
      delete env.ELECTRON_RUN_AS_NODE;
      delete env.AURELI_DESKTOP_DEV;
      await run(electron, [fixture], { env, timeout: 15000 });
      return JSON.parse(fs.readFileSync(path.join(dataRoot, "result.json")));
    }
    assert.deepEqual(await launch(true), { page: "old-ui", saved: null });
    currentPage = "new-ui";
    assert.deepEqual(await launch(true), { page: "old-ui", saved: "keep-layout" },
      "control must reproduce an old page surviving an app restart");
    const before = requests;
    assert.deepEqual(await launch(false), { page: "new-ui", saved: "keep-layout" });
    assert.ok(requests > before, "the fixed app must request the current page");
    currentPage = "newer-ui";
    assert.deepEqual(await launch(false), { page: "newer-ui", saved: "keep-layout" },
      "the next ordinary restart must also bypass the persisted old page");
  });
