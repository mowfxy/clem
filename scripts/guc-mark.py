"""Rebuilds GUC's mark from its 128 px source as clean, flat shapes at 512 px (light and dark-theme variants)."""
import sys
import numpy as np
from PIL import Image, ImageFilter

src, out_light, out_dark, preview = sys.argv[1:5]
# Padded so a shape touching the source's edge is not cut off by the blur.
PAD = 10
srcim = Image.open(src).convert('RGBA')
padded = Image.new('RGBA', (srcim.width + 2 * PAD, srcim.height + 2 * PAD), (0, 0, 0, 0)); padded.paste(srcim, (PAD, PAD))
N = padded.width
im = np.asarray(padded).astype(np.float32) / 255
rgb, alpha = im[..., :3], im[..., 3]

RED, YELLOW, BLACK = (233, 31, 39), (255, 220, 2), (5, 5, 5)
INK = (238, 243, 250)  # the app's light ink, for the black arm in the dark theme
cols = np.array([RED, YELLOW, BLACK], np.float32) / 255

# Each pixel's share of each colour: nearest colour wins, weighted by how opaque the pixel is. Pale fringes (the light
# halo the source carries) are far from every colour and drop out.
d = np.linalg.norm(rgb[..., None, :] - cols[None, None], axis=-1)  # h, w, 3
near = d.argmin(-1)
conf = np.clip(1.4 - d.min(-1) / 0.5, 0, 1)
masks = [(near == i) * alpha * conf for i in range(3)]

SCALE, OUT = 8, 512
def smooth(m):
    big = Image.fromarray((m * 255).astype(np.uint8), 'L').resize((N * SCALE, N * SCALE), Image.BICUBIC)
    big = big.filter(ImageFilter.GaussianBlur(SCALE * 0.9))
    a = np.asarray(big).astype(np.float32) / 255
    # A narrow ramp around the half-way line: a crisp edge that downsampling then antialiases.
    a = np.clip((a - 0.4) / 0.06 + 0.5, 0, 1)
    return Image.fromarray((a * 255).astype(np.uint8), 'L').resize((OUT, OUT), Image.LANCZOS)

layers = [smooth(m) for m in masks]

def compose(colours):
    canvas = Image.new('RGBA', (OUT, OUT), (0, 0, 0, 0))
    for c, layer in zip(colours, layers):
        canvas.alpha_composite(Image.merge('RGBA', [Image.new('L', (OUT, OUT), v) for v in c] + [layer]))
    return canvas

light, dark = compose([RED, YELLOW, BLACK]), compose([RED, YELLOW, INK])
light.save(out_light, optimize=True)
dark.save(out_dark, optimize=True)

# Preview: the old and new marks side by side on paper and on night, at 4x.
sheet = Image.new('RGBA', (1024 + 30, 1024 + 30), (0, 0, 0, 255))
old = Image.open(src).convert('RGBA').resize((OUT, OUT), Image.LANCZOS)
for i, (img, bg) in enumerate([(old, (244, 242, 236, 255)), (light, (244, 242, 236, 255)), (Image.open(src).convert('RGBA').resize((OUT, OUT), Image.LANCZOS), (13, 21, 36, 255)), (dark, (13, 21, 36, 255))]):
    tile = Image.new('RGBA', (OUT, OUT), bg); tile.alpha_composite(img)
    sheet.paste(tile, ((i % 2) * (OUT + 30), (i // 2) * (OUT + 30)))
sheet.save(preview)
print('ok', light.size)
