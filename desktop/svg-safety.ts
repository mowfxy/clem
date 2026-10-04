/**
 * Drawings Mowr will not draw or save: scripts, embedded documents, event handlers, entity tricks, and any link or CSS
 * url() that leaves the drawing (remote addresses, local paths, file: URLs). Links inside it (#id) and embedded
 * data: pictures are fine. The drawing page's Content-Security-Policy (desktop/rasterize.ts) blocks loads as well;
 * this names the problem so the model can fix it.
 */
export const unsafeSvg = /<script|<foreignObject|<iframe|<embed|<object|<!ENTITY|@import|\bon[a-z]+\s*=|(?:href|src)\s*=\s*["']?\s*(?!#|data:image\/(?:png|jpe?g|gif|webp|svg\+xml)[;,])[^\s"'>]|url\(\s*["']?\s*(?!#|data:)/i;
