"""Tiles review frames into one image: python3 sheet.py out.jpg a.png b.png ... (COLS columns, default 2)."""
import os
import sys
from PIL import Image, ImageDraw
out, files = sys.argv[1], sys.argv[2:]
C = int(os.environ.get('COLS', 2))
W, H = 1920 // C, 1080 // C
rows = (len(files) + C - 1) // C
sheet = Image.new('RGB', (W * C, rows * (H + 24)), 'white')
d = ImageDraw.Draw(sheet)
for i, f in enumerate(files):
    im = Image.open(f).convert('RGB').resize((W, H))
    x, y = (i % C) * W, (i // C) * (H + 24)
    sheet.paste(im, (x, y + 24))
    d.text((x + 6, y + 6), f.split('/')[-1], fill='black')
sheet.save(out, quality=88)
