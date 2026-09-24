const AUDIO_EXTENSIONS = [
  'mp3',
  'wav',
  'ogg',
  'oga',
  'opus',
  'm4a',
  'm4b',
  'flac',
  'aac',
  'weba',
  'aif',
  'aiff',
  'wma',
];

export type ValidationResult = { ok: true } | { ok: false; reason: string };

/**
 * Cheap pre-decode gate: reject empty files and anything that does not look
 * like audio by extension or MIME type. The final word is always decodeAudioData.
 */
export function validateAudioFile(name: string, size: number, mime: string): ValidationResult {
  if (!Number.isFinite(size) || size <= 0) {
    return { ok: false, reason: 'El archivo está vacío.' };
  }
  const ext = name.includes('.') ? (name.split('.').pop() ?? '').toLowerCase() : '';
  if (mime.startsWith('audio/') || AUDIO_EXTENSIONS.includes(ext)) {
    return { ok: true };
  }
  return { ok: false, reason: `"${name}" no parece ser un archivo de audio.` };
}
