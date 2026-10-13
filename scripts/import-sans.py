# Imports Mowafy Sans from a checkout of mowfxy/sans (6.0 layout) into Mowr.
#   python scripts/import-sans.py <path-to-sans-checkout>
# Copies the five weights, their italics and the script and math companions into public/fonts, and rewrites the
# Mowafy Sans block in src/type.css from the package's own mowafy-sans.css. That CSS declares every companion under
# 'Mowafy Sans' with a unicode-range of only what the Latin files leave out, so browsers fetch a companion only when
# a page uses those characters.
import pathlib, re, shutil, subprocess, sys

src = pathlib.Path(sys.argv[1])
rev = subprocess.run(["git", "-C", str(src), "rev-parse", "--short", "HEAD"], capture_output=True, text=True, check=True).stdout.strip()
root = pathlib.Path(__file__).resolve().parent.parent
fonts = root / "public" / "fonts"

for old in fonts.glob("MowafySans*.woff2"):
    old.unlink()
for p in sorted((src / "fonts" / "woff2").glob("*.woff2")):
    shutil.copyfile(p, fonts / p.name)

faces = re.findall(r"@font-face\s*\{[^}]*font-family:\s*'Mowafy Sans'[^}]*\}", (src / "fonts" / "mowafy-sans.css").read_text(encoding="utf-8"))
faces = [re.sub(r"\s+", " ", f).replace("url('./woff2/", "url('/fonts/").replace("@font-face {", "@font-face{").replace("{ ", "{").replace("; }", "}").replace(": ", ":").replace("; ", ";") for f in faces]
block = (f"/* Mowafy Sans (mowfxy/sans {rev}), from scripts/import-sans.py: Light, Regular, Medium, SemiBold and Bold, each with an\n"
         "   italic, plus script and math companions that only load when a page uses them. */\n" + "\n".join(faces) + "\n")
css_path = root / "src" / "type.css"
css = css_path.read_text(encoding="utf-8")
css, n = re.subn(r"/\* Mowafy Sans \(mowfxy/sans [^)]*\).*?\*/\n(?:@font-face\{font-family:'Mowafy Sans';[^\n]*\n)+", lambda _: block, css, count=1, flags=re.S)
if n != 1: sys.exit("Could not find the Mowafy Sans block in src/type.css")
css_path.write_text(css, encoding="utf-8")
for p in sorted(fonts.glob("MowafySans*.woff2")):
    print(f"{p.name}: {p.stat().st_size // 1024} KB")
print("Imported mowfxy/sans", rev, "-", len(faces), "faces")
