import type { Plugin } from 'vite';
import { handleApiRequest } from './convert-http.ts';

/**
 * Sirve todas las rutas de /api en el mismo origen que la interfaz:
 * - `npm run dev`     → configureServer
 * - `npm run preview` → configurePreviewServer
 * Rutas: /api/convert (legado, MP3), /api/fetch-audio, /api/match, /api/spotify/playlist.
 */
export function convertApiPlugin(): Plugin {
  const mount = (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse): void => {
    // connect ya quitó el prefijo '/api'; el router espera la ruta completa.
    req.url = `/api${req.url ?? ''}`;
    void handleApiRequest(req, res);
  };
  return {
    name: 'musical-system-api',
    configureServer(server) {
      server.middlewares.use('/api', (req, res) => {
        mount(req, res);
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api', (req, res) => {
        mount(req, res);
      });
    },
  };
}
