import { useRef, useState, type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent } from "react";

/** How far (px) the ☰ handle must move before a press becomes a drag; a shorter press is a click that opens the menu. */
export const REORDER_SLOP = 6;

/** Items the person has arranged by hand come in their order; the rest (new ones) keep the usual order, ahead of them. */
export function arranged<T extends { rank?: number }>(items: T[], usual: (a: T, b: T) => number) {
  return [...items].sort((a, b) => a.rank == null && b.rank == null ? usual(a, b) : a.rank == null ? -1 : b.rank == null ? 1 : a.rank - b.rank);
}

/** `ids` with `id` moved to where `target` is (before it when moving up, after it when moving down). */
export function moved(ids: string[], id: string, target: string) {
  const from = ids.indexOf(id), to = ids.indexOf(target);
  if (from < 0 || to < 0 || from === to) return ids;
  const next = ids.filter((x) => x !== id);
  next.splice(to, 0, id);
  return next;
}

/**
 * Reordering cards by dragging their ☰ handle, for the person's own arrangement. It follows the pointer itself rather
 * than the browser's drag and drop, so it never starts (or is mistaken for) dragging a file onto a folder to move it:
 * cards keep that. A press that does not move is a click (the menu opens); after a drag the click is swallowed.
 * `group` keeps folders and files apart: a card is only placed among cards of its own group.
 */
export function useReorder(group: string, ids: string[], commit: (ids: string[]) => void) {
  const [preview, setPreview] = useState<string[] | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const press = useRef<{ id: string; x: number; y: number; pointer: number; moving: boolean } | null>(null);
  const swallow = useRef(false);
  const order = preview ?? ids;
  const end = (keep: boolean) => {
    const was = press.current;
    press.current = null;
    if (was?.moving) {
      swallow.current = true;
      // A click only follows a pointer that went up where it went down; without one the flag must not linger.
      setTimeout(() => { swallow.current = false; }, 0);
      if (keep && preview && preview.join() !== ids.join()) commit(preview);
    }
    setPreview(null);
    setDragging(null);
  };
  /** Props for an item's ☰ button. */
  const handle = (id: string) => ({
    "data-reorder-handle": "",
    style: { touchAction: "none" as const },
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
      if (e.button !== 0 || ids.length < 2) return;
      press.current = { id, x: e.clientX, y: e.clientY, pointer: e.pointerId, moving: false };
      // Held from the start, so a quick drag that leaves the small button at once is still followed (a plain click
      // still lands on the button: it opens the menu).
      e.currentTarget.setPointerCapture?.(e.pointerId);
    },
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => {
      const p = press.current;
      if (!p || p.pointer !== e.pointerId) return;
      if (!p.moving) {
        if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < REORDER_SLOP) return;
        p.moving = true;
        setDragging(id);
      }
      e.preventDefault();
      const under = document.elementFromPoint(e.clientX, e.clientY)?.closest?.(`[data-reorder-group="${group}"]`) as HTMLElement | null;
      const target = under?.dataset.reorderId;
      if (target && target !== id) setPreview((now) => moved(now ?? ids, id, target));
    },
    onPointerUp: (e: ReactPointerEvent<HTMLElement>) => { if (press.current?.pointer === e.pointerId) end(true); },
    onPointerCancel: () => end(false),
    onLostPointerCapture: () => { if (press.current) end(!!press.current.moving); },
    onKeyDown: (e: { key: string }) => { if (e.key === "Escape" && press.current?.moving) end(false); },
    onClickCapture: (e: ReactMouseEvent) => { if (swallow.current) { swallow.current = false; e.stopPropagation(); e.preventDefault(); } },
  });
  /** Props for an item's card: where it sits, and how it looks while it is the one moving. */
  const item = (id: string) => ({ "data-reorder-group": group, "data-reorder-id": id, "data-reordering": dragging === id ? "" : undefined });
  /** Whether a press on a ☰ handle is under way: a card's own drag-to-move must not start from it. */
  const pressing = () => !!press.current;
  return { order, handle, item, pressing, dragging };
}
