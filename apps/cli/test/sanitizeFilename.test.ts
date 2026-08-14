import { describe, it, expect } from 'vitest';
import { sanitizeFilename } from '../src/util/sanitizeFilename';

describe('sanitizeFilename', () => {
  it('leaves an already-safe name untouched', () => {
    expect(sanitizeFilename('Forss - Flickermood')).toBe('Forss - Flickermood');
  });

  it('replaces every Windows-invalid character', () => {
    expect(sanitizeFilename('A/B\\C:D*E?F"G<H>I|J')).toBe('A_B_C_D_E_F_G_H_I_J');
  });

  it('strips control characters', () => {
    expect(sanitizeFilename('Track\x00Name\x1f')).toBe('Track_Name_');
  });

  it('trims a trailing dot or space (Windows disallows both)', () => {
    expect(sanitizeFilename('Track Name. ')).toBe('Track Name');
  });

  it('caps length while trimming trailing whitespace left by the cut', () => {
    const longName = 'A'.repeat(200) + ' B';
    const result = sanitizeFilename(longName, 150);
    expect(result.length).toBeLessThanOrEqual(150);
    expect(result).toBe('A'.repeat(150));
  });

  it('falls back to "untitled" when nothing survives sanitization', () => {
    expect(sanitizeFilename('...')).toBe('untitled');
  });
});
