import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Icon } from "../Icons";
import { desktop } from "../desktop/bridge";
import { detectSeparator, parseQuizlet, separatorNames, type ImportedCard, type Separator } from "../../core/flashcard-import";
import type { Space } from "../../core/types";
import "./share.css";

/** Where cards come from: an Anki deck (.apkg, read in the main process), or Quizlet text (a file or pasted). */
export type CardSource = { kind: "apkg"; name: string; bytes: Uint8Array } | { kind: "text"; name: string; text: string } | { kind: "paste" };
export type ReadDeck = { name: string; cards: ImportedCard[]; media: { name: string; data: Uint8Array }[]; warnings: string[] };
export const MAX_TEXT = 5_000_000;
export const isDeckFile = (name: string) => /\.apkg$/i.test(name);
export const isCardText = (name: string) => /\.(txt|csv|tsv)$/i.test(name);

/** Reads a file the person picked or dropped into a source, refusing what is too large before reading it whole. */
export async function sourceOf(file: File): Promise<CardSource> {
  if (isDeckFile(file.name)) {
    if (file.size > 250_000_000) throw Error("This deck is over 250 MB, too large to import.");
    return { kind: "apkg", name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) };
  }
  if (isCardText(file.name)) {
    if (file.size > MAX_TEXT) throw Error("This file is over 5 MB, too large for a set of cards.");
    return { kind: "text", name: file.name, text: await file.text() };
  }
  throw Error("Clem imports Anki decks (.apkg) and Quizlet exports (.txt or .csv).");
}

const clean = (e: unknown) => (e as Error).message?.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") || "That file couldn't be read.";

/**
 * Import cards from Anki or Quizlet: what is in the file (or the pasted text), a few cards to check, what doesn't carry
 * over, and where it goes. Nothing is added until Import.
 */
export function FlashcardImport({ source, subjects, target, onImport, onCancel }: { source: CardSource; subjects: Space[]; target?: string; onImport: (deck: ReadDeck, spaceId: string | null) => Promise<void>; onCancel: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), picker = useRef<HTMLInputElement>(null);
  const [current, setCurrent] = useState<CardSource>(source), [deck, setDeck] = useState<ReadDeck | null>(null), [error, setError] = useState("");
  const [text, setText] = useState(source.kind === "text" ? source.text : ""), [separator, setSeparator] = useState<Separator | "auto">("auto");
  const [title, setTitle] = useState(""), [where, setWhere] = useState(target || (subjects[0]?.id ?? "new")), [busy, setBusy] = useState("");
  useEffect(() => { dialog.current?.showModal(); }, []);
  // An Anki deck is read in the main process's worker; the window stays free meanwhile.
  useEffect(() => {
    setError(""); setDeck(null);
    if (current.kind !== "apkg") return;
    let live = true;
    setBusy("Reading the deck…");
    void desktop!.invoke({ action: "ankiRead", name: current.name.slice(0, 260), data: current.bytes as Uint8Array<ArrayBuffer> }).then((read: ReadDeck) => { if (live) { setDeck(read); setTitle(read.name); } }, (e) => { if (live) setError(clean(e)); }).finally(() => { if (live) setBusy(""); });
    return () => { live = false; };
  }, [current]);
  // Quizlet text is parsed here as it is typed or pasted (it is capped at 5 MB).
  const parsed = current.kind !== "apkg" && text.trim() ? parseQuizlet(text.slice(0, MAX_TEXT), separator === "auto" ? detectSeparator(text) : separator) : null;
  useEffect(() => { if (current.kind !== "apkg") setTitle((t) => t || (current.kind === "text" ? current.name.replace(/\.(txt|csv|tsv)$/i, "") : "Quizlet set")); }, [current]);
  const shown: ReadDeck | null = current.kind === "apkg" ? deck : parsed?.cards.length ? { name: title, cards: parsed.cards, media: [], warnings: parsed.skipped ? [`${parsed.skipped} line${parsed.skipped === 1 ? "" : "s"} without both a term and a definition ${parsed.skipped === 1 ? "was" : "were"} left out.`] : [] } : null;
  const history = shown?.cards.filter((c) => c.state).length || 0, decks = new Set(shown?.cards.map((c) => c.deck).filter(Boolean)).size;
  const choose = () => picker.current?.click();
  return <dialog ref={dialog} className="share-sheet pack-open card-import" aria-label="Import flashcards" onClose={onCancel} onClick={(e) => { if (e.target === dialog.current) onCancel(); }}>
    <input ref={picker} type="file" hidden accept=".apkg,.txt,.csv,.tsv" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void sourceOf(f).then((s) => { setCurrent(s); if (s.kind === "text") setText(s.text); setTitle(""); }, (err) => setError(clean(err))); }} />
    <div className="po-cover">
      <span className="sh-eyebrow">{current.kind === "apkg" ? "From Anki" : "From Quizlet"}</span>
      <h2>{current.kind === "paste" ? "Paste your Quizlet set" : current.name}</h2>
      {shown && <div className="po-chips">
        <span><Icon name="subjects" size={14} />{shown.cards.length.toLocaleString()} card{shown.cards.length === 1 ? "" : "s"}</span>
        {decks > 1 && <span><Icon name="projects" size={14} />{decks} decks</span>}
        {history > 0 && <span><Icon name="clock" size={14} />{history} with review history</span>}
        {shown.media.length > 0 && <span><Icon name="files" size={14} />{shown.media.length} picture{shown.media.length === 1 ? "" : "s"}</span>}
      </div>}
    </div>
    <div className="sh-body">
      {current.kind !== "apkg" && <>
        <textarea className="ci-text" aria-label="Quizlet export" rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder={"In Quizlet: ⋯ → Export → Copy text, then paste it here.\nMitochondria\tMakes most of the cell’s ATP\nRibosome\tBuilds proteins"} />
        <label className="ci-row">Between term and definition
          <select value={separator} onChange={(e) => setSeparator(e.target.value as Separator | "auto")} aria-label="Separator">
            <option value="auto">Find it for me{parsed ? ` (${separatorNames[parsed.separator]})` : ""}</option>
            {(Object.keys(separatorNames) as Separator[]).map((s) => <option key={s} value={s}>{separatorNames[s]}</option>)}
          </select>
        </label>
      </>}
      {shown && <div className="po-sample">{shown.cards.slice(0, 3).map((c, i) => <div key={i} style={{ "--i": i } as CSSProperties}><b>{c.question}</b><span>{c.answer}</span></div>)}</div>}
      {shown && <label className="ci-row">Name<input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} aria-label="Set name" /></label>}
      {shown && <label className="ci-row">Add to<select value={where} onChange={(e) => setWhere(e.target.value)} aria-label="Add to">
        <option value="new">A new subject: {title || shown.name}</option>
        {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select></label>}
      {shown?.warnings.map((w) => <p key={w} className="sh-private ci-note"><Icon name="alert" size={14} />{w}</p>)}
      {shown && current.kind === "apkg" && !history && <p className="sh-private"><Icon name="check" size={14} />The cards start as new in your review schedule.</p>}
      {current.kind !== "apkg" && text.trim() && !parsed?.cards.length && <p className="inline-error" role="alert">No cards found. Each line needs a term, then a definition after the separator.</p>}
      {busy && <p className="muted" role="status">{busy}</p>}
      {error && <p className="inline-error" role="alert">{error}</p>}
    </div>
    <footer className="sh-foot">
      <button className="sh-ghost" onClick={choose}>Choose a file…</button>
      <button className="sh-ghost" onClick={onCancel}>Cancel</button>
      <button className="primary" disabled={!shown || !!busy} onClick={() => { if (!shown) return; setBusy("Adding…"); void onImport({ ...shown, name: title.trim() || shown.name }, where === "new" ? null : where).catch((e) => setError(clean(e))).finally(() => setBusy("")); }}>Import<Icon name="arrow" size={16} /></button>
    </footer>
  </dialog>;
}
