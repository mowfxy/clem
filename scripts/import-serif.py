# Imports Mowafy Serif from a checkout of mowfxy/serif (3.0 layout) into Mowr.
#   python scripts/import-serif.py <path-to-serif-checkout>
# Each style ships as a small Latin cut under the plain name (what the app, emails, server pages and films load)
# plus MowafySerifFull-*, the whole Mowafy Serif file (Greek, Cyrillic, extended Latin), limited by unicode-range
# to what the Latin cut leaves out. Arabic, math, science and Coptic come from the package's companion families,
# declared under the same 'Mowafy Serif' name with unicode-ranges of only the characters nothing before them
# covers, so browsers fetch each file only when a page uses those characters.
# Writes public/fonts, scripts/eyepiece/fonts, core/serif-fonts.ts and the serif block in src/type.css.
import json, pathlib, re, shutil, subprocess, sys
from fontTools.ttLib import TTFont
from fontTools import subset

src = pathlib.Path(sys.argv[1])
web = src / "fonts"
rev = subprocess.run(["git", "-C", str(src), "rev-parse", "--short", "HEAD"], capture_output=True, text=True, check=True).stdout.strip()
root = pathlib.Path(__file__).resolve().parent.parent
fonts = root / "public" / "fonts"

# style file, CSS weight band, CSS style
# Medium is the bold inside running text (answers, file previews); Bold is for headings and display.
STYLES = [("Light", "300", "normal"), ("Regular", "400", "normal"), ("Medium", "500", "normal"), ("Bold", "600 800", "normal"),
          ("Italic", "300 400", "italic"), ("MediumItalic", "500", "italic"), ("BoldItalic", "600 800", "italic")]
# Companion families in fallback order; the bold file (when there is one) serves the 600-800 band.
COMPANIONS = [("MowafyGreek", True), ("MowafyArabic", True), ("MowafyMath", False), ("MowafyMathSupplement", False),
              ("MowafyScience", False), ("MowafyScienceSupplement", False), ("MowafyCopticSupplement", False)]
LATIN = "U+20-7E,U+A0-17F,U+192,U+218-21B,U+237,U+2BB-2BC,U+2C6-2C7,U+2D8-2DD,U+300-30C,U+323-328,U+1E9E,U+2013-2014,U+2018-201E,U+2020-2022,U+2026,U+2030,U+2032-2033,U+2039-203A,U+2044,U+2070,U+2074-2079,U+20AC,U+2122,U+2190-2193,U+2212,U+2215,U+221E,U+2248,U+2260,U+2264-2265,U+FB01-FB02"

def codepoints(spec):
    out = set()
    for part in spec.split(","):
        a, _, b = part.removeprefix("U+").partition("-")
        out.update(range(int(a, 16), int(b or a, 16) + 1))
    return out

def ranges(cps):
    cps = sorted(cps); out = []; s = e = cps[0]
    for c in cps[1:]:
        if c == e + 1: e = c
        else: out.append((s, e)); s = e = c
    out.append((s, e))
    return ",".join(f"U+{a:X}" if a == b else f"U+{a:X}-{b:X}" for a, b in out)

def cmap_of(path):
    return {c for c in TTFont(path).getBestCmap() if c >= 0x20}

wanted = codepoints(LATIN)
companion_files = {}
for family, has_bold in COMPANIONS:
    for style in (("Regular", "Bold") if has_bold else ("Regular",)):
        name = f"{family}-{style}"
        shutil.copyfile(web / f"{name}.woff2", fonts / f"{name}.woff2")
        companion_files[name] = cmap_of(web / f"{name}.woff2")

faces = []
for name, weight, style in STYLES:
    full = web / f"MowafySerif-{name}.woff2"
    cmap = cmap_of(full)
    latin = cmap & wanted
    opts = subset.Options(); opts.flavor = "woff2"; opts.layout_features = ["*"]; opts.name_IDs = ["*"]; opts.notdef_outline = True
    font = TTFont(full); s = subset.Subsetter(opts); s.populate(unicodes=latin); s.subset(font)
    subset.save_font(font, str(fonts / f"MowafySerif-{name}.woff2"), opts)
    shutil.copyfile(full, fonts / f"MowafySerifFull-{name}.woff2")
    faces.append({"file": f"MowafySerif-{name}", "weight": weight, "style": style, "range": ranges(latin)})
    faces.append({"file": f"MowafySerifFull-{name}", "weight": weight, "style": style, "range": ranges(cmap - latin), "full": True})
    covered = set(cmap)
    bold = weight.startswith("6")
    for family, has_bold in COMPANIONS:
        file = f"{family}-{'Bold' if has_bold and bold else 'Regular'}"
        extra = companion_files[file] - covered
        covered |= extra
        if extra:
            faces.append({"file": file, "weight": weight, "style": style, "range": ranges(extra), "full": True})
shutil.copyfile(web / "MowafyMath-Regular.woff2", fonts / "MowafyMath-Regular.woff2")
for name in ("Regular", "Bold"):
    shutil.copyfile(fonts / f"MowafySerif-{name}.woff2", root / "scripts" / "eyepiece" / "fonts" / f"MowafySerif-{name}.woff2")
shutil.copyfile(src / "licenses" / "MowafySerif-OFL.txt", fonts / "licenses" / "MowafySerif-OFL.txt")

(root / "core" / "serif-fonts.ts").write_text(
    f"// Mowafy Serif imported from mowfxy/serif at {rev} by scripts/import-serif.py. `full` faces carry the\n"
    "// non-Latin coverage and are only fetched when a page uses those characters; pages that inline fonts skip them.\n"
    f"export const serifFaces = {json.dumps(faces, indent=2)} as const;\n", encoding="utf-8")

css_path = root / "src" / "type.css"
css = css_path.read_text(encoding="utf-8")
block = (f"/* Mowafy Serif (mowfxy/serif {rev}), from scripts/import-serif.py: Light, Regular, Medium, Bold and italics. Each style is a\n"
         "   small Latin cut plus the full Mowafy Serif file and its Arabic, math and symbol companions, which only load when used. */\n"
         + "".join(f"@font-face{{font-family:'Mowafy Serif';src:url('/fonts/{f['file']}.woff2') format('woff2');font-weight:{f['weight']};font-style:{f['style']};font-display:swap;unicode-range:{f['range']}}}\n" for f in faces))
css, n = re.subn(r"/\* Mowafy Serif \(mowfxy/serif [^)]*\).*?\*/\n(?:@font-face\{font-family:'Mowafy Serif';[^\n]*\n)+", lambda _: block, css, count=1, flags=re.S)
if n != 1: sys.exit("Could not find the Mowafy Serif block in src/type.css")
css_path.write_text(css, encoding="utf-8")
for p in sorted(fonts.glob("Mowafy*.woff2")):
    if not p.name.startswith("MowafySans"): print(f"{p.name}: {p.stat().st_size // 1024} KB")
print("Imported mowfxy/serif", rev, "-", len(faces), "faces")
