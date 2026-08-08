import { execFile } from 'child_process';
import * as path from 'path';
import { resolveBinary } from '../binaries';

// scripts/detect_key.py sits at the package root, two levels up from both
// src/processing/key.ts and dist/processing/key.js, so this path is stable
// whether running from source (ts-node) or the compiled dist output.
const DETECT_KEY_SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'detect_key.py');

/**
 * Detect the musical key of an audio file via a Python/librosa subprocess.
 * Degrades gracefully to null when python3/librosa is unavailable — the key
 * is a nice-to-have, never a reason to fail a download job.
 */
export function detectKey(filePath: string, timeoutMs = 30000): Promise<string | null> {
  return new Promise((resolve) => {
    const pythonCmd = resolveBinary('python3');
    execFile(pythonCmd, [DETECT_KEY_SCRIPT, filePath], { timeout: timeoutMs }, (err, stdout) => {
      if (err || !stdout) {
        resolve(null);
        return;
      }
      try {
        const parsed = JSON.parse(stdout.trim());
        resolve(parsed.key || null);
      } catch {
        resolve(null);
      }
    });
  });
}
