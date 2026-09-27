"""Makes the Microsoft Store (MSIX) logo and tile images in build/appx from public/logo.png.

The petals are drawn on transparent tiles; the Start menu fills them with appx.backgroundColor
(see electron-builder.store.cjs). Run: python scripts/store-assets.py  (needs Pillow)."""
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parent.parent
out = root / "build" / "appx"
out.mkdir(parents=True, exist_ok=True)
logo = Image.open(root / "public" / "logo.png").convert("RGBA")
logo = logo.crop(logo.getbbox())

# The light-taskbar copies use the ink colour instead of the off-white petals, which would vanish on light grey.
dark = Image.new("RGBA", logo.size, (18, 18, 17, 255))
dark.putalpha(logo.getchannel("A"))

def tile(width, height, share, mark_source=logo):
    """The logo centred on a transparent width x height canvas, `share` of the shorter side tall."""
    side = max(1, round(min(width, height) * share))
    canvas = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    mark = mark_source.resize((side, side), Image.LANCZOS)
    canvas.alpha_composite(mark, ((width - side) // 2, (height - side) // 2))
    return canvas

# name: (base width, base height, logo share). Scale variants let Windows pick a sharp copy per display.
tiles = {
    "StoreLogo": (50, 50, 0.84),
    "Square44x44Logo": (44, 44, 0.84),
    "SmallTile": (71, 71, 0.52),
    "Square150x150Logo": (150, 150, 0.5),
    "Wide310x150Logo": (310, 150, 0.5),
    "LargeTile": (310, 310, 0.46),
}
for name, (w, h, share) in tiles.items():
    for scale in (100, 125, 150, 200, 400):
        tile(round(w * scale / 100), round(h * scale / 100), share).save(out / f"{name}.scale-{scale}.png")

# Taskbar, Alt+Tab and title bar sizes. "altform-unplated" draws them without the coloured plate.
for size in (16, 20, 24, 30, 32, 36, 40, 48, 60, 64, 72, 80, 96, 256):
    icon = tile(size, size, 0.9)
    icon.save(out / f"Square44x44Logo.targetsize-{size}.png")
    icon.save(out / f"Square44x44Logo.targetsize-{size}_altform-unplated.png")
    tile(size, size, 0.9, dark).save(out / f"Square44x44Logo.targetsize-{size}_altform-lightunplated.png")
print(f"Wrote {len(list(out.glob('*.png')))} images to {out}")
