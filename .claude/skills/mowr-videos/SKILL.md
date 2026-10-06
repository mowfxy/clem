---
name: mowr-videos
description: Make or change Mowr's video ads and films (announcements, launch films, social cuts) in the house feel the owner has approved — an eyepiece journey through dozens of living archival plates, hard cuts on the beat, a synthesised score, Mowr's notebook page and flower. Use whenever the user asks for a Mowr video, ad, trailer, promo, film or reel, or to change the existing one in ads/.
---

# Mowr videos

The approved film is `ads/mowr-announcement.mp4`, rendered by `scripts/eyepiece/`. Start from it: new films reuse the
renderer, the plates and the score. Everything is made in code (no stock footage, no samples), so there is nothing to
license and every frame and sound can be changed.

## The feel (what the owner asked for, in their words and in practice)

The model is a film that looks through an eyepiece at archival plates (birds, botany, maps, microscopy, stars, the moon), with
a swelling orchestral sound and a quiet ending. Keep **the same feel, not the same film**: never copy its shots, its bird or
its sky. Mowr's version:

- **Opening:** darkness, then an engraved navy iris inside the lens clicks open in three ratchet steps; the focus racks onto
  a cream notebook page where a navy ink pen finishes Mowr's four-petal flower (line boil on twos, see the ink-illustration
  memory). The flower's centre becomes a second lens that grows until it fills the first, and the run starts on the hit.
- **The run must never feel like a slideshow.** Many, many things (the current film has about 50 subjects in 62 shots).
  Every shot keeps moving while it is on screen (push, pan, turn) and as many as possible are alive (a butterfly crossing,
  gears turning, current in a circuit, a helix, a pendulum drawing its wave, a harmonograph, a Mandelbrot zoom, orbits).
- **Hard cuts on the beat. No transition animations between subjects** (slides, zoom-throughs, spins and focus pulls were
  tried and rejected). 120 BPM from the hit: two half beats, then quarter beats, then eighths in the climax.
- **No white flashes.** Hits land as a lens punch: a quick push in with a darkened rim and a little colour fringe.
- **Hold the big moment.** The run ends on the moon and stays on it (about 1.7 s, drifting) before the lens pulls back.
- **Ending:** the moon shrinks into the flower's centre on the page, the petals fill with Mowr red, the wordmark inks in,
  margin sketches of what we saw draw themselves, then the line and "Free for Windows · mowrai.com".
- **Line:** short, catchy and not about features. Rejected: "Look closer.", "Every subject, one place." Current: "The world,
  in focus." Offer two or three alternatives when changing it.
- **Content rules:** no Arabic text and nothing religious (an Arabic plate was removed); no birds or bird sounds unless a bird
  is on screen; nothing that imitates a real brand.
- **Look:** cream paper `#f1ebde`-ish, navy ink `#16224a`, Mowr red `#d9473e`, the logo petal path from `public/logo.svg`;
  hand-coloured engraving with a print pass (soft edges, pigment grain, slight misregistration); a dark engraved lens barrel.
- **Format:** 1080×1080, 24 fps, about 32 s, −14 LUFS, H.264 capped at 12 Mbps. Save the finished film alone in `ads/`
  (no previews, stills or WAVs there; working files go to `.work/eyepiece/`). Never overwrite `ads/mowr-announcement-original.mp4`.

## The sound (keep it matching the picture)

Synthesised in `score.mjs`, in E: room air and the pen while drawing; iris clicks; a low granular rumble that grows; a
string section swelling bar by bar (A, E/G#, F#m, D, C#m, B into E major); a clockwork tick on every cut with the grid filled
between; a timpani pulse doubling near the end; a deep thunk, metal clank and low stab on the first hit (no cymbal crash);
a full hit on the moon, then near silence — a low drone, a high glass shimmer, the reverb tail — and a rising breath out of the
lens into a bright held chord with soft piano notes under the titles. When the picture changes, change the sound with it.

## How to work

```bash
node scripts/eyepiece/render.mjs --stills 4.5,9,13.2   # PNG stills → .work/eyepiece/stills
node scripts/eyepiece/render.mjs --plates              # every baked plate → .work/eyepiece/plates
node scripts/eyepiece/render.mjs                       # full film (about 40 s on the GPU) → ads/mowr-announcement.mp4
```

- Files: `lib.js` (GL, engraving, wash, print pass), `plates*.js` and `shaders.js` (subjects; `LIVE.*` animates one while
  on screen), `page.js` (notebook page, flower, wordmark, line, sketches and their times), `stage.js` (lens shader, the
  `RUN` shot list, timing constants `DIVE0/HIT/HIT2/MOON/PULL/OUTOF/CLOSE_END`, page camera keys), `score.mjs`.
- To add a subject: paint it in a `plates*.js` painter (or a shader), register it in that file's builder, then add a shot to
  `RUN`. Shot durations come from their place on the beat grid, so keep `RUN` long enough to fill every slot.
- When timings move, move the page sketch shift in `page.js`, the title cues in `stage.js` and the page camera keys together.
- Fonts: Mowafy Serif is pinned in `scripts/eyepiece/fonts` (see `SOURCE.md`; update it from github.com/mowfxy/serif `main`
  when asked); Mowafy Sans comes from `public/fonts`.
- Check every change by eye before handing it over: contact sheets of the run (`ffmpeg ... -vf "fps=6,scale=200:200,tile=12x6"`),
  the opening and the moon. You cannot hear the audio: check loudness (`ebur128`) and a log spectrogram against the cue
  times, and say plainly that the sound needs the owner's ears.
- The finished film is usually over 30 MB, so it only reaches the desktop app, not the phone; say so when sending it.
