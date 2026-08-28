import { describe, it, expect } from 'vitest';
import { formatFileSize } from '../src/utils/formatFileSize.js';

describe('formatFileSize', () => {
  it('formats the 0-byte edge case', () => {
    expect(formatFileSize(0)).toBe('0 B');
  });

  it('formats sub-KB byte counts', () => {
    expect(formatFileSize(1)).toBe('1 B');
    expect(formatFileSize(512)).toBe('512 B');
    expect(formatFileSize(1023)).toBe('1023 B');
  });

  it('formats KB-range values', () => {
    expect(formatFileSize(1024)).toBe('1.0 KB');
    expect(formatFileSize(1536)).toBe('1.5 KB');
    expect(formatFileSize(10240)).toBe('10.0 KB');
  });

  it('formats MB-range values', () => {
    expect(formatFileSize(1024 * 1024)).toBe('1.0 MB');
    expect(formatFileSize(1024 * 1024 * 4.5)).toBe('4.5 MB');
  });

  it('formats GB-range values', () => {
    expect(formatFileSize(1024 * 1024 * 1024)).toBe('1.0 GB');
    expect(formatFileSize(1024 * 1024 * 1024 * 2.3)).toBe('2.3 GB');
  });

  // Cross-check against real tracks from the migrated database: for each,
  // file_size_bytes was derived by parsing the original `fileSize` string
  // (e.g. "4.5 MB") in db/migrate-from-json.js's parseFileSizeToBytes().
  // formatFileSize() is that transform's rough inverse, so re-formatting
  // the stored bytes should visually match the original string. They are
  // not guaranteed to be byte-identical round trips in general (the source
  // string only carries 1 decimal digit of precision), but for these real
  // samples the round trip lands on the same value.
  describe('cross-check against real migrated track data', () => {
    const realSamples = [
      { title: 'Racks Blue', file_size_bytes: 4718592, originalFileSize: '4.5 MB' },
      { title: 'Eyesight', file_size_bytes: 5242880, originalFileSize: '5.0 MB' },
      { title: 'Pocket Full Of Money Got My Trousers Falling Down', file_size_bytes: 4404019, originalFileSize: '4.2 MB' },
      { title: 'Wassup', file_size_bytes: 5242880, originalFileSize: '5.0 MB' },
      { title: 'WHISKEY (RELEASE ME) (feat. Gorillaz & Westside Gunn)', file_size_bytes: 8283750, originalFileSize: '7.9 MB' },
    ];

    for (const sample of realSamples) {
      it(`matches the original format for "${sample.title}"`, () => {
        expect(formatFileSize(sample.file_size_bytes)).toBe(sample.originalFileSize);
      });
    }
  });
});
