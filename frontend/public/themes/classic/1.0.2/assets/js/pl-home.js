/* =====================================================================
   CLASSIC THEME - HOME PAGE
   - Renders inside #page-home > .pl-root
   - Uses the REAL inventory (window.PADB.getV()) - no demo vehicles
   - Search form sends the visitor to the existing inventory page:
        #/inventory?q=..&type=..&min=..&max=..
     (all four params are already understood by the old inventory system)
   - Re-renders automatically when inventory changes (see buildHome hook)
   ===================================================================== */
(function () {
  "use strict";

  /* Images, texts, category cards and reviews come from the Website Editor (rendered into the page).
     Brand list below: logo:'' = automatic logo. Or set logo:'images/brands/ford.png' / link:'https://...' */
  var BRANDS = ["Acura", "Audi", "Bentley", "BMW", "Chevrolet", "Chrysler", "Dodge", "Ford", "GMC", "Honda", "Hyundai", "Jeep", "Kia", "Lexus", "Mazda", "Mercedes-Benz", "Nissan", "Subaru", "Toyota", "Volkswagen"].map(function (n) { return { name: n, logo: "", link: "" }; });
  var FILTERS = ["All", "Sedan", "SUV", "Truck", "Coupe", "Luxury", "Electric / Hybrid", "Van", "AWD"];
  var PRICES = [3000, 5000, 7500, 10000, 15000, 20000, 25000, 30000, 40000, 50000];
  var LUX = /^(bmw|mercedes|audi|lexus|acura|infiniti|cadillac|lincoln|volvo|genesis|porsche|tesla|bentley)/i;
  var T = window.paT || function () { return ""; };
  /* ------------------------------------------------------ */

  var root = document.getElementById("plRoot");
  if (!root) return;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var money = function (n) { return "$" + Math.round(Number(n) || 0).toLocaleString("en-US"); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var vName = function (v) { return v.title || (v.year + " " + v.make + " " + v.model + " " + (v.trim || "")).trim(); };
  root.classList.add("pl-js");

  /* ---------- fallback picture so no image is ever empty ---------- */
  var SC = [["#f59e0b", "#1e3a8a"], ["#fb7185", "#0f172a"], ["#38bdf8", "#0b1b3a"], ["#34d399", "#0f2a2a"]];
  function fbImg(i) {
    var c = SC[(i || 0) % 4], a = c[0], b = c[1];
    var s = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 800 520'><defs><linearGradient id='g' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='" + a + "'/><stop offset='.62' stop-color='" + b + "'/></linearGradient></defs><rect width='800' height='520' fill='url(#g)'/><circle cx='560' cy='170' r='60' fill='#fff' opacity='.25'/><path d='M0 400l140-90 120 60 150-110 140 90 110-60 140 80v130H0z' fill='#0b1220' opacity='.55'/><g fill='#0b1220'><path d='M150 400c0-40 40-62 90-70l70-62c18-16 40-24 70-24h120c34 0 58 10 78 30l52 56c46 6 80 24 80 70v20H150z'/><circle cx='290' cy='430' r='46'/><circle cx='560' cy='430' r='46'/></g><g fill='#e2e8f0'><circle cx='290' cy='430' r='20'/><circle cx='560' cy='430' r='20'/></g><path d='M330 276h110l30 54H300z' fill='#7dd3fc' opacity='.55'/></svg>";
    return "data:image/svg+xml;utf8," + encodeURIComponent(s);
  }
  window.plImgFb = function (el) { el.onerror = null; el.src = fbImg(+el.getAttribute("data-i") || 0); };
  (window.plImgQ || []).forEach(window.plImgFb); window.plImgQ = [];
  function setBg(v, url, i) {
    root.style.setProperty(v, 'url("' + url + '")');
    var t = new Image(); t.onerror = function () { root.style.setProperty(v, 'url("' + fbImg(i) + '")'); }; t.src = url;
  }
  function monogram(n) {
    var c = "#2B6BFF";
    return "data:image/svg+xml;utf8," + encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 120'><circle cx='60' cy='60' r='52' fill='none' stroke='" + c + "' stroke-width='6'/><circle cx='60' cy='60' r='40' fill='" + c + "' opacity='.12'/><text x='60' y='76' font-family='Arial' font-weight='700' font-size='46' text-anchor='middle' fill='" + c + "'>" + esc(n.charAt(0)) + "</text></svg>");
  }
  window.plMono = monogram;

  /* ---------- reveal on scroll ---------- */
  var io = null;
  function reveal() {
    var l = $$(".pl-reveal:not(.pl-in)", root);
    if (!("IntersectionObserver" in window)) { l.forEach(function (e) { e.classList.add("pl-in"); }); return; }
    io = io || new IntersectionObserver(function (es) { es.forEach(function (x) { if (x.isIntersecting) { x.target.classList.add("pl-in"); io.unobserve(x.target); } }); }, { threshold: .08 });
    l.forEach(function (e) { io.observe(e); });
  }
  setTimeout(function () { $$(".pl-reveal", root).forEach(function (e) { e.classList.add("pl-in"); }); }, 2500);

  /* ---------- saved vehicles: SAME storage the vehicle page uses ---------- */
  function getSaved() { try { return JSON.parse(localStorage.getItem("savedVehicles") || "[]"); } catch (e) { return []; } }
  var heart = '<svg viewBox="0 0 24 24"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>';

  /* ---------- real inventory ---------- */
  function vehicles() {
    var all = [];
    try { all = (window.PADB && window.PADB.getV()) || []; } catch (e) { }
    return all.filter(function (v) { return v.status !== "draft"; });
  }
  function featuredList(list) {
    var f = list.filter(function (v) { return v.featured; }).slice(0, 4);
    if (f.length < 4) f = f.concat(list.filter(function (v) { return f.indexOf(v) === -1; }).slice(0, 4 - f.length));
    return f;
  }
  function card(v) {
    var saved = getSaved(), id = String(v.id), on = saved.indexOf(id) > -1;
    var img = (v.images && v.images[0]) || "";
    var tag2 = v.trans || v.fuel || v.drivetrain || "";
    return '<article class="pl-card pl-reveal"><button type="button" class="pl-heart' + (on ? " pl-on" : "") + '" data-id="' + esc(id) + '" aria-label="Save ' + esc(vName(v)) + '" aria-pressed="' + on + '">' + heart + '</button>' +
      '<a href="#/vehicle/' + esc(id) + '" data-vehicle="' + esc(id) + '"><div class="pl-pimg"><img src="' + esc(img || fbImg(0)) + '" data-i="' + (String(id).length % 4) + '" alt="' + esc(vName(v) + " " + T("v_alt")) + '" loading="lazy" onerror="plImgFb(this)"></div>' +
      '<div class="pl-cb"><small>' + esc(v.body || v.type || "") + '</small><h3>' + esc(vName(v)) + '</h3><div class="pl-tags"><span>' + Number(v.mileage || 0).toLocaleString("en-US") + ' mi</span>' + (tag2 ? '<span>' + esc(tag2) + '</span>' : '') + '</div>' +
      '<div class="pl-pr"><b>' + money(v.price) + '</b><span>View details →</span></div></div></a></article>';
  }
  var match = function (v, f) {
    var body = String(v.body || ""), drive = String(v.drivetrain || "");
    switch (f) {
      case "All": return true;
      case "Sedan": return /sedan/i.test(body);
      case "SUV": return v.type === "SUV" && !/van/i.test(body);
      case "Truck": return v.type === "Truck";
      case "Coupe": return /coupe/i.test(body);
      case "Luxury": return LUX.test(v.make || "");
      case "Electric / Hybrid": return /electric|hybrid/i.test(v.fuel || "");
      case "Van": return /van/i.test(body);
      case "AWD": return /awd|4wd|all-wheel|four-wheel|4x4/i.test(drive);
    }
    return false;
  };
  var filter = "All";
  function drawTrend() {
    var list = vehicles().filter(function (v) { return match(v, filter); });
    $("#plTrend").innerHTML = list.length ? list.slice(0, 8).map(card).join("") : '<p class="pl-empty">' + esc(T("inv_empty_text")) + '</p>';
    reveal();
  }
  function setChip(f) { filter = f; $$(".pl-chip", root).forEach(function (x) { x.classList.toggle("pl-on", x.getAttribute("data-f") === f); }); }

  /* ---------- search suggestions (from real stock) ---------- */
  var POOL = [];
  function buildPool(list) {
    var seen = {}, makes = [];
    list.forEach(function (v) { if (v.make && !seen[v.make]) { seen[v.make] = 1; makes.push([v.make, "Make"]); } });
    POOL = makes.concat(list.map(function (v) { return [vName(v), v.body || v.type || ""]; }), [["Truck", "Type"], ["SUV", "Type"], ["Sedan", "Type"], ["Coupe", "Type"], ["Hybrid", "Fuel"], ["AWD", "Drive"]]);
  }
  var sQ = $("#plQ"), sL = $("#plList"), sel = -1, items = [];
  function hide() { sL.hidden = true; sQ.setAttribute("aria-expanded", "false"); sel = -1; }
  function suggest() {
    var t = sQ.value.trim().toLowerCase(); if (!t) return hide();
    items = POOL.filter(function (p) { return p[0].toLowerCase().indexOf(t) > -1; }).sort(function (a, b) { return a[0].toLowerCase().indexOf(t) - b[0].toLowerCase().indexOf(t); }).slice(0, 7);
    if (!items.length) return hide();
    sL.innerHTML = items.map(function (p, i) {
      var k = p[0].toLowerCase().indexOf(t);
      return '<li role="option" data-i="' + i + '"><span>' + esc(p[0].slice(0, k)) + "<mark>" + esc(p[0].slice(k, k + t.length)) + "</mark>" + esc(p[0].slice(k + t.length)) + "</span><small>" + esc(p[1]) + "</small></li>";
    }).join("");
    sL.hidden = false; sQ.setAttribute("aria-expanded", "true"); sel = -1;
  }
  sQ.addEventListener("input", suggest); sQ.addEventListener("focus", suggest);
  sQ.addEventListener("keydown", function (e) {
    if (sL.hidden) return; var li = $$("li", sL);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); sel = (sel + (e.key === "ArrowDown" ? 1 : -1) + li.length) % li.length; li.forEach(function (x, i) { x.classList.toggle("pl-on", i === sel); }); }
    else if (e.key === "Enter" && sel > -1) { e.preventDefault(); sQ.value = items[sel][0]; hide(); $("#plSearchForm").requestSubmit ? $("#plSearchForm").requestSubmit() : submitSearch(); }
    else if (e.key === "Escape") hide();
  });
  sL.addEventListener("mousedown", function (e) {
    var li = e.target.closest("li"); if (li) { e.preventDefault(); sQ.value = items[+li.getAttribute("data-i")][0]; hide(); $("#plSearchForm").requestSubmit ? $("#plSearchForm").requestSubmit() : submitSearch(); }
  });

  /* ---------- SEARCH -> existing inventory page ---------- */
  function submitSearch() {
    hide();
    var mn = +$("#plMin").value, mx = +$("#plMax").value;
    if (mn && mx && mn > mx) { var t = mn; mn = mx; mx = t; }
    var p = [], q = sQ.value.trim(), ty = $("#plType").value;
    if (q) p.push("q=" + encodeURIComponent(q));
    if (ty) p.push("type=" + encodeURIComponent(ty));
    if (mn) p.push("min=" + mn);
    if (mx) p.push("max=" + mx);
    location.hash = "#/inventory" + (p.length ? "?" + p.join("&") : "");
  }
  $("#plSearchForm").addEventListener("submit", function (e) { e.preventDefault(); submitSearch(); });

  /* ---------- one-time static parts ---------- */
  /* ---------- hero slideshow (photos from the Website Editor, auto-change every 2.5s) ---------- */
  (function () {
    var box = $("#plHeroSlides"); if (!box) return;
    var W = window.innerWidth < 700 ? 900 : window.innerWidth < 1200 ? 1400 : 1920;
    var list = $$("[data-slide]", box).map(function (el) { var u = el.getAttribute("data-slide") || ""; el.remove(); return u; }).filter(Boolean)
      .map(function (u) { return u.indexOf("images.unsplash.com") > -1 ? u.replace(/([?&])w=\d+/, "$1w=" + W) : u; });
    var slides = list.map(function (url, i) {
      var d = document.createElement("div"); d.className = "pl-hs" + (i === 0 ? " on" : "");
      d.style.backgroundImage = 'url("' + url.replace(/"/g, "%22") + '")';
      var t = new Image(); t.onerror = function () { d.style.backgroundImage = 'url("' + fbImg(i % 3) + '")'; }; t.src = url;
      box.appendChild(d); return d;
    });
    if (slides.length < 2) return;
    var cur = 0;
    setInterval(function () {
      slides[cur].classList.remove("on"); cur = (cur + 1) % slides.length; slides[cur].classList.add("on");
    }, 2500);
  })();
  setBg("--hero", root.getAttribute("data-hero") || "", 0); setBg("--finbg", root.getAttribute("data-finbg") || "", 2); setBg("--readybg", root.getAttribute("data-readybg") || "", 1);
  $("#plMin").innerHTML = '<option value="0">No minimum</option>' + PRICES.map(function (p) { return '<option value="' + p + '">' + money(p) + "</option>"; }).join("");
  $("#plMax").innerHTML = '<option value="0">No maximum</option>' + PRICES.map(function (p) { return '<option value="' + p + '">' + money(p) + "</option>"; }).join("");
  $("#plChips").innerHTML = FILTERS.map(function (f, i) { return '<button type="button" class="pl-chip' + (i ? "" : " pl-on") + '" data-f="' + f + '">' + f + "</button>"; }).join("");
  function slug(n) { return n.toLowerCase().replace("-benz", "").replace(/[^a-z0-9]/g, ""); }
  $("#plBrands").innerHTML = BRANDS.map(function (b) {
    var src = b.logo || "https://cdn.simpleicons.org/" + slug(b.name) + "/0F1B33";
    var href = b.link || "#/inventory?q=" + encodeURIComponent(b.name);
    return '<a class="pl-bcard" href="' + esc(href) + '"' + (b.link ? ' target="_blank" rel="noopener"' : "") + '><span class="pl-lg"><img src="' + esc(src) + '" alt="' + esc(b.name) + ' logo" loading="lazy" onerror="this.onerror=null;this.src=plMono(\'' + esc(b.name) + '\')"></span><b>' + esc(b.name) + "</b></a>";
  }).join("");
  var tr = $("#plBrands"), bp = $("#plBPrev"), bn = $("#plBNext");
  function arrows() { bp.disabled = tr.scrollLeft < 5; bn.disabled = tr.scrollLeft + tr.clientWidth >= tr.scrollWidth - 5; }
  bp.onclick = function () { tr.scrollBy({ left: -tr.clientWidth * .8, behavior: "smooth" }); };
  bn.onclick = function () { tr.scrollBy({ left: tr.clientWidth * .8, behavior: "smooth" }); };
  tr.addEventListener("scroll", arrows, { passive: true }); window.addEventListener("resize", arrows); arrows();

  /* ---------- events (scoped to the home root) ---------- */
  root.addEventListener("click", function (e) {
    if (!e.target.closest(".pl-ac")) hide();
    var h = e.target.closest(".pl-heart");
    if (h) {
      e.preventDefault(); e.stopPropagation();
      var id = h.getAttribute("data-id"), l = getSaved(), i = l.indexOf(id);
      if (i > -1) { l.splice(i, 1); if (window.toast) window.toast("Removed from saved vehicles"); } else { l.push(id); if (window.toast) window.toast("Vehicle saved"); }
      try { localStorage.setItem("savedVehicles", JSON.stringify(l)); } catch (_) { }
      var on = l.indexOf(id) > -1;
      $$('.pl-heart[data-id="' + id.replace(/"/g, "") + '"]', root).forEach(function (b) { b.classList.toggle("pl-on", on); b.setAttribute("aria-pressed", on); });
      return;
    }
    var c = e.target.closest(".pl-chip"); if (c) { setChip(c.getAttribute("data-f")); drawTrend(); return; }
    if (e.target.closest("#plMenu a")) closeMenu();
  });
  document.addEventListener("click", function (e) { if (!e.target.closest || !e.target.closest(".pl-ac")) hide(); });
  var menu = $("#plMenu"), burger = $("#plBurger");
  function closeMenu() { menu.classList.remove("pl-open"); burger.classList.remove("pl-x"); }
  burger.addEventListener("click", function () { menu.classList.toggle("pl-open"); burger.classList.toggle("pl-x"); });
  window.addEventListener("scroll", function () { $("#plNav").classList.toggle("pl-stuck", window.scrollY > 40); }, { passive: true });

  /* ---------- render everything that depends on real inventory ---------- */
  var HERO_EMPTY = $("#plHeroCar") ? $("#plHeroCar").textContent : "";
  function render() {
    var list = vehicles(), f = featuredList(list);
    if (window.PADB && window.PADB.loaded && !window.PADB.loaded()) { $("#plFeat").innerHTML = ""; return; }
    buildPool(list);
    $("#plFeat").innerHTML = f.length ? f.map(card).join("") : '<p class="pl-empty">' + esc(T("home_empty")) + '</p>';
    var hv = f[0], hl = $("#plHeroLink");
    if (hv) {
      $("#plHeroCar").textContent = hv.year + " " + hv.make + " " + hv.model + " · " + money(hv.price);
      hl.setAttribute("href", "#/vehicle/" + hv.id); hl.setAttribute("data-vehicle", hv.id);
    } else { $("#plHeroCar").textContent = HERO_EMPTY; hl.setAttribute("href", "#/inventory"); hl.removeAttribute("data-vehicle"); }
    drawTrend(); reveal();
  }
  window.PL_HOME = { render: render };
  render();

  /* ---------- hide the old shared header/footer while the home page is showing ---------- */
  var pg = document.getElementById("page-home");
  function sync() { document.body.classList.toggle("pl-home", pg.classList.contains("active")); }
  if (pg) { sync(); if (window.MutationObserver) new MutationObserver(sync).observe(pg, { attributes: true, attributeFilter: ["class"] }); }
})();
