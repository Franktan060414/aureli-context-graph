const path = require("node:path");

function executableName(name, platform = process.platform) {
  return platform === "win32" ? `${name}.exe` : name;
}

function developmentResources(desktopRoot, platform = process.platform, arch = process.arch) {
  return platform === "win32"
    ? path.join(desktopRoot, "resources", `${platform}-${arch}`)
    : path.join(desktopRoot, "resources");
}

module.exports = { executableName, developmentResources };
