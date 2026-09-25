/** Ends the desktop app's opening screen (public/boot.js). Safe to call more than once, and does nothing on the web. */
export function bootDone() {
  (window as { mowrBoot?: { done(): void } }).mowrBoot?.done();
}
