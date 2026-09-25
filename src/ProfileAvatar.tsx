import { useEffect, useId, useRef, type ReactNode } from "react";
import "./profile-avatar.css";

const INK = "#f2f1ec";
type Mark = { id: string; name: string; draw: (clip: string) => ReactNode };
// Ids stay stable so saved choices keep working; the marks are plain black-and-white geometry.
const marks: Mark[] = [
  { id: "pip", name: "Orbit", draw: () => <><circle cx="50" cy="50" r="22" fill="none" stroke={INK} strokeWidth="2.5" opacity=".55" /><g className="av-spin"><circle cx="72" cy="50" r="6" fill={INK} /></g><circle cx="50" cy="50" r="7" fill={INK} /></> },
  { id: "moth", name: "Tide", draw: (clip) => <g clipPath={`url(#${clip})`}><g className="av-drift">{[36, 50, 64].map((y, i) => <path key={y} d={`M-40 ${y}q12.5 -9 25 0t25 0t25 0t25 0t25 0t25 0t25 0`} fill="none" stroke={INK} strokeWidth="3" strokeLinecap="round" opacity={1 - i * 0.28} />)}</g></g> },
  { id: "pebble", name: "Grid", draw: () => <>{[0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => <circle key={r * 3 + c} className="av-pulse" style={{ animationDelay: `${(r + c) * 0.25}s` }} cx={32 + c * 18} cy={32 + r * 18} r="4.6" fill={INK} />))}</> },
  { id: "comet", name: "Petal", draw: () => <g className="av-turn">{[0, 90, 180, 270].map((a) => <path key={a} transform={`rotate(${a} 50 50)`} d="M50 48C44 40 44 28 50 22C56 28 56 40 50 48Z" fill={INK} />)}</g> },
  { id: "cloudlet", name: "Moon", draw: (clip) => <g className="av-turn slow"><circle cx="50" cy="50" r="24" fill="none" stroke={INK} strokeWidth="2.5" /><g clipPath={`url(#${clip}-half)`}><circle cx="50" cy="50" r="24" fill={INK} /></g></g> },
  { id: "noodle", name: "Rings", draw: () => <>{[10, 19, 28].map((r, i) => <circle key={r} className="av-breathe" style={{ animationDelay: `${i * 0.4}s` }} cx="50" cy="50" r={r} fill="none" stroke={INK} strokeWidth="2.4" opacity={1 - i * 0.25} />)}</> },
  { id: "finch", name: "Prism", draw: () => <g className="av-turn slow"><path d="M50 24L74 66H26Z" fill="none" stroke={INK} strokeWidth="2.6" strokeLinejoin="round" /><path d="M50 24L50 66" stroke={INK} strokeWidth="2" opacity=".5" /><circle cx="50" cy="52" r="4.5" fill={INK} /></g> },
  { id: "sprig", name: "Lines", draw: (clip) => <g clipPath={`url(#${clip})`}><g className="av-slide">{Array.from({ length: 9 }, (_, i) => <path key={i} d={`M${-40 + i * 18} 110L${20 + i * 18} -10`} stroke={INK} strokeWidth="5" opacity={i % 2 ? 0.35 : 0.9} />)}</g></g> },
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
      <circle cx="50" cy="50" r="49.5" fill="#101010" stroke="#ffffff24" />
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
