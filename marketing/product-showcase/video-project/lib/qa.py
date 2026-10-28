"""Technical checks of a rendered cut: python3 lib/qa.py <video.mp4> <out-dir> [--every s]

Writes <out-dir>/<name>.qa.json (stream facts, black frames, silences, loudness, frozen picture) and
<name>.sheet.jpg (one frame every --every seconds, default 30, with its time)."""
import json
import os
import re
import subprocess
import sys

from PIL import Image, ImageDraw


def run(args):
    return subprocess.run(args, capture_output=True, text=True, check=True)


def main():
    src, out = sys.argv[1], sys.argv[2]
    every = float(sys.argv[sys.argv.index('--every') + 1]) if '--every' in sys.argv else 30.0
    os.makedirs(out, exist_ok=True)
    name = os.path.splitext(os.path.basename(src))[0]
    probe = json.loads(run(['ffprobe', '-v', 'error', '-show_format', '-show_streams', '-of', 'json', src]).stdout)
    v = next(s for s in probe['streams'] if s['codec_type'] == 'video')
    a = next((s for s in probe['streams'] if s['codec_type'] == 'audio'), None)
    duration = float(probe['format']['duration'])

    # One decoding pass for the picture filters and one for the sound filters.
    pic = run(['ffmpeg', '-v', 'info', '-nostats', '-i', src, '-an', '-vf',
               'blackdetect=d=0.5:pix_th=0.10,freezedetect=n=0.0005:d=8', '-f', 'null', '-']).stderr
    black = [(float(m[0]), float(m[1])) for m in re.findall(r'black_start:([\d.]+) black_end:([\d.]+)', pic)]
    freezes = [float(x) for x in re.findall(r'freeze_start: ([\d.]+)', pic)]
    freeze_ends = [float(x) for x in re.findall(r'freeze_end: ([\d.]+)', pic)]
    snd = {}
    if a:
        log = run(['ffmpeg', '-v', 'info', '-nostats', '-i', src, '-vn', '-af',
                   'silencedetect=n=-50dB:d=1.5,ebur128=peak=true', '-f', 'null', '-']).stderr
        summary = log[log.rfind('Summary:'):]
        num = lambda key: float(re.search(key + r':\s+(-?[\d.]+|-inf)', summary).group(1).replace('-inf', '-999'))
        snd = {
            'integrated_lufs': num('I'), 'lra_lu': num('LRA'), 'true_peak_dbtp': num('Peak'),
            'silences': [(float(s), float(e)) for s, e in zip(re.findall(r'silence_start: ([\d.]+)', log), re.findall(r'silence_end: ([\d.]+)', log))],
        }
    report = {
        'file': os.path.basename(src), 'size_mb': round(int(probe['format']['size']) / 1e6, 1), 'duration_s': round(duration, 2),
        'video': {'codec': v['codec_name'], 'profile': v.get('profile'), 'width': v['width'], 'height': v['height'],
                  'fps': v['r_frame_rate'], 'pix_fmt': v['pix_fmt'], 'bitrate_mbps': round(int(probe['format']['bit_rate']) / 1e6, 2)},
        'audio': {'codec': a['codec_name'], 'sample_rate': a['sample_rate'], 'channels': a['channels']} if a else None,
        'black_segments': black,
        'frozen_segments': [(s, freeze_ends[i] if i < len(freeze_ends) else duration) for i, s in enumerate(freezes)],
        **snd,
    }
    with open(os.path.join(out, f'{name}.qa.json'), 'w') as f:
        json.dump(report, f, indent=1)

    # Contact sheet
    times = [t + 1 for t in frange(0, duration - 1, every)]
    tiles = []
    for t in times:
        frame = os.path.join(out, f'.{name}-{t:.0f}.jpg')
        run(['ffmpeg', '-v', 'error', '-y', '-ss', f'{t:.2f}', '-i', src, '-frames:v', '1', '-vf', 'scale=480:-2', frame])
        tiles.append((t, Image.open(frame).convert('RGB')))
        os.remove(frame)
    cols = 6
    w, h = tiles[0][1].size
    sheet = Image.new('RGB', (cols * w, ((len(tiles) + cols - 1) // cols) * (h + 22)), 'white')
    d = ImageDraw.Draw(sheet)
    for i, (t, im) in enumerate(tiles):
        x, y = (i % cols) * w, (i // cols) * (h + 22)
        sheet.paste(im, (x, y + 22))
        d.text((x + 6, y + 4), f'{int(t // 60):02d}:{t % 60:04.1f}', fill='black')
    sheet.save(os.path.join(out, f'{name}.sheet.jpg'), quality=85)
    print(json.dumps({k: report[k] for k in report if k not in ('silences',)}, indent=1))


def frange(a, b, step):
    t = a
    while t <= b:
        yield t
        t += step


if __name__ == '__main__':
    main()
