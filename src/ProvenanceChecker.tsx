import { useRef, useState } from "react";
import { checkContent } from "../core/provenance";
import { Logo, Icon } from "./Icons";
import { Illustration } from "./Illustrations";
import "./checker.css";
type Verdict = {
  tone: "found" | "changed" | "none" | "error";
  icon: string;
  title: string;
  body: string;
};
const verdicts: Record<"found" | "changed" | "none", Verdict> = {
  found: {
    tone: "found",
    icon: "verify",
    title: "Made with Mowr",
    body: "The Mowr mark is in this file and the content is unchanged since it was exported.",
  },
  changed: {
    tone: "changed",
    icon: "alert",
    title: "The mark doesn't match",
    body: "A Mowr mark was found, but it is invalid or the content has changed since it was exported.",
  },
  none: {
    tone: "none",
    icon: "search",
    title: "No Mowr mark found",
    body: "This doesn't rule out Mowr: editing or re-exporting a file can remove the mark.",
  },
};
export default function ProvenanceChecker() {
  const [verdict, setVerdict] = useState<Verdict | null>(null),
    [busy, setBusy] = useState(false),
    [filename, setFilename] = useState(""),
    [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null),
    checking = useRef(false);
  async function check(file?: File) {
    if (!file || checking.current) return;
    checking.current = true;
    setBusy(true);
    setVerdict(null);
    setFilename(file.name);
    try {
      if (file.size > 250_000_000)
        throw Error("Choose a file smaller than 250 MB.");
      const r = await checkContent(file);
      setVerdict(verdicts[r.status === "found" ? "found" : r.status === "changed" ? "changed" : "none"]);
    } catch (e) {
      setVerdict({
        tone: "error",
        icon: "alert",
        title: "Couldn't read that file",
        body: (e as Error).message,
      });
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
          <Illustration scene="discover" className="checker-art" />
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
            <h2>{busy ? "Reading the mark…" : "Drop a file to check it"}</h2>
            <p>{filename || "Documents, slides, sheets and PDFs made with Mowr."}</p>
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
          {verdict && (
            <div
              className={"checker-result " + verdict.tone}
              role="status"
              aria-label={verdict.title}
            >
              <span className="checker-result-mark">
                <Icon name={verdict.icon} size={22} />
              </span>
              <div>
                <h3>{verdict.title}</h3>
                <p>{verdict.body}</p>
                {filename && <small>{filename}</small>}
              </div>
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
