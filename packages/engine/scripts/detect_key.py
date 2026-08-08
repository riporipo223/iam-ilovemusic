import sys
import json
import librosa
import numpy as np

def detect_key(file_path):
    try:
        y, sr = librosa.load(file_path, mono=True, duration=60)
        chroma = librosa.feature.chroma_cqt(y=y, sr=sr)
        chroma_mean = chroma.mean(axis=1)

        keys = ['C', 'C#', 'D', 'D#', 'E', 'F',
                'F#', 'G', 'G#', 'A', 'A#', 'B']

        # Krumhansl-Schmuckler key profiles
        major_profile = [6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88]
        minor_profile = [6.33,2.68,3.52,5.38,2.60,3.53,2.54,4.75,3.98,2.69,3.34,3.17]

        major_corr = [np.corrcoef(np.roll(major_profile, i), chroma_mean)[0,1] for i in range(12)]
        minor_corr = [np.corrcoef(np.roll(minor_profile, i), chroma_mean)[0,1] for i in range(12)]

        best_major = np.argmax(major_corr)
        best_minor = np.argmax(minor_corr)

        if major_corr[best_major] >= minor_corr[best_minor]:
            result = f"{keys[best_major]} maj"
        else:
            result = f"{keys[best_minor]} min"

        print(json.dumps({"key": result, "error": None}))
    except Exception as e:
        print(json.dumps({"key": None, "error": str(e)}))

if __name__ == "__main__":
    detect_key(sys.argv[1])
