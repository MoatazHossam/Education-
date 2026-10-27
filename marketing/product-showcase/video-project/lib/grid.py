"""Draws a 100-px grid (in the shot's CSS pixels) over a recorded frame, to pick camera boxes.
python3 grid.py <frame.jpg> <css-width> <out.jpg>"""
import sys
from PIL import Image, ImageDraw
src, css_w, out = sys.argv[1], float(sys.argv[2]), sys.argv[3]
im = Image.open(src).convert('RGB')
s = im.width / css_w
im = im.resize((int(im.width / s), int(im.height / s)))
d = ImageDraw.Draw(im)
for x in range(0, im.width, 100):
    d.line([(x, 0), (x, im.height)], fill=(220, 0, 0), width=1)
    d.text((x + 2, 2), str(x), fill=(220, 0, 0))
for y in range(0, im.height, 100):
    d.line([(0, y), (im.width, y)], fill=(0, 0, 220), width=1)
    d.text((2, y + 2), str(y), fill=(0, 0, 220))
im.save(out, quality=85)
