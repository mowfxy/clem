import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { Model } from "../core/types";
import { Icon, Logo } from "./Icons";
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
const PETAL = "M12 2c3.2-.9 5.6 1.3 5.5 4.4 0 2.1-1.3 3.9-2.7 4.2-.8.1-.7-1-.4-1.6.6-1.8-.8-2.5-2.2-1.8-1.4.6-2.2-.7-2.2-2.3 0-1.3.7-2.3 2-2.9Z";
/** Mowr's four-petal mark, small enough to drift through the thinking bar. */
function Petal({ style }: { style: CSSProperties }) {
  return <svg className="effort-petal" style={style} viewBox="0 0 24 24" aria-hidden="true">{[0, 90, 180, 270].map((r) => <path key={r} d={PETAL} transform={`rotate(${r} 12 12)`} />)}</svg>;
}
const petals = Array.from({ length: 9 }, (_, i) => ({ top: [18, 62, 34, 76, 46, 24, 68, 40, 56][i], size: [11, 8, 13, 9, 7, 12, 8, 10, 7][i], delay: -i * 0.61 }));

/** How hard the model thinks: a bar to drag, with Mowr's petals drifting faster as it climbs. */
function EffortSlider({ levels, level, model, onChange, onReset, hint }: {
  levels: string[]; level: string; model?: string; onChange: (effort: string) => void; onReset?: () => void; hint: string;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const last = Math.max(1, levels.length - 1), index = Math.max(0, levels.indexOf(level));
  const at = (x: number) => {
    const r = track.current!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (x - r.left - 16) / Math.max(1, r.width - 32)));
  };
  const pick = (p: number) => { const next = levels[Math.round(p * last)]; if (next && next !== level) onChange(next); };
  const intensity = levels.length > 1 ? index / last : 1;
  const style = { "--p": drag ?? intensity, "--speed": `${(5.2 - intensity * 3.4).toFixed(2)}s`, "--glow": 0.35 + intensity * 0.65 } as CSSProperties;
  return <div className="picker-effort">
    <div className="effort-head">
      <span className="effort-mark" style={{ transform: `rotate(${intensity * 90}deg)` }}><Logo size={16} /></span>
      <div className="effort-title"><b>{effortName(level)}</b>{model && <small>{model}</small>}</div>
      {onReset ? <button type="button" className="picker-effort-reset" aria-label="Reset thinking level" title="Reset to default" onClick={() => { onReset(); track.current?.focus(); }}><Icon name="undo" size={15} /></button> : <span className="effort-spacer" />}
    </div>
    <div ref={track} className={"effort-track" + (drag !== null ? " is-dragging" : "")} style={style} role="slider" tabIndex={0}
      aria-label="Reasoning effort" aria-valuemin={0} aria-valuemax={levels.length - 1} aria-valuenow={index} aria-valuetext={effortName(level)}
      onPointerDown={(e) => { if (e.button) return; e.currentTarget.setPointerCapture(e.pointerId); const p = at(e.clientX); setDrag(p); pick(p); }}
      onPointerMove={(e) => { if (drag === null) return; const p = at(e.clientX); setDrag(p); pick(p); }}
      onPointerUp={() => setDrag(null)} onPointerCancel={() => setDrag(null)}
      onKeyDown={(e) => {
        if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) return;
        e.preventDefault();
        const next = e.key === "Home" ? 0 : e.key === "End" ? levels.length - 1 : Math.max(0, Math.min(levels.length - 1, index + (e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : -1)));
        onChange(levels[next]);
      }}>
      {levels.map((l, i) => i > index && <span key={l} className="effort-stop" style={{ "--at": i / last } as CSSProperties} />)}
      <span className="effort-fill">{petals.map((p, i) => <Petal key={i} style={{ top: p.top + "%", width: p.size, height: p.size, animationDelay: `calc(var(--speed) * ${(p.delay / 5).toFixed(3)})` }} />)}</span>
      <span className="effort-knob" />
    </div>
    <p className="picker-effort-hint">{hint}</p>
  </div>;
}

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
      {onEffort && levels.length > 0 && <EffortSlider levels={levels.map((l) => l.reasoningEffort)} level={level!} model={selected?.name} onChange={onEffort}
        onReset={selected?.defaultReasoningEffort && level !== selected.defaultReasoningEffort ? () => onEffort(selected.defaultReasoningEffort!) : undefined}
        hint={(level && (levels.find((l) => l.reasoningEffort === level)?.description?.length || 0) > 12 ? levels.find((l) => l.reasoningEffort === level)!.description : effortHint[level || ""]) || "How long the model thinks before answering."} />}
      <button type="button" className="picker-connect" onClick={() => { close(false); onConnect(); }}>Manage connections<Icon name="arrow" size={13} /></button>
    </div>, document.body)}
  </div>;
}
