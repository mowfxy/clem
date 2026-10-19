// The desktop app's opening screen: Mowr's mark, drawn before any of the app has loaded and kept until the workspace
// is ready (the app calls window.mowrBoot.done()). Plain script so it paints on the first frame. The Peaks stroke, its
// nine lines and the thinking motion (tick, stepped writing, boil) match core/peaks.ts and the Logo in src/Icons.tsx.
(function () {
  var boil = ["M20 64 L36 32 L52 66 L68 32 L80 56", "M20.6 63.4 L35.5 32.6 L52.4 65.3 L67.6 32.5 L80.5 55.4", "M19.6 64.5 L36.4 31.6 L51.6 66.6 L68.5 31.4 L79.6 56.6"];
  // The theme goes on before anything paints, on the web and on the desktop alike, so a light-mode start never flashes
  // dark: the choice from Settings, or by default the system's (Windows') light or dark setting. Same rule as src/theme/theme.ts.
  var theme = "dark";
  try { var chosen = localStorage.getItem("mowr-theme"); theme = chosen === "light" || chosen === "dark" ? chosen : matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"; } catch (e) {}
  document.documentElement.dataset.theme = theme;
  if (location.protocol !== "mowr:") return;
  var paper = theme === "light" ? "#faf8f3" : "#141414", trace = theme === "light" ? "32,37,58" : "245,244,240";
  var style = document.createElement("style");
  style.textContent =
    "#mowr-boot{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;background:" + paper + ";color:#ef5340;transition:opacity .45s ease,visibility 0s linear .45s}" +
    "#mowr-boot .boot-stage{position:relative;display:grid;place-items:center;width:160px;height:160px}" +
    "#mowr-boot .boot-glow{position:absolute;inset:18px;border-radius:50%;background:radial-gradient(circle,rgba(217,71,62,.16),rgba(217,71,62,0) 68%);animation:mowr-boot-breathe 3.6s ease-in-out infinite}" +
    "#mowr-boot svg{position:relative;width:72px;height:72px;overflow:visible;transform-origin:50% 49%;animation:mowr-boot-in .7s cubic-bezier(.2,.7,.2,1) backwards,mowr-boot-tick .84s steps(1) .7s infinite}" +
    "#mowr-boot svg g{stroke-dasharray:100 100;animation:mowr-boot-write 1.04s steps(9) infinite}" +
    "#mowr-boot .boot-line{position:absolute;bottom:14px;width:56px;height:2px;border-radius:2px;background:rgba(" + trace + ",.12);overflow:hidden;opacity:0;animation:mowr-boot-fade .4s ease 1.2s forwards}" +
    "#mowr-boot .boot-line i{position:absolute;inset:0;width:40%;border-radius:2px;background:rgba(" + trace + ",.55);animation:mowr-boot-run 1.4s ease-in-out infinite}" +
    "#mowr-boot.is-leaving{opacity:0;visibility:hidden}" +
    "#mowr-boot.is-leaving svg{transform:scale(1.08);transition:transform .45s cubic-bezier(.2,.7,.2,1)}" +
    "@keyframes mowr-boot-in{from{opacity:0;scale:.82}to{opacity:1;scale:1}}" +
    "@keyframes mowr-boot-tick{0%{rotate:0deg}33%{rotate:-6deg}66%{rotate:4deg}}" +
    "@keyframes mowr-boot-write{0%{stroke-dashoffset:100}55%{stroke-dashoffset:0}100%{stroke-dashoffset:-100}}" +
    "@keyframes mowr-boot-breathe{0%,100%{opacity:.35;transform:scale(.86)}45%{opacity:1;transform:scale(1.06)}}" +
    "@keyframes mowr-boot-fade{to{opacity:1}}" +
    "@keyframes mowr-boot-run{from{transform:translateX(-100%)}to{transform:translateX(250%)}}" +
    "@media (prefers-reduced-motion:reduce){#mowr-boot *{animation:none!important}#mowr-boot .boot-line{opacity:1}}";
  document.head.appendChild(style);
  var root = document.createElement("div");
  root.id = "mowr-boot";
  root.setAttribute("role", "status");
  root.setAttribute("aria-label", "Opening Mowr");
  var ns = "http://www.w3.org/2000/svg", svg = document.createElementNS(ns, "svg"), ink = document.createElementNS(ns, "g"), paths = [];
  svg.setAttribute("viewBox", "0 0 100 100");
  svg.setAttribute("aria-hidden", "true");
  [["fill", "none"], ["stroke", "currentColor"], ["stroke-width", "2.2"], ["stroke-linecap", "round"], ["stroke-linejoin", "round"]].forEach(function (a) { ink.setAttribute(a[0], a[1]); });
  for (var k = -4; k <= 4; k++) {
    var path = document.createElementNS(ns, "path");
    path.setAttribute("d", boil[0]);
    path.setAttribute("pathLength", "100");
    if (k) path.setAttribute("transform", "translate(" + (k * 0.6275).toFixed(2) + " " + (-k * 0.5275).toFixed(2) + ")");
    ink.appendChild(path); paths.push(path);
  }
  svg.appendChild(ink);
  var stage = document.createElement("div"), glow = document.createElement("span"), line = document.createElement("span");
  stage.className = "boot-stage"; glow.className = "boot-glow"; line.className = "boot-line";
  line.appendChild(document.createElement("i"));
  stage.appendChild(glow); stage.appendChild(svg); stage.appendChild(line); root.appendChild(stage);
  (document.body || document.documentElement).appendChild(root);

  // The stroke boils between three hand-drawn poses, changing every 120 ms like the Logo's.
  var still = matchMedia("(prefers-reduced-motion: reduce)").matches, started = performance.now(), pose = 0, frame = 0;
  if (!still) frame = setInterval(function () { pose = (pose + 1) % boil.length; paths.forEach(function (path) { path.setAttribute("d", boil[pose]); }); }, 120);

  var finished = false;
  function done() {
    if (finished) return;
    finished = true;
    // Always show the mark for a moment, so a fast start still reads as an opening rather than a flicker.
    setTimeout(function () {
      root.classList.add("is-leaving");
      setTimeout(function () { clearInterval(frame); root.remove(); style.remove(); }, 500);
    }, Math.max(0, 900 - (performance.now() - started)));
  }
  window.mowrBoot = { done: done };
  // Never trap someone behind the opening screen if something upstream fails to report in.
  setTimeout(done, 25000);
})();
