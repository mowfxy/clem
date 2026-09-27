"""Makes the Microsoft Store (MSIX) logo and tile images in build/appx from public/logo.png (run scripts/render-icons.mjs first).

The petals are drawn on transparent tiles; the Start menu fills them with appx.backgroundColor
(see electron-builder.store.cjs). Run: python scripts/store-assets.py  (needs Pillow)."""
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parent.parent
out = root / "build" / "appx"
out.mkdir(parents=True, exist_ok=True)
logo = Image.open(root / "public" / "logo.png").convert("RGBA")
logo = logo.crop(logo.getbbox())

def tile(width, height, share):
    """The logo centred on a transparent width x height canvas, `share` of the shorter side tall."""
    side = max(1, round(min(width, height) * share))
    canvas = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    mark = logo.resize((side, side), Image.LANCZOS)
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

# Taskbar, Alt+Tab and title bar sizes (Square44x44Logo.targetsize-*) are drawn per size by scripts/render-icons.mjs.
print(f"Wrote {len(list(out.glob('*.png')))} images to {out}")
