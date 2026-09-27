import { useEffect, useState, type RefObject } from "react";
import { commandsFor, readCommand, type SlashCommand } from "../../core/commands";
import { Icon } from "../Icons";
import "./slash.css";

/** A command as it appears in the composer and in a sent message: its icon and name in a small box. */
export function CommandChip({ command, onRemove }: { command: SlashCommand; onRemove?: () => void }) {
  const inner = <><Icon name={command.icon} size={15} /><span>{command.label}</span></>;
  return onRemove
    ? <button type="button" className="command-chip" title={`${command.description} · click to remove`} aria-label={`${command.label} command, remove`} onClick={onRemove}>{inner}</button>
    : <span className="command-chip" title={command.description}>{inner}</span>;
}

/** The composer's text box. Typing "/" lists the commands; choosing one turns it into a chip in front of the text.
 *  The message itself stays "/name words", which is what the app and the model read (see core/commands.ts). */
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
  const typing = !command && /^\/[a-z]*$/i.test(value) ? value.slice(1) : null;
  const options = typing === null ? [] : commandsFor(typing, inSubject);
  const [index, setIndex] = useState(0);
  const [closed, setClosed] = useState(false);
  useEffect(() => { setIndex(0); if (typing === null) setClosed(false); }, [typing]);
  const open = options.length > 0 && !closed;
  const at = Math.min(index, options.length - 1);

  const choose = (c: SlashCommand) => { onChange(`/${c.id} `); requestAnimationFrame(() => inputRef.current?.focus()); };
  const remove = () => { onChange(rest); requestAnimationFrame(() => inputRef.current?.focus()); };

  return (
    <div className={`slash-field ${command ? "has-command" : ""}`}>
      {open && (
        <div className="slash-menu" role="listbox" aria-label="Commands">
          {options.map((c, i) => (
            <button type="button" role="option" key={c.id} aria-selected={i === at} className={i === at ? "on" : ""}
              onMouseDown={(e) => { e.preventDefault(); choose(c); }} onMouseEnter={() => setIndex(i)}>
              <span className="slash-icon"><Icon name={c.icon} size={17} /></span>
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
        onChange={(e) => onChange(command ? `/${command.id} ${e.target.value}` : e.target.value)}
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
