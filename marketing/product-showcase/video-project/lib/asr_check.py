"""Checks generated narration by speech recognition: python3 asr_check.py <lines.json> <whisper-dir> <out.json>

lines.json is a list of {"id", "text", "file"} (the narration lines of a cut). Each take is transcribed with
Whisper (sherpa-onnx) and compared with its text after normalisation (no diacritics, one form of alef, ya and
ta marbuta, no punctuation). Reports the character error rate per line and overall; a high rate marks a line
to listen to. Recognition errors count too, so the rate is an upper bound on the voice's own errors."""
import json
import re
import sys
import subprocess

import numpy as np
import sherpa_onnx


def normalise(t):
    t = re.sub('[ً-ْٰـ]', '', t)
    t = re.sub('[إأآٱ]', 'ا', t).replace('ى', 'ي').replace('ة', 'ه')
    t = re.sub(r'[^ء-ي0-9 ]', ' ', t)
    return re.sub(r'\s+', ' ', t).strip()


def distance(a, b):
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def main():
    lines, model, out = json.load(open(sys.argv[1], encoding='utf-8')), sys.argv[2], sys.argv[3]
    rec = sherpa_onnx.OfflineRecognizer.from_whisper(
        encoder=f'{model}/small-encoder.int8.onnx', decoder=f'{model}/small-decoder.int8.onnx',
        tokens=f'{model}/small-tokens.txt', language='ar', task='transcribe', num_threads=4)
    results, errors, total = [], 0, 0
    for line in lines:
        # Any WAV depth or format (the narrator's prepared takes are 24-bit), as mono float at 16 kHz.
        sr = 16000
        x = np.frombuffer(subprocess.run(['ffmpeg', '-v', 'error', '-i', line['file'], '-ac', '1', '-ar', str(sr), '-f', 'f32le', '-'],
                                         capture_output=True, check=True).stdout, np.float32)
        stream = rec.create_stream()
        # Half a second of silence on each side: without it Whisper tends to drop the last word of a take.
        pad = np.zeros(sr // 2, np.float32)
        stream.accept_waveform(sr, np.concatenate([pad, x, pad]))
        rec.decode_stream(stream)
        heard = stream.result.text
        ref, hyp = normalise(line['text']), normalise(heard)
        d = distance(ref, hyp)
        errors, total = errors + d, total + len(ref)
        results.append({'id': line['id'], 'cer': round(d / max(1, len(ref)), 3), 'text': ref, 'heard': hyp})
        print(f"{line['id']}: {d / max(1, len(ref)):.2%}", flush=True)
    summary = {'lines': len(results), 'cer': round(errors / max(1, total), 4), 'results': results}
    json.dump(summary, open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(f"overall character error rate: {summary['cer']:.2%} over {len(results)} lines")


if __name__ == '__main__':
    main()
