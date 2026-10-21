// Builds docs/verification/clem-drive-demo.mp4 from the raw takes in docs/verification/takes/.
//   node scripts/verification/build-demo.mjs                      build everything
//   node scripts/verification/build-demo.mjs --only 02-connect    rebuild one scene, then re-join
//   node scripts/verification/build-demo.mjs --dead-air 05-drop   list frozen spans to put in `cuts`
//   node scripts/verification/build-demo.mjs --frames             re-pull review frames without rebuilding
// Timing lives in docs/verification/timing.json; a scene with no entry shows its default caption for the whole take.
// Times are seconds in the take AFTER the cuts are removed:
//   { "02-connect": { "cuts": [[0,3.5],[40,46]], "captions": [{ "from": 1, "to": 9, "text": "…" }], "zoom": [[12,18],[20,26]] } }
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const dir = join(root, "docs/verification"), takes = join(dir, "takes"), build = join(dir, "build"), frames = join(dir, "frames");
const OUT = join(dir, "clem-drive-demo.mp4");
const FONT = "Segoe UI";
const SCOPE = "https://www.googleapis.com/auth/drive";
// Where Chrome's address bar sits in the 2880x1620 capture (physical pixels). Adjust after looking at a take.
const BAR = { y: Number(process.env.BAR_Y || 70), h: Number(process.env.BAR_H || 110) };

/** Cards are generated; every other scene is a take. `zoom` windows magnify the address bar over the top of the frame. */
const SCENES = [
  { id: "00-title", card: { seconds: 7, lines: ["Clem: Google OAuth verification demo", SCOPE, "Website: https://clem.m4labs.xyz", "Privacy policy: https://m4labs.xyz/privacy"] } },
  { id: "00-site", caption: "Clem is a Windows desktop app. The website clem.m4labs.xyz hosts sign-in and the Drive consent redirect; the privacy policy at m4labs.xyz/privacy is linked from the footer." },
  { id: "01-signin", caption: "OAuth client 2 of 2: Google sign-in (“Continue with Google”). Clem uses it only to identify the user’s account (email and basic profile)." },
  { id: "02-connect", caption: `OAuth client 1 of 2: the Google Drive connector. It requests one scope: ${SCOPE}` },
  { id: "03-link", caption: "READ: the user browses their Drive and links a folder they made to a subject. Its files and subfolders are listed live from Drive; nothing is copied to the PC." },
  { id: "04-read", caption: "READ: PDFs and videos are streamed from Drive when opened. Clem reads a file, or searches Drive, only to answer the user’s question." },
  { id: "05-drop", caption: "WRITE: a file the user drops into the Drive folder they linked is uploaded to that folder, then marked as saved." },
  { id: "06-add", caption: "WRITE: “Add files” uploads files the user chooses to the linked folder; a worksheet Clem made is saved into it only when the user picks Save copy in Drive." },
  { id: "07-edit", caption: "WRITE: after the user approves an edit, the same Drive file receives the new version. It is not duplicated." },
  { id: "07b-manage", caption: "WRITE: the user can rename a file or move it to Drive’s trash from Clem. Clem never permanently deletes Drive files." },
  { id: "08-why", card: { seconds: 10, lines: ["Why the full drive scope?", "Users link folders they made themselves. drive.file shows none of what is already inside such a folder and can’t add files to it, so Clem needs the drive scope to list the linked folder and save into it.", "Clem reads and changes Drive only when the user acts. Data is streamed, never copied to our servers. Disconnect revokes access."] } },
  { id: "09-revoke", caption: "REVOKE: Disconnect in Clem revokes the Google grant, so Clem can no longer read or write the user’s Drive." },
  { id: "10-end", card: { seconds: 7, lines: ["Clem: thank you for reviewing", "Support: support@m4labs.xyz", "Privacy policy: https://m4labs.xyz/privacy", "Scope used: " + SCOPE] } },
];
const timing = existsSync(join(dir, "timing.json")) ? JSON.parse(readFileSync(join(dir, "timing.json"), "utf8")) : {};

const args = process.argv.slice(2), flag = (n) => args.includes(n), arg = (n) => args[args.indexOf(n) + 1];
const run = (cmd, a, opts = {}) => {
  const r = spawnSync(cmd, a, { encoding: "utf8", maxBuffer: 1 << 26, ...opts });
  if (r.status !== 0 && !opts.soft) { console.error(r.stderr || r.stdout); throw new Error(`${cmd} failed`); }
  return r;
};
const probe = (f) => Number(run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).stdout);
const take = (id) => join(takes, id + ".mkv");

const ts = (s) => { const c = Math.round(s * 100), h = Math.floor(c / 360000), m = Math.floor(c / 6000) % 60, sec = Math.floor(c / 100) % 60; return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(c % 100).padStart(2, "0")}`; };
const esc = (t) => t.replace(/\\/g, "\\\\").replace(/[{}]/g, "").replace(/\n/g, "\\N");
const header = (events) => `[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding
Style: Cap,${FONT},42,&H00FFFFFF,&H00FFFFFF,&HD8101010,&HD8101010,0,0,0,0,100,100,0,0,3,18,0,2,150,150,56,1
Style: H1,${FONT},70,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,0,0,8,200,200,0,1
Style: P,${FONT},44,&H00DCDCDC,&H00DCDCDC,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,8,200,200,0,1
Style: Mono,Consolas,40,&H0059D0FF,&H0059D0FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,8,200,200,0,1

[Events]
Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text
${events}`;

function scene(s) {
  const out = join(build, s.id + ".mp4"), ass = join(build, s.id + ".ass");
  const base = ["-hide_banner", "-loglevel", "error", "-y"];
  const enc = ["-r", "30", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-an", out];
  if (s.card) {
    // First line large, the rest plain; URLs and the scope in monospace. Long lines wrap inside the margins.
    const [first, ...rest] = s.card.lines;
    let y = 300, ev = `Dialogue: 0,${ts(0)},${ts(s.card.seconds)},H1,,0,0,0,,{\\pos(960,${y})\\an8}${esc(first)}\n`;
    y += 190;
    for (const l of rest) {
      const mono = /^(https?:|Scope used|Website|Privacy policy|Support)/.test(l);
      ev += `Dialogue: 0,${ts(0)},${ts(s.card.seconds)},${mono ? "Mono" : "P"},,0,0,0,,{\\pos(960,${y})\\an8}${esc(l)}\n`;
      y += l.length > 62 ? 170 : 95;
    }
    writeFileSync(ass, header(ev));
    run("ffmpeg", [...base, "-f", "lavfi", "-i", `color=c=0x141414:s=1920x1080:r=30:d=${s.card.seconds}`, "-vf", `ass=${s.id}.ass`, ...enc], { cwd: build });
    return out;
  }
  if (!existsSync(take(s.id))) { console.warn("No take yet for", s.id, "- skipped"); return null; }
  const t = timing[s.id] || {};
  const dur = probe(take(s.id)), cuts = t.cuts || [];
  const kept = cuts.reduce((d, [a, b]) => d - (Math.min(b, dur) - a), dur);
  const caps = t.captions || [{ from: 0.6, to: Math.max(1, kept - 0.6), text: s.caption }];
  writeFileSync(ass, header(caps.map((c) => `Dialogue: 0,${ts(c.from)},${ts(c.to)},Cap,,0,0,0,,${esc(c.text)}\n`).join("")));
  const drop = cuts.length ? `select='not(${cuts.map(([a, b]) => `between(t,${a},${b})`).join("+")})',setpts=N/FRAME_RATE/TB,` : "";
  const zoom = (t.zoom || []).map(([a, b]) => `between(t,${a},${b})`).join("+");
  // Zoom: two overlapping, magnified strips of the address bar (left part, right part) stacked at the top, so a long
  // consent URL stays readable: its client_id on the first line, the scope on the second.
  const stripW = 1560, mag = 1920 / stripW, sh = Math.round(BAR.h * mag);
  const chain = zoom
    ? `[0:v]${drop}fps=30,split=3[a][l][r];[l]crop=${stripW}:${BAR.h}:0:${BAR.y},scale=1920:${sh}[L];[r]crop=${stripW}:${BAR.h}:${2880 - stripW}:${BAR.y},scale=1920:${sh}[R];` +
      `[a]scale=1920:1080,drawbox=x=0:y=0:w=1920:h=${sh * 2 + 12}:color=0x0a0a0a@1:t=fill:enable='${zoom}'[b];[b][L]overlay=0:4:enable='${zoom}'[c];[c][R]overlay=0:${sh + 8}:enable='${zoom}'[d];[d]ass=${s.id}.ass[v]`
    : `[0:v]${drop}fps=30,scale=1920:1080,ass=${s.id}.ass[v]`;
  run("ffmpeg", [...base, "-i", take(s.id), "-filter_complex", chain, "-map", "[v]", ...enc], { cwd: build });
  return out;
}

if (flag("--dead-air")) {
  const r = run("ffmpeg", ["-hide_banner", "-i", take(arg("--dead-air")), "-vf", "freezedetect=n=0.003:d=2", "-an", "-f", "null", "-"], { soft: true });
  console.log((r.stderr.match(/freeze_(start|end|duration): [\d.]+/g) || []).join("\n") || "No frozen spans over 2 s.");
  process.exit(0);
}
mkdirSync(build, { recursive: true });
const only = arg("--only");
const parts = [];
for (const s of SCENES) {
  const f = join(build, s.id + ".mp4");
  if (flag("--frames") || (only && s.id !== only && existsSync(f))) { if (existsSync(f)) parts.push(f); continue; }
  const made = scene(s);
  if (made) parts.push(made);
}
if (!flag("--frames")) {
  writeFileSync(join(build, "list.txt"), parts.map((p) => `file '${p.replace(/\\/g, "/")}'`).join("\n"));
  run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", join(build, "list.txt"), "-c:v", "libx264", "-preset", "medium", "-crf", "19", "-pix_fmt", "yuv420p", "-movflags", "+faststart", OUT]);
  const total = probe(OUT);
  console.log(`Wrote ${OUT} (${Math.floor(total / 60)}:${String(Math.round(total % 60)).padStart(2, "0")})`);
  if (total > 300) console.warn("Over 5 minutes: add `cuts` in timing.json to trim dead air.");
}
// Review frames: the middle of every caption and of every zoom window, per scene.
rmSync(frames, { recursive: true, force: true });
mkdirSync(frames, { recursive: true });
for (const s of SCENES) {
  const f = join(build, s.id + ".mp4");
  if (!existsSync(f)) continue;
  const d = probe(f), t = timing[s.id] || {};
  const at = s.card ? [d / 2] : [...(t.captions || [{ from: 0.6, to: d - 0.6 }]).map((c) => (c.from + c.to) / 2), ...(t.zoom || []).map(([a, b]) => (a + b) / 2)];
  at.forEach((x, i) => run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", String(Math.min(x, d - 0.1)), "-i", f, "-frames:v", "1", join(frames, `${s.id}-${i}.png`)]));
}
console.log("Review frames in", frames);
