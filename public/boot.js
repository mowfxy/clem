// The desktop app's opening screen: Clem's mark, drawn before any of the app has loaded and kept until the workspace
// is ready (the app calls window.clemBoot.done()). Plain script so it paints on the first frame. The mark's geometry and
// the three hopping cursors match core/mark.ts and the Logo in src/Icons.tsx.
(function () {
  // The theme goes on before anything paints, on the web and on the desktop alike, so a light-mode start never flashes
  // dark: the choice from Settings, or by default the system's (Windows') light or dark setting. Same rule as src/theme/theme.ts.
  var theme = "dark";
  try { var chosen = localStorage.getItem("clem-theme"); theme = chosen === "light" || chosen === "dark" ? chosen : matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"; } catch (e) {}
  // The public website keeps the visitor's clock instead: paper from 6:00 to 19:00, ink at night, unless they picked
  // one on the site (src/site/clock.ts).
  if (location.protocol !== "clem:" && location.hostname !== "admin.m4labs.xyz" && /^#?\/?(features.*|support|about|pricing)?$/.test(location.hash.replace(/^#\/?#.*/, ""))) {
    var h = new Date().getHours(), site = null;
    try { site = localStorage.getItem("clem-site-theme"); } catch (e) {}
    theme = site === "light" || site === "dark" ? site : h >= 6 && h < 19 ? "light" : "dark";
  }
  document.documentElement.dataset.theme = theme;
  if (location.protocol !== "clem:") return;
  var light = theme === "light", paper = light ? "#faf8f3" : "#141414", ink = light ? "#0b0b0a" : "#F4F2EC";
  var style = document.createElement("style");
  style.textContent =
    "#clem-boot{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;background:" + paper + ";color:" + ink + ";transition:opacity .45s ease,visibility 0s linear .45s}" +
    "#clem-boot .boot-stage{display:grid;justify-items:center;gap:30px}" +
    "#clem-boot svg{width:76px;height:76px;overflow:visible;animation:clem-boot-in .6s cubic-bezier(.2,.7,.2,1) backwards}" +
    "#clem-boot svg rect{animation:clem-boot-blink 1.06s steps(1) .6s infinite}" +
    "#clem-boot .boot-hop{display:flex;gap:6px;height:22px;align-items:center;opacity:0;animation:clem-boot-fade .4s ease 1s forwards}" +
    "#clem-boot .boot-hop i{display:block;width:7px;height:14px;border-radius:2px;background:currentColor;opacity:.18;animation:clem-boot-hop 1.35s ease-in-out infinite}" +
    "#clem-boot .boot-hop i:nth-child(2){animation-delay:.45s}#clem-boot .boot-hop i:nth-child(3){animation-delay:.9s}" +
    "#clem-boot.is-leaving{opacity:0;visibility:hidden}" +
    "#clem-boot.is-leaving svg{transform:scale(1.06);transition:transform .45s cubic-bezier(.2,.7,.2,1)}" +
    "@keyframes clem-boot-in{from{opacity:0;scale:.86}to{opacity:1;scale:1}}" +
    "@keyframes clem-boot-blink{0%{opacity:1}50%{opacity:0}}" +
    "@keyframes clem-boot-fade{to{opacity:1}}" +
    "@keyframes clem-boot-hop{0%{opacity:.18;transform:translateY(0)}12%{opacity:1;transform:translateY(-4px)}30%{opacity:1;transform:translateY(0)}42%,100%{opacity:.18;transform:translateY(0)}}" +
    "@media (prefers-reduced-motion:reduce){#clem-boot *{animation:none!important}#clem-boot .boot-hop{opacity:1}}";
  document.head.appendChild(style);
  var root = document.createElement("div");
  root.id = "clem-boot";
  root.setAttribute("role", "status");
  root.setAttribute("aria-label", "Opening Clem");
  root.innerHTML =
    '<div class="boot-stage"><svg viewBox="0 0 100 100" aria-hidden="true"><g transform="translate(3.8 0)">' +
    '<path d="M72.29 29.93A30 30 0 1 0 72.29 70.07" fill="none" stroke="currentColor" stroke-width="13" stroke-linecap="round"/>' +
    '<rect x="56" y="40" width="11" height="20" rx="2" fill="currentColor"/></g></svg>' +
    '<span class="boot-hop" aria-hidden="true"><i></i><i></i><i></i></span></div>';
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
