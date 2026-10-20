// Makes harmless sample files for the Drive demo in ~/Desktop/clem-demo-files (nothing personal): two PDFs and a short video.
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const out = join(homedir(), "Desktop", "clem-demo-files");
mkdirSync(out, { recursive: true });
const chrome = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(existsSync);
const page = (title, body) => `<meta charset=utf-8><style>body{font:16px Georgia,serif;margin:60px;line-height:1.55}h1{font-size:30px}</style><h1>${title}</h1>${body}`;
const docs = {
  "physics-notes.pdf": page("Physics: forces and motion (sample notes)", "<p>Newton's first law: an object keeps its state of motion unless a net force acts on it.</p><p>Newton's second law: F = m a. A 2 kg trolley pushed with 6 N accelerates at 3 m/s².</p><p>Newton's third law: when A pushes B, B pushes A with an equal and opposite force.</p><p>Speed = distance / time. A cyclist covering 150 m in 25 s travels at 6 m/s.</p>"),
  "past-paper-1.pdf": page("Past paper 1 (sample)", "<ol><li>State Newton's second law. [2]</li><li>A 3 kg box is pushed with 12 N. Find its acceleration. [2]</li><li>Explain why a passenger moves forward when a car brakes. [3]</li></ol>"),
};
for (const [name, html] of Object.entries(docs)) {
  const f = join(out, name.replace(".pdf", ".html")); writeFileSync(f, html);
  if (chrome) spawnSync(chrome, ["--headless", "--disable-gpu", "--no-pdf-header-footer", "--print-to-pdf=" + join(out, name), pathToFileURL(f).href]);
}
spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=1280x720:r=30:d=20", "-f", "lavfi", "-i", "sine=f=330:d=20", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", join(out, "demo-clip.mp4")]);
writeFileSync(join(out, "dropped-file.txt"), "Sample file dragged from Explorer into the linked Drive folder.\nNo personal data.\n");
console.log("Sample files in", out);
