import { build } from 'vite';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('../', import.meta.url)));
await build({ mode: 'app' });
await build({ mode: 'host' });
