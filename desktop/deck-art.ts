import { random, mix, type Art } from "./deck-design.ts";

/**
 * Pictures Mowr draws for decks itself: a set of outline icons on a 24-unit grid, and generated art (orbits, waves,
 * contours, confetti…) seeded per deck and coloured from its palette, for covers, section slides and image slides.
 * Both are SVG, drawn to PNG by the offscreen page (desktop/rasterize.ts) like Kinetra figures.
 */
const ICONS: Record<string, string> = {
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>',
  rocket: '<path d="M12 2.5c3 2 4.6 5.6 4.5 9.8L14 16h-4l-2.5-3.7C7.4 8.1 9 4.5 12 2.5z"/><circle cx="12" cy="9.5" r="1.7"/><path d="M10 16l-1.6 4.5L12 18.6l3.6 1.9L14 16"/>',
  idea: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V17h5v-1.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z"/>',
  growth: '<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/><path d="M15 8h4v4"/>',
  "bar-chart": '<path d="M3 21h18M5.5 21v-8h3v8M10.5 21V5h3v16M15.5 21v-11h3v11"/>',
  "pie-chart": '<path d="M11 3.1A9 9 0 1 0 20.9 13H11z"/><path d="M14 3.2A8 8 0 0 1 20.8 10H14z"/>',
  team: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.5"/><path d="M16.5 14.1c2.5.3 4.5 2.4 4.5 5"/>',
  person: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.5 3.8 5.6 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.6-3.8-9S9.5 5.5 12 3z"/>',
  leaf: '<path d="M5 19C5 11 10 5 20 4c-1 10-7 15-15 15z"/><path d="M5 19l8-8"/>',
  heart: '<path d="M12 20s-7-4.4-9-9c-1.2-2.9.7-6.5 4-6.5 2 0 3.6 1.2 5 3 1.4-1.8 3-3 5-3 3.3 0 5.2 3.6 4 6.5-2 4.6-9 9-9 9z"/>',
  shield: '<path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.5 2.5L16 9.5"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  book: '<path d="M4 19.5V5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2 2 2 0 0 0 2 2h13"/><path d="M8 7h7"/>',
  graduation: '<path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5M22 9v5"/>',
  flask: '<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3"/><path d="M7.5 15h9"/>',
  atom: '<circle cx="12" cy="12" r="1.5"/><ellipse cx="12" cy="12" rx="9.5" ry="3.8"/><ellipse cx="12" cy="12" rx="9.5" ry="3.8" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="9.5" ry="3.8" transform="rotate(-60 12 12)"/>',
  dna: '<path d="M8 3c0 6 8 6 8 9s-8 3-8 9M16 3c0 6-8 6-8 9s8 3 8 9M9 6h6M9 18h6M10.5 9.6h3M10.5 14.4h3"/>',
  chip: '<rect x="6" y="6" width="12" height="12" rx="2"/><rect x="9.5" y="9.5" width="5" height="5"/><path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3"/>',
  code: '<path d="M8 7l-5 5 5 5M16 7l5 5-5 5M13.5 4l-3 16"/>',
  cloud: '<path d="M7 18a4.5 4.5 0 0 1-.5-9 6 6 0 0 1 11.5 1.5 3.8 3.8 0 0 1-.5 7.5z"/>',
  database: '<ellipse cx="12" cy="5.5" rx="7.5" ry="2.5"/><path d="M4.5 5.5v13c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5v-13M4.5 12c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5"/>',
  settings: '<circle cx="12" cy="12" r="6.5"/><circle cx="12" cy="12" r="2.5"/><path d="M12 2.5v3M12 18.5v3M21.5 12h-3M5.5 12h-3M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1M18.7 18.7l-2.1-2.1M7.4 7.4L5.3 5.3"/>',
  tools: '<path d="M15 4a5 5 0 0 0-4.6 6.9l-6.9 6.9a1.8 1.8 0 0 0 2.6 2.6l6.9-6.9A5 5 0 0 0 20 9l-3 1-2-2 1-3z"/>',
  money: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.8"/><path d="M6 9.5v5M18 9.5v5"/>',
  coin: '<circle cx="12" cy="12" r="8.5"/><path d="M14.5 9.2c-.5-.9-1.5-1.4-2.6-1.4-1.6 0-2.7.9-2.7 2.1 0 2.8 5.6 1.4 5.6 4.2 0 1.2-1.2 2.1-2.8 2.1-1.2 0-2.3-.6-2.8-1.5M12 6.5v1.3M12 16.6v1.3"/>',
  cart: '<path d="M3 4h2.5l2.2 11h10.6L20.5 7H6.4"/><circle cx="9" cy="19.5" r="1.4"/><circle cx="17" cy="19.5" r="1.4"/>',
  truck: '<path d="M2.5 6h11v10h-11zM13.5 10h4l3 3v3h-7"/><circle cx="6.5" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>',
  building: '<path d="M4 21V5l8-2v18M12 8h8v13M2 21h20M7 8h2M7 12h2M7 16h2M15 12h2M15 16h2"/>',
  home: '<path d="M3 11l9-7 9 7M5.5 9.5V20h13V9.5M10 20v-5h4v5"/>',
  location: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  phone: '<rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M11 18.5h2"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3.5 6.5L12 13l8.5-6.5"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9.5h8M8 12.5h5"/>',
  megaphone: '<path d="M4 9.5h3l9-5v15l-9-5H4z"/><path d="M7 14.5l1.5 5h2.5l-1.3-4.3M19 9.5a3 3 0 0 1 0 5"/>',
  camera: '<path d="M4 8h3l1.5-2.5h7L17 8h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/>',
  music: '<path d="M9 18V5l11-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
  palette: '<path d="M12 3a9 9 0 1 0 0 18c1.4 0 2-1 1.5-2.2-.6-1.3.3-2.8 1.8-2.8H18a3 3 0 0 0 3-3c0-5.5-4-10-9-10z"/><circle cx="7.5" cy="11.5" r="1.2"/><circle cx="10" cy="7.5" r="1.2"/><circle cx="14.5" cy="7.5" r="1.2"/><circle cx="17" cy="11" r="1.2"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M9.5 17h5v4h-5zM8 21h8"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  water: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>',
  energy: '<path d="M13 2.5L4.5 13.5H12l-1 8 8.5-11H12z"/>',
  cycle: '<path d="M20 11a8 8 0 0 0-14.5-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.5 4.5L20 16M20 20v-4h-4"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
  mountain: '<path d="M2.5 20l7-12 4 6.5 2.5-3.5 5.5 9z"/>',
  sprout: '<path d="M12 21v-9M12 12c0-4-3-6.5-7-6.5 0 4 3 6.5 7 6.5zM12 14c0-3.5 2.5-6 6.5-6 0 3.5-2.5 6-6.5 6z"/>',
  tree: '<path d="M12 21v-5M12 3l6 8h-3l4 5H5l4-5H6z"/>',
  pencil: '<path d="M4 20l1-4.5L15.5 5a2.1 2.1 0 0 1 3 3L8 18.5z"/><path d="M13.5 7l3 3"/>',
  microscope: '<path d="M8 3.5h4v9H8zM10 12.5V15M6 21h13M14.5 21a5.5 5.5 0 0 0 1.5-10.5M12 6h3"/>',
  health: '<path d="M6 3v6a4 4 0 0 0 8 0V3M10 13v2a5 5 0 0 0 10 0v-2"/><circle cx="20" cy="11" r="2"/>',
  pill: '<path d="M10.5 20.5a5 5 0 0 1-7-7l10-10a5 5 0 0 1 7 7z"/><path d="M8.5 8.5l7 7"/>',
  justice: '<path d="M12 3v18M7 21h10M4 7h16M6 7l-3 7a3 3 0 0 0 6 0zM18 7l-3 7a3 3 0 0 0 6 0z"/>',
  document: '<path d="M6 2.5h8l5 5V21.5H6z"/><path d="M14 2.5V8h5M9 13h7M9 17h5"/>',
  arrow: '<path d="M4 12h16M14 6l6 6-6 6"/>',
  question: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17v.2"/>',
  warning: '<path d="M12 3.5l9.5 16.5h-19z"/><path d="M12 10v4.5M12 17.3v.2"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  smile: '<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5a4 4 0 0 0 7 0M9 9.5v.5M15 9.5v.5"/>',
  plane: '<path d="M21 16l-8-4V5.5a1.5 1.5 0 0 0-3 0V12l-8 4v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-3.5l8 2.5z"/>',
  signal: '<path d="M5 12.5a10 10 0 0 1 14 0M8 15.5a6 6 0 0 1 8 0M12 18.5v.2"/>',
  package: '<path d="M3 7.5l9-4.5 9 4.5v9L12 21l-9-4.5z"/><path d="M3 7.5l9 4.5 9-4.5M12 12v9"/>',
  percent: '<path d="M19 5L5 19"/><circle cx="7" cy="7" r="2.5"/><circle cx="17" cy="17" r="2.5"/>',
  speed: '<path d="M4 17a8 8 0 1 1 16 0"/><path d="M12 17l4-5"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l2.5 2.5M15 8l2 2"/>',
  puzzle: '<path d="M4 8h3.5a2 2 0 1 1 4 0H15v3.5a2 2 0 1 1 0 4V20H4v-4.5a2 2 0 1 0 0-4z"/>',
  handshake: '<path d="M2.5 11l4-4 4 2 3-2 4 1 4 3"/><path d="M6.5 7l-2 9 4 3 2-1.5 2 1.5 2-1.5 2 1 3-2.5-3.5-6.5-4 2-1.5-1"/>',
  car: '<path d="M4 16v-4l2-5h12l2 5v4z"/><circle cx="7.5" cy="16.5" r="1.8"/><circle cx="16.5" cy="16.5" r="1.8"/><path d="M4 12h16"/>',
  bulb: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V17h5v-1.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z"/>',
};
/** Other names models reach for, mapped to the icons above. */
const ALIASES: Record<string, string> = {
  goal: "target", aim: "target", objective: "target", launch: "rocket", startup: "rocket", lightbulb: "idea", insight: "idea", innovation: "idea",
  chart: "bar-chart", trend: "growth", "line-chart": "growth", up: "growth", users: "team", people: "team", community: "team", user: "person", customer: "person",
  world: "globe", international: "globe", nature: "leaf", environment: "leaf", eco: "leaf", love: "heart", care: "heart", security: "shield", safety: "shield",
  privacy: "lock", time: "clock", schedule: "calendar", date: "calendar", done: "check", success: "check", quality: "star", favourite: "star", milestone: "flag",
  learn: "book", reading: "book", education: "graduation", school: "graduation", science: "flask", chemistry: "flask", lab: "flask", physics: "atom",
  biology: "dna", genetics: "dna", hardware: "chip", ai: "chip", software: "code", programming: "code", storage: "database", data: "database", gear: "settings",
  process: "settings", build: "tools", wrench: "tools", finance: "money", cost: "money", price: "coin", revenue: "coin", shop: "cart", sales: "cart",
  delivery: "truck", logistics: "truck", company: "building", office: "building", house: "home", place: "location", map: "location", mobile: "phone",
  email: "mail", message: "chat", feedback: "chat", marketing: "megaphone", announce: "megaphone", photo: "camera", art: "palette", design: "palette",
  award: "trophy", win: "trophy", solar: "sun", weather: "sun", drop: "water", power: "energy", electricity: "energy", bolt: "energy", recycle: "cycle",
  repeat: "cycle", refresh: "cycle", research: "search", explore: "compass", direction: "compass", challenge: "mountain", grow: "sprout", plant: "sprout",
  forest: "tree", write: "pencil", edit: "pencil", medicine: "health", doctor: "health", stethoscope: "health", drug: "pill", law: "justice", legal: "justice",
  balance: "justice", report: "document", file: "document", next: "arrow", help: "question", risk: "warning", alert: "warning", stack: "layers",
  vision: "eye", view: "eye", happy: "smile", travel: "plane", network: "signal", wifi: "signal", product: "package", box: "package", rate: "percent",
  performance: "speed", fast: "speed", access: "key", solution: "puzzle", partnership: "handshake", deal: "handshake", transport: "car",
};
export const iconNames = Object.keys(ICONS);
/** The icon for a name (or a close alias), or undefined when there is none. */
export function iconFor(name: unknown) {
  const key = String(name || "").trim().toLowerCase().replace(/[\s_]+/g, "-");
  return ICONS[key] ? key : ALIASES[key] ? ALIASES[key] : ICONS[key.replace(/s$/, "")] ? key.replace(/s$/, "") : undefined;
}
/** An icon as SVG: outline in `color`, or (solid/badge) on a disc. */
export function iconSvg(name: string, style: "line" | "solid" | "badge", color: string, disc?: string) {
  const body = ICONS[iconFor(name) || "star"];
  const stroke = style === "solid" ? (disc || "FFFFFF") : color;
  const ground = style === "solid" ? `<circle cx="12" cy="12" r="12" fill="#${color}"/>` : style === "badge" ? `<circle cx="12" cy="12" r="12" fill="#${disc || color}"/>` : "";
  const inner = style === "line" ? body : `<g transform="translate(5.4 5.4) scale(.55)">${body}</g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="240" height="240">${ground}<g fill="none" stroke="#${stroke}" stroke-width="${style === "line" ? 1.6 : 2.2}" stroke-linecap="round" stroke-linejoin="round">${inner}</g></svg>`;
}

const f = (n: number) => Math.round(n * 10) / 10;
/**
 * Generated art: an abstract picture in the deck's colours, `w`×`h` units (inches × 100). The same deck and slot always
 * give the same picture; different decks and slots give different ones.
 */
export function artSvg(style: Art, seed: number, w: number, h: number, colors: { bg: string; accent: string; accent2: string; accent3: string; dark: boolean }) {
  const rand = random(seed), r = (a: number, b: number) => a + rand() * (b - a);
  const palette = [colors.accent, colors.accent2, colors.accent3];
  const pick = () => palette[Math.floor(rand() * palette.length) % palette.length];
  const soft = (c: string, k: number) => mix(c, colors.bg, k);
  const parts: string[] = [];
  switch (style) {
    case "orbits": {
      const cx = r(w * 0.55, w * 1.05), cy = r(-h * 0.1, h * 0.5);
      for (let i = 0; i < 7; i++) parts.push(`<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(h * (0.18 + i * 0.16))}" fill="none" stroke="#${soft(colors.accent, 0.25 + i * 0.09)}" stroke-width="${f(1.2 + (i % 3))}"${i % 2 ? ' stroke-dasharray="2 9"' : ""}/>`);
      for (let i = 0; i < 6; i++) { const a = r(0, Math.PI * 2), d = h * (0.18 + Math.floor(r(0, 7)) * 0.16); parts.push(`<circle cx="${f(cx + Math.cos(a) * d)}" cy="${f(cy + Math.sin(a) * d)}" r="${f(r(5, 16))}" fill="#${pick()}"/>`); }
      parts.push(`<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(h * 0.1)}" fill="#${colors.accent}"/>`);
      break;
    }
    case "waves": {
      for (let i = 0; i < 6; i++) {
        const base = h * (0.42 + i * 0.1), amp = r(h * 0.03, h * 0.09), phase = r(0, 6), freq = r(1.2, 2.4);
        let d = `M0 ${f(base)}`;
        for (let x = 0; x <= w; x += w / 40) d += ` L${f(x)} ${f(base + Math.sin(phase + (x / w) * Math.PI * 2 * freq) * amp)}`;
        parts.push(`<path d="${d} L${w} ${h} L0 ${h}z" fill="#${soft(palette[i % 3], 0.15 + i * 0.1)}" opacity="${f(0.55 + i * 0.07)}"/>`);
      }
      break;
    }
    case "blocks": {
      for (let i = 0; i < 9; i++) {
        const s = r(h * 0.12, h * 0.45), x = r(-s * 0.3, w - s * 0.6), y = r(-s * 0.3, h - s * 0.6);
        parts.push(rand() < 0.3 ? `<circle cx="${f(x + s / 2)}" cy="${f(y + s / 2)}" r="${f(s / 2)}" fill="#${pick()}" opacity="${f(r(0.75, 1))}"/>` : `<rect x="${f(x)}" y="${f(y)}" width="${f(s * r(0.8, 1.6))}" height="${f(s)}" fill="#${pick()}" opacity="${f(r(0.7, 1))}" transform="rotate(${f(r(-12, 12))} ${f(x + s / 2)} ${f(y + s / 2)})"/>`);
      }
      break;
    }
    case "contours": {
      const cx = r(w * 0.3, w * 0.8), cy = r(h * 0.3, h * 0.8), wobble = Array.from({ length: 6 }, () => r(0, 6));
      for (let i = 1; i <= 12; i++) {
        let d = "";
        for (let k = 0; k <= 72; k++) {
          const a = (k / 72) * Math.PI * 2, rr = i * h * 0.06 * (1 + 0.12 * Math.sin(a * 3 + wobble[0]) + 0.08 * Math.sin(a * 5 + wobble[1] + i * 0.2));
          d += `${k ? "L" : "M"}${f(cx + Math.cos(a) * rr * 1.25)} ${f(cy + Math.sin(a) * rr)}`;
        }
        parts.push(`<path d="${d}z" fill="none" stroke="#${soft(i % 4 ? colors.accent : colors.accent2, 0.2 + (i % 4) * 0.12)}" stroke-width="${i % 4 ? 1.4 : 2.4}"/>`);
      }
      break;
    }
    case "confetti": {
      for (let i = 0; i < 42; i++) {
        const x = r(0, w), y = r(0, h), s = r(6, 18), c = pick(), kind = Math.floor(r(0, 4));
        if (kind === 0) parts.push(`<circle cx="${f(x)}" cy="${f(y)}" r="${f(s / 2)}" fill="#${c}"/>`);
        else if (kind === 1) parts.push(`<path d="M${f(x)} ${f(y - s / 2)} L${f(x + s / 2)} ${f(y + s / 2)} L${f(x - s / 2)} ${f(y + s / 2)}z" fill="#${c}" transform="rotate(${f(r(0, 90))} ${f(x)} ${f(y)})"/>`);
        else if (kind === 2) parts.push(`<path d="M${f(x - s)} ${f(y)} q${f(s / 2)} ${f(-s / 2)} ${f(s)} 0 t${f(s)} 0" fill="none" stroke="#${c}" stroke-width="3" stroke-linecap="round"/>`);
        else parts.push(`<rect x="${f(x)}" y="${f(y)}" width="${f(s)}" height="${f(s / 2.4)}" rx="2" fill="#${c}" transform="rotate(${f(r(0, 180))} ${f(x)} ${f(y)})"/>`);
      }
      break;
    }
    case "grid": {
      const step = h / 12;
      for (let x = step / 2; x < w; x += step) for (let y = step / 2; y < h; y += step) parts.push(`<circle cx="${f(x)}" cy="${f(y)}" r="1.6" fill="#${soft(colors.accent, 0.55)}"/>`);
      for (let i = 0; i < 7; i++) { const x = Math.floor(r(0, w / step)) * step, y = Math.floor(r(0, h / step)) * step, s = step * Math.floor(r(1, 4)); parts.push(`<rect x="${f(x)}" y="${f(y)}" width="${f(s)}" height="${f(s)}" fill="#${pick()}" opacity="${f(r(0.6, 1))}"/>`); }
      break;
    }
    case "rays": {
      const cx = r(-w * 0.1, w * 0.2), cy = r(h * 0.7, h * 1.1);
      for (let i = 0; i < 18; i++) { const a = -Math.PI / 2 + (i / 18) * Math.PI * 0.75 + r(-0.03, 0.03), len = Math.hypot(w, h); parts.push(`<path d="M${f(cx)} ${f(cy)} L${f(cx + Math.cos(a) * len)} ${f(cy + Math.sin(a) * len)} L${f(cx + Math.cos(a + 0.035) * len)} ${f(cy + Math.sin(a + 0.035) * len)}z" fill="#${i % 3 ? soft(colors.accent, 0.3 + (i % 5) * 0.1) : pick()}" opacity=".85"/>`); }
      parts.push(`<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(h * 0.22)}" fill="#${colors.accent}"/>`);
      break;
    }
    case "leaves": {
      for (let i = 0; i < 14; i++) {
        const x = r(0, w), y = r(0, h), s = r(h * 0.12, h * 0.32), a = r(0, 360), c = pick();
        parts.push(`<g transform="translate(${f(x)} ${f(y)}) rotate(${f(a)})"><path d="M0 0 C${f(s * 0.4)} ${f(-s * 0.35)} ${f(s * 0.8)} ${f(-s * 0.2)} ${f(s)} 0 C${f(s * 0.8)} ${f(s * 0.2)} ${f(s * 0.4)} ${f(s * 0.35)} 0 0z" fill="#${soft(c, r(0, 0.35))}"/><path d="M0 0 L${f(s * 0.95)} 0" stroke="#${soft(c, 0.6)}" stroke-width="1.2"/></g>`);
      }
      break;
    }
    case "stripes": {
      const angle = r(-35, -20), gap = h / 9;
      for (let i = -12; i < 24; i++) parts.push(`<rect x="${f(i * gap * 1.4)}" y="${f(-h)}" width="${f(gap * r(0.2, 0.7))}" height="${f(h * 3)}" fill="#${i % 5 === 0 ? pick() : soft(colors.accent, 0.35 + (Math.abs(i) % 4) * 0.12)}" transform="rotate(${f(angle)} ${f(w / 2)} ${f(h / 2)})"/>`);
      break;
    }
    case "none": break;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#${colors.bg}"/>${parts.join("")}</svg>`;
}
