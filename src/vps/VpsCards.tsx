// The VPS's main-thread cards: a move finished (vps_moved), and a command or overwrite the AI asked for that waits for
// the person's one tap (vps_confirm). Same frame as the GUC and organizer cards.
import { useState } from "react";
import type { z } from "zod";
import type { vpsConfirmCard, vpsMovedCard } from "../../core/guc/cards";
import { Icon } from "../Icons";
import { desktop } from "../desktop/bridge";
import { bytes } from "./VpsRow";
import "../guc/guc.css";
import "./vps.css";

export function VpsMovedCardView({ card, onOpen }: { card: z.infer<typeof vpsMovedCard>; onOpen?: () => void }) {
  const up = card.direction === "up";
  return <div className="edit-proposal clem-card guc-card">
    <header><Icon name="server" size={16} /><div><strong>{up ? "Your files are on your VPS" : "Your files are back on this PC"}</strong><small>{card.files} file{card.files === 1 ? "" : "s"} · {bytes(card.bytes)}{card.failed ? ` · ${card.failed} stayed where they were` : ""}</small></div></header>
    <div className="guc-card-body"><p className="guc-card-line">{up ? "Each one was checked on your VPS first. Recent and pinned files stay on this PC so they open instantly." : "Each one was checked here before it left your VPS."}</p></div>
    {onOpen && <footer><button type="button" onClick={onOpen}>Storage settings</button></footer>}
  </div>;
}

type Done = { exitCode?: number; output?: string; ok?: boolean; error?: string; path?: string };
export function VpsConfirmCardView({ card }: { card: z.infer<typeof vpsConfirmCard> }) {
  const [state, setState] = useState<"ask" | "running" | "done" | "cancelled">("ask"), [result, setResult] = useState<Done | null>(null);
  const go = async () => { setState("running"); try { setResult(await desktop!.invoke({ action: "vpsConfirm", id: card.id })); } catch (e) { setResult({ error: String((e as Error).message || e) }); } setState("done"); };
  const cancel = () => { setState("cancelled"); void desktop?.invoke({ action: "vpsCancel", id: card.id }).catch(() => {}); };
  const run = card.action === "run";
  return <div className="edit-proposal clem-card guc-card" aria-busy={state === "running" || undefined}>
    <header><Icon name={state === "done" && !result?.error ? "check" : "alert"} size={16} /><div><strong>{state === "done" && !result?.error ? (run ? "Ran on your VPS" : "Replaced on your VPS") : run ? "Run this on your VPS?" : "Replace this file on your VPS?"}</strong><small>{card.reason ? "Clem asks first: " + card.reason : run ? "It could change the server." : "The file already exists."}</small></div></header>
    <div className="guc-card-body">
      <pre className="vps-card-output">{run ? card.command : card.path}</pre>
      {result && <pre className="vps-card-output" role="status">{result.error || (run ? `${result.output || "(no output)"}\n\nexit ${result.exitCode}` : `Saved ${result.path}`)}</pre>}
    </div>
    <footer>
      {state === "ask" && <><button type="button" onClick={cancel}>Cancel</button><button type="button" className="primary" onClick={() => void go()} disabled={!desktop}>{run ? "Run it" : "Replace it"}</button></>}
      {state === "running" && <small>Running…</small>}
      {state === "cancelled" && <small>Cancelled</small>}
    </footer>
  </div>;
}
