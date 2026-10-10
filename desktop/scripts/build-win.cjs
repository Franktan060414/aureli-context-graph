const path = require("node:path");
const { execFileSync } = require("node:child_process");
const desktopRoot = path.resolve(__dirname, "..");
const projectRoot = path.resolve(desktopRoot, "..");
const { version } = require("../package.json");

function npm(args, cwd) {
  // Calling the JS entry point avoids Windows .cmd quoting and spawn errors.
  if (!process.env.npm_execpath) throw new Error("请通过 npm run dist:win 运行此脚本。");
  execFileSync(process.execPath, [process.env.npm_execpath, ...args], { cwd, stdio: "inherit" });
}

try {
  if (process.platform !== "win32" || process.arch !== "x64") {
    throw new Error("此入口需要 Windows x64；只有 Mac 时请运行 Windows installer GitHub Actions 工作流。");
  }
  npm(["ci"], path.join(projectRoot, "frontend"));
  npm(["run", "build"], path.join(projectRoot, "frontend"));
  execFileSync("cmd.exe", ["/d", "/s", "/c", "mvn.cmd package"], { cwd: projectRoot, stdio: "inherit" });
  npm(["run", "prepare:win"], desktopRoot);
  npm(["test"], desktopRoot);
  execFileSync(process.execPath, [require.resolve("electron-builder/cli.js"),
    "--config", "electron-builder-win.json", "--win", "nsis", "--x64", "--publish", "never"],
    { cwd: desktopRoot, stdio: "inherit" });
  // Verify the actual resources after packaging and relocation, too.
  execFileSync(process.execPath, ["--test", "tests/embedded-runtime.test.cjs"], {
    cwd: desktopRoot, stdio: "inherit",
    env: { ...process.env, AURELI_TEST_RESOURCES: path.join(desktopRoot, "dist", "windows", "win-unpacked", "resources") },
  });
  console.log(`安装包已生成：${path.join(desktopRoot, "dist", "windows", `Aureli-Setup-${version}-x64.exe`)}`);
} catch (error) {
  console.error("Windows 安装包构建失败：", error.message);
  process.exitCode = 1;
}
