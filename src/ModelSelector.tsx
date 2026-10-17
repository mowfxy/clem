import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { Model } from "../core/types";
import { Icon, MARK } from "./Icons";
import { ProviderLogo } from "./BrandLogos";
import "./model-selector.css";

export const effortName = (value: string) =>
  value === "low" ? "Light" : value === "minimal" ? "Minimal" : value === "xhigh" ? "Extra high" : value.charAt(0).toUpperCase() + value.slice(1);
const EFFORT_NAMES = ["minimal", "low", "medium", "high", "xhigh", "max"];
/** Mowr's mark, small enough to drift through the thinking bar. */
function Petal({ style }: { style: CSSProperties }) {
  return <svg className="effort-petal" style={style} viewBox={MARK.viewBox} fill="none" stroke="currentColor" strokeWidth={MARK.width} strokeLinecap="round" aria-hidden="true">{MARK.turns.map((r) => <path key={r} d={MARK.arm} transform={`rotate(${r} 72 72)`} />)}</svg>;
}
const petals = Array.from({ length: 9 }, (_, i) => ({ top: [18, 62, 34, 76, 46, 24, 68, 40, 56][i], size: [11, 8, 13, 9, 7, 12, 8, 10, 7][i], delay: -i * 0.53 }));

/** How hard the model thinks: a bar to drag, with Mowr's marks drifting faster and thicker as it climbs. */
function EffortSlider({ levels, level, onChange }: {
  levels: string[]; level: string; onChange: (effort: string) => void;
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
  const live = drag ?? intensity;
  // The drift speeds up through its playback rate, so every petal keeps its place instead of the loop restarting.
  useEffect(() => {
    const rate = 0.75 + live * 1.6;
    for (const animation of track.current?.getAnimations({ subtree: true }) || []) if (animation instanceof CSSAnimation && animation.animationName !== "effort-sheen") animation.updatePlaybackRate(rate);
  }, [live]);
  const shown = Math.round(3 + live * (petals.length - 3));
  const style = { "--p": live, "--glow": 0.35 + live * 0.65 } as CSSProperties;
  return <div className="picker-effort">
    <div className="effort-head">
      <div className="effort-title"><b>{effortName(level)}</b><small>thinking</small></div>
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
      {levels.map((l, i) => <span key={l} className={"effort-stop" + (i <= index ? " is-passed" : "")} style={{ "--at": i / last } as CSSProperties} />)}
      <span className="effort-fill">{petals.map((p, i) => <span key={i} className={"effort-lane" + (i < shown ? " is-on" : "")} style={{ animationDelay: p.delay + "s" }}><Petal style={{ top: p.top + "%", width: p.size, height: p.size, animationDelay: p.delay + "s" }} /></span>)}</span>
      <span className="effort-knob" />
    </div>
  </div>;
}

function ProviderMark({ provider }: { provider?: string }) {
  return <span className={"picker-mark " + (provider === "Anthropic" ? "picker-mark-anthropic" : provider === "xAI" ? "picker-mark-grok" : "picker-mark-openai")} aria-hidden="true"><ProviderLogo provider={provider} size={16} /></span>;
}

/** A small popover anchored above (or below) its trigger. */
function usePopover(trigger: RefObject<HTMLButtonElement | null>, open: boolean, close: () => void) {
  const panel = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = trigger.current;
      if (!anchor || !panel.current) return;
      const a = anchor.getBoundingClientRect(), p = panel.current.getBoundingClientRect();
      const above = a.top - p.height - 8;
      setPosition({ left: Math.max(8, Math.min(a.left, innerWidth - p.width - 8)), top: above >= 8 ? above : Math.max(8, Math.min(a.bottom + 8, innerHeight - p.height - 8)) });
    };
    place();
    const observer = new ResizeObserver(place); if (panel.current) observer.observe(panel.current);
    const outside = (e: PointerEvent) => { if (!panel.current?.contains(e.target as Node) && !trigger.current?.contains(e.target as Node)) close(); };
    // Escape closes only this menu: inside a modal dialog (Settings) the dialog's own "cancel" that follows is swallowed.
    const escape = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault(); e.stopPropagation();
      const dialog = trigger.current?.closest("dialog");
      if (dialog) { const swallow = (c: Event) => { c.preventDefault(); c.stopImmediatePropagation(); }; dialog.addEventListener("cancel", swallow, { capture: true, once: true }); setTimeout(() => dialog.removeEventListener("cancel", swallow, { capture: true }), 200); }
      close(); trigger.current?.focus();
    };
    addEventListener("resize", place); addEventListener("scroll", place, true);
    document.addEventListener("pointerdown", outside); document.addEventListener("keydown", escape, true);
    return () => { observer.disconnect(); removeEventListener("resize", place); removeEventListener("scroll", place, true); document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape, true); };
  }, [open]);
  return { panel, position };
}

/** The trigger already shows the provider's mark, so "Claude Sonnet 5.5" reads as "Sonnet 5.5" there. */
const shortName = (m: Model) => m.provider === "Anthropic" ? m.name.replace(/^Claude\s+/, "") : m.name;

/** Two small controls: which model, and how hard it thinks. `auto`: the name of a first choice that picks no model
 *  (value ""), such as Settings' automatic model for background tasks. */
export function ModelSelector({ models, value, onChange, onConnect, effort, onEffort, disabled = false, auto, label = "Choose model" }: {
  models: Model[]; value: string; onChange: (id: string) => void; onConnect?: () => void;
  effort?: string; onEffort?: (effort: string) => void; disabled?: boolean; auto?: string; label?: string;
}) {
  const [open, setOpen] = useState<"model" | "effort" | null>(null);
  const modelButton = useRef<HTMLButtonElement>(null), effortButton = useRef<HTMLButtonElement>(null);
  const close = () => setOpen(null);
  // Inside a modal dialog (Settings) the menu goes in the dialog: anywhere else it would sit under the dialog's top layer.
  const host = () => modelButton.current?.closest("dialog") || document.body;
  const modelPop = usePopover(modelButton, open === "model", close), effortPop = usePopover(effortButton, open === "effort", close);
  const available = models.filter((m) => m.connected), selected = available.find((m) => m.id === value);
  const levels = selected?.reasoningEfforts || [];
  const requested = effort || selected?.defaultReasoningEffort;
  const level = levels.find((e) => e.reasoningEffort === requested)?.reasoningEffort || levels[0]?.reasoningEffort;
  const multi = new Set(available.map((m) => m.provider)).size > 1;
  useEffect(() => { if (disabled) setOpen(null); }, [disabled]);
  useLayoutEffect(() => {
    if (open === "model") modelPop.panel.current?.querySelector<HTMLElement>('.picker-model-row[aria-checked="true"], .picker-model-row')?.focus();
    if (open === "effort") effortPop.panel.current?.querySelector<HTMLElement>(".effort-track")?.focus();
  }, [open]);
  const moveRow = (key: string) => {
    const rows = Array.from(modelPop.panel.current!.querySelectorAll<HTMLButtonElement>(".picker-model-row"));
    const current = rows.indexOf(document.activeElement as HTMLButtonElement);
    rows[key === "Home" ? 0 : key === "End" ? rows.length - 1 : current < 0 ? 0 : (current + (key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length]?.focus();
  };
  return <div className="model-selector unified-model-picker">
    <button ref={modelButton} type="button" className="picker-trigger" disabled={disabled} aria-label={label} aria-haspopup="menu" aria-expanded={open === "model"} aria-description={selected?.name || (auto && !value ? auto : "Choose a model")} onClick={() => setOpen(open === "model" ? null : "model")}>
      {selected && <ProviderMark provider={selected.provider} />}
      <span className="picker-trigger-name">{(selected && shortName(selected)) || (auto && !value ? auto : "Choose model")}</span>
      <Icon name="down" size={12} />
    </button>
    {level && onEffort && levels.length > 0 && <button ref={effortButton} type="button" className="picker-trigger picker-trigger-effort" data-level={level} data-provider={selected?.provider} disabled={disabled} aria-label="Thinking level" aria-haspopup="dialog" aria-expanded={open === "effort"} aria-description={effortName(level) + " thinking"} onClick={() => setOpen(open === "effort" ? null : "effort")}>
      <span className="effort-pip" aria-hidden="true" style={{ "--p": levels.length > 1 ? levels.findIndex((l) => l.reasoningEffort === level) / (levels.length - 1) : 1 } as CSSProperties} />
      {/* Every name sits in the same cell so the button keeps the widest one's width and the model button never shifts. */}
      <span className="effort-label">{[...new Set([...EFFORT_NAMES, ...levels.map((l) => l.reasoningEffort)])].map((l) => <span key={l} aria-hidden={l !== level || undefined} className={l === level ? "is-on" : undefined}>{effortName(l)}</span>)}</span>
    </button>}
    {open === "model" && createPortal(<div ref={modelPop.panel} className="unified-picker-panel model-pop" role="menu" aria-label="Select model" style={modelPop.position} onKeyDown={(e) => { if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) { e.preventDefault(); moveRow(e.key); } }}>
      {/* The models scroll in their own list, so a long one never runs off the window; "Manage connections" stays in view. */}
      <div className="picker-model-list">
      {auto && <button className="picker-model-row picker-model-auto" type="button" role="menuitemradio" aria-checked={!value} aria-label={auto} onClick={() => { onChange(""); close(); modelButton.current?.focus(); }}>
        <span className="picker-model-name">{auto}</span>
        {!value && <Icon name="check" size={13} />}
      </button>}
      {available.map((m, i) => <div key={m.id}>
        {multi && (i === 0 || available[i - 1].provider !== m.provider) && <div className="picker-group-name">{m.provider === "Anthropic" ? "Claude" : m.provider === "xAI" ? "Grok" : m.provider}</div>}
        <button className="picker-model-row" type="button" role="menuitemradio" aria-checked={value === m.id} aria-label={m.name} onClick={() => { onChange(m.id); close(); modelButton.current?.focus(); }}>
          <ProviderMark provider={m.provider} />
          <span className="picker-model-name">{m.name}</span>
          {value === m.id && <Icon name="check" size={13} />}
        </button>
      </div>)}
      {!available.length && <p className="picker-empty">Connect ChatGPT, Claude or Grok to see your models.</p>}
      </div>
      {onConnect && <button type="button" className="picker-connect" onClick={() => { close(); onConnect(); }}>Manage connections<Icon name="arrow" size={12} /></button>}
    </div>, host())}
    {open === "effort" && onEffort && level && createPortal(<div ref={effortPop.panel} className="unified-picker-panel effort-pop" data-provider={selected?.provider} role="dialog" aria-label="Thinking level" style={effortPop.position}>
      <EffortSlider levels={levels.map((l) => l.reasoningEffort)} level={level} onChange={onEffort} />
    </div>, host())}
  </div>;
}
