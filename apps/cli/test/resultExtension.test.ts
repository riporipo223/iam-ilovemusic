import { describe, it, expect } from 'vitest';
import { resultExtension } from '../src/util/resultExtension';

describe('resultExtension', () => {
  it('reads the real extension from a presigned R2 URL, ignoring query params', () => {
    const url =
      'https://ilovemusic-downloads.example.r2.cloudflarestorage.com/downloads/abc-123.opus?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires=3600';
    expect(resultExtension(url)).toBe('.opus');
  });

  it('works for .mp3 results too', () => {
    const url = 'https://example.com/downloads/abc-123.mp3?X-Amz-Signature=abc';
    expect(resultExtension(url)).toBe('.mp3');
  });

  it('works for other extensions (.m4a, .ogg, .webm)', () => {
    expect(resultExtension('https://example.com/downloads/x.m4a?y=1')).toBe('.m4a');
    expect(resultExtension('https://example.com/downloads/x.ogg?y=1')).toBe('.ogg');
    expect(resultExtension('https://example.com/downloads/x.webm?y=1')).toBe('.webm');
  });

  it('falls back to .mp3 when the URL path has no extension at all', () => {
    expect(resultExtension('https://example.com/downloads/no-extension-here')).toBe('.mp3');
  });
});
