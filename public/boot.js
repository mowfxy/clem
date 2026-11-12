// The desktop app's opening screen: Clem's mark, drawn before any of the app has loaded and kept until the workspace
// is ready (the app calls window.clemBoot.done()). Plain script so it paints on the first frame. The mark's geometry and
// the tumbling shape match core/mark.ts and the Logo in src/Icons.tsx.
(function () {
  // The theme goes on before anything paints, on the web and on the desktop alike, so a light-mode start never flashes
  // dark: the choice from Settings, or by default the system's (Windows') light or dark setting. Same rule as src/theme/theme.ts.
  var theme = "dark";
  try { var chosen = localStorage.getItem("clem-theme"); theme = chosen === "light" || chosen === "dark" ? chosen : matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"; } catch (e) {}
  // The public website is always in its orbit, starting on the night side (src/site/Site.tsx).
  if (location.protocol !== "clem:" && location.hostname !== "admin.m4labs.xyz" && /^#?\/?(features.*|support|about|pricing)?$/.test(location.hash)) theme = "dark";
  document.documentElement.dataset.theme = theme;
  if (location.protocol !== "clem:") return;
  var light = theme === "light", paper = light ? "#e9eff6" : "#05080f", ink = light ? "#0b0b0a" : "#F4F2EC";
  var style = document.createElement("style");
  style.textContent =
    "#clem-boot{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;background:" + paper + ";color:" + ink + ";transition:opacity .45s ease,visibility 0s linear .45s}" +
    "#clem-boot .boot-stage{display:grid;justify-items:center;gap:30px}" +
    "#clem-boot svg{width:76px;height:76px;overflow:visible;animation:clem-boot-in .6s cubic-bezier(.2,.7,.2,1) backwards}" +
    "#clem-boot .boot-tumble{position:relative;display:block;width:22px;height:22px;opacity:0;animation:clem-boot-fade .4s ease 1s forwards}" +
    "#clem-boot .boot-tumble i{position:absolute;inset:14%;border-radius:34%;background:currentColor;animation:clem-boot-tumble 2.4s cubic-bezier(.65,0,.2,1) infinite}" +
    "#clem-boot.is-leaving{opacity:0;visibility:hidden}" +
    "#clem-boot.is-leaving svg{transform:scale(1.06);transition:transform .45s cubic-bezier(.2,.7,.2,1)}" +
    "@keyframes clem-boot-in{from{opacity:0;scale:.86}to{opacity:1;scale:1}}" +
    "@keyframes clem-boot-fade{to{opacity:1}}" +
    "@keyframes clem-boot-tumble{0%{transform:rotate(0) scale(1);border-radius:34%}25%{transform:rotate(90deg) scale(.86);border-radius:0 100% 0 100%}50%{transform:rotate(180deg) scale(1);border-radius:50%}75%{transform:rotate(270deg) scale(.86);border-radius:100% 0 100% 0}100%{transform:rotate(360deg) scale(1);border-radius:34%}}" +
    "@media (prefers-reduced-motion:reduce){#clem-boot *{animation:none!important}#clem-boot .boot-tumble{opacity:1}}";
  document.head.appendChild(style);
  var root = document.createElement("div");
  root.id = "clem-boot";
  root.setAttribute("role", "status");
  root.setAttribute("aria-label", "Opening Clem");
  root.innerHTML =
    '<div class="boot-stage"><svg viewBox="0 0 100 100" aria-hidden="true">' +
    '<path d="M70.89 15.56C78.88 19.44 86.71 29.77 89.89 37.94C92.77 45.35 92.92 52.63 88.85 59.66C84.46 67.24 65.87 80.58 57.77 84.27C51.49 87.13 44.84 87.6 38.77 83.89C35.63 81.96 11.04 58.55 9.48 55.83C7.34 52.07 7.45 48.27 10.22 44.88C13.26 41.13 44.74 19.42 50.21 16.47C56.68 12.98 64.17 12.31 70.89 15.56ZM73.25 31.75C61.68 33.22 51.39 38.98 45.85 44.76C40.22 50.65 34.1 61.01 37.34 74.86C43.36 65.18 53.84 64.07 60.49 58.13C66.5 52.76 73.53 45 73.25 31.75Z" fill="currentColor" fill-rule="evenodd"/></svg>' +
    '<span class="boot-tumble" aria-hidden="true"><i></i></span></div>';
  (document.body || document.documentElement).appendChild(root);

  var started = performance.now(), finished = false;
  function done() {
    if (finished) return;
    finished = true;
    // Always show the mark for a moment, so a fast start still reads as an opening rather than a flicker.
    setTimeout(function () {
      root.classList.add("is-leaving");
      setTimeout(function () { root.remove(); style.remove(); }, 500);
    }, Math.max(0, 900 - (performance.now() - started)));
  }
  window.clemBoot = { done: done };
  // Never trap someone behind the opening screen if something upstream fails to report in.
  setTimeout(done, 25000);
})();
