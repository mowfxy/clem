import { useRef, useState } from "react";
import { checkContent } from "../core/provenance";
import { Logo, Icon } from "./Icons";
import { Illustration } from "./Illustrations";
import "./checker.css";
export default function ProvenanceChecker() {
  const [result, setResult] = useState(""),
    [busy, setBusy] = useState(false),
    [filename, setFilename] = useState(""),
    [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null),
    checking = useRef(false);
  async function check(file?: File) {
    if (!file || checking.current) return;
    checking.current = true;
    setBusy(true);
    setResult("");
    setFilename(file.name);
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
      checking.current = false;
      setBusy(false);
    }
  }
  return (
    <main className="provenance-page">
      <header>
        <a href="https://mowrai.com" aria-label="Mowr home">
          <Logo size={28} />
          <span>
            mowr <span className="checker-slash">/</span> check
          </span>
        </a>
      </header>
      <section className="checker-layout">
        <div className="checker-intro">
          <Illustration ambient scene="discover" className="checker-art" />
          <span className="eyebrow">A little clarity</span>
          <h1>
            Does it carry
            <br />
            the Mowr mark?
          </h1>
          <p>Look for the invisible marker in a document made with Mowr.</p>
        </div>
        <div className="checker-workspace">
          <div
            className={"checker-drop" + (dragging ? " dragging" : "")}
            aria-busy={busy}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node))
                setDragging(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              void check(e.dataTransfer.files[0]);
            }}
          >
            <span className="checker-file-mark">
              <Icon name="files" size={30} />
            </span>
            <h2>{busy ? "Reading the mark…" : "A file. A little clarity."}</h2>
            <p>{filename || "Drop your document here to take a look."}</p>
            <button
              className="primary"
              disabled={busy}
              onClick={() => input.current?.click()}
            >
              {busy
                ? "Checking…"
                : filename
                  ? "Choose another file"
                  : "Choose a file"}
              <Icon name="plus" size={17} />
            </button>
            <input
              ref={input}
              hidden
              aria-label="Choose a file to check"
              disabled={busy}
              type="file"
              onChange={(e) => {
                void check(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            <small>PDF, Office documents, text and more · up to 250 MB</small>
          </div>
          {result && (
            <div className="checker-result" role="status">
              {result}
            </div>
          )}
          <p className="checker-private">
            <Icon name="check" size={15} />
            Your file stays on your device. Nothing is uploaded.
          </p>
          <small className="checker-disclaimer">
            Markers can be removed or copied. This check identifies an export
            marker, not proof of authorship.
          </small>
        </div>
      </section>
      <footer>
        <span>Made with care. Checked on your device.</span>
        <a href="https://mowrai.com/#/privacy">Privacy</a>
      </footer>
    </main>
  );
}
