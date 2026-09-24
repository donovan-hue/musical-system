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
});
