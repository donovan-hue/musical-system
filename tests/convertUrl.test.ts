import { describe, expect, it } from 'vitest';
import { validateConvertUrl } from '../src/util/convertUrl.js';

describe('validateConvertUrl', () => {
  it('rechaza URL vacía', () => {
    const result = validateConvertUrl('');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('Introduce');
  });

  it('rechaza solo espacios', () => {
    expect(validateConvertUrl('   ').ok).toBe(false);
  });

  it('rechaza texto que no es URL', () => {
    const result = validateConvertUrl('no es una url');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('no es válida');
  });

  it('rechaza protocolos que no son http/https', () => {
    const result = validateConvertUrl('ftp://ejemplo.com/audio.mp3');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('http');
  });

  it('acepta una URL de YouTube con espacios alrededor', () => {
    const result = validateConvertUrl('  https://www.youtube.com/watch?v=abc123  ');
    expect(result).toEqual({ ok: true, url: 'https://www.youtube.com/watch?v=abc123' });
  });

  it('acepta http y URLs sin query', () => {
    expect(validateConvertUrl('http://ejemplo.com/video').ok).toBe(true);
    expect(validateConvertUrl('https://youtu.be/x9y8z7').ok).toBe(true);
  });

  it('rechaza objetivos SSRF: localhost, loopback, IPs privadas y metadata', () => {
    expect(validateConvertUrl('http://localhost/audio.mp3').ok).toBe(false);
    expect(validateConvertUrl('http://127.0.0.1:8080/audio.mp3').ok).toBe(false);
    expect(validateConvertUrl('http://10.0.0.5/stream').ok).toBe(false);
    expect(validateConvertUrl('http://172.16.0.1/test').ok).toBe(false);
    expect(validateConvertUrl('http://192.168.1.100/song').ok).toBe(false);
    expect(validateConvertUrl('http://169.254.169.254/latest/meta-data').ok).toBe(false);
    expect(validateConvertUrl('http://[::1]/secret').ok).toBe(false);
    expect(validateConvertUrl('http://service.internal/audio').ok).toBe(false);
  });

  it('rechaza URLs con credenciales embebidas', () => {
    expect(validateConvertUrl('https://admin:pass@ejemplo.com/audio.mp3').ok).toBe(false);
  });
});
