import { useEffect, useRef } from "react";
import "./profile-avatar.css";
const characters = [
  {
    id: "pip",
    name: "Orbit",
    body: "M24 49C24 17 75 15 76 48C77 80 23 84 24 49ZM24 40Q49 30 76 40",
  },
  {
    id: "moth",
    name: "Fold",
    body: "M24 29L66 24L78 40L73 77L25 75ZM66 24L63 42L78 40",
  },
  {
    id: "pebble",
    name: "Lantern",
    body: "M29 33Q48 17 68 33L73 73Q48 82 25 73ZM39 27Q48 10 59 27",
  },
  {
    id: "comet",
    name: "Clover",
    body: "M27 45C9 25 39 12 49 33C61 12 87 27 71 45C91 63 68 87 51 71C32 90 9 65 27 45Z",
  },
  {
    id: "cloudlet",
    name: "Drop",
    body: "M49 17C40 35 22 40 24 59C26 89 77 86 76 57C75 40 58 34 49 17Z",
  },
  {
    id: "noodle",
    name: "Arch",
    body: "M25 76L25 44C25 10 75 11 75 44L75 76L61 72L49 77L37 72Z",
  },
  {
    id: "finch",
    name: "Kite",
    body: "M49 19L80 49L64 78L33 77L18 48ZM49 19L47 36",
  },
  {
    id: "sprig",
    name: "Bloom",
    body: "M31 38C20 17 47 11 51 32C64 13 85 28 68 43C93 48 83 76 64 65C60 90 31 88 35 65C9 70 7 42 31 38Z",
  },
];
export function ProfileAvatar({
  value,
  size = 56,
}: {
  value?: string;
  size?: number;
}) {
  const c = characters.find((c) => c.id === value) || characters[0],
    ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const el = ref.current!;
    let visible = true;
    const sync = () =>
      el.classList.toggle("avatar-resting", !visible || document.hidden);
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      sync();
    });
    observer.observe(el);
    document.addEventListener("visibilitychange", sync);
    sync();
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);
  return (
    <svg
      ref={ref}
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={`profile-character character-${c.id}`}
      aria-hidden="true"
    >
      <path
        d={c.body}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <g className="character-face" fill="currentColor">
        <g className="character-eyes">
          <ellipse cx="40" cy="52" rx="2.5" ry="3.4" />
          <ellipse cx="57" cy="52" rx="2.5" ry="3.4" />
        </g>
        <path
          d="M43 62Q49 67 55 61"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </g>
      <path
        className="character-arm"
        d="M69 61Q78 69 83 59"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
export function ProfilePicker({
  value,
  onChange,
}: {
  value?: string;
  onChange: (id: string) => void;
}) {
  const selected = characters.some((c) => c.id === value) ? value : "pip";
  return (
    <div
      className="profile-picker"
      role="group"
      aria-label="Choose your character"
    >
      {characters.map((c) => (
        <button
          type="button"
          key={c.id}
          aria-pressed={selected === c.id}
          onClick={() => onChange(c.id)}
        >
          <ProfileAvatar value={c.id} />
          <span>{c.name}</span>
        </button>
      ))}
    </div>
  );
}
