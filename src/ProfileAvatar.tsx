import { Fragment, useEffect, useId, useRef, type ReactNode } from "react";
import "./profile-avatar.css";

const INK = "#f2f1ec", GREY = "#63635e", BG = "#101010";
/** A moving part, drawn on the same 100×100 stage as the still parts. `window` shows it only inside the r=30 circle. */
type Layer = { motion: string; draw: ReactNode; origin?: string; delay?: string; window?: boolean };
type Mark = { id: string; name: string; still?: ReactNode; moving: (id: string) => Layer[] };
// Ids stay stable so saved choices keep working. Drawn like the illustrations: an ivory line over flat grey shapes.
// The avatar sits in the sidebar on every screen, so its motion runs on the compositor: each moving part is its own
// HTML layer turned or slid by CSS. Moving shapes inside the SVG instead made Chromium re-layer the whole page on
// every frame, which cost a third of a core in a long chat.
const line = { fill: "none", stroke: INK, strokeWidth: 2.6, strokeLinecap: "round", strokeLinejoin: "round" } as const;
const solid = { fill: GREY, stroke: INK, strokeWidth: 2.6, strokeLinejoin: "round" } as const;
const marks: Mark[] = [
  { id: "pip", name: "Orbit", still: <><circle cx="50" cy="50" r="27" {...line} strokeWidth={1.8} opacity=".5" /><circle cx="50" cy="50" r="13" {...solid} /></>, moving: () => [{ motion: "av-spin", draw: <circle cx="77" cy="50" r="5" fill={INK} /> }] },
  { id: "moth", name: "Tide", still: <circle cx="50" cy="40" r="10" {...solid} />, moving: () => [{ motion: "av-drift", window: true, draw: [57, 68].map((y, i) => <path key={y} d={`M-40 ${y}q12.5 -8 25 0t25 0t25 0t25 0t25 0t25 0t25 0`} {...line} opacity={1 - i * 0.35} />) }] },
  { id: "pebble", name: "Grid", moving: () => [0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => ({ motion: "av-pulse", origin: `${32 + c * 18}% ${32 + r * 18}%`, delay: `${(r + c) * 0.25}s`, draw: <circle cx={32 + c * 18} cy={32 + r * 18} r="5" {...solid} strokeWidth={2} /> }))) },
  { id: "comet", name: "Petal", moving: () => [{ motion: "av-turn", draw: [0, 90, 180, 270].map((a) => <path key={a} transform={`rotate(${a} 50 50)`} d="M50 47C44 40 44 29 50 23C56 29 56 40 50 47Z" {...solid} strokeWidth={2.2} />) }] },
  { id: "cloudlet", name: "Moon", moving: (id) => [{ motion: "av-turn slow", draw: <>
    <defs><mask id={id + "-moon"}><rect width="100" height="100" fill="#fff" /><circle cx="60" cy="43" r="17" fill="#000" /></mask><clipPath id={id + "-disc"}><circle cx="50" cy="50" r="21" /></clipPath></defs>
    <g mask={`url(#${id}-moon)`}><circle cx="50" cy="50" r="21" {...solid} /></g>
    <circle cx="60" cy="43" r="17" {...line} clipPath={`url(#${id}-disc)`} />
    <circle cx="69" cy="66" r="2.4" fill={INK} /><circle cx="33" cy="32" r="1.8" fill={INK} /></> }] },
  { id: "noodle", name: "Rings", moving: () => [...[17, 27].map((r, i) => ({ motion: "av-breathe", delay: `${i * 0.4}s`, draw: <circle cx="50" cy="50" r={r} {...line} opacity={1 - i * 0.35} /> })), { motion: "av-breathe", draw: <circle cx="50" cy="50" r="7" {...solid} /> }] },
  { id: "finch", name: "Prism", moving: () => [{ motion: "av-turn slow", draw: <><path d="M24 54L42 51" {...line} /><path d="M50 26L72 64H28Z" {...solid} /><path d="M60 46L78 40M61 50L79 50M60 54L78 60" {...line} strokeWidth={2} opacity=".7" /></> }] },
  { id: "sprig", name: "Lines", moving: () => [{ motion: "av-slide", window: true, draw: Array.from({ length: 9 }, (_, i) => <path key={i} d={`M${-40 + i * 18} 110L${20 + i * 18} -10`} stroke={i % 2 ? GREY : INK} strokeWidth={i % 2 ? 6 : 2.6} strokeLinecap="round" />) }] },
];

export function ProfileAvatar({ value, size = 56 }: { value?: string; size?: number }) {
  const mark = marks.find((m) => m.id === value) || marks[0], ref = useRef<HTMLSpanElement>(null);
  const id = "av" + useId().replace(/[^a-zA-Z0-9]/g, "");
  useEffect(() => {
    const el = ref.current!;
    let visible = true;
    // Rests while off screen, minimised or while another window has focus (the new-chat sky slows down then too).
    const sync = () => el.classList.toggle("avatar-resting", !visible || document.hidden || !document.hasFocus());
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync(); });
    observer.observe(el);
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("focus", sync); window.addEventListener("blur", sync);
    sync();
    return () => { observer.disconnect(); document.removeEventListener("visibilitychange", sync); window.removeEventListener("focus", sync); window.removeEventListener("blur", sync); };
  }, []);
  return (
    <span ref={ref} style={{ width: size, height: size }} className={`profile-character mark-${mark.id}`} aria-hidden="true">
      <svg viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="49.5" fill={BG} stroke="#ffffff24" />
        {mark.still}
      </svg>
      {mark.moving(id).map((layer, i) => {
        const part = <span className={`av-layer ${layer.motion}`} style={{ transformOrigin: layer.origin, animationDelay: layer.delay }}><svg viewBox="0 0 100 100" overflow="visible">{layer.draw}</svg></span>;
        return layer.window ? <span key={i} className="av-window">{part}</span> : <Fragment key={i}>{part}</Fragment>;
      })}
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
