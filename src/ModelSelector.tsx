import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Model } from "../core/types";
import { Icon } from "./Icons";
import { ProviderLogo } from "./BrandLogos";
import "./model-selector.css";

export const effortName = (value: string) =>
  value === "low" ? "Light" : value === "minimal" ? "Minimal" : value === "xhigh" ? "Extra high" : value.charAt(0).toUpperCase() + value.slice(1);
const effortHint: Record<string, string> = {
  minimal: "Fastest replies for simple questions.",
  low: "Quick answers with light reasoning.",
  medium: "Balanced speed and depth.",
  high: "Thinks longer on hard problems.",
  xhigh: "Deepest reasoning. Slowest.",
};
function ProviderMark({ provider }: { provider?: string }) {
  return <span className={"picker-mark " + (provider === "Anthropic" ? "picker-mark-anthropic" : "picker-mark-openai")} aria-hidden="true"><ProviderLogo provider={provider} size={12} /></span>;
}

/** One trigger, one panel: choose the model, then how hard it should think. */
export function ModelSelector({ models, value, onChange, onConnect, effort, onEffort, disabled = false }: {
  models: Model[]; value: string; onChange: (id: string) => void; onConnect: () => void;
  effort?: string; onEffort?: (effort: string) => void; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false), [query, setQuery] = useState("");
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const root = useRef<HTMLDivElement>(null), panel = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const available = models.filter((m) => m.connected), selected = available.find((m) => m.id === value);
  const levels = selected?.reasoningEfforts || [];
  const requested = effort || selected?.defaultReasoningEffort;
  const level = levels.find((e) => e.reasoningEffort === requested)?.reasoningEffort || levels[0]?.reasoningEffort;
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const shown = available.filter((m) => !q || (m.name + " " + (m.description || "") + " " + m.provider).toLowerCase().includes(q));
    const by = new Map<string, Model[]>();
    for (const m of shown) by.set(m.provider, [...(by.get(m.provider) || []), m]);
    return [...by.entries()];
  }, [available, query]);
  const close = (focus = true) => { setOpen(false); setQuery(""); if (focus) trigger.current?.focus(); };
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useEffect(() => {
    const outside = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node) && !panel.current?.contains(e.target as Node)) { setOpen(false); setQuery(""); } };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = trigger.current;
      if (!anchor || !panel.current) return;
      const a = anchor.getBoundingClientRect(), p = panel.current.getBoundingClientRect();
      const above = a.top - p.height - 8;
      setPosition({ left: Math.max(8, Math.min(a.right - p.width, innerWidth - p.width - 8)), top: above >= 8 ? above : Math.max(8, Math.min(a.bottom + 8, innerHeight - p.height - 8)) });
    };
    place();
    const observer = new ResizeObserver(place); if (panel.current) observer.observe(panel.current);
    window.addEventListener("resize", place); window.addEventListener("scroll", place, true);
    // Escape closes the panel even when focus has left it (for example after Reset hides itself).
    const escape = (e: KeyboardEvent) => { if (e.key === "Escape" && !panel.current?.contains(document.activeElement)) { e.stopPropagation(); close(); } };
    document.addEventListener("keydown", escape);
    (panel.current?.querySelector<HTMLElement>(".picker-search input") || panel.current?.querySelector<HTMLElement>('.picker-model-row[aria-pressed="true"], .picker-model-row'))?.focus();
    return () => { observer.disconnect(); document.removeEventListener("keydown", escape); window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open]);
  const moveRow = (key: string) => {
    const rows = Array.from(panel.current!.querySelectorAll<HTMLButtonElement>(".picker-model-row"));
    const current = rows.indexOf(document.activeElement as HTMLButtonElement);
    rows[key === "Home" ? 0 : key === "End" ? rows.length - 1 : current < 0 ? 0 : (current + (key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length]?.focus();
  };
  return <div className="model-selector unified-model-picker" ref={root}>
    <button ref={trigger} type="button" className="picker-trigger" disabled={disabled} aria-label="Choose model" aria-haspopup="dialog" aria-expanded={open} title={selected ? `${selected.name}${level ? " · " + effortName(level) + " thinking" : ""}` : "Choose a model"} onClick={() => open ? close(false) : setOpen(true)}>
      {selected && <ProviderMark provider={selected.provider} />}
      <span className="picker-trigger-name">{selected?.name || "Choose model"}</span>
      {level && onEffort && <span className="picker-trigger-effort" data-level={level}>{effortName(level)}</span>}
      <Icon name="down" size={12} />
    </button>
    {open && createPortal(<div ref={panel} className="unified-picker-panel" role="dialog" aria-label="Select model" style={position} onKeyDown={(e) => {
      if (e.key === "Escape") { e.stopPropagation(); close(); }
      if (["ArrowDown", "ArrowUp"].includes(e.key) && !(e.target as HTMLElement).closest(".picker-effort")) { e.preventDefault(); moveRow(e.key); }
      if (["Home", "End"].includes(e.key) && (e.target as HTMLElement).classList.contains("picker-model-row")) { e.preventDefault(); moveRow(e.key); }
    }}>
      {available.length > 6 && <label className="picker-search"><Icon name="search" size={14} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search models" aria-label="Search models" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); panel.current?.querySelector<HTMLButtonElement>(".picker-model-row")?.click(); } }} /></label>}
      <div className="picker-model-list">
        {groups.map(([provider, list]) => <div className="picker-group" key={provider} role="group" aria-label={provider}>
          {(groups.length > 1 || available.length > 6) && <div className="picker-group-name">{provider === "Anthropic" ? "Claude" : provider}</div>}
          {list.map((m) => <button className="picker-model-row" type="button" key={m.id} aria-pressed={value === m.id} aria-label={m.name} onClick={() => { onChange(m.id); if (!onEffort || !(m.reasoningEfforts?.length)) close(); }}>
            <ProviderMark provider={m.provider} />
            <span className="picker-model-text"><span className="picker-model-name">{m.name}{m.isDefault && <em>Default</em>}</span>{m.description && <small>{m.description}</small>}</span>
            {value === m.id && <Icon name="check" size={14} />}
          </button>)}
        </div>)}
        {!available.length && <p className="picker-empty">Connect a ChatGPT or Claude account to see your models.</p>}
        {available.length > 0 && !groups.length && <p className="picker-empty">No models match “{query}”.</p>}
      </div>
      {onEffort && levels.length > 0 && <div className="picker-effort">
        <div className="picker-effort-head"><span>Thinking</span>{selected?.defaultReasoningEffort && level !== selected.defaultReasoningEffort && <button type="button" className="picker-effort-reset" onClick={() => { onEffort(selected.defaultReasoningEffort!); requestAnimationFrame(() => panel.current?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')?.focus()); }}>Reset</button>}</div>
        <div className="picker-effort-options" role="radiogroup" aria-label="Reasoning effort" onKeyDown={(e) => {
          if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) return;
          e.preventDefault();
          const i = levels.findIndex((l) => l.reasoningEffort === level);
          const next = e.key === "Home" ? 0 : e.key === "End" ? levels.length - 1 : Math.max(0, Math.min(levels.length - 1, i + (e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1)));
          onEffort(levels[next].reasoningEffort);
          (e.currentTarget.children[next] as HTMLElement)?.focus();
        }}>
          {levels.map((l) => <button type="button" role="radio" key={l.reasoningEffort} aria-checked={l.reasoningEffort === level} tabIndex={l.reasoningEffort === level ? 0 : -1} onClick={() => onEffort(l.reasoningEffort)}>{effortName(l.reasoningEffort)}</button>)}
        </div>
        <p className="picker-effort-hint">{(level && (levels.find((l) => l.reasoningEffort === level)?.description?.length || 0) > 12 ? levels.find((l) => l.reasoningEffort === level)!.description : effortHint[level || ""]) || "How long the model thinks before answering."}</p>
      </div>}
      <button type="button" className="picker-connect" onClick={() => { close(false); onConnect(); }}>Manage connections<Icon name="arrow" size={13} /></button>
    </div>, document.body)}
  </div>;
}
