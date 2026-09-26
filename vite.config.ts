import { defineConfig } from 'vite';
import { convertApiPlugin } from './server/convert-plugin.ts';

export default defineConfig({
  base: './',
  plugins: [convertApiPlugin()],
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    // The Arena preview proxies the app through an e2b.app host.
    allowedHosts: true,
  },
  build: {
    target: 'es2022',
  },
});
