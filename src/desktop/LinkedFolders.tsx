import { useEffect, useState } from "react";
import { desktop } from "./bridge";
export function LinkedFolders({ scope }: { scope: string }) {
  const [folders, setFolders] = useState<{ id: string; path: string }[]>([]),
    [error, setError] = useState("");
  // Electron prefixes errors from the main process; the person sees only the reason.
  const fail = (e: unknown) => setError(String((e as Error)?.message || e).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "") || "Linked folders could not be read.");
  const refresh = () =>
    desktop!.invoke({ action: "folders", scope }).then((f) => { setFolders(f); setError(""); });
  useEffect(() => {
    let active = true;
    void desktop!.invoke({ action: "folders", scope }).then((f) => {
      if (active) { setFolders(f); setError(""); }
    }, (e) => { if (active) fail(e); });
    return () => {
      active = false;
    };
  }, [scope]);
  return (
    <section className="desktop-folder-panel">
      <strong>Linked folders</strong>
      <p>
        Selected text excerpts are sent to your AI provider when you ask a
        question in this space.
      </p>
      {!folders.length && !error && <p className="fine">No folders linked yet.</p>}
      {folders.map((folder) => (
        <p key={folder.id}>
          {folder.path}{" "}
          <button
            aria-label={"Unlink " + folder.path}
            onClick={() =>
              void desktop!
                .invoke({ action: "unlinkFolder", id: folder.id })
                .then(refresh)
                .catch(fail)
            }
          >
            Unlink
          </button>
        </p>
      ))}
      <button
        onClick={() =>
          void desktop!
            .invoke({ action: "linkFolder", scope })
            .then(refresh)
            .catch(fail)
        }
      >
        Link a local folder
      </button>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
