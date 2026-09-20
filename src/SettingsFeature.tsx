import "./settings-features.css";
import { Illustration } from "./Illustrations";
export function SettingsFeature({ kind }: { kind: "memory" | "automation" }) {
  return (
    <aside className={"settings-feature " + kind}>
      <div className="settings-feature-copy">
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
      <Illustration
        ambient
        scene={kind === "memory" ? "orchestrate" : "schedule"}
        className="settings-feature-art"
      />
    </aside>
  );
}
