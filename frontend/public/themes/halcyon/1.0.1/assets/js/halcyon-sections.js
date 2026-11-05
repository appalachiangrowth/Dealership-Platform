/* HALCYON · MIDNIGHT SHOWROOM — home sections 02-10: live inventory rendering + motion.
   Needs pa-data.js (window.PA). Respects prefers-reduced-motion throughout. */
(function () {
  "use strict";
  var RM = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  var HOVER = window.matchMedia && matchMedia("(hover:hover) and (pointer:fine)").matches;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  var smooth = function (a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var money = function (n) { return n === null || n === undefined || n === "" || isNaN(Number(n)) ? "Call for price" : "$" + Math.round(Number(n)).toLocaleString("en-US"); };
  var PLACEHOLDER = "data:image/svg+xml;charset=UTF-8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#1b2130"/><stop offset="1" stop-color="#0b0e15"/></linearGradient><linearGradient id="p" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#ff5a5f"/><stop offset=".45" stop-color="#c3141d"/><stop offset="1" stop-color="#3a0306"/></linearGradient></defs><rect width="800" height="600" fill="url(#g)"/><ellipse cx="400" cy="420" rx="300" ry="22" fill="#e0212b" opacity=".25"/><path d="M130 400c0-22 16-34 44-38l110-14c36-34 86-56 150-58h40c66 2 112 24 146 54l70 12c26 6 40 18 40 38v18H130z" fill="url(#p)"/><path d="M308 348c32-28 72-42 126-44h40c50 2 86 16 112 44z" fill="#0a0d14" opacity=".85"/><circle cx="262" cy="416" r="40" fill="#07080b"/><circle cx="262" cy="416" r="22" fill="#8a93a2"/><circle cx="556" cy="416" r="40" fill="#07080b"/><circle cx="556" cy="416" r="22" fill="#8a93a2"/></svg>');

  /* ---------- heading word split (keeps <em>) ---------- */
  function splitHeading(h) {
    var n = 0;
    /* keep punctuation that follows an italic word attached to it (no orphan "." on its own line) */
    Array.prototype.slice.call(h.querySelectorAll("em")).forEach(function (em) { var t = em.nextSibling; if (t && t.nodeType === 3) { var m = /^[.,!?;:\u2019\u201d]+/.exec(t.nodeValue); if (m) { em.appendChild(document.createTextNode(m[0])); t.nodeValue = t.nodeValue.slice(m[0].length); } } });
    (function walk(node) {
      Array.prototype.slice.call(node.childNodes).forEach(function (c) {
        if (c.nodeType === 3) {
          var parts = (c.nodeValue || "").split(/(\s+)/), frag = document.createDocumentFragment();
          parts.forEach(function (p) {
            if (!p) return;
            if (/^\s+$/.test(p)) { frag.appendChild(document.createTextNode(" ")); return; }
            var w = document.createElement("span"), i = document.createElement("span");
            w.className = "sr-w"; i.textContent = p; i.style.setProperty("--i", n++); w.appendChild(i); frag.appendChild(w);
          });
          node.replaceChild(frag, c);
        } else if (c.nodeType === 1 && c.tagName !== "BR") walk(c);
      });
    })(h);
  }
  $$(".sr-split, .sr-hero-title").forEach(splitHeading);

  /* review copy writes itself in, word by word */
  $$(".sr-rv blockquote").forEach(function (q) {
    var parts = (q.textContent || "").split(/(\s+)/), frag = document.createDocumentFragment(), wi = 0;
    var card = q.closest ? q.closest(".sr-rv") : q.parentNode;
    var base = card && card.style ? (parseFloat(card.style.getPropertyValue("--d")) || 0) + .5 : .5;
    parts.forEach(function (p) {
      if (!p) return;
      if (/^\s+$/.test(p)) { frag.appendChild(document.createTextNode(p)); return; }
      var w = document.createElement("span"); w.className = "sr-review-word"; w.textContent = p;
      w.style.setProperty("--write-delay", (base + wi * .04).toFixed(3) + "s"); wi++;
      frag.appendChild(w);
    });
    while (q.firstChild) q.removeChild(q.firstChild);
    q.appendChild(frag);
  });

  /* ---------- hero: decorative word, dust, entrance ---------- */
  (function () {
    var cap = $(".sr-hero-caption"), word = $("#srHeroWord");
    if (cap && word) {
      var t = "";
      Array.prototype.forEach.call(cap.childNodes, function (n) { if (!t && n.nodeType === 3 && n.nodeValue.trim()) t = n.nodeValue.trim(); });
      word.textContent = (t.split(/\s+/)[0] || "").slice(0, 10);
    }
    var dust = $("#srDust");
    if (dust && !RM) {
      var count = innerWidth < 700 ? 8 : 16, html = "";
      for (var i = 0; i < count; i++) {
        html += '<i style="left:' + (Math.random() * 100).toFixed(1) + '%;--s:' + (1 + Math.random() * 2.2).toFixed(1) + 'px;--t:' + (10 + Math.random() * 14).toFixed(1) + 's;--dl:-' + (Math.random() * 20).toFixed(1) + 's;--dx:' + ((Math.random() - .5) * 120).toFixed(0) + 'px;--o:' + (.25 + Math.random() * .55).toFixed(2) + '"></i>';
      }
      dust.innerHTML = html;
    }
    requestAnimationFrame(function () { requestAnimationFrame(function () { document.body.classList.add("sr-ready"); }); });
  })();

  /* ---------- label scramble (decodes like a dash display) ---------- */
  var GLYPHS = "ABCDEFGHJKLMNPRSTUVWXYZ0123456789/<>-";
  function scramble(el) {
    if (RM || el.__scr) return; el.__scr = 1;
    var final = el.textContent, len = final.length, start = performance.now(), dur = 700 + len * 18;
    (function f(t) {
      var p = clamp((t - start) / dur, 0, 1), shown = Math.floor(p * len), out = "";
      for (var i = 0; i < len; i++) out += i < shown || final[i] === " " ? final[i] : GLYPHS[(Math.random() * GLYPHS.length) | 0];
      el.textContent = out;
      if (p < 1) requestAnimationFrame(f); else el.textContent = final;
    })(start);
  }

  /* ---------- reveal on scroll ---------- */
  var io = "IntersectionObserver" in window && !RM ? new IntersectionObserver(function (es) {
    es.forEach(function (e) {
      if (!e.isIntersecting) return;
      e.target.classList.add("is-in"); io.unobserve(e.target);
      var s = $(".sr-scr", e.target); if (s) scramble(s);
      if (e.target.__srIn) e.target.__srIn();
    });
  }, { threshold: .16, rootMargin: "0px 0px -8% 0px" }) : null;
  function watch(el, cb) {
    if (!el) return;
    if (el.classList.contains("is-in")) { cb && cb(); return; }
    if (!io) { el.classList.add("is-in"); cb && cb(); return; }
    el.__srIn = cb; io.observe(el);
  }
  $$(".sr-reveal,.sr-split,.sr-mapbox,.sr-footer-word,.sr-stars").forEach(function (el) { watch(el); });

  /* ---------- scroll engine: progress, top bar, panels, parallax, promo ---------- */
  var prog = $("#hxProgress"), bar = $("#hxTopbar"), hero = $("#hero"), callRide = $(".sr-call-ride"), toTop = $("#toTop");
  var panels = $$(".sr-panel"), lights = $$(".sr-light"), fword = $(".sr-footer-word span");
  var ticking = false, lastY = scrollY, vel = 0, dirAcc = 0;
  function onScroll() {
    var y = scrollY, vh = innerHeight, max = document.documentElement.scrollHeight - vh;
    if (prog) prog.style.transform = "scaleX(" + (max > 0 ? y / max : 0) + ")";
    var dy = y - lastY; vel = dy; lastY = y;
    var heroH = hero ? hero.offsetHeight : vh;
    if (bar) {
      bar.classList.toggle("on", y > 40);
      dirAcc = (dy > 0) === (dirAcc > 0) ? dirAcc + dy : dy;
      if (y < heroH * .6 || dirAcc < -40) bar.classList.remove("hide");
      else if (dirAcc > 60 && !document.body.classList.contains("menu-open")) bar.classList.add("hide");
    }
    if (callRide) callRide.classList.toggle("show", y > heroH * .55);
    if (toTop) toTop.classList.toggle("is-visible", y > heroH * 1.2);
    if (!RM) {
      panels.forEach(function (p) {
        var r = p.getBoundingClientRect(); if (r.top > vh || r.bottom < 0) return;
        var k = 1 - smooth(0, .75, (vh - r.top) / vh);
        p.style.setProperty("--pc", k.toFixed(3));
      });
      lights.forEach(function (s) {
        var r = s.getBoundingClientRect(); if (r.top > vh || r.bottom < 0) return;
        s.style.setProperty("--ny", ((r.top) * -.18).toFixed(1) + "px");
      });
      if (fword) { var fr = fword.getBoundingClientRect(); if (fr.top < vh) fword.style.setProperty("--py", ((fr.top - vh) * .08).toFixed(1) + "px"); }
      if (hero && y < heroH) {
        var copy = $(".sr-hero-copy");
        if (copy) { copy.style.opacity = String(1 - smooth(heroH * .15, heroH * .7, y)); }
      }
    }
    promoUpdate(); ticking = false;
  }
  addEventListener("scroll", function () { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true });
  addEventListener("resize", function () { fitFooterWord(); onScroll(); });

  /* ---------- pointer effects ---------- */
  if (HOVER && !RM) {
    $$(".sr-feat").forEach(function (c) { c.addEventListener("pointermove", function (e) { var r = c.getBoundingClientRect(); c.style.setProperty("--fx", (e.clientX - r.left) + "px"); c.style.setProperty("--fy", (e.clientY - r.top) + "px"); }); });
    document.addEventListener("pointermove", function (e) {
      var b = e.target.closest && e.target.closest(".sr-magnet"); if (!b) return;
      var r = b.getBoundingClientRect();
      b.style.transform = "translate(" + ((e.clientX - r.left - r.width / 2) * .2).toFixed(1) + "px," + ((e.clientY - r.top - r.height / 2) * .3).toFixed(1) + "px)";
      if (!b.__mg) { b.__mg = 1; b.addEventListener("pointerleave", function () { b.style.transform = ""; }); }
    });
    var map = $(".sr-map-tilt"), mapbox = $(".sr-mapbox");
    if (map && mapbox) {
      mapbox.addEventListener("pointermove", function (e) { var r = mapbox.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5; map.style.setProperty("--ty", (x * 12).toFixed(2) + "deg"); map.style.setProperty("--tx", (-y * 10).toFixed(2) + "deg"); });
      mapbox.addEventListener("pointerleave", function () { map.style.removeProperty("--ty"); map.style.removeProperty("--tx"); });
    }
  }

  /* ---------- count-up ---------- */
  function countUp(el) {
    var target = Number(el.dataset.target || 0), pre = el.dataset.prefix || "";
    if (RM) { el.textContent = pre + target.toLocaleString("en-US"); return; }
    var t0 = performance.now(), d = 2000;
    (function f(t) { var p = clamp((t - t0) / d, 0, 1), e = 1 - Math.pow(1 - p, 4); el.textContent = pre + Math.round(target * e).toLocaleString("en-US"); if (p < 1) requestAnimationFrame(f); })(t0);
  }
  function rollNumber(el, to) {
    var s = String(to); s = s.length < 2 ? "0" + s : s;
    var from = parseInt(el.textContent, 10) || 0;
    if (RM || from === to) { el.textContent = s; return; }
    var t0 = performance.now(), d = 700;
    (function f(t) { var p = clamp((t - t0) / d, 0, 1), e = 1 - Math.pow(1 - p, 3), v = Math.round(from + (to - from) * e), o = String(v); el.textContent = o.length < 2 ? "0" + o : o; if (p < 1) requestAnimationFrame(f); })(t0);
  }

  /* ---------- vehicle card ---------- */
  function cardHTML(v, i) {
    var img = (v.images && v.images[0]) || "", name = PA.name(v), body = v.body || v.type || "Vehicle";
    var tags = [];
    if (v.mileage !== undefined && v.mileage !== "" && v.mileage !== null) tags.push(Number(v.mileage).toLocaleString("en-US") + " mi");
    [v.trans, v.fuel, PA.drive(v.drivetrain)].forEach(function (t) { if (t && tags.indexOf(t) < 0) tags.push(t); });
    return '<a class="sr-fc" href="vehicle.html?id=' + encodeURIComponent(v.id) + '" style="--ad:' + (.1 + (i % 6) * .09).toFixed(2) + 's"><div class="sr-fc-in"><div class="sr-ph">' + (v.featured ? '<span class="sr-badge">Featured</span>' : "") +
      (v.year ? '<span class="sr-yr">' + esc(v.year) + '</span>' : "") +
      '<img src="' + esc(img || PLACEHOLDER) + '" alt="' + esc(name) + '" loading="lazy" decoding="async" draggable="false" onerror="this.onerror=null;this.src=\'' + PLACEHOLDER.replace(/'/g, "%27") + '\'"></div>' +
      '<div class="sr-fb"><small>' + esc(v.make || body) + " · " + esc(body) + '</small><h3>' + esc(name) + '</h3><div class="sr-specs">' + tags.slice(0, 3).map(function (t) { return "<span>" + esc(t) + "</span>"; }).join("") + '</div>' +
      '<div class="sr-ff"><div><small>Price</small><b>' + money(v.price) + '</b></div><span class="sr-go"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 12h14M13 6l6 6-6 6"/></svg></span></div></div></div></a>';
  }
  function tilt(el) {
    if (!HOVER || RM) return;
    var inner = el.firstChild;
    el.addEventListener("pointermove", function (e) {
      if (el.parentNode && el.parentNode.classList.contains("drag")) return;
      var r = el.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
      inner.style.setProperty("--ry", ((x - .5) * 10).toFixed(2) + "deg"); inner.style.setProperty("--rx", ((.5 - y) * 8).toFixed(2) + "deg");
      inner.style.setProperty("--mx", (x * 100) + "%"); inner.style.setProperty("--my", (y * 100) + "%");
    });
    el.addEventListener("pointerleave", function () { inner.style.setProperty("--rx", "0deg"); inner.style.setProperty("--ry", "0deg"); });
  }

  /* ---------- promo: scroll-driven drive-in + kinetic phrase ---------- */
  var lift = $("#lift"), car = $("#hxCar"), wA = $("#hxWA"), wB = $("#hxWB"), lanes = $("#srLanes"), phrase = $("#srPhrase");
  function promoUpdate() {
    if (!lift || !car) return;
    var r = lift.getBoundingClientRect(); if (r.bottom < 0 || r.top > innerHeight) return;
    var p = clamp((innerHeight - r.top) / (innerHeight + r.height * .45), 0, 1);
    var e = RM ? 1 : 1 - Math.pow(1 - smooth(.22, .8, p), 3), x = -1150 + 1110 * e;
    car.setAttribute("transform", "translate(" + x.toFixed(1) + " 0)");
    var a = (x * 1.3) % 360;
    wA.setAttribute("transform", "rotate(" + a.toFixed(1) + " 440 296)"); wB.setAttribute("transform", "rotate(" + a.toFixed(1) + " 880 296)");
    car.style.setProperty("--trail", (1 - e * .85).toFixed(2));
    if (lanes) lanes.setAttribute("transform", "translate(" + (-(p * 2400) % 120).toFixed(1) + " 0)");
    if (phrase && !RM) phrase.style.setProperty("--px", (-p * (phrase.scrollWidth * .45)).toFixed(1) + "px");
  }

  /* ---------- map route ---------- */
  (function () {
    var box = $(".sr-mapbox"), route = $("#route"), glow = $("#routeGlow"), dot = $("#mapCar"); if (!route || !box) return;
    var len = route.getTotalLength(); route.style.setProperty("--len", len); if (glow) glow.style.setProperty("--len", len);
    box.__srIn = function () {
      if (RM) { var p = route.getPointAtLength(len); dot.setAttribute("cx", p.x); dot.setAttribute("cy", p.y); return; }
      var t0 = performance.now() + 300, d = 3200;
      (function f(t) { var k = clamp((t - t0) / d, 0, 1), e = k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2, p = route.getPointAtLength(len * e); dot.setAttribute("cx", p.x); dot.setAttribute("cy", p.y); if (k < 1) requestAnimationFrame(f); })(performance.now());
    };
  })();

  /* ---------- footer word fits its container ---------- */
  function fitFooterWord() {
    var box = $(".sr-footer-word"), s = box && box.firstElementChild; if (!s) return;
    s.style.setProperty("--fw", "100px");
    var w = s.scrollWidth || 1, avail = box.clientWidth || 1;
    s.style.setProperty("--fw", Math.min(260, Math.max(14, 100 * avail / w * .98)).toFixed(1) + "px");
  }
  fitFooterWord();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitFooterWord);

  /* ---------- data-driven parts ---------- */
  function init() {
    var all = PA.published(), makes = {};
    all.forEach(function (v) { if (v.make) makes[v.make] = (makes[v.make] || 0) + 1; });
    var makeNames = Object.keys(makes).sort(function (a, b) { return makes[b] - makes[a] || a.localeCompare(b); });
    var prices = all.map(function (v) { return Number(v.price) || 0; }).filter(Boolean);

    /* stats */
    var stats = $(".sr-stats");
    $$("[data-count]").forEach(function (el) {
      var k = el.dataset.count;
      el.dataset.target = k === "all" ? all.length : k === "makes" ? makeNames.length : (prices.length ? Math.min.apply(null, prices) : 0);
    });
    watch(stats, function () { $$("[data-count]", stats).forEach(countUp); });

    /* search */
    var sq = $("#sq"), st = $("#stype"), mn = $("#matchN");
    function matches() { var q = sq.value.trim().toLowerCase(), t = st.value.toLowerCase(); return all.filter(function (v) { return (!q || [v.year, v.make, v.model, v.trim].join(" ").toLowerCase().indexOf(q) > -1) && (!t || (PA.kinds[t] && PA.kinds[t](v))); }).length; }
    function upd() { mn.textContent = matches(); if (mn.animate && !RM) mn.animate([{ transform: "translateY(-70%) scale(.8)", opacity: 0, color: "#e0212b" }, { transform: "none", opacity: 1 }], { duration: 420, easing: "cubic-bezier(.16,1,.3,1)" }); }
    sq.addEventListener("input", upd); st.addEventListener("input", upd); mn.textContent = matches();
    $("#searchForm").addEventListener("submit", function (e) { e.preventDefault(); var p = new URLSearchParams(), q = sq.value.trim(), t = st.value; if (q) p.set("q", q); if (t) p.set("type", t); location.href = "inventory.html" + (p.toString() ? "?" + p.toString() : ""); });
    var pop = $("#pop"), chips = makeNames.slice(0, 3).map(function (m) { return ["make", m, m]; });
    ["Truck", "SUV"].forEach(function (t) { if (all.some(function (v) { return PA.kinds[t.toLowerCase()](v); })) chips.push(["type", t, t + "s"]); });
    chips.slice(0, 5).forEach(function (c) { var a = document.createElement("a"); a.href = "inventory.html?" + c[0] + "=" + encodeURIComponent(c[1]); a.textContent = c[2]; pop.appendChild(a); });
    if (!RM) {
      var words = all.slice(0, 5).map(function (v) { return [v.year, v.make, v.model].filter(Boolean).join(" "); }).filter(Boolean), wi = 0, ci = 0, del = false; if (!words.length) words = ["Search make or model"];
      (function tick() { if (document.activeElement === sq || sq.value) { setTimeout(tick, 900); return; } var w = words[wi]; ci += del ? -1 : 1; sq.placeholder = "Try “" + w.slice(0, ci) + "”"; var wait = del ? 32 : 68; if (!del && ci === w.length) { del = true; wait = 1700; } else if (del && ci === 0) { del = false; wi = (wi + 1) % words.length; wait = 300; } setTimeout(tick, wait); })();
    }

    /* featured lane */
    var lane = $("#lane"), feat = PA.list("featured"); if (!feat.length) feat = all;
    lane.innerHTML = feat.length ? feat.map(function (v, i) { return cardHTML(v, i); }).join("") : '<p class="sr-empty" style="flex:1">New inventory is arriving soon. Call us for what is on the lot today.</p>';
    watch(lane);
    $$(".sr-fc", lane).forEach(tilt);
    var fp = $("#fprog");
    function lp() { var m = lane.scrollWidth - lane.clientWidth, f = Math.min(1, lane.clientWidth / Math.max(1, lane.scrollWidth)); fp.style.width = (f * 100) + "%"; fp.style.transform = "translateX(" + (m > 0 ? lane.scrollLeft / m * (1 / f - 1) * 100 : 0) + "%)"; }
    lane.addEventListener("scroll", lp, { passive: true }); addEventListener("resize", lp); lp();
    function step(d) { var c = $(".sr-fc", lane); if (c) lane.scrollBy({ left: d * (c.offsetWidth + 24), behavior: RM ? "auto" : "smooth" }); }
    $("#fPrev").onclick = function () { step(-1); }; $("#fNext").onclick = function () { step(1); };
    var down = false, sx = 0, sl = 0, moved = false;
    lane.addEventListener("pointerdown", function (e) { if (e.pointerType !== "mouse") return; down = true; moved = false; sx = e.clientX; sl = lane.scrollLeft; });
    addEventListener("pointermove", function (e) { if (!down) return; var dx = e.clientX - sx; if (Math.abs(dx) > 4) { moved = true; lane.classList.add("drag"); } lane.scrollLeft = sl - dx; });
    addEventListener("pointerup", function () { down = false; lane.classList.remove("drag"); });
    lane.addEventListener("click", function (e) { if (moved) { e.preventDefault(); moved = false; } }, true);

    /* brands marquee — two rows, opposite directions, speed follows scroll velocity */
    var brands = $("#brands"), mrows = $(".sr-mrows");
    if (!makeNames.length) brands.hidden = true; else {
      var tile = function (m) { return '<a class="sr-mk" href="inventory.html?make=' + encodeURIComponent(m) + '">' + esc(m) + "<sup>" + makes[m] + "</sup></a>"; };
      var lines = [{ el: $("#mrowA"), dir: -1, list: makeNames }, { el: $("#mrowB"), dir: 1, list: makeNames.slice().reverse() }];
      lines.forEach(function (l) {
        if (!l.el) return;
        var set = l.list.map(tile).join(""); l.el.innerHTML = set; var w = l.el.scrollWidth || 1, reps = Math.max(2, Math.ceil(innerWidth * 2 / w) + 1);
        l.el.innerHTML = new Array(reps + 1).join(set); l.w = w; l.x = l.dir > 0 ? -w : 0; l.hov = false;
        if (l.dir > 0) $$("a", l.el).forEach(function (a) { a.setAttribute("tabindex", "-1"); a.setAttribute("aria-hidden", "true"); });
        l.el.addEventListener("pointerenter", function () { l.hov = true; }); l.el.addEventListener("pointerleave", function () { l.hov = false; });
      });
      lines = lines.filter(function (l) { return l.el; });
      var visible = true;
      if ("IntersectionObserver" in window) new IntersectionObserver(function (es) { visible = es[0].isIntersecting; }).observe(brands);
      if (!RM) (function loop() {
        if (visible) {
          var boost = clamp(vel * .14, -16, 16); vel *= .9;
          if (mrows) mrows.style.setProperty("--skew", clamp(-boost * .5, -8, 8).toFixed(2) + "deg");
          lines.forEach(function (l) {
            var sp = (l.hov ? .2 : .8) * l.dir + Math.abs(boost) * l.dir * .7; l.x += sp;
            if (l.dir < 0 && l.x <= -l.w) l.x += l.w;
            if (l.dir > 0 && l.x >= 0) l.x -= l.w;
            l.el.style.transform = "translate3d(" + l.x.toFixed(2) + "px,0,0)";
          });
        }
        requestAnimationFrame(loop);
      })();
    }

    /* body styles */
    var gear = $("#gear"), knob = $("#knob"), grid = $("#bsGrid"), bsN = $("#bsN"), bsBox = $(".sr-bscount"), cur = -1, busy;
    var bodyOf = function (v) { return v.body || v.type || "Vehicle"; }, bc = {};
    all.forEach(function (v) { var b = bodyOf(v); bc[b] = (bc[b] || 0) + 1; });
    var tabs = ["All"].concat(Object.keys(bc).sort(function (a, b) { return bc[b] - bc[a]; }).slice(0, 6));
    tabs.forEach(function (t, i) { var b = document.createElement("button"); b.type = "button"; b.setAttribute("role", "tab"); b.innerHTML = esc(t) + "<em>" + (t === "All" ? all.length : bc[t]) + "</em>"; b.addEventListener("click", function () { pick(i); }); gear.appendChild(b); });
    function place(b) { if (!b) return; knob.style.left = b.offsetLeft + "px"; knob.style.top = b.offsetTop + "px"; knob.style.width = b.offsetWidth + "px"; knob.style.height = b.offsetHeight + "px"; }
    function render(list, animate) {
      var total = list.length; list = list.slice(0, innerWidth <= 980 ? 8 : 4);
      grid.innerHTML = list.length ? list.map(function (v, i) { return cardHTML(v, i); }).join("") : '<p class="sr-empty">No vehicles in this style right now. Call us and we will help you find one.</p>';
      if (!grid.__w) { grid.__w = true; watch(grid); }
      $$(".sr-fc", grid).forEach(function (el, k) { tilt(el); if (animate && !RM) { el.classList.add("enter"); el.style.animationDelay = (k * .07) + "s"; } });
      rollNumber(bsN, total);
      if (bsBox) bsBox.style.setProperty("--fill", (all.length ? Math.round(total / all.length * 100) : 0) + "%");
      $("#bsAll").href = tabs[cur] === "All" ? "inventory.html" : "inventory.html?body=" + encodeURIComponent(tabs[cur]);
    }
    function pick(i) {
      if (i === cur) return; var bs = $$("button", gear);
      bs.forEach(function (b, j) { b.classList.toggle("on", j === i); b.setAttribute("aria-selected", j === i); }); place(bs[i]);
      if (gear.scrollWidth > gear.clientWidth) gear.scrollTo({ left: bs[i].offsetLeft - gear.clientWidth / 2 + bs[i].offsetWidth / 2, behavior: RM ? "auto" : "smooth" });
      var first = cur < 0; cur = i; var list = tabs[i] === "All" ? all : all.filter(function (v) { return bodyOf(v) === tabs[i]; });
      clearTimeout(busy); if (first || RM) { render(list, false); return; }
      $$(".sr-fc", grid).forEach(function (el) { el.classList.remove("enter"); el.classList.add("leave"); }); busy = setTimeout(function () { render(list, true); }, 320);
    }
    pick(0); addEventListener("resize", function () { place($(".on", gear)); });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { place($(".on", gear)); });
    watch($("#gear"), function () { place($(".on", gear)); });
  }
  if (window.PA && PA.load) PA.load().then(init); else document.addEventListener("pa:ready", init);
  onScroll();
})();
