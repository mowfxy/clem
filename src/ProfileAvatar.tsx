import { useEffect, useId, useRef, type ReactNode } from "react";
import "./profile-avatar.css";

const INK = "#f2f1ec", GREY = "#63635e", BG = "#101010";
type Mark = { id: string; name: string; draw: (clip: string) => ReactNode };
// Ids stay stable so saved choices keep working. Drawn like the illustrations: an ivory line over flat grey shapes.
const line = { fill: "none", stroke: INK, strokeWidth: 2.6, strokeLinecap: "round", strokeLinejoin: "round" } as const;
const solid = { fill: GREY, stroke: INK, strokeWidth: 2.6, strokeLinejoin: "round" } as const;
const marks: Mark[] = [
  { id: "pip", name: "Orbit", draw: () => <><circle cx="50" cy="50" r="27" {...line} strokeWidth={1.8} opacity=".5" /><circle cx="50" cy="50" r="13" {...solid} /><g className="av-spin"><circle cx="77" cy="50" r="5" fill={INK} /></g></> },
  { id: "moth", name: "Tide", draw: (clip) => <g clipPath={`url(#${clip})`}><circle cx="50" cy="40" r="10" {...solid} /><g className="av-drift">{[57, 68].map((y, i) => <path key={y} d={`M-40 ${y}q12.5 -8 25 0t25 0t25 0t25 0t25 0t25 0t25 0`} {...line} opacity={1 - i * 0.35} />)}</g></g> },
  { id: "pebble", name: "Grid", draw: () => <>{[0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => <circle key={r * 3 + c} className="av-pulse" style={{ animationDelay: `${(r + c) * 0.25}s` }} cx={32 + c * 18} cy={32 + r * 18} r="5" {...solid} strokeWidth={2} />))}</> },
  { id: "comet", name: "Petal", draw: () => <g className="av-turn">{[0, 90, 180, 270].map((a) => <path key={a} transform={`rotate(${a} 50 50)`} d="M50 47C44 40 44 29 50 23C56 29 56 40 50 47Z" {...solid} strokeWidth={2.2} />)}</g> },
  { id: "cloudlet", name: "Moon", draw: (clip) => <g className="av-turn slow">
    <defs><mask id={clip + "-moon"}><rect width="100" height="100" fill="#fff" /><circle cx="60" cy="43" r="17" fill="#000" /></mask><clipPath id={clip + "-disc"}><circle cx="50" cy="50" r="21" /></clipPath></defs>
    <g mask={`url(#${clip}-moon)`}><circle cx="50" cy="50" r="21" {...solid} /></g>
    <circle cx="60" cy="43" r="17" {...line} clipPath={`url(#${clip}-disc)`} />
    <circle cx="69" cy="66" r="2.4" fill={INK} /><circle cx="33" cy="32" r="1.8" fill={INK} /></g> },
  { id: "noodle", name: "Rings", draw: () => <>{[17, 27].map((r, i) => <circle key={r} className="av-breathe" style={{ animationDelay: `${i * 0.4}s` }} cx="50" cy="50" r={r} {...line} opacity={1 - i * 0.35} />)}<circle className="av-breathe" cx="50" cy="50" r="7" {...solid} /></> },
  { id: "finch", name: "Prism", draw: () => <g className="av-turn slow"><path d="M24 54L42 51" {...line} /><path d="M50 26L72 64H28Z" {...solid} /><path d="M60 46L78 40M61 50L79 50M60 54L78 60" {...line} strokeWidth={2} opacity=".7" /></g> },
  { id: "sprig", name: "Lines", draw: (clip) => <g clipPath={`url(#${clip})`}><g className="av-slide">{Array.from({ length: 9 }, (_, i) => <path key={i} d={`M${-40 + i * 18} 110L${20 + i * 18} -10`} stroke={i % 2 ? GREY : INK} strokeWidth={i % 2 ? 6 : 2.6} strokeLinecap="round" />)}</g></g> },
];

export function ProfileAvatar({ value, size = 56 }: { value?: string; size?: number }) {
  const mark = marks.find((m) => m.id === value) || marks[0], ref = useRef<SVGSVGElement>(null);
  const clip = "av" + useId().replace(/[^a-zA-Z0-9]/g, "");
  useEffect(() => {
    const el = ref.current!;
    let visible = true;
    const sync = () => el.classList.toggle("avatar-resting", !visible || document.hidden);
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync(); });
    observer.observe(el);
    document.addEventListener("visibilitychange", sync);
    sync();
    return () => { observer.disconnect(); document.removeEventListener("visibilitychange", sync); };
  }, []);
  return (
    <svg ref={ref} width={size} height={size} viewBox="0 0 100 100" className={`profile-character mark-${mark.id}`} aria-hidden="true">
      <defs>
        <clipPath id={clip}><circle cx="50" cy="50" r="30" /></clipPath>
        <clipPath id={clip + "-half"}><rect x="50" y="0" width="50" height="100" /></clipPath>
      </defs>
      <circle cx="50" cy="50" r="49.5" fill={BG} stroke="#ffffff24" />
      {mark.draw(clip)}
    </svg>
  );
}

export function ProfilePicker({ value, onChange }: { value?: string; onChange: (id: string) => void }) {
  const selected = marks.some((m) => m.id === value) ? value : "pip";
  return (
    <div className="profile-picker" role="radiogroup" aria-label="Choose your picture">
      {marks.map((m) => (
        <button type="button" role="radio" key={m.id} aria-checked={selected === m.id} aria-pressed={selected === m.id} onClick={() => onChange(m.id)}>
          <ProfileAvatar value={m.id} size={52} />
          <span>{m.name}</span>
        </button>
      ))}
    </div>
  );
}
