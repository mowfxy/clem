import { useEffect, useState } from "react";
import { desktop } from "./bridge";
import { download } from "../store";
type Record = {
  id: string;
  key: string;
  text: string;
  kind: string;
  confirmed: boolean;
  source: { locator: string; at: string };
  supersededBy?: string;
};
export function MemoryPanel({ scope }: { scope: string }) {
  const [state, setState] = useState<{ enabled: boolean; records: Record[] }>({
      enabled: true,
      records: [],
    }),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const refresh = () =>
    desktop!.invoke({ action: "memoryList", scope }).then(setState);
  useEffect(() => {
    void refresh().catch((e) => setError(e.message));
  }, [scope]);
  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      await refresh();
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="desktop-folder-panel">
      <summary>Memory for this space</summary>
      <label>
        <input
          type="checkbox"
          checked={state.enabled}
          disabled={busy}
          onChange={(e) =>
            void run(() =>
              desktop!.invoke({
                action: "memoryToggle",
                enabled: e.target.checked,
              }),
            )
          }
        />
        Enable local memory
      </label>
      <p>
        Only facts you confirm here are saved. Sources are kept with every
        entry. Nothing is shared with other spaces automatically.
      </p>
      {state.records.map((record) => (
        <article key={record.id}>
          <strong>
            {record.key}
            {record.supersededBy ? " · superseded" : ""}
          </strong>
          <p>{record.text}</p>
          <small>
            {record.kind} · {record.source.locator} · {record.source.at}
          </small>
          <button
            disabled={busy}
            onClick={() =>
              void run(() =>
                desktop!.invoke({ action: "memoryForget", id: record.id }),
              )
            }
          >
            Forget
          </button>
        </article>
      ))}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget,
            fields = new FormData(form);
          void run(async () => {
            await desktop!.invoke({
              action: "memorySave",
              scope,
              key: String(fields.get("key")),
              text: String(fields.get("text")),
              kind: "fact",
              sharedWith: [],
            });
            form.reset();
          });
        }}
      >
        <label>
          Topic
          <input name="key" maxLength={100} required />
        </label>
        <label>
          Confirmed fact or correction
          <textarea name="text" maxLength={2000} required />
        </label>
        <button disabled={busy || !state.enabled}>Save confirmed fact</button>
      </form>
      <button
        onClick={() =>
          download(
            new Blob([JSON.stringify(state, null, 2)], {
              type: "application/json",
            }),
            "mowr-memory.json",
          )
        }
      >
        Export this space
      </button>
      {error && <p role="alert">{error}</p>}
    </details>
  );
}
