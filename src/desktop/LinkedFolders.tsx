import { useEffect, useState } from "react";
import { desktop } from "./bridge";
export function LinkedFolders({ scope }: { scope: string }) {
  const [folders, setFolders] = useState<{ id: string; path: string }[]>([]),
    [error, setError] = useState("");
  const refresh = () =>
    desktop!.invoke({ action: "folders", scope }).then(setFolders);
  useEffect(() => {
    let active = true;
    void desktop!.invoke({ action: "folders", scope }).then((f) => {
      if (active) setFolders(f);
    });
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
      {folders.map((folder) => (
        <p key={folder.id}>
          {folder.path}{" "}
          <button
            aria-label={"Unlink " + folder.path}
            onClick={() =>
              void desktop!
                .invoke({ action: "unlinkFolder", id: folder.id })
                .then(refresh)
                .catch((e) => setError(e.message))
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
            .catch((e) => setError(e.message))
        }
      >
        Link a local folder
      </button>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
