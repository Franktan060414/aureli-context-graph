const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { assertWindowsJava21, inspectWindowsJava21 } = require("../scripts/java-runtime.cjs");
const { findJava } = require("../backend.cjs");

function settings(version = "21.0.11", os = "Windows Server 2025", arch = "amd64") {
  return `Property settings:\r\n    java.version = ${version}\r\n    os.arch = ${arch}\r\n    os.name = ${os}\r\n\r\nopenjdk version "${version}"\r\n`;
}

test("accepts Java 21 Windows x64 properties without release-file metadata", () => {
  assert.deepEqual(assertWindowsJava21(settings()), {
    version: "21.0.11", os: "Windows Server 2025", arch: "amd64",
  });
  assert.equal(assertWindowsJava21(settings("21", "Windows 11", "x86_64")).version, "21");
});

test("rejects other Java versions, operating systems, architectures and missing settings", () => {
  for (const output of [settings("17.0.11"), settings("25.0.1"), settings("21-ea"),
    settings("21.0.11", "Mac OS X"), settings("21.0.11", "Linux"),
    settings("21.0.11", "Windows 11", "aarch64"), settings("21.0.11", "Windows 11", "x86"),
    'JAVA_VERSION="21.0.11"\nMODULES="java.base"\n']) {
    assert.throws(() => assertWindowsJava21(output), /应用需要 Windows x64 Java 21/);
  }
});

test("reads settings from the actual Java executable", () => {
  if (process.platform === "win32") {
    const java = process.env.AURELI_JAVA_SOURCE
      ? path.join(process.env.AURELI_JAVA_SOURCE, "bin", "java.exe") : findJava();
    assert.match(inspectWindowsJava21(java).version, /^21(?:\.|$)/);
  } else {
    assert.throws(() => inspectWindowsJava21(findJava()), /检测到 Java=.*OS=.*ARCH=/);
  }
});
