const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const AdmZip = require("adm-zip");
const { findJar } = require("../backend.cjs");
const { developmentResources } = require("../runtime-paths.cjs");
const { inspectWindowsJava21 } = require("./java-runtime.cjs");

const desktopRoot = path.resolve(__dirname, "..");
const resources = developmentResources(desktopRoot, "win32", "x64");

function copyRuntime(source, destination, filter = () => true) {
  if (path.resolve(source) === path.resolve(destination)) return;
  if (path.resolve(source).startsWith(path.resolve(destination) + path.sep)) {
    throw new Error("运行环境源目录不能放在生成目录内部。");
  }
  const staging = fs.mkdtempSync(path.join(resources, ".runtime-stage-"));
  try {
    const prepared = path.join(staging, "runtime");
    fs.cpSync(source, prepared, { recursive: true, filter });
    // Generated executables only; user's database is outside this directory.
    fs.rmSync(destination, { recursive: true, force: true });
    fs.renameSync(prepared, destination);
  } finally { fs.rmSync(staging, { recursive: true, force: true }); }
}

try {
  if (process.platform !== "win32" || process.arch !== "x64") {
    throw new Error("请在 Windows x64 环境运行；只有 Mac 时请使用 Windows installer GitHub Actions 工作流。");
  }
  const javaSource = process.env.AURELI_JAVA_SOURCE || process.env.JAVA_HOME;
  const postgresSource = process.env.AURELI_POSTGRES_SOURCE || process.env.PGROOT;
  if (!javaSource || !postgresSource) {
    throw new Error("请设置 AURELI_JAVA_SOURCE 和 AURELI_POSTGRES_SOURCE，分别指向 Windows Java 21 与含 pgvector 的 PostgreSQL。");
  }
  const java = inspectWindowsJava21(path.join(javaSource, "bin", "java.exe"));
  console.log(`Java 运行环境校验通过：${java.version}, ${java.os}, ${java.arch}`);
  for (const name of ["bin/postgres.exe", "bin/initdb.exe", "bin/psql.exe", "bin/pg_ctl.exe",
    "lib/vector.dll", "share/extension/vector.control", "lib/uuid-ossp.dll", "share/extension/uuid-ossp.control"]) {
    if (!fs.existsSync(path.join(postgresSource, name))) throw new Error(`Windows PostgreSQL 源目录缺少 ${name}`);
  }
  fs.mkdirSync(resources, { recursive: true });
  copyRuntime(javaSource, path.join(resources, "java"));
  // Never include a source installation's existing databases or administration GUI.
  copyRuntime(postgresSource, path.join(resources, "postgres"), (entry) => {
    const first = path.relative(postgresSource, entry).split(path.sep)[0].toLowerCase();
    return !["data", "logs", "log", "pgadmin 4", "pgadmin4", "doc"].includes(first);
  });
  const crt = process.env.AURELI_VC_REDIST_SOURCE;
  if (!crt) throw new Error("请设置 AURELI_VC_REDIST_SOURCE，指向 Visual Studio x64 CRT 可分发 DLL 目录。");
  for (const name of fs.readdirSync(crt).filter(name => name.toLowerCase().endsWith(".dll"))) {
    fs.copyFileSync(path.join(crt, name), path.join(resources, "postgres", "bin", name));
  }
  execFileSync(path.join(resources, "postgres", "bin", "postgres.exe"), ["--version"], { stdio: "inherit", windowsHide: true });
  fs.cpSync(path.join(desktopRoot, "config"), path.join(resources, "config"), { recursive: true });
  const backendDir = path.join(resources, "backend");
  fs.mkdirSync(backendDir, { recursive: true });
  const jar = new AdmZip(findJar(path.resolve(desktopRoot, "..")));
  for (const entry of jar.getEntries()) {
    if (/^BOOT-INF\/classes\/application-(dev|prod|local[^/]*|profile\.example)\.ya?ml$/.test(entry.entryName)) {
      jar.deleteFile(entry.entryName);
    }
  }
  jar.writeZip(path.join(backendDir, "aureli.jar"));
  console.log("Windows Java 21、PostgreSQL、pgvector、CRT 和发布用 JAR 已准备好。");
} catch (error) {
  console.error("准备 Windows 应用资源失败：", error.message);
  process.exitCode = 1;
}
