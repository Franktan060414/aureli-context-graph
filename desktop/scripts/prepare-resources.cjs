const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { findJar } = require("../backend.cjs");

const desktopRoot = path.resolve(__dirname, "..");
const resources = path.join(desktopRoot, "resources");
const source = process.env.AURELI_POSTGRES_SOURCE || "/Applications/Postgres.app/Contents/Versions/18";
const destination = path.join(resources, "postgres");

try {
  execFileSync(path.join(resources, "java", "bin", "java"), ["-version"], { stdio: "ignore" });
  for (const name of ["bin/postgres", "bin/initdb", "bin/psql", "lib/postgresql/vector.dylib", "share/postgresql/extension/vector.control"]) {
    if (!fs.existsSync(path.join(source, name))) throw new Error(`PostgreSQL 源目录缺少 ${name}`);
  }
  // Preserve relative dylib symlinks; do not rewrite them to the developer's installation path.
  // Copy to a fresh staging directory: copying over existing dylib symlinks is not reliable.
  const staging = fs.mkdtempSync(path.join(resources, ".postgres-stage-"));
  try {
    const stagedPostgres = path.join(staging, "postgres");
    fs.cpSync(source, stagedPostgres, { recursive: true, dereference: false, verbatimSymlinks: true });
    // This directory contains generated executable resources only, never database data.
    fs.rmSync(destination, { recursive: true, force: true });
    fs.renameSync(stagedPostgres, destination);
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
  execFileSync(path.join(destination, "bin", "postgres"), ["--version"], { stdio: "inherit" });
  fs.cpSync(path.join(desktopRoot, "config"), path.join(resources, "config"), { recursive: true });
  const backendDir = path.join(resources, "backend");
  fs.mkdirSync(backendDir, { recursive: true });
  const jar = path.join(backendDir, "aureli.jar");
  fs.copyFileSync(findJar(path.resolve(desktopRoot, "..")), jar);
  // Distribution must not include machine-specific development credentials or paths.
  const entries = execFileSync("/usr/bin/zipinfo", ["-1", jar], { encoding: "utf8" }).split("\n");
  const privateProfiles = entries.filter((entry) =>
    /^BOOT-INF\/classes\/application-(dev|prod|local[^/]*|profile\.example)\.ya?ml$/.test(entry));
  if (privateProfiles.length) execFileSync("/usr/bin/zip", ["-q", "-d", jar, ...privateProfiles]);
  console.log("内置 Java、PostgreSQL、pgvector 和发布用 JAR 已准备好。");
} catch (error) {
  console.error("准备应用资源失败：", error.message);
  process.exitCode = 1;
}
