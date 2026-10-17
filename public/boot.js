// The desktop app's opening screen: Mowr's mark, drawn before any of the app has loaded and kept until the workspace
// is ready (the app calls window.mowrBoot.done()). Plain script so it paints on the first frame. The stroke and the
// writing motion match src/brand/mark.ts.
(function () {
  if (location.protocol !== "mowr:") return;
  var stroke = "M15 113 V63 C15 43 25 31 40 31 C55 31 65 43 65 63 V105 V63 C65 43 75 31 90 31 C105 31 115 43 115 63 V93 C115 105 121 113 129 109";
  var theme = "dark";
  try { var chosen = localStorage.getItem("mowr-theme"); theme = chosen === "light" || (chosen === "system" && matchMedia("(prefers-color-scheme: light)").matches) ? "light" : "dark"; } catch (e) {}
  var paper = theme === "light" ? "#faf8f3" : "#141414", trace = theme === "light" ? "32,37,58" : "245,244,240";
  var style = document.createElement("style");
  style.textContent =
    "#mowr-boot{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;background:" + paper + ";color:#d9473e;transition:opacity .45s ease,visibility 0s linear .45s}" +
    "#mowr-boot .boot-stage{position:relative;display:grid;place-items:center;width:160px;height:160px}" +
    "#mowr-boot .boot-glow{position:absolute;inset:18px;border-radius:50%;background:radial-gradient(circle,rgba(217,71,62,.16),rgba(217,71,62,0) 68%);animation:mowr-boot-breathe 3.6s ease-in-out infinite}" +
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
  var ns = "http://www.w3.org/2000/svg", svg = document.createElementNS(ns, "svg"), path = document.createElementNS(ns, "path");
  svg.setAttribute("viewBox", "0 0 144 144");
  svg.setAttribute("aria-hidden", "true");
  path.setAttribute("d", stroke);
  path.setAttribute("pathLength", "1");
  ["fill", "none", "stroke", "currentColor", "stroke-width", "19", "stroke-linecap", "round", "stroke-linejoin", "round"].forEach(function (v, i, a) { if (i % 2 === 0) path.setAttribute(v, a[i + 1]); });
  svg.appendChild(path);
  var stage = document.createElement("div"), glow = document.createElement("span"), line = document.createElement("span");
  stage.className = "boot-stage"; glow.className = "boot-glow"; line.className = "boot-line";
  line.appendChild(document.createElement("i"));
  stage.appendChild(glow); stage.appendChild(svg); stage.appendChild(line); root.appendChild(stage);
  (document.body || document.documentElement).appendChild(root);

  var still = matchMedia("(prefers-reduced-motion: reduce)").matches, started = performance.now(), frame = 0, last = -1;
  var ease = function (t) { var x = Math.max(0, Math.min(1, t)); return x * x * (3 - 2 * x); };
  // The pen writes the m, holds, lifts it from the start, and writes it again (3.2 s a loop).
  function tick(now) {
    var cel = Math.floor(now / 24);
    if (cel !== last) {
      last = cel;
      var t = ((now - started) % 3200) / 3200, from = t < .62 ? 0 : ease((t - .62) / .38), to = t < .5 ? ease(t / .5) : 1;
      path.setAttribute("stroke-dasharray", (to - from).toFixed(3) + " 2");
      path.setAttribute("stroke-dashoffset", (-from).toFixed(3));
      path.setAttribute("opacity", to - from < .01 ? "0" : "1");
    }
    frame = requestAnimationFrame(tick);
  }
  if (!still) frame = requestAnimationFrame(tick);

  var finished = false;
  function done() {
    if (finished) return;
    finished = true;
    // Always show the pen at work for a moment, so a fast start still reads as an opening rather than a flicker.
    setTimeout(function () {
      root.classList.add("is-leaving");
      setTimeout(function () { cancelAnimationFrame(frame); root.remove(); style.remove(); }, 500);
    }, Math.max(0, 900 - (performance.now() - started)));
  }
  window.mowrBoot = { done: done };
  // Never trap someone behind the opening screen if something upstream fails to report in.
  setTimeout(done, 25000);
})();
