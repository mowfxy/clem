import { useEffect, useRef } from "react";

/** A place in the workspace: a page (its route) and, on the chat page, the conversation open there. */
export type Place = { route: string; chatId: string | null; spaceId: string | null };
const same = (a: Place, b: Place) => a.route === b.route && a.chatId === b.chatId;
const LIMIT = 60;

/**
 * Back and forward through the places the person has been, like a browser: Alt+← and Alt+→, or the mouse's back and
 * forward buttons. Conversations are not in the address, so the workspace keeps its own trail. `exists` drops places
 * whose chat was deleted since.
 */
export function usePlaceHistory(here: Place, go: (place: Place) => void, exists: (chatId: string) => boolean, enabled: boolean) {
  const trail = useRef<Place[]>([]);
  const at = useRef(-1);
  // The place being travelled to by Back or Forward; the steps on the way there (the chat changes before the page
  // does) are not new places.
  const moving = useRef<{ place: Place; until: number } | null>(null);
  const latest = useRef({ go, exists, enabled });
  latest.current = { go, exists, enabled };

  // Every new place joins the trail (dropping anything ahead of it), unless it was reached by going back or forward.
  useEffect(() => {
    if (!enabled) return;
    if (moving.current) {
      if (same(moving.current.place, here) || performance.now() > moving.current.until) moving.current = null;
      return;
    }
    const list = trail.current;
    if (at.current >= 0 && same(list[at.current], here)) { list[at.current] = here; return; }
    // A new chat that has just been sent its first message takes the place of the empty new-chat page.
    const last = list[at.current];
    if (last && last.route === here.route && last.chatId === null && here.chatId) { list[at.current] = here; list.length = at.current + 1; return; }
    list.splice(at.current + 1, list.length, here);
    if (list.length > LIMIT) list.splice(0, list.length - LIMIT);
    at.current = list.length - 1;
  }, [here.route, here.chatId, here.spaceId, enabled]);

  useEffect(() => {
    const step = (by: -1 | 1) => {
      const { go, exists, enabled } = latest.current;
      if (!enabled || document.querySelector("dialog[open]")) return false;
      const list = trail.current;
      for (let i = at.current + by; i >= 0 && i < list.length; i += by) {
        const place = list[i];
        if (place.chatId && !exists(place.chatId)) continue;
        at.current = i;
        moving.current = { place, until: performance.now() + 600 };
        go(place);
        return true;
      }
      return false;
    };
    const key = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
      // In a text box with words in it, Alt+arrows belong to the text; an empty message box still navigates.
      const field = (e.target as HTMLElement | null)?.closest?.("input,textarea,[contenteditable=true]") as HTMLElement | null;
      if (field && (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement ? field.value : field.textContent)) return;
      if (step(e.key === "ArrowLeft" ? -1 : 1)) e.preventDefault();
    };
    // Mouse buttons 4 and 5 (back and forward).
    const mouse = (e: MouseEvent) => { if (e.button === 3 || e.button === 4) { e.preventDefault(); if (e.type === "mouseup") step(e.button === 3 ? -1 : 1); } };
    addEventListener("keydown", key);
    addEventListener("mousedown", mouse);
    addEventListener("mouseup", mouse);
    return () => { removeEventListener("keydown", key); removeEventListener("mousedown", mouse); removeEventListener("mouseup", mouse); };
  }, []);
}
