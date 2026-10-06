// Records one scene of the Drive verification demo: node scripts/verification/record.mjs <scene-id>
// Captures the whole 2880x1800 desktop's top 2880x1620 (16:9) at 30 fps with ffmpeg's gdigrab; the edit scales it to 1920x1080.
// Press q in this window to stop. Matroska, so a take is playable even if the window is closed by accident.
import { spawn } from "node:child_process";
import { mkdirSync, existsSync, renameSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const takes = join(dirname(fileURLToPath(import.meta.url)), "../../docs/verification/takes");
const scene = process.argv[2];
if (!scene || !/^[\w-]+$/.test(scene)) { console.error("Usage: node scripts/verification/record.mjs <scene-id>   (for example 02-connect)"); process.exit(1); }
mkdirSync(takes, { recursive: true });
const out = join(takes, scene + ".mkv");
if (existsSync(out)) { const old = join(takes, `${scene}.old-${Date.now()}.mkv`); renameSync(out, old); console.log("Kept the previous take as", old); }
const [w, h] = (process.env.CAPTURE_SIZE || "2880x1620").split("x");
for (let n = 3; n > 0; n--) { console.log(`Recording ${scene} in ${n}…`); await new Promise((r) => setTimeout(r, 1000)); }
console.log("RECORDING. Press q here to stop.");
const ff = spawn("ffmpeg", ["-hide_banner", "-loglevel", "warning", "-f", "gdigrab", "-framerate", "30", "-draw_mouse", "1", "-offset_x", "0", "-offset_y", "0", "-video_size", `${w}x${h}`, "-i", "desktop",
  "-c:v", "libx264", "-preset", "ultrafast", "-crf", "20", "-pix_fmt", "yuv420p", out], { stdio: ["inherit", "inherit", "inherit"] });
ff.on("exit", () => console.log("Saved", out));
