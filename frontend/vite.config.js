import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
export default defineConfig({
  plugins: [vue()],
  base: "./",
  server: { proxy: { "/customer-service": process.env.AURELI_DEV_BACKEND_URL || "http://localhost:8080" } },
  build: {
    outDir: "../src/main/resources/static",
    emptyOutDir: false,
    assetsDir: "vue-assets",
  },
});
