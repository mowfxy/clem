import { useState } from "react";
import { confirmDialog } from "./dialogs";
import type { Automation, Model } from "../core/types";
export function nextAutomation(schedule: string, after = Date.now()) {
  const date = new Date(after);
  date.setDate(date.getDate() + (schedule === "weekly" ? 7 : 1));
  return date.getTime();
}
export function LocalAutomations({
  items,
  models,
  onChange,
}: {
  items: Automation[];
  models: Model[];
  onChange: (items: Automation[]) => void;
}) {
  const [creating, setCreating] = useState(false);
  return (
    <section>
      <p>
        Tasks run on this computer while Mowr is open. A missed run is picked up
        once when you return. Results appear in your chats.
      </p>
      <button onClick={() => setCreating(!creating)}>
        {creating ? "Cancel" : "New automation"}
      </button>
      {creating && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            onChange([
              ...items,
              {
                id: crypto.randomUUID(),
                name: String(data.get("name")),
                prompt: String(data.get("prompt")),
                model: String(data.get("model")),
                schedule: String(data.get("schedule")),
                nextRun: new Date(String(data.get("start"))).getTime(),
                enabled: true,
                spaceId: null,
              },
            ]);
            setCreating(false);
          }}
        >
          <label>
            Name
            <input name="name" required maxLength={100} />
          </label>
          <label>
            Instructions
            <textarea name="prompt" required maxLength={8000} />
          </label>
          <label>
            Model
            <select aria-label="Model" name="model" required>
              <option value="">Choose a model</option>
              {models
                .filter((m) => m.connected)
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            First run (your local time)
            <input
              name="start"
              type="datetime-local"
              required
              min={new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
                .toISOString()
                .slice(0, 16)}
            />
          </label>
          <label>
            Repeat
            <select name="schedule">
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
            </select>
          </label>
          <p>Scheduled requests use your Codex subscription allowance.</p>
          <button type="submit">Schedule task</button>
        </form>
      )}
      {items.map((a) => (
        <article className="study-item" key={a.id}>
          <h3>{a.name}</h3>
          <p>
            {a.enabled
              ? "Next: " + new Date(a.nextRun || 0).toLocaleString()
              : "Paused"}
          </p>
          {a.lastError && <p role="status">{a.lastError}</p>}
          {a.lastRun && <p>Last run: {new Date(a.lastRun).toLocaleString()}</p>}
          <button
            onClick={() =>
              onChange(
                items.map((x) =>
                  x.id === a.id
                    ? {
                        ...x,
                        enabled: !x.enabled,
                        nextRun: Math.max(x.nextRun || 0, Date.now()),
                      }
                    : x,
                ),
              )
            }
          >
            {a.enabled ? "Pause" : "Resume"}
          </button>
          <button
            onClick={async () => {
              if (
                await confirmDialog({
                  title: "Delete this automation?",
                  message: "It stops running. Chats it already created are kept.",
                  confirm: "Delete",
                  danger: true,
                })
              )
                onChange(items.filter((x) => x.id !== a.id));
            }}
          >
            Delete
          </button>
        </article>
      ))}
    </section>
  );
}
