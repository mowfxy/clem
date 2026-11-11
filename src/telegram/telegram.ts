// Telegram's pairing as the window sees it (desktop/engine/telegram.ts through tg* requests). One shared state, so the
// pair card in the main thread and Settings → Channels → Telegram always show the same thing: the status, a live
// code with its countdown (polled until the chat sends it), Connected as @name, Unpair.
import { useEffect, useState } from "react";
import { desktop } from "../desktop/bridge";
import { confirmDialog } from "../dialogs";

export type TgStatus = { configured: boolean; bot?: string; paired: { name: string; since: number; online?: boolean } | null };
export type TgCode = { code: string; link: string; expires: number; bot: string };
type Shared = { status: TgStatus | null; code: TgCode | null; error: string; busy: boolean };

const clean = (e: unknown) => String((e as Error)?.message || e || "").replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, "");
const ask = <T,>(request: Record<string, unknown>) => desktop!.invoke(request as never) as Promise<T>;
let shared: Shared = { status: null, code: null, error: "", busy: false };
const listeners = new Set<() => void>();
const set = (next: Partial<Shared>) => { shared = { ...shared, ...next }; for (const fn of listeners) fn(); };
let poll: ReturnType<typeof setInterval> | undefined;

export async function refresh(fresh = false) {
  if (!desktop) return;
  try {
    const status = await ask<TgStatus>({ action: "tgStatus", fresh });
    set({ status, error: "", ...(status.paired ? { code: null } : {}) });
  } catch (e) { set({ error: clean(e), status: shared.status || { configured: false, paired: null } }); }
}
/** While a code is showing, ask every few seconds whether the chat has sent it. */
function watch() {
  if (poll) clearInterval(poll);
  poll = setInterval(() => {
    if (!shared.code || shared.status?.paired || shared.code.expires < Date.now()) { clearInterval(poll); poll = undefined; return; }
    void refresh(true);
  }, 3000);
}
export async function newCode() {
  if (shared.busy) return;
  set({ busy: true, error: "" });
  try { set({ code: await ask<TgCode>({ action: "tgPair" }) }); watch(); }
  catch (e) { set({ error: clean(e) }); }
  finally { set({ busy: false }); }
}
export async function unpair() {
  const name = shared.status?.paired?.name;
  if (!await confirmDialog({ title: "Unpair Telegram?", message: `Clem stops answering ${name ? name + " " : ""}in Telegram and sends nothing there. You can pair again any time.`, confirm: "Unpair", danger: true })) return;
  set({ busy: true, error: "" });
  try { set({ status: await ask<TgStatus>({ action: "tgUnpair" }), code: null }); }
  catch (e) { set({ error: clean(e) }); }
  finally { set({ busy: false }); }
}

/** The shared state, live; `now` ticks each second while a code counts down. */
export function useTelegram() {
  const [, tick] = useState(0);
  useEffect(() => {
    const fn = () => tick((n) => n + 1);
    listeners.add(fn);
    if (!shared.status) void refresh();
    return () => { listeners.delete(fn); };
  }, []);
  const counting = !!shared.code && !shared.status?.paired;
  useEffect(() => { if (!counting) return; const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, [counting]);
  return { ...shared, now: Date.now() };
}
