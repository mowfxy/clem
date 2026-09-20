import { useEffect, useRef, useState } from "react";
import type { Model } from "../core/types";
import { Icon } from "./Icons";
import "./model-selector.css";
export function ModelSelector({
  models,
  value,
  onChange,
  onConnect,
  effort,
  onEffort,
  disabled = false,
}: {
  models: Model[];
  value: string;
  onChange: (id: string) => void;
  onConnect: () => void;
  effort?: string;
  onEffort?: (effort: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false),
    ref = useRef<HTMLDivElement>(null),
    button = useRef<HTMLButtonElement>(null);
  const available = models.filter((m) => m.connected),
    selected = available.find((m) => m.id === value),
    level = effort || selected?.defaultReasoningEffort;
  useEffect(() => {
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  return (
    <div
      className="model-selector"
      ref={ref}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          setOpen(false);
          button.current?.focus();
        }
      }}
    >
      <button
        ref={button}
        type="button"
        disabled={disabled}
        aria-expanded={open}
        aria-label="Choose model"
        onClick={() => setOpen(!open)}
      >
        {selected?.name || "Choose model"}
        {level && <span className="effort-caption">{level}</span>}
        <Icon name="down" size={12} />
      </button>
      {open && (
        <div className="model-menu">
          <header>
            <span>Model</span>
            <small>From your Codex account</small>
          </header>
          <div className="model-options">
            {available.map((m) => (
              <button
                type="button"
                key={m.id}
                aria-pressed={value === m.id}
                onClick={() => {
                  onChange(m.id);
                  if (!onEffort) setOpen(false);
                }}
              >
                <span>
                  {m.name}
                  {m.description && <small>{m.description}</small>}
                </span>
                {value === m.id && <Icon name="check" size={15} />}
              </button>
            ))}
          </div>
          {!available.length && (
            <p>Connect Codex to load your available models.</p>
          )}
          {!!selected?.reasoningEfforts?.length && onEffort && (
            <fieldset>
              <legend>Reasoning</legend>
              <div className="reasoning-options">
                {selected.reasoningEfforts.map((e) => (
                  <button
                    type="button"
                    key={e.reasoningEffort}
                    title={e.description}
                    aria-pressed={level === e.reasoningEffort}
                    onClick={() => {
                      onEffort(e.reasoningEffort);
                      setOpen(false);
                      button.current?.focus();
                    }}
                  >
                    {e.reasoningEffort === "low" ? "Light" : e.reasoningEffort}
                  </button>
                ))}
              </div>
            </fieldset>
          )}
          <button
            type="button"
            className="model-manage"
            onClick={() => {
              setOpen(false);
              onConnect();
            }}
          >
            Manage connection <Icon name="arrow" size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
