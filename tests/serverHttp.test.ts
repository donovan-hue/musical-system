import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleApiRequest } from '../server/convert-http.ts';

function createMockReqRes(method: string, url: string, body?: string, headers: Record<string, string> = {}) {
  const req = new EventEmitter() as IncomingMessage & EventEmitter;
  req.method = method;
  req.url = url;
  req.headers = { host: 'localhost', ...headers };
  req.socket = { remoteAddress: headers['x-forwarded-for'] || '127.0.0.1' } as unknown as import('node:net').Socket;

  let statusCode = 200;
  const resHeaders: Record<string, string> = {};
  let responseData = '';

  const res = {
    setHeader: (name: string, value: string) => {
      resHeaders[name.toLowerCase()] = value;
    },
    writeHead: (code: number, headers?: Record<string, string>) => {
      statusCode = code;
      if (headers) {
        for (const [k, v] of Object.entries(headers)) {
          resHeaders[k.toLowerCase()] = v;
        }
      }
    },
    end: (chunk?: string | Buffer) => {
      if (chunk) responseData += chunk.toString();
    },
    destroy: () => {},
  } as unknown as ServerResponse;

  const run = async () => {
    const promise = handleApiRequest(req, res);
    if (body !== undefined) {
      req.emit('data', Buffer.from(body));
      req.emit('end');
    }
    await promise;
    return {
      statusCode,
      headers: resHeaders,
      data: responseData,
      json: () => JSON.parse(responseData),
    };
  };

  return { run };
}

describe('Server HTTP Security & Router', () => {
  it('responde 404 para rutas desconocidas', async () => {
    const { run } = createMockReqRes('POST', '/api/desconocida', '{}');
    const res = await run();
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('NOT_FOUND');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('responde 405 si el método no es POST', async () => {
    const { run } = createMockReqRes('GET', '/api/convert');
    const res = await run();
    expect(res.statusCode).toBe(405);
    expect(res.json().error).toContain('Método no permitido');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('responde 400 si el JSON es inválido o no tiene URL', async () => {
    const { run } = createMockReqRes('POST', '/api/convert', 'esto-no-es-json');
    const res = await run();
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('BAD_URL');
  });

  it('aplica cabeceras de seguridad y Cache-Control: no-store', async () => {
    const { run } = createMockReqRes('POST', '/api/convert', JSON.stringify({}));
    const res = await run();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(res.headers['cache-control']).toContain('no-store');
  });

  it('activa 429 Rate Limit cuando una IP satura peticiones', async () => {
    const ip = '198.51.100.99';
    let lastStatus = 200;
    for (let i = 0; i < 35; i++) {
      const { run } = createMockReqRes('POST', '/api/match', JSON.stringify({ query: 'test' }), {
        'x-forwarded-for': ip,
      });
      const res = await run();
      lastStatus = res.statusCode;
      if (res.statusCode === 429) {
        expect(res.json().code).toBe('RATE_LIMIT');
        expect(res.headers['retry-after']).toBeDefined();
        break;
      }
    }
    expect(lastStatus).toBe(429);
  });
});
