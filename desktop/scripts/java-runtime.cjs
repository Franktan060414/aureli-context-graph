const { spawnSync } = require("node:child_process");

function assertWindowsJava21(output) {
  const properties = Object.fromEntries([...output.matchAll(
    /^\s*(java\.version|os\.arch|os\.name)\s*=\s*([^\r\n]+)\s*$/gm,
  )].map((match) => [match[1], match[2].trim()]));
  const version = properties["java.version"] || "未知";
  const arch = properties["os.arch"] || "未知";
  const os = properties["os.name"] || "未知";
  if (!/^21(?:\.|\+|$)/.test(version) || !/^(amd64|x86_64)$/.test(arch) || !/^Windows(?:\s|$)/.test(os)) {
    throw new Error(`应用需要 Windows x64 Java 21 运行环境；检测到 Java=${version}, OS=${os}, ARCH=${arch}。`);
  }
  return { version, arch, os };
}

function inspectWindowsJava21(executable) {
  // jlink's release file may contain only JAVA_VERSION and MODULES, without OS_ARCH.
  const result = spawnSync(executable, ["-XshowSettings:properties", "-version"], {
    encoding: "utf8", windowsHide: true, timeout: 15000,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`无法启动 Java 运行环境：${executable}（${result.error?.message || result.signal || result.status}）。`);
  }
  return assertWindowsJava21(`${result.stdout}\n${result.stderr}`);
}

module.exports = { assertWindowsJava21, inspectWindowsJava21 };
