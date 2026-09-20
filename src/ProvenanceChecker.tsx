import { useState } from "react";
import { checkContent } from "../core/provenance";
import { Logo } from "./Icons";
import "./checker.css";
export default function ProvenanceChecker() {
  const [result, setResult] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <main className="provenance-page">
      <header>
        <Logo size={28} />
        <span>mowr / check</span>
      </header>
      <section>
        <span className="eyebrow">A little clarity</span>
        <h1>
          Does it carry
          <br />
          the Mowr mark?
        </h1>
        <p>Check a document for Mowr’s invisible export marker.</p>
        <label className="checker-drop">
          {busy ? "Checking…" : "Choose a file"}
          <input
            disabled={busy}
            type="file"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setBusy(true);
              setResult("");
              try {
                if (file.size > 250_000_000)
                  throw Error("Choose a file smaller than 250 MB.");
                const r = await checkContent(file);
                setResult(
                  r.status === "found"
                    ? "Mowr marker found. The marked content is unchanged."
                    : r.status === "changed"
                      ? "A marker was found, but it is invalid or the content has changed."
                      : "No Mowr marker found. This does not rule out Mowr: editing or re-exporting can remove the marker.",
                );
              } catch (e) {
                setResult((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          />
        </label>
        {result && (
          <div className="checker-result" role="status">
            {result}
          </div>
        )}
        <small>
          Your file stays in this browser. Nothing is uploaded.
          <br />
          Markers are not digital signatures or proof of authorship. They can be
          removed or copied.
        </small>
      </section>
      <footer>Made with care. Checked on your device.</footer>
    </main>
  );
}
