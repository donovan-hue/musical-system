import type { Plugin } from 'vite';
import { handleConvertRequest } from './convert-http.ts';

/**
 * Sirve POST /api/convert en el mismo origen que la interfaz:
 * - `npm run dev`     → configureServer
 * - `npm run preview` → configurePreviewServer
 * Así el frontend llama a una ruta relativa y no necesita URL ni proxy.
 */
export function convertApiPlugin(): Plugin {
  return {
    name: 'musical-system-api-convert',
    configureServer(server) {
      server.middlewares.use('/api/convert', (req, res) => {
        void handleConvertRequest(req, res);
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api/convert', (req, res) => {
        void handleConvertRequest(req, res);
      });
    },
  };
}
