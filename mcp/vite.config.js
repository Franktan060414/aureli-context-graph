import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { resolve } from 'node:path';
export default defineConfig(({ mode }) => ({ plugins: [vue(), viteSingleFile()],
  build: { target: 'es2022', emptyOutDir: mode !== 'host',
    rollupOptions: { input: resolve(mode === 'host' ? 'host.html' : 'index.html') } } }));
