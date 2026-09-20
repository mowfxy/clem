import "./settings-features.css";
import { useEffect, useRef } from "react";
export function SettingsFeature({ kind }: { kind: "memory" | "automation" }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const element = ref.current!;
    let visible = true;
    const sync = () => {
      element.dataset.motion = String(visible && !document.hidden);
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      sync();
    });
    observer.observe(element);
    document.addEventListener("visibilitychange", sync);
    sync();
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);
  return (
    <aside ref={ref} className={"settings-feature " + kind}>
      <div>
        <span className="eyebrow">Made for your way of working</span>
        <h3>
          {kind === "memory"
            ? "A little context goes a long way."
            : "Leave a thought for later."}
        </h3>
        <p>
          {kind === "memory"
            ? "Keep preferences and useful context close. Review or change what Mowr remembers whenever you like. Each project and subject keeps its own context."
            : "Set a recurring task, choose a model, and find the result in your chats. Your computer must be awake with Mowr open and signed in."}
        </p>
      </div>
      <svg
        viewBox="0 0 160 130"
        aria-hidden="true"
        fill="none"
        stroke="#e9e8dc"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {kind === "memory" ? (
          <>
            <path d="M26 32Q47 23 72 32L72 106Q48 98 26 104ZM72 32Q101 23 128 33L126 105Q99 96 72 106M36 47L58 44M86 47L114 50M36 61L58 59M87 65L111 66" />
            <g className="feature-spark">
              <path d="M78 9L86 22M97 9L94 23M108 18L101 27" stroke="#aebc98" />
            </g>
          </>
        ) : (
          <>
            <circle cx="73" cy="57" r="35" />
            <path d="M53 14L41 27M92 14L105 27M47 91L39 105M97 91L105 105" />
            <g className="feature-hand">
              <path d="M73 34L73 57L92 68" />
            </g>
            <path d="M118 70L144 74L138 109L113 105Z" fill="#8e9ad1" />
            <path d="M119 91L126 99L138 84" stroke="#171916" />
          </>
        )}
      </svg>
    </aside>
  );
}
