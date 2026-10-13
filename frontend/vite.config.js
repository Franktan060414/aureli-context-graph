import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { readdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

// Keep the supported legacy page while removing bundles from previous builds.
const cleanOldBundles = {
  name: "aureli-clean-old-bundles",
  apply: "build",
  async writeBundle(output, bundle) {
    const currentFiles = new Set(Object.keys(bundle).map(file => resolve(output.dir, file)));
    const assetsDir = resolve(output.dir, "vue-assets");
    for (const entry of await readdir(assetsDir, { withFileTypes: true })) {
      const file = resolve(assetsDir, entry.name);
      if (entry.isFile() && !currentFiles.has(file)) await rm(file);
    }
  },
};

export default defineConfig({
  plugins: [vue(), cleanOldBundles],
  base: "./",
  server: { proxy: { "/customer-service": process.env.AURELI_DEV_BACKEND_URL || "http://localhost:8080" } },
  build: {
    outDir: "../src/main/resources/static",
    emptyOutDir: false,
    assetsDir: "vue-assets",
  },
});
