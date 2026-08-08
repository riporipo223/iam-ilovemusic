import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import { resolveBinary } from '../binaries';

const execFileAsync = promisify(execFile);

/**
 * Detect BPM from an audio file using ffmpeg (convert to mono WAV) + aubio tempo.
 * Returns null (never throws) if detection fails or tools are unavailable —
 * callers treat a missing BPM as "unknown", not a fatal error.
 */
export async function detectBPMFromAudio(filePath: string): Promise<number | null> {
  let tempWav = filePath.replace(/\.[^.]+$/, '_temp_bpm.wav');
  let converted = false;

  try {
    const ffmpegPath = resolveBinary('ffmpeg');
    const aubioPath = resolveBinary('aubio');

    if (!filePath.toLowerCase().endsWith('.wav')) {
      const convertArgs = ['-i', filePath, '-ar', '44100', '-ac', '1', '-f', 'wav', '-y', tempWav];
      await execFileAsync(ffmpegPath, convertArgs, { timeout: 60000 });
      converted = true;
    } else {
      tempWav = filePath;
    }

    const aubioArgs = ['tempo', converted ? tempWav : filePath];
    const { stdout, stderr } = await execFileAsync(aubioPath, aubioArgs, {
      timeout: 120000,
      maxBuffer: 1024 * 1024 * 10,
    });

    const output = stdout.toString() + stderr.toString();
    const bpmMatches = output.match(/(\d+\.?\d*)\s*(?:bpm|BPM)?/gi);

    if (bpmMatches && bpmMatches.length > 0) {
      const lastMatch = bpmMatches[bpmMatches.length - 1];
      const bpmValue = parseFloat(lastMatch.match(/(\d+\.?\d*)/)![1]);
      const detectedBPM = Math.round(bpmValue);

      if (detectedBPM >= 60 && detectedBPM <= 200) {
        cleanup();
        return detectedBPM;
      }
      if (detectedBPM > 0 && detectedBPM < 60) {
        const doubledBPM = detectedBPM * 2;
        if (doubledBPM >= 60 && doubledBPM <= 200) {
          cleanup();
          return doubledBPM;
        }
      }
    }

    cleanup();
    return null;
  } catch {
    cleanup();
    return null;
  }

  function cleanup() {
    if (converted && fs.existsSync(tempWav)) {
      fs.unlinkSync(tempWav);
    }
  }
}
