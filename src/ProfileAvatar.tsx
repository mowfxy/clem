import { useEffect, useRef, type ReactNode } from "react";
import "./profile-avatar.css";

type Character = { id: string; name: string; bg: string; body: string; shape: string; extra?: ReactNode; face?: [number, number] };
// Ids stay stable so saved choices keep working; the drawings are new.
const characters: Character[] = [
  { id: "pip", name: "Mochi", bg: "#2c2a26", body: "#f2ece0", shape: "M18 70C18 42 32 27 50 27C68 27 82 42 82 70C82 80 72 85 50 85C28 85 18 80 18 70Z" },
  { id: "moth", name: "Sprout", bg: "#1e2a21", body: "#d4e8cc", shape: "M21 62C21 45 34 34 50 34C66 34 79 45 79 62C79 78 66 86 50 86C34 86 21 78 21 62Z",
    extra: <g className="character-extra sprout"><path d="M50 35V25" stroke="#8fbf7f" strokeWidth="3" strokeLinecap="round" /><path d="M50 27C50 18 56 12 66 11C66 20 60 26 50 27Z" fill="#8fbf7f" /><path d="M50 29C49 22 44 18 37 18C38 25 43 29 50 29Z" fill="#a9d29a" /></g> },
  { id: "pebble", name: "Cloud", bg: "#1f2530", body: "#e6edf7", shape: "M28 80C15 80 11 66 21 60C17 46 33 38 43 45C47 33 67 31 71 45C83 43 90 57 82 65C88 75 80 81 72 80Z", face: [0, 3] },
  { id: "comet", name: "Pebble", bg: "#2a2622", body: "#e3d6c8", shape: "M21 63C19 45 35 31 54 31C72 31 83 45 81 61C79 77 65 85 49 85C33 85 22 77 21 63Z",
    extra: <path className="character-extra twinkle" d="M73 25L75 31L81 33L75 35L73 41L71 35L65 33L71 31Z" fill="#f2d9a6" /> },
  { id: "cloudlet", name: "Owl", bg: "#26222d", body: "#e2d9ee", shape: "M24 80V48C24 38 27 31 29 22L40 32C46 30 54 30 60 32L71 22C73 31 76 38 76 48V80C76 84 70 87 50 87C30 87 24 84 24 80Z", face: [0, -2] },
  { id: "noodle", name: "Boo", bg: "#232323", body: "#f4f4f1", shape: "M26 86V50C26 34 36 24 50 24C64 24 74 34 74 50V86L66 80L58 86L50 80L42 86L34 80Z", face: [0, -4] },
  { id: "finch", name: "Bean", bg: "#2b2322", body: "#f1d2c7", shape: "M33 31C48 21 70 27 74 45C78 61 70 83 50 85C34 87 22 75 24 61C25 51 21 39 33 31Z" },
  { id: "sprig", name: "Spark", bg: "#20262a", body: "#d9eef0", shape: "M22 65C22 47 34 37 50 37C66 37 78 47 78 65C78 81 66 87 50 87C34 87 22 81 22 65Z", face: [0, 4],
    extra: <g className="character-extra antenna"><path d="M50 38V23" stroke="#d9eef0" strokeWidth="3" strokeLinecap="round" /><circle cx="50" cy="19" r="5" fill="#f5c96b" /></g> },
];

export function ProfileAvatar({ value, size = 56 }: { value?: string; size?: number }) {
  const c = characters.find((c) => c.id === value) || characters[0], ref = useRef<SVGSVGElement>(null);
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
  const [dx, dy] = c.face || [0, 0];
  return (
    <svg ref={ref} width={size} height={size} viewBox="0 0 100 100" className={`profile-character character-${c.id}`} aria-hidden="true">
      <circle cx="50" cy="50" r="50" fill={c.bg} />
      <g className="character-body">
        {c.extra}
        <path className="character-arm" d="M76 66Q86 62 87 53" fill="none" stroke={c.body} strokeWidth="6" strokeLinecap="round" />
        <path d={c.shape} fill={c.body} />
        <g className="character-face" transform={`translate(${dx} ${dy})`}>
          <ellipse cx="37" cy="66" rx="4.5" ry="2.6" fill="#ff8f86" opacity=".35" />
          <ellipse cx="63" cy="66" rx="4.5" ry="2.6" fill="#ff8f86" opacity=".35" />
          <g className="character-eyes" fill="#1b1b1a">
            <ellipse cx="42" cy="58" rx="2.9" ry="3.8" />
            <ellipse cx="58" cy="58" rx="2.9" ry="3.8" />
            <circle cx="43" cy="56.6" r=".9" fill="#fff" />
            <circle cx="59" cy="56.6" r=".9" fill="#fff" />
          </g>
          <path d="M46 66Q50 69.5 54 66" fill="none" stroke="#1b1b1a" strokeWidth="2.2" strokeLinecap="round" />
        </g>
      </g>
    </svg>
  );
}

export function ProfilePicker({ value, onChange }: { value?: string; onChange: (id: string) => void }) {
  const selected = characters.some((c) => c.id === value) ? value : "pip";
  return (
    <div className="profile-picker" role="radiogroup" aria-label="Choose your character">
      {characters.map((c) => (
        <button type="button" role="radio" key={c.id} aria-checked={selected === c.id} aria-pressed={selected === c.id} onClick={() => onChange(c.id)}>
          <ProfileAvatar value={c.id} size={52} />
          <span>{c.name}</span>
        </button>
      ))}
    </div>
  );
}
