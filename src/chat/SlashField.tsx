import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { commandsFor, readCommand, type SlashCommand } from "../../core/commands";
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
 *  its name with a space) leaves "/name" right where it was typed, drawn as a small pill behind the words so the
 *  sentence reads straight through. The message is moved to "/name words" only when it is sent (see core/commands.ts). */
export function SlashField({ value, onChange, onEnter, placeholder, inSubject, inputRef }: {
  value: string;
  onChange: (value: string) => void;
  onEnter: () => void;
  placeholder: string;
  inSubject: boolean;
  inputRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const [caret, setCaret] = useState(value.length);
  // The "/word" being typed just before the caret, if any (only one command per message).
  const typed = /(^|\s)\/([a-z-]*)$/i.exec(value.slice(0, caret));
  // A finished command is a known "/name" followed by a space or the end that the caret is not still typing.
  const token = [...value.matchAll(/(^|\s)\/([a-z]+(?:-[a-z]+)*)(?=\s|$)/gi)].find((m) => readCommand(`/${m[2]}`) && !(typed && m.index + m[0].length === caret));
  const command = token ? readCommand(`/${token[2]}`)!.command : null;
  const options = typed && !command ? commandsFor(typed[2], inSubject) : [];
  const [index, setIndex] = useState(0);
  const [closed, setClosed] = useState(false);
  const typing = typed ? typed[2] : null;
  useEffect(() => { setIndex(0); if (typing === null) setClosed(false); }, [typing]);
  const open = options.length > 0 && !closed;
  const at = Math.min(index, options.length - 1);
  const mirror = useRef<HTMLDivElement>(null);
  // The pill layer copies the text box's type so both wrap and scroll identically.
  useLayoutEffect(() => {
    const el = inputRef.current, m = mirror.current;
    if (!el || !m) return;
    const css = getComputedStyle(el);
    for (const k of ["fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "wordSpacing", "textIndent"] as const) m.style[k] = css[k];
    // The words are painted by this layer (so the command can be tinted); the box keeps only the caret.
    m.style.color = el.dataset.ink ||= css.color;
    el.style.caretColor = el.dataset.ink;
    // Grows with the message; the stylesheet's max-height caps it and the box scrolls past that.
    const top = el.scrollTop;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + parseFloat(css.borderTopWidth) + parseFloat(css.borderBottomWidth)}px`;
    el.scrollTop = top;
    m.scrollTop = el.scrollTop;
  });
  // Puts the caret back after the text is rewritten, unless more was typed in the meantime.
  const focusAt = (pos: number, text: string) => requestAnimationFrame(() => { const el = inputRef.current; if (!el) return; el.focus(); if (el.value !== text) return; el.setSelectionRange(pos, pos); setCaret(pos); });

  const choose = (c: SlashCommand) => {
    const start = typed!.index + typed![1].length;
    const after = value.slice(caret);
    const next = `${value.slice(0, start)}/${c.id} ${after.replace(/^[ 	]+/, "")}`;
    onChange(next);
    focusAt(start + c.id.length + 2, next);
  };
  const split = token ? token.index + token[1].length : 0;

  return (
    <div className="slash-field">
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
      <div className="slash-mirror" aria-hidden="true" ref={mirror}>
        {token ? <>{value.slice(0, split)}<mark><b>/</b>{value.slice(split + 1, split + token[2].length + 1)}</mark>{value.slice(split + token[2].length + 1)}</> : value}{"\n"}
      </div>
      <textarea
        ref={inputRef}
        rows={1}
        className={command ? "has-command" : undefined}
        aria-label="Your message"
        aria-autocomplete="list"
        aria-expanded={open}
        placeholder={placeholder}
        value={value}
        onChange={(e) => { setCaret(e.target.selectionStart); onChange(e.target.value); }}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
        onScroll={(e) => { if (mirror.current) mirror.current.scrollTop = e.currentTarget.scrollTop; }}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (open) {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); setIndex((at + (e.key === "ArrowDown" ? 1 : -1) + options.length) % options.length); return; }
            if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); choose(options[at]); return; }
            if (e.key === "Escape") { e.preventDefault(); setClosed(true); return; }
          }
          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onEnter(); }
        }}
      />
    </div>
  );
}
