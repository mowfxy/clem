// The desktop app's opening screen: Mowr's mark, drawn before any of the app has loaded and kept until the workspace
// is ready (the app calls window.mowrBoot.done()). Plain script so it paints on the first frame. The arm, viewBox and
// the gather-turn-open motion match MARK and the Logo component in src/Icons.tsx.
(function () {
  var arm = "M62 87C60.6 83 55.2 70.5 53.5 63C51.8 55.5 51.1 48.2 52 42C52.9 35.8 55.3 30 59 26C62.7 22 69.2 18.8 74 18C78.8 17.2 84.5 19 88 21C91.5 23 93.7 26.7 95 30C96.3 33.3 95.8 39.2 96 41";
  var numbers = arm.match(/-?\d*\.?\d+/g).map(Number), gathered = numbers.map(function (v) { return 72 + (v - 72) * .74; });
  // The theme goes on before anything paints, on the web and on the desktop alike, so a light-mode start never flashes
  // dark: the choice from Settings, or by default the system's (Windows') light or dark setting. Same rule as src/theme/theme.ts.
  var theme = "dark";
  try { var chosen = localStorage.getItem("mowr-theme"); theme = chosen === "light" || chosen === "dark" ? chosen : matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"; } catch (e) {}
  document.documentElement.dataset.theme = theme;
  if (location.protocol !== "mowr:") return;
  var paper = theme === "light" ? "#faf8f3" : "#141414", trace = theme === "light" ? "32,37,58" : "245,244,240";
  var style = document.createElement("style");
  style.textContent =
    "#mowr-boot{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;background:" + paper + ";color:#b56c4b;transition:opacity .45s ease,visibility 0s linear .45s}" +
    "#mowr-boot .boot-stage{position:relative;display:grid;place-items:center;width:160px;height:160px}" +
    "#mowr-boot .boot-glow{position:absolute;inset:18px;border-radius:50%;background:radial-gradient(circle,rgba(181,108,75,.16),rgba(181,108,75,0) 68%);animation:mowr-boot-breathe 3.6s ease-in-out infinite}" +
    "#mowr-boot svg{position:relative;width:64px;height:64px;overflow:visible;animation:mowr-boot-in .7s cubic-bezier(.2,.7,.2,1) both}" +
    "#mowr-boot .boot-line{position:absolute;bottom:14px;width:56px;height:2px;border-radius:2px;background:rgba(" + trace + ",.12);overflow:hidden;opacity:0;animation:mowr-boot-fade .4s ease 1.2s forwards}" +
    "#mowr-boot .boot-line i{position:absolute;inset:0;width:40%;border-radius:2px;background:rgba(" + trace + ",.55);animation:mowr-boot-run 1.4s ease-in-out infinite}" +
    "#mowr-boot.is-leaving{opacity:0;visibility:hidden}" +
    "#mowr-boot.is-leaving svg{transform:scale(1.08);transition:transform .45s cubic-bezier(.2,.7,.2,1)}" +
    "@keyframes mowr-boot-in{from{opacity:0;scale:.82}to{opacity:1;scale:1}}" +
        "@keyframes mowr-boot-breathe{0%,100%{opacity:.35;transform:scale(.86)}45%{opacity:1;transform:scale(1.06)}}" +
    "@keyframes mowr-boot-fade{to{opacity:1}}" +
    "@keyframes mowr-boot-run{from{transform:translateX(-100%)}to{transform:translateX(250%)}}" +
    "@media (prefers-reduced-motion:reduce){#mowr-boot *{animation:none!important}#mowr-boot .boot-line{opacity:1}}";
  document.head.appendChild(style);
  var root = document.createElement("div");
  root.id = "mowr-boot";
  root.setAttribute("role", "status");
  root.setAttribute("aria-label", "Opening Mowr");
  var ns = "http://www.w3.org/2000/svg", svg = document.createElementNS(ns, "svg"), turn = document.createElementNS(ns, "g"), paths = [];
  svg.setAttribute("viewBox", "8.5 4.5 122 122");
  svg.setAttribute("aria-hidden", "true");
  turn.setAttribute("fill", "none"); turn.setAttribute("stroke", "currentColor"); turn.setAttribute("stroke-width", "14.5"); turn.setAttribute("stroke-linecap", "round");
  [0, 120, 240].forEach(function (angle) {
    var path = document.createElementNS(ns, "path");
    path.setAttribute("transform", "rotate(" + angle + " 72 72)");
    path.setAttribute("d", arm);
    turn.appendChild(path); paths.push(path);
  });
  svg.appendChild(turn);
  var stage = document.createElement("div"), glow = document.createElement("span"), line = document.createElement("span");
  stage.className = "boot-stage"; glow.className = "boot-glow"; line.className = "boot-line";
  line.appendChild(document.createElement("i"));
  stage.appendChild(glow); stage.appendChild(svg); stage.appendChild(line); root.appendChild(stage);
  (document.body || document.documentElement).appendChild(root);

  var still = matchMedia("(prefers-reduced-motion: reduce)").matches, started = performance.now(), frame = 0, last = -1;
  var ease = function (t) { var x = Math.max(0, Math.min(1, t)); return x * x * (3 - 2 * x); };
  function tick(now) {
    var cel = Math.floor(now / 24);
    if (cel !== last) {
      last = cel;
      var cycle = (now - started) % 3600;
      turn.setAttribute("transform", "rotate(" + (120 * ease((cycle / 3600 - .2) / .42)).toFixed(2) + " 72 72)");
      paths.forEach(function (path, i) {
        var t = (cycle - i * 100) / 2600;
        var blend = t < .12 ? 0 : t < .4 ? ease((t - .12) / .28) : t < .54 ? 1 : 1 - ease((t - .54) / .34), j = 0;
        path.setAttribute("d", arm.replace(/-?\d*\.?\d+/g, function () { var from = numbers[j]; return (from + (gathered[j++] - from) * blend).toFixed(2); }));
      });
    }
    frame = requestAnimationFrame(tick);
  }
  if (!still) frame = requestAnimationFrame(tick);

  var finished = false;
  function done() {
    if (finished) return;
    finished = true;
    // Always show at least one gather-and-open, so a fast start still reads as an opening rather than a flicker.
    setTimeout(function () {
      root.classList.add("is-leaving");
      setTimeout(function () { cancelAnimationFrame(frame); root.remove(); style.remove(); }, 500);
    }, Math.max(0, 900 - (performance.now() - started)));
  }
  window.mowrBoot = { done: done };
  // Never trap someone behind the opening screen if something upstream fails to report in.
  setTimeout(done, 25000);
})();
