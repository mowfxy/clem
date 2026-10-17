// The desktop app's opening screen: Mowr's mark, drawn before any of the app has loaded and kept until the workspace
// is ready (the app calls window.mowrBoot.done()). Plain script so it paints on the first frame. The petal shapes and
// the gather-and-open motion match the Logo component in src/Icons.tsx.
(function () {
  if (location.protocol !== "mowr:") return;
  var petal = "M68 9 C93 7 109 27 104 50 C101 63 90 71 78 70 C73 69 72 63 75 59 C80 52 76 45 68 45 C57 45 48 38 48 27 C48 16 57 10 68 9Z";
  var gathered = "M72 17 C81.9 17 90 25.1 90 35 C90 44.9 81.9 53 72 53 C68.3 53 64.7 51.9 61.7 49.7 C58.2 47.3 55.7 43.7 54.6 39.7 C53.2 34.5 54.2 29 57.3 24.7 C60.6 19.9 66.1 17 72 17Z".match(/-?\d*\.?\d+/g).map(Number);
  var theme = "dark";
  try { var chosen = localStorage.getItem("mowr-theme"); theme = chosen === "light" || (chosen === "system" && matchMedia("(prefers-color-scheme: light)").matches) ? "light" : "dark"; } catch (e) {}
  var paper = theme === "light" ? "#faf8f3" : "#141414", trace = theme === "light" ? "32,37,58" : "245,244,240";
  var style = document.createElement("style");
  style.textContent =
    "#mowr-boot{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;background:" + paper + ";color:#d9473e;transition:opacity .45s ease,visibility 0s linear .45s}" +
    "#mowr-boot .boot-stage{position:relative;display:grid;place-items:center;width:160px;height:160px}" +
    "#mowr-boot .boot-glow{position:absolute;inset:18px;border-radius:50%;background:radial-gradient(circle,rgba(217,71,62,.16),rgba(217,71,62,0) 68%);animation:mowr-boot-breathe 3.6s ease-in-out infinite}" +
    "#mowr-boot svg{position:relative;width:64px;height:64px;overflow:visible;animation:mowr-boot-in .7s cubic-bezier(.2,.7,.2,1) both,mowr-boot-turn 14.4s linear infinite}" +
    "#mowr-boot .boot-line{position:absolute;bottom:14px;width:56px;height:2px;border-radius:2px;background:rgba(" + trace + ",.12);overflow:hidden;opacity:0;animation:mowr-boot-fade .4s ease 1.2s forwards}" +
    "#mowr-boot .boot-line i{position:absolute;inset:0;width:40%;border-radius:2px;background:rgba(" + trace + ",.55);animation:mowr-boot-run 1.4s ease-in-out infinite}" +
    "#mowr-boot.is-leaving{opacity:0;visibility:hidden}" +
    "#mowr-boot.is-leaving svg{transform:scale(1.08);transition:transform .45s cubic-bezier(.2,.7,.2,1)}" +
    "@keyframes mowr-boot-in{from{opacity:0;scale:.82}to{opacity:1;scale:1}}" +
    "@keyframes mowr-boot-turn{to{rotate:360deg}}" +
    "@keyframes mowr-boot-breathe{0%,100%{opacity:.35;transform:scale(.86)}45%{opacity:1;transform:scale(1.06)}}" +
    "@keyframes mowr-boot-fade{to{opacity:1}}" +
    "@keyframes mowr-boot-run{from{transform:translateX(-100%)}to{transform:translateX(250%)}}" +
    "@media (prefers-reduced-motion:reduce){#mowr-boot *{animation:none!important}#mowr-boot .boot-line{opacity:1}}";
  document.head.appendChild(style);
  var root = document.createElement("div");
  root.id = "mowr-boot";
  root.setAttribute("role", "status");
  root.setAttribute("aria-label", "Opening Mowr");
  var ns = "http://www.w3.org/2000/svg", svg = document.createElementNS(ns, "svg"), paths = [];
  svg.setAttribute("viewBox", "0 0 144 144");
  svg.setAttribute("aria-hidden", "true");
  [0, 90, 180, 270].forEach(function (angle) {
    var g = document.createElementNS(ns, "g"), path = document.createElementNS(ns, "path");
    g.setAttribute("transform", "rotate(" + angle + " 72 72)");
    path.setAttribute("d", petal);
    path.setAttribute("fill", "currentColor");
    g.appendChild(path); svg.appendChild(g); paths.push(path);
  });
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
      paths.forEach(function (path, i) {
        var t = ((now - started) % 3600 - i * 100) / 2600;
        var blend = t < .12 ? 0 : t < .4 ? ease((t - .12) / .28) : t < .54 ? 1 : 1 - ease((t - .54) / .34), j = 0;
        path.setAttribute("d", petal.replace(/-?\d*\.?\d+/g, function (value) { var from = Number(value); return (from + (gathered[j++] - from) * blend).toFixed(2); }));
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
