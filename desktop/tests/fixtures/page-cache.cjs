const { app, BrowserWindow, session } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

if (process.env.AURELI_CACHE_TEST_BASELINE === "1") {
  app.setPath("userData", process.env.AURELI_DATA_DIR);
} else {
  // Exercise the real startup policy without starting PostgreSQL or the backend.
  const quit = app.quit;
  const lock = app.requestSingleInstanceLock;
  app.quit = () => {};
  app.requestSingleInstanceLock = () => false;
  require(process.env.AURELI_CACHE_TEST_MAIN || "../../main.cjs");
  app.quit = quit;
  app.requestSingleInstanceLock = lock;
}

app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  await window.loadURL(process.env.AURELI_CACHE_TEST_URL);
  const result = await window.webContents.executeJavaScript(`(() => {
    const saved = localStorage.getItem('aureli-cache-test-layout');
    if (saved === null) localStorage.setItem('aureli-cache-test-layout', 'keep-layout');
    return { page: document.body.textContent.trim(), saved };
  })()`);
  session.defaultSession.flushStorageData();
  fs.writeFileSync(path.join(process.env.AURELI_DATA_DIR, "result.json"), JSON.stringify(result));
  app.quit();
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
