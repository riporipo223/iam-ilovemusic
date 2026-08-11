import { describe, it, expect, vi, beforeEach } from 'vitest';
import { promisify } from 'util';

const execFileMock = vi.fn();

// Same mocking approach as soundcloud.test.ts: replace child_process's
// execFile with something driven by execFileMock, including the
// promisify.custom symbol real execFile carries (unused by key.ts directly,
// but keeping the mock shape consistent avoids surprises if that changes).
vi.mock('child_process', () => {
  function execFile(file: string, args: string[], optionsOrCallback?: unknown, maybeCallback?: unknown) {
    const callback = (typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback) as
      | ((err: Error | null, stdout?: string, stderr?: string) => void)
      | undefined;
    Promise.resolve(execFileMock(file, args)).then(
      (result: { stdout?: string; stderr?: string } = {}) => callback?.(null, result.stdout ?? '', result.stderr ?? ''),
      (err: Error) => callback?.(err)
    );
  }
  (execFile as unknown as Record<symbol, unknown>)[promisify.custom] = async (file: string, args: string[]) => {
    const result = (await execFileMock(file, args)) ?? {};
    return { stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
  };
  return { execFile };
});

import { detectKey } from '../src/processing/key';

beforeEach(() => {
  execFileMock.mockReset();
});

describe('detectKey — graceful degradation when python3/librosa is unavailable', () => {
  it('resolves null (not a rejection) when python3 itself is not found — the ENOENT case for a clean end-user machine', async () => {
    const enoent = Object.assign(new Error("spawn python3 ENOENT"), { code: 'ENOENT' });
    execFileMock.mockRejectedValue(enoent);

    await expect(detectKey('/tmp/track.mp3')).resolves.toBeNull();
  });

  it('resolves null when python3 exists but exits non-zero — e.g. `import librosa` failing because it is not installed', async () => {
    // detect_key.py imports librosa at module scope, outside any try/except,
    // so a missing librosa surfaces as a Python traceback on stderr and a
    // non-zero exit — no JSON on stdout for key.ts to parse.
    execFileMock.mockRejectedValue(new Error('Command failed with exit code 1'));

    await expect(detectKey('/tmp/track.mp3')).resolves.toBeNull();
  });

  it('resolves null when the subprocess produces no stdout at all', async () => {
    execFileMock.mockResolvedValue({ stdout: '' });

    await expect(detectKey('/tmp/track.mp3')).resolves.toBeNull();
  });

  it('resolves null on malformed stdout instead of throwing a JSON parse error', async () => {
    execFileMock.mockResolvedValue({ stdout: 'not json' });

    await expect(detectKey('/tmp/track.mp3')).resolves.toBeNull();
  });

  it('resolves the detected key on success, so the happy path is not accidentally broken by the graceful-degradation handling', async () => {
    execFileMock.mockResolvedValue({ stdout: JSON.stringify({ key: 'A min', error: null }) });

    await expect(detectKey('/tmp/track.mp3')).resolves.toBe('A min');
  });
});
