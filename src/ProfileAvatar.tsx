import { useEffect, useRef } from "react";
import { avatarFilms, avatarFrame, type AvatarFilm as Mark } from "./avatarFilms";
import "./profile-avatar.css";

// Ids stay stable so saved choices keep working.
const marks = avatarFilms;
const CELS_PER_SECOND = 12;
/** The film's pen is 4.8 units wide; a small crop lifts it just enough to hold a line. */
const PEN = 4.8;

/** One picture's drawings, made once for its ink and size, then reused by every copy. */
const films = new Map<string, Promise<HTMLImageElement[]>>();
function film(mark: Mark, ink: string, px: number, size: number) {
  const key = `${mark.id}/${ink}/${px}`;
  if (!films.has(key)) films.set(key, (async () => {
    const [cx, cy, side] = mark.crop, wide = (1.15 + size * 0.006) / (PEN * (size / side));
    const cels = Math.round(mark.seconds * CELS_PER_SECOND), out: HTMLImageElement[] = [];
    for (let cel = 0; cel < cels; cel++) {
      const art = avatarFrame(mark, cel / CELS_PER_SECOND).replace(/stroke-width="([\d.]+)"/g, (_, w) => `stroke-width="${(Number(w) * Math.max(1, wide)).toFixed(2)}"`).replace(/currentColor/g, ink);
      const image = new Image();
      image.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="${cx - side / 2} ${cy - side / 2} ${side} ${side}">${art}</svg>`);
      await image.decode();
      out.push(image);
    }
    return out;
  })());
  return films.get(key)!;
}

export function ProfileAvatar({ value, size = 56 }: { value?: string; size?: number }) {
  const mark = marks.find((m) => m.id === value) || marks[0], ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!, context = canvas.getContext("2d")!, px = Math.round(size * Math.min(devicePixelRatio || 1, 2));
    canvas.width = canvas.height = px;
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    let visible = true, timer = 0, frames: HTMLImageElement[] = [], gone = false, elapsed = 0, last = 0, shown = -1;
    const show = (cel: number) => { if (cel === shown || !frames[cel]) return; shown = cel; context.clearRect(0, 0, px, px); context.drawImage(frames[cel], 0, 0, px, px); };
    const quiet = () => media.matches || document.documentElement.dataset.quiet === "true";
    // Rests while off screen, minimised or while another window has focus (the new-chat sky slows down then too).
    const moving = () => visible && !document.hidden && document.hasFocus() && !quiet();
    const tick = () => {
      timer = 0;
      if (!moving() || !frames.length) { last = 0; if (quiet()) show(0); return; }
      const now = performance.now();
      if (last) elapsed += Math.min(now - last, 100) / 1000;
      last = now;
      const cel = Math.floor(elapsed * CELS_PER_SECOND);
      show(cel % frames.length);
      timer = window.setTimeout(tick, Math.max(1, ((cel + 1) / CELS_PER_SECOND - elapsed) * 1000));
    };
    const sync = () => { if (!timer) tick(); };
    const load = () => {
      shown = -1;
      void film(mark, getComputedStyle(canvas).color, px, size).then((drawn) => { if (gone) return; frames = drawn; show(0); sync(); });
    };
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync(); });
    observer.observe(canvas);
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("focus", sync); window.addEventListener("blur", sync);
    window.addEventListener("clem-theme", load);
    load();
    return () => { gone = true; clearTimeout(timer); observer.disconnect(); document.removeEventListener("visibilitychange", sync); window.removeEventListener("focus", sync); window.removeEventListener("blur", sync); window.removeEventListener("clem-theme", load); };
  }, [mark, size]);
  return (
    <span style={{ width: size, height: size }} className={`profile-character mark-${mark.id}`} aria-hidden="true">
      <canvas ref={ref} />
    </span>
  );
}

/** The pictures to choose from, as tiles: the mark, its name, and a tick on the one in use. */
export function ProfilePicker({ value, onChange }: { value?: string; onChange: (id: string) => void }) {
  const selected = marks.some((m) => m.id === value) ? value : "pip";
  return (
    <div className="profile-picker" role="radiogroup" aria-label="Choose your picture">
      {marks.map((m) => (
        <button type="button" role="radio" key={m.id} aria-checked={selected === m.id} onClick={() => onChange(m.id)}>
          <ProfileAvatar value={m.id} size={56} />
          <span>{m.name}</span>
        </button>
      ))}
    </div>
  );
}
