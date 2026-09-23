import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { Model } from "../core/types";
import { Icon } from "./Icons";
import { ReasoningInk } from "./ReasoningInk";
import "./model-selector.css";
const effortName = (value: string) => value === "low" ? "Light" : value === "xhigh" ? "Extra high" : value.charAt(0).toUpperCase() + value.slice(1);
export function ModelSelector({ models, value, onChange, onConnect, effort, onEffort, disabled = false }: {
  models: Model[]; value: string; onChange: (id: string) => void; onConnect: () => void;
  effort?: string; onEffort?: (effort: string) => void; disabled?: boolean;
}) {
  const [open, setOpen] = useState<"models" | "effort" | null>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const [visible, setVisible] = useState(!document.hidden);
  const root = useRef<HTMLDivElement>(null), panel = useRef<HTMLDivElement>(null);
  const modelButton = useRef<HTMLButtonElement>(null), effortButton = useRef<HTMLButtonElement>(null);
  const available = models.filter(m => m.connected), selected = available.find(m => m.id === value);
  const levels = selected?.reasoningEfforts || [];
  const requested = effort || selected?.defaultReasoningEffort;
  const index = Math.max(0, levels.findIndex(e => e.reasoningEffort === requested));
  const level = levels[index]?.reasoningEffort;
  const close = () => { setOpen(null); (open === "effort" ? effortButton : modelButton).current?.focus(); };
  useEffect(() => { if (disabled) setOpen(null); }, [disabled]);
  useEffect(() => {
    const outside = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node) && !panel.current?.contains(e.target as Node)) setOpen(null); };
    const visibility = () => setVisible(!document.hidden);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("visibilitychange", visibility);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("visibilitychange", visibility); };
  }, []);
  useLayoutEffect(() => {
    if (!open) return;
    const anchor = (open === "effort" ? effortButton : modelButton).current;
    const place = () => {
      if (!anchor || !panel.current) return;
      const a = anchor.getBoundingClientRect(), p = panel.current.getBoundingClientRect();
      setPosition({ left: Math.max(8, Math.min(a.right - p.width, innerWidth - p.width - 8)), top: Math.max(8, a.top - p.height - 8 >= 8 ? a.top - p.height - 8 : Math.min(a.bottom + 8, innerHeight - p.height - 8)) });
    };
    place();
    const observer = new ResizeObserver(place); if (panel.current) observer.observe(panel.current);
    window.addEventListener("resize", place); window.addEventListener("scroll", place, true);
    panel.current?.querySelector<HTMLElement>(open === "effort" ? "input" : '[aria-pressed="true"], .picker-model-row')?.focus();
    return () => { observer.disconnect(); window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open]);
  return <div className="model-selector compact-model-picker" ref={root}>
    <button ref={modelButton} type="button" disabled={disabled} aria-label="Choose model" aria-haspopup="dialog" aria-expanded={open === "models"} onClick={() => setOpen(open === "models" ? null : "models")}>
      <span>{selected?.name || "Choose model"}</span><Icon name="down" size={12}/>
    </button>
    {level && onEffort && <button ref={effortButton} className="picker-effort-trigger" type="button" disabled={disabled} aria-label="Reasoning effort" aria-haspopup="dialog" aria-expanded={open === "effort"} onClick={() => setOpen(open === "effort" ? null : "effort")}>
      {effortName(level)}<Icon name="down" size={11}/>
    </button>}
    {open && createPortal(<div ref={panel} className={`compact-picker-panel ${open === "effort" ? "effort-panel" : "models-panel"}`} role="dialog" aria-label={open === "models" ? "Select model" : "Adjust reasoning"} style={position} data-paused={!visible} onKeyDown={e => {
      if (e.key === "Escape") { e.stopPropagation(); close(); }
      if (open === "models" && ["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
        e.preventDefault(); const rows = Array.from(panel.current!.querySelectorAll<HTMLButtonElement>(".picker-model-row"));
        const current = rows.indexOf(document.activeElement as HTMLButtonElement);
        rows[e.key === "Home" ? 0 : e.key === "End" ? rows.length - 1 : (current + (e.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length]?.focus();
      }
    }}>
      {open === "models" ? <>
        <div className="picker-heading">Select model</div>
        <div className="picker-model-list">{available.map(m => <button className="picker-model-row" type="button" key={m.id} title={m.description} aria-pressed={value === m.id} onClick={() => { onChange(m.id); close(); }}>
          <span>{m.name}</span>{value === m.id && <Icon name="check" size={14}/>}</button>)}</div>
        {!available.length && <p className="picker-empty">Connect an account to see your models.</p>}
        <button type="button" className="picker-connect" onClick={() => { setOpen(null); onConnect(); }}>Manage connections<Icon name="arrow" size={13}/></button>
      </> : <>
        <div className="effort-panel-heading"><div><strong>{level ? effortName(level) : "Reasoning"}</strong><span>Reasoning effort</span></div>
          <button type="button" className="effort-reset" aria-label="Reset reasoning to model default" title="Reset to model default" onClick={() => onEffort?.(selected?.defaultReasoningEffort || levels[0]?.reasoningEffort)}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 10a8 8 0 1 1 1 7M4 4v6h6"/></svg></button>
        </div>
        <div className="effort-track" style={{ "--effort-progress": `${levels.length > 1 ? index / (levels.length - 1) * 100 : 0}%` } as CSSProperties}>
          <div className="effort-rail" aria-hidden="true"><div className="effort-fill"><ReasoningInk/></div><div className="effort-stops">{levels.map((e, i) => <span key={e.reasoningEffort} data-reached={i <= index}/>)}</div></div>
          <input aria-label="Reasoning effort level" aria-valuetext={level ? effortName(level) : "Default"} type="range" min="0" max={Math.max(0, levels.length - 1)} step="1" value={index} disabled={levels.length < 2} onChange={e => onEffort?.(levels[Number(e.target.value)].reasoningEffort)}/>
        </div>
        <div className="effort-scale"><span>Faster</span><span>Deeper</span></div>
      </>}
    </div>, document.body)}
  </div>;
}
