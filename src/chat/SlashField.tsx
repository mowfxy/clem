import { useEffect, useState, type RefObject } from "react";
import { commandsFor, leadingCommand, readCommand, type SlashCommand } from "../../core/commands";
import { Icon } from "../Icons";
import "./slash.css";

/** A command as it appears in the composer and in a sent message: its icon and name in a small box. */
export function CommandChip({ command, onRemove }: { command: SlashCommand; onRemove?: () => void }) {
  const inner = <><Icon name={command.icon} size={16} /><span>{command.label}</span></>;
  return onRemove
    ? <button type="button" className="command-chip" aria-description={`${command.description} · click to remove`} aria-label={`${command.label} command, remove`} onClick={onRemove}>{inner}</button>
    : <span className="command-chip" aria-description={command.description}>{inner}</span>;
}

/** The composer's text box. Typing "/" at the start or after a space lists the commands; choosing one (or finishing
 *  its name with a space) turns it into a chip in front of the text. The message itself stays "/name words", which is
 *  what the app and the model read (see core/commands.ts). */
export function SlashField({ value, onChange, onEnter, placeholder, inSubject, inputRef }: {
  value: string;
  onChange: (value: string) => void;
  onEnter: () => void;
  placeholder: string;
  inSubject: boolean;
  inputRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const head = /^\/([a-z]+)\s/i.exec(value);
  const command = head ? readCommand(value)?.command ?? null : null;
  const rest = command ? value.slice(head![0].length) : value;
  const [caret, setCaret] = useState(rest.length);
  // The "/word" being typed just before the caret, if any (only one command per message).
  const typed = command ? null : /(^|\s)\/([a-z]*)$/i.exec(rest.slice(0, caret));
  const options = typed ? commandsFor(typed[2], inSubject) : [];
  const [index, setIndex] = useState(0);
  const [closed, setClosed] = useState(false);
  const typing = typed ? typed[2] : null;
  useEffect(() => { setIndex(0); if (typing === null) setClosed(false); }, [typing]);
  const open = options.length > 0 && !closed;
  const at = Math.min(index, options.length - 1);
  // Puts the caret back after the text is rewritten, unless more was typed in the meantime.
  const focusAt = (pos: number, text: string) => requestAnimationFrame(() => { const el = inputRef.current; if (!el) return; el.focus(); if (el.value !== text) return; el.setSelectionRange(pos, pos); setCaret(pos); });

  const choose = (c: SlashCommand) => {
    const start = typed!.index + typed![1].length;
    const before = rest.slice(0, start).replace(/[ \t]+$/, ""), after = rest.slice(caret).replace(/^[ \t]+/, "");
    // The words around the command close up with one space, and the caret goes where the command was.
    const lead = before.replace(/^\s+/, ""), gap = lead && !lead.endsWith("\n") ? " " : "";
    onChange(`/${c.id} ${lead}${gap}${after}`);
    focusAt(lead.length + gap.length, lead + gap + after);
  };
  const remove = () => { onChange(rest); focusAt(0, rest); };
  const edit = (text: string, pos: number) => {
    setCaret(pos);
    if (command) return onChange(`/${command.id} ${text}`);
    // A command typed out in full, then a space, becomes a chip too.
    const done = [...text.matchAll(/(^|\s)\/([a-z]+)\s/gi)].find((m) => readCommand(`/${m[2]}`));
    if (done) { const moved = leadingCommand(text); onChange(moved); focusAt(Math.max(0, pos - done[2].length - 1), moved.slice(moved.indexOf(" ") + 1)); return; }
    onChange(text);
  };

  return (
    <div className={`slash-field ${command ? "has-command" : ""}`}>
      {open && (
        <div className="slash-menu" role="listbox" aria-label="Commands">
          {options.map((c, i) => (
            <button type="button" role="option" key={c.id} aria-selected={i === at} className={i === at ? "on" : ""}
              ref={i === at ? (el) => el?.scrollIntoView({ block: "nearest" }) : undefined}
              onMouseDown={(e) => { e.preventDefault(); choose(c); }} onMouseEnter={() => setIndex(i)}>
              <Icon name={c.icon} size={16} />
              <span className="slash-name">/{c.id}</span>
              <span className="slash-desc">{c.description}</span>
            </button>
          ))}
        </div>
      )}
      {command && <CommandChip command={command} onRemove={remove} />}
      <textarea
        ref={inputRef}
        aria-label="Your message"
        aria-autocomplete="list"
        aria-expanded={open}
        placeholder={command ? command.placeholder : placeholder}
        value={rest}
        onChange={(e) => edit(e.target.value, e.target.selectionStart)}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (open) {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); setIndex((at + (e.key === "ArrowDown" ? 1 : -1) + options.length) % options.length); return; }
            if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); choose(options[at]); return; }
            if (e.key === "Escape") { e.preventDefault(); setClosed(true); return; }
          }
          if (command && e.key === "Backspace" && e.currentTarget.selectionStart === 0 && e.currentTarget.selectionEnd === 0) { e.preventDefault(); remove(); return; }
          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onEnter(); }
        }}
      />
    </div>
  );
}
