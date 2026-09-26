/** Copies text, falling back to a hidden textarea when the async Clipboard API is missing or refused. */
export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall through */ }
  const area = document.createElement('textarea');
  area.value = text; area.setAttribute('readonly', ''); area.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
  const active = document.activeElement as HTMLElement | null;
  document.body.appendChild(area); area.select();
  try { return document.execCommand('copy'); } catch { return false; } finally { area.remove(); active?.focus?.(); }
}
