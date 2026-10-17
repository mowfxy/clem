/** The app's colour theme: dark (Mowr's original), light (paper), or whatever the system uses. Kept on this device. */
export type ThemeChoice = "dark" | "light" | "system";
const KEY = "mowr-theme";
const media = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: light)") : undefined;

export function themeChoice(): ThemeChoice {
  try { const v = localStorage.getItem(KEY); return v === "light" || v === "system" ? v : "dark"; } catch { return "dark"; }
}
const resolve = (choice: ThemeChoice) => (choice === "system" ? (media?.matches ? "light" : "dark") : choice);

/** Puts the theme on <html data-theme> and the browser's toolbar colour, and follows the system while asked to. */
export function applyTheme(choice: ThemeChoice = themeChoice()) {
  const theme = resolve(choice), root = document.documentElement;
  root.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "light" ? "#faf8f3" : "#171717");
  window.dispatchEvent(new CustomEvent("mowr-theme", { detail: theme }));
}
export function setThemeChoice(choice: ThemeChoice) {
  try { localStorage.setItem(KEY, choice); } catch {}
  applyTheme(choice);
}
media?.addEventListener("change", () => { if (themeChoice() === "system") applyTheme("system"); });
