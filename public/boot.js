// The desktop app's opening screen: Mowr's mark, drawn before any of the app has loaded and kept until the workspace
// is ready (the app calls window.mowrBoot.done()). Plain script so it paints on the first frame. The petal shapes and
// the gather-and-open motion match the Logo component in src/Icons.tsx.
(function () {
  if (location.protocol !== "mowr:") return;
  var petal = "M96.7 10.8 C100.6 19.9 103.2 29.6 102.1 38.9 C101.1 48.1 95.8 55.7 89.5 60.7 C84.8 64.2 80 65.5 74.2 66.4 C70.7 61.8 68.2 57.5 67.2 51.7 C66.2 43.8 67.7 34.7 73.4 27.3 C79.1 19.8 87.6 14.7 96.7 10.8Z";
  var gathered = "M78.7 18.3 C85.8 21.2 90.4 28.2 90 35.9 C89.6 44.3 83.3 51.3 75 52.7 C71.7 53.3 68.3 52.9 65.2 51.7 C62.2 50.4 59.5 48.4 57.5 45.7 C52.5 38.9 52.9 29.5 58.5 23.1 C63.5 17.4 71.6 15.4 78.7 18.3Z".match(/-?\d*\.?\d+/g).map(Number);
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
