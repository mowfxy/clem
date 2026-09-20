import { useEffect, useRef } from "react";
import "./profile-avatar.css";
const characters = [
  {
    id: "pip",
    name: "Pip",
    color: "#a9b88b",
    body: "M23 66C13 47 27 28 45 30C43 17 57 12 64 19C58 23 53 27 53 31C80 27 87 60 71 73C56 83 32 79 23 66Z",
  },
  {
    id: "moth",
    name: "Moth",
    color: "#969fdf",
    body: "M46 42C30 16 10 28 19 49C6 66 29 80 48 65C69 82 94 65 80 49C89 26 65 16 52 42Z",
  },
  {
    id: "pebble",
    name: "Pebble",
    color: "#c2b5a0",
    body: "M19 64C14 53 27 24 43 23C65 18 85 45 81 61C77 80 31 83 19 64Z",
  },
  {
    id: "comet",
    name: "Comet",
    color: "#d7a188",
    body: "M22 54L15 20L39 34L61 13L66 37C94 50 80 78 54 79C32 80 20 70 22 54Z",
  },
  {
    id: "cloudlet",
    name: "Cloudlet",
    color: "#bcc8cf",
    body: "M24 72C5 63 10 43 27 41C22 20 51 14 59 33C75 21 91 41 79 52C96 75 65 83 54 72C43 82 30 82 24 72Z",
  },
  {
    id: "noodle",
    name: "Noodle",
    color: "#c9bbdc",
    body: "M24 70C14 52 40 55 32 35C22 13 55 10 58 31C62 47 87 39 80 64C76 80 36 84 24 70Z",
  },
  {
    id: "finch",
    name: "Finch",
    color: "#cbbd81",
    body: "M25 67C13 39 43 18 63 28C76 32 78 44 74 50L88 56L73 61C67 81 40 81 25 67Z",
  },
  {
    id: "sprig",
    name: "Sprig",
    color: "#92b6a7",
    body: "M26 70L25 43C9 26 29 15 44 32C43 6 70 14 61 34C83 20 94 47 74 53L74 70Q48 85 26 70Z",
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
        fill={c.color}
        stroke="#eeeade"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <g className="character-face" fill="#292b2b">
        <g className="character-eyes">
          <ellipse cx="40" cy="52" rx="2.5" ry="3.4" />
          <ellipse cx="57" cy="52" rx="2.5" ry="3.4" />
        </g>
        <path
          d="M43 62Q49 67 55 61"
          fill="none"
          stroke="#292b2b"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </g>
      <path
        className="character-arm"
        d="M69 61Q78 69 83 59"
        fill="none"
        stroke="#eeeade"
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
