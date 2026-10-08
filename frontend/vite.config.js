import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
export default defineConfig({
  plugins: [vue()],
  base: "./",
  server: { proxy: { "/customer-service": "http://localhost:8080" } },
  build: {
    outDir: "../src/main/resources/static",
    emptyOutDir: false,
    assetsDir: "vue-assets",
  },
});
