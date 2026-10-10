const path = require("node:path");
const { execFileSync } = require("node:child_process");

const desktopRoot = path.resolve(__dirname, "..");
const projectRoot = path.resolve(desktopRoot, "..");
const { version } = require("../package.json");

try {
  if (process.platform !== "darwin" || process.arch !== "arm64") {
    throw new Error("当前安装包使用 Apple Silicon Java 运行环境，请在 arm64 Mac 上构建。");
  }
  execFileSync("npm", ["run", "build"], { cwd: path.join(projectRoot, "frontend"), stdio: "inherit" });
  execFileSync("mvn", ["package"], { cwd: projectRoot, stdio: "inherit" });
  execFileSync("npm", ["run", "prepare:desktop"], { cwd: desktopRoot, stdio: "inherit" });
  execFileSync("npm", ["test"], { cwd: desktopRoot, stdio: "inherit" });
  execFileSync(path.join(desktopRoot, "node_modules", ".bin", "electron-builder"),
    ["--config", "electron-builder.json", "--mac", "dmg", "--arm64", "--publish", "never"],
    {
      cwd: desktopRoot, stdio: "inherit",
      env: {
        ...process.env,
        ELECTRON_BUILDER_BINARIES_MIRROR: process.env.ELECTRON_BUILDER_BINARIES_MIRROR
          || "https://npmmirror.com/mirrors/electron-builder-binaries/",
      },
    });
  console.log(`安装包已生成：${path.join(desktopRoot, "dist", `Aureli-${version}-arm64.dmg`)}`);
} catch (error) {
  console.error("Mac 安装包构建失败：", error.message);
  process.exitCode = 1;
}
