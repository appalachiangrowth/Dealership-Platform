/* HALCYON · MIDNIGHT SHOWROOM — inner pages.
   Navigation, motion, live inventory catalog, vehicle detail, blog, article and lead forms.
   Data comes from the dealership's inventory.json; leads post to api/lead.php (unchanged). */
(function () {
  "use strict";
  var RM = !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
  var HOVER = !!(window.matchMedia && matchMedia("(hover:hover) and (pointer:fine)").matches);
  var $ = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };
  var esc = function (v) { return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); };
  var str = function (v) { return v == null ? "" : String(v).trim(); };
  var num = function (v) { if (v === null || v === undefined || String(v).trim() === "") return null; var n = Number(String(v).replace(/[^0-9.-]/g, "")); return isFinite(n) ? n : null; };
  var money = function (v) { var n = num(v); return n === null ? "Call for price" : "$" + Math.round(n).toLocaleString("en-US"); };
  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  var SITE = window.SITE || {};
  var BD = document.body ? document.body.dataset : {};
  if (!SITE.phone && BD.phone) SITE.phone = BD.phone;
  if (BD.tel) SITE.tel_link = BD.tel;
  var PLACEHOLDER = "data:image/svg+xml;charset=UTF-8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#1b2130"/><stop offset="1" stop-color="#0b0e15"/></linearGradient><linearGradient id="p" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#ff5a5f"/><stop offset=".45" stop-color="#c3141d"/><stop offset="1" stop-color="#3a0306"/></linearGradient></defs><rect width="800" height="600" fill="url(#g)"/><ellipse cx="400" cy="420" rx="300" ry="22" fill="#e0212b" opacity=".25"/><path d="M130 400c0-22 16-34 44-38l110-14c36-34 86-56 150-58h40c66 2 112 24 146 54l70 12c26 6 40 18 40 38v18H130z" fill="url(#p)"/><path d="M308 348c32-28 72-42 126-44h40c50 2 86 16 112 44z" fill="#0a0d14" opacity=".85"/><circle cx="262" cy="416" r="40" fill="#07080b"/><circle cx="262" cy="416" r="22" fill="#8a93a2"/><circle cx="556" cy="416" r="40" fill="#07080b"/><circle cx="556" cy="416" r="22" fill="#8a93a2"/></svg>');
  var ARROW = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
  var BTN_ICO = '<span class="sr-btn-ico" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M7 17 17 7M9 7h8v8"/></svg></span>';

  /* ---------- data helpers (same rules as the original pages) ---------- */
  function imageUrl(raw) { var u = str(raw); if (!u) return PLACEHOLDER; if (/^https?:\/\//i.test(u) || /^data:image\//i.test(u) || u.charAt(0) === "/") return u; return u.replace(/^\.\//, ""); }
  function imgOf(x) { return x && typeof x === "object" ? (x.url || x.src || x.path || "") : x; }
  function titleV(v) { return [str(v.year), str(v.make), str(v.model), str(v.trim)].filter(Boolean).join(" ") || str(v.title) || "Vehicle listing"; }
  function bodyOf(v) { return str(v.body || v.bodyStyle || v.type).toLowerCase(); }
  function kindOf(v) { var b = bodyOf(v), t = str(v.type).toLowerCase(); if (/suv|crossover|sport utility/.test(b) || /suv/.test(t)) return "SUV"; if (/truck|pickup/.test(b) || /truck|pickup/.test(t)) return "Truck"; if (/wagon/.test(b) || /wagon/.test(t)) return "Wagon"; if (/sedan/.test(b) || /sedan/.test(t)) return "Sedan"; return "Car"; }
  function drive(d) { d = str(d); if (/four|4/i.test(d)) return "4x4"; if (/all/i.test(d)) return "AWD"; if (/front/i.test(d)) return "FWD"; if (/rear/i.test(d)) return "RWD"; return d; }
  function matchesCategory(v, c) { var k = kindOf(v), b = bodyOf(v); if (c === "all") return true; if (c === "cars") return k !== "SUV" && k !== "Truck" && k !== "Wagon"; if (c === "sedans") return k === "Sedan" || /sedan/.test(b); if (c === "suvs") return k === "SUV"; if (c === "trucks") return k === "Truck"; if (c === "wagons") return k === "Wagon"; return true; }
  function filterVehicles(list, category, p) {
    var q = str(p.get("q")).toLowerCase(), type = str(p.get("type")).toLowerCase(), make = str(p.get("make")).toLowerCase(), body = str(p.get("body")).toLowerCase(), fuel = str(p.get("fuel")).toLowerCase(), dr = str(p.get("drivetrain") || p.get("drive")).toLowerCase(), max = num(p.get("max")), feature = str(p.get("feature")).toLowerCase();
    return list.filter(function (v) {
      var title = titleV(v).toLowerCase(), k = kindOf(v).toLowerCase(), b = bodyOf(v), pr = num(v.price);
      if (!matchesCategory(v, category)) return false;
      if (q && title.indexOf(q) < 0) return false;
      if (type && k !== type && str(v.type).toLowerCase() !== type && b.indexOf(type) < 0) return false;
      if (make && str(v.make).toLowerCase() !== make) return false;
      if (body && b.indexOf(body) < 0 && str(v.bodyStyle).toLowerCase().indexOf(body) < 0) return false;
      if (fuel && str(v.fuel).toLowerCase().replace(/[ /]/g, "-").indexOf(fuel) < 0) return false;
      if (dr && str(v.drivetrain).toLowerCase().replace(/[^a-z0-9]/g, "").indexOf(dr.replace(/[^a-z0-9]/g, "")) < 0) return false;
      if (max !== null && (pr === null || pr > max)) return false;
      if (feature === "luxury" && !/luxury|premium/i.test([v.make, v.model, v.trim, (v.features || []).join(" ")].join(" "))) return false;
      return true;
    });
  }
  function sortVehicles(list, sort) {
    var c = list.slice(), n = function (x, d) { var r = num(x); return r === null ? d : r; };
    if (sort === "price-asc") c.sort(function (a, b) { return n(a.price, Infinity) - n(b.price, Infinity); });
    else if (sort === "price-desc") c.sort(function (a, b) { return n(b.price, -Infinity) - n(a.price, -Infinity); });
    else if (sort === "year-desc") c.sort(function (a, b) { return (num(b.year) || 0) - (num(a.year) || 0); });
    else if (sort === "mileage-asc") c.sort(function (a, b) { return (num(a.mileage) || 0) - (num(b.mileage) || 0); });
    else c.sort(function (a, b) { return Number(!!b.featured) - Number(!!a.featured) || (num(b.year) || 0) - (num(a.year) || 0); });
    return c;
  }
  function loadData() {
    return fetch("inventory.json", { cache: "no-store", credentials: "same-origin" }).then(function (r) { if (!r.ok) throw new Error("Inventory unavailable"); return r.json(); }).then(function (d) {
      return { vehicles: Array.isArray(d.vehicles) ? d.vehicles.filter(function (v) { return v && typeof v === "object" && str(v.status).toLowerCase() !== "draft"; }) : [], posts: Array.isArray(d.posts) ? d.posts : [] };
    });
  }

  /* ---------- vehicle card (same design as the home page) ---------- */
  function card(v, i) {
    var imgs = Array.isArray(v.images) ? v.images : [], img = imgOf(imgs[0]), sold = str(v.status).toLowerCase() === "sold", mi = num(v.mileage !== undefined ? v.mileage : v.miles), tags = [];
    if (mi !== null) tags.push(Math.round(mi).toLocaleString("en-US") + " mi");
    [v.trans || v.transmission, drive(v.drivetrain), v.fuel].forEach(function (t) { if (str(t) && tags.indexOf(t) < 0) tags.push(t); });
    var badge = sold ? '<span class="sr-badge">Sold</span>' : (v.featured ? '<span class="sr-badge">Featured</span>' : "");
    return '<a class="sr-fc" href="vehicle.html?id=' + encodeURIComponent(str(v.id)) + '" style="--ad:' + (Math.min(i, 8) * .06).toFixed(2) + 's"><div class="sr-fc-in"><div class="sr-ph">' + badge + (v.year ? '<span class="sr-yr">' + esc(v.year) + "</span>" : "") +
      '<img src="' + esc(imageUrl(img)) + '" alt="' + esc(titleV(v)) + '" loading="lazy" decoding="async" draggable="false" onerror="this.onerror=null;this.src=\'' + PLACEHOLDER + '\'"></div>' +
      '<div class="sr-fb"><small>' + esc([v.make, kindOf(v)].filter(Boolean).join(" · ")) + "</small><h3>" + esc(titleV(v)) + '</h3><div class="sr-specs">' + tags.slice(0, 3).map(function (t) { return "<span>" + esc(t) + "</span>"; }).join("") + "</div>" +
      '<div class="sr-ff"><div><small>Price</small><b>' + esc(money(v.price)) + '</b></div><span class="sr-go">' + ARROW + "</span></div></div></div></a>";
  }
  function tilt(scope) {
    if (!HOVER || RM) return;
    $$(".sr-fc", scope).forEach(function (el) {
      var inner = el.firstChild;
      el.addEventListener("pointermove", function (e) { var r = el.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height; inner.style.setProperty("--ry", ((x - .5) * 8).toFixed(2) + "deg"); inner.style.setProperty("--rx", ((.5 - y) * 6).toFixed(2) + "deg"); inner.style.setProperty("--mx", (x * 100) + "%"); inner.style.setProperty("--my", (y * 100) + "%"); });
      el.addEventListener("pointerleave", function () { inner.style.setProperty("--rx", "0deg"); inner.style.setProperty("--ry", "0deg"); });
    });
  }
  function empty(title, text, href, label) { return '<div class="pg-empty"><h3>' + esc(title) + "</h3><p>" + esc(text) + "</p>" + (href ? '<a class="sr-btn sr-btn-ink" href="' + href + '"><span class="sr-btn-txt">' + esc(label) + "</span>" + BTN_ICO + "</a>" : "") + "</div>"; }

  /* ---------- headline split + entrance ---------- */
  function splitHeading(h) {
    var n = 0;
    /* keep punctuation that follows an italic word attached to it (no orphan "." on its own line) */
    Array.prototype.slice.call(h.querySelectorAll("em")).forEach(function (em) { var t = em.nextSibling; if (t && t.nodeType === 3) { var m = /^[.,!?;:\u2019\u201d]+/.exec(t.nodeValue); if (m) { em.appendChild(document.createTextNode(m[0])); t.nodeValue = t.nodeValue.slice(m[0].length); } } });
    (function walk(node) {
      Array.prototype.slice.call(node.childNodes).forEach(function (c) {
        if (c.nodeType === 3) {
          var parts = (c.nodeValue || "").split(/(\s+)/), frag = document.createDocumentFragment();
          parts.forEach(function (p) { if (!p) return; if (/^\s+$/.test(p)) { frag.appendChild(document.createTextNode(" ")); return; } var w = document.createElement("span"), i = document.createElement("span"); w.className = "sr-w"; i.textContent = p; i.style.setProperty("--i", n++); w.appendChild(i); frag.appendChild(w); });
          node.replaceChild(frag, c);
        } else if (c.nodeType === 1 && c.tagName !== "BR") walk(c);
      });
    })(h);
  }
  $$(".pg-title,.sr-split").forEach(splitHeading);

  /* ---------- reveal on scroll ---------- */
  var io = "IntersectionObserver" in window && !RM ? new IntersectionObserver(function (es) {
    es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); } });
  }, { threshold: .12, rootMargin: "0px 0px -6% 0px" }) : null;
  function watch(scope) { $$(".sr-reveal,.sr-split,.sr-footer-word", scope).forEach(function (el) { if (io) io.observe(el); else el.classList.add("is-in"); }); }
  watch(document);

  /* ---------- navigation ---------- */
  var toggle = $("#menuToggle"), mnav = $("#mobileNav");
  function closeMenu() { if (!toggle || !mnav) return; toggle.setAttribute("aria-expanded", "false"); toggle.setAttribute("aria-label", "Open navigation"); mnav.setAttribute("aria-hidden", "true"); mnav.classList.remove("is-open"); document.body.classList.remove("menu-open"); }
  if (toggle && mnav) {
    toggle.addEventListener("click", function () { var open = toggle.getAttribute("aria-expanded") !== "true"; toggle.setAttribute("aria-expanded", String(open)); toggle.setAttribute("aria-label", open ? "Close navigation" : "Open navigation"); mnav.setAttribute("aria-hidden", String(!open)); mnav.classList.toggle("is-open", open); document.body.classList.toggle("menu-open", open); });
    $$("a", mnav).forEach(function (a) { a.addEventListener("click", closeMenu); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeMenu(); });
    addEventListener("resize", function () { if (innerWidth > 980) closeMenu(); });
  }
  var page = document.body.getAttribute("data-page") || "";
  var navMap = { inventory: "inventory.html", cars: "used-cars.html", sedans: "used-cars.html", trucks: "used-cars.html", suvs: "used-cars.html", wagons: "used-cars.html", vehicle: "inventory.html", about: "about-us.html", contact: "contact-us.html", blog: "blog.html", "blog-post": "blog.html", pages: "pages.html" };
  $$(".sr-topnav > a, .sr-topnav > .sr-nav-group > a").forEach(function (a) { if (a.getAttribute("href") === navMap[page]) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });

  /* ---------- scroll engine ---------- */
  var bar = $("#hxTopbar"), prog = $("#hxProgress"), ride = $(".sr-call-ride"), toTop = $("#toTop"), vbar = null, lastY = scrollY, acc = 0, ticking = false;
  function onScroll() {
    var y = scrollY, max = document.documentElement.scrollHeight - innerHeight, dy = y - lastY; lastY = y;
    if (prog) prog.style.transform = "scaleX(" + (max > 0 ? y / max : 0) + ")";
    if (bar) {
      bar.classList.toggle("on", y > 30);
      acc = (dy > 0) === (acc > 0) ? acc + dy : dy;
      if (y < 300 || acc < -40) bar.classList.remove("hide"); else if (acc > 60 && !document.body.classList.contains("menu-open")) bar.classList.add("hide");
      document.body.classList.toggle("bar-hidden", bar.classList.contains("hide"));
    }
    if (ride) ride.classList.toggle("show", y > 260);
    if (toTop) toTop.classList.toggle("is-visible", y > 900);
    vbar = vbar || $(".vd-bar"); if (vbar) vbar.classList.toggle("show", y > 420);
    ticking = false;
  }
  addEventListener("scroll", function () { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true });
  if (HOVER && !RM) document.addEventListener("pointermove", function (e) {
    var b = e.target.closest && e.target.closest(".sr-magnet"); if (!b) return;
    var r = b.getBoundingClientRect(); b.style.transform = "translate(" + ((e.clientX - r.left - r.width / 2) * .18).toFixed(1) + "px," + ((e.clientY - r.top - r.height / 2) * .28).toFixed(1) + "px)";
    if (!b.__mg) { b.__mg = 1; b.addEventListener("pointerleave", function () { b.style.transform = ""; }); }
  });

  /* footer wordmark fits its width */
  function fitWord() { var box = $(".sr-footer-word"), s = box && box.firstElementChild; if (!s) return; s.style.setProperty("--fw", "100px"); var w = s.scrollWidth || 1; s.style.setProperty("--fw", Math.min(260, Math.max(14, 100 * box.clientWidth / w * .98)).toFixed(1) + "px"); }
  fitWord(); addEventListener("resize", fitWord); if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitWord);

  /* hero decorative word = page eyebrow */
  (function () { var w = $(".pg-hero-word"), eb = $(".pg-hero .sr-hero-eyebrow"); if (w && eb && !w.textContent.trim()) w.textContent = (eb.textContent || "").trim().split(/\s+/).pop(); })();
  requestAnimationFrame(function () { requestAnimationFrame(function () { document.body.classList.add("sr-ready"); }); });

  /* ---------- catalog (inventory + category pages) ---------- */
  function renderCatalog(data) {
    var root = $('[data-apx-kind="catalog"]'); if (!root) return;
    var category = root.getAttribute("data-category") || "all", params = new URLSearchParams(location.search);
    var search = $("#apxQuery"), type = $("#apxType"), make = $("#apxMake"), sort = $("#apxSort"), grid = $("#apxVehicleGrid"), count = $("#apxCount"), status = $("#apxResultsStatus"), pager = $("#apxPagination"), form = $("#apxFilterForm");
    var PAGE = 15, cur = Math.max(1, parseInt(params.get("page") || "1", 10) || 1);
    var inCat = data.vehicles.filter(function (v) { return matchesCategory(v, category); });
    Array.from(new Set(inCat.map(function (v) { return str(v.make); }).filter(Boolean))).sort().forEach(function (m) { var o = document.createElement("option"); o.value = m; o.textContent = m; make.appendChild(o); });
    if (search) search.value = params.get("q") || ""; if (type) type.value = params.get("type") || ""; if (make) make.value = params.get("make") || ""; if (sort) sort.value = params.get("sort") || "featured";
    /* category chips with live counts */
    $$(".pg-chips a[data-cat]").forEach(function (a) { var c = a.getAttribute("data-cat"), n = data.vehicles.filter(function (v) { return matchesCategory(v, c); }).length; var em = $("em", a); if (em) em.textContent = n; });
    function query(withPage) {
      var q = new URLSearchParams(location.search);
      [["q", search && search.value.trim()], ["type", type && type.value], ["make", make && make.value]].forEach(function (p) { if (p[1]) q.set(p[0], p[1]); else q.delete(p[0]); });
      if (sort && sort.value !== "featured") q.set("sort", sort.value); else q.delete("sort");
      if (withPage && cur > 1) q.set("page", String(cur)); else q.delete("page");
      return q;
    }
    function activeCount() { return [type && type.value, make && make.value, sort && sort.value !== "featured" ? 1 : ""].filter(Boolean).length; }
    function draw(reset) {
      if (reset) cur = 1;
      var all = sortVehicles(filterVehicles(data.vehicles, category, query(false)), sort ? sort.value : "featured");
      var pages = Math.max(1, Math.ceil(all.length / PAGE)); cur = clamp(cur, 1, pages);
      var from = (cur - 1) * PAGE, to = Math.min(from + PAGE, all.length), vis = all.slice(from, to);
      grid.innerHTML = vis.length ? vis.map(card).join("") : empty("No vehicles match these filters yet.", "Try another search or browse the full inventory.", "inventory.html", "View all inventory");
      tilt(grid);
      if (count) count.textContent = String(all.length);
      if (status) status.textContent = "vehicle" + (all.length === 1 ? "" : "s") + " found";
      var badge = $(".pg-filter-toggle b"); if (badge) badge.textContent = activeCount() || "";
      if (pager) {
        if (all.length > PAGE) {
          var b = '<button type="button" class="pg-prev" data-page="' + Math.max(1, cur - 1) + '"' + (cur === 1 ? " disabled" : "") + ' aria-label="Previous page">‹ <span>Prev</span></button>';
          var s = Math.max(1, Math.min(cur - 2, pages - 4)), e = Math.min(pages, s + 4);
          for (var p = s; p <= e; p++) b += '<button type="button" class="' + (p === cur ? "is-current" : "") + '" data-page="' + p + '"' + (p === cur ? ' aria-current="page"' : "") + ">" + p + "</button>";
          if (e < pages) b += '<span class="pg-ell">…</span><button type="button" data-page="' + pages + '">' + pages + "</button>";
          b += '<button type="button" class="pg-next" data-page="' + Math.min(pages, cur + 1) + '"' + (cur === pages ? " disabled" : "") + ' aria-label="Next page"><span>Next</span> ›</button>';
          pager.innerHTML = '<div class="pg-pager-sum">Showing <strong>' + (from + 1) + "–" + to + "</strong> of <strong>" + all.length + '</strong></div><div class="pg-pager-btns">' + b + "</div>";
          pager.hidden = false;
        } else { pager.innerHTML = ""; pager.hidden = true; }
      }
      var q = query(true); history.replaceState(null, "", location.pathname + (q.toString() ? "?" + q.toString() : ""));
    }
    if (form) form.addEventListener("submit", function (e) { e.preventDefault(); draw(true); if (document.activeElement) document.activeElement.blur(); });
    var reset = $("#apxResetFilters"); if (reset) reset.addEventListener("click", function () { if (search) search.value = ""; if (type) type.value = ""; if (make) make.value = ""; if (sort) sort.value = "featured"; draw(true); });
    var ft = $(".pg-filter-toggle"); if (ft) ft.addEventListener("click", function () { var open = form.classList.toggle("is-open"); ft.setAttribute("aria-expanded", String(open)); });
    var timer; if (search) search.addEventListener("input", function () { clearTimeout(timer); timer = setTimeout(function () { draw(true); }, 160); });
    [type, make, sort].forEach(function (el) { if (el) el.addEventListener("change", function () { draw(true); }); });
    if (pager) pager.addEventListener("click", function (e) {
      var btn = e.target.closest("button[data-page]"); if (!btn || btn.disabled) return;
      cur = parseInt(btn.getAttribute("data-page"), 10) || 1; draw(false);
      window.scrollTo({ top: Math.max(0, grid.getBoundingClientRect().top + pageYOffset - 170), behavior: RM ? "auto" : "smooth" });
    });
    draw(false);
  }

  /* ---------- vehicle detail ---------- */
  function renderVehicle(data) {
    var root = $('[data-apx-kind="vehicle"]'); if (!root) return;
    var id = new URLSearchParams(location.search).get("id") || "", box = $("#apxVehicleContent");
    var v = data.vehicles.find(function (x) { return str(x.id) === id || str(x.slug) === id; });
    if (!v) { box.innerHTML = empty("Vehicle not found", "This listing may no longer be available.", "inventory.html", "Browse inventory"); return; }
    document.title = titleV(v) + " | " + (SITE.name || "Vehicle inventory");
    var imgs = (Array.isArray(v.images) ? v.images : []).map(imgOf).filter(Boolean); if (!imgs.length) imgs = [""];
    var sold = str(v.status).toLowerCase() === "sold", mi = num(v.mileage);
    var info = [["Year", v.year], ["Make", v.make], ["Model", v.model], ["Trim", v.trim], ["Mileage", mi !== null ? mi.toLocaleString("en-US") + " mi" : v.miles ? String(v.miles) : ""], ["Body style", v.body || v.bodyStyle || v.type], ["Drivetrain", v.drivetrain], ["Transmission", v.trans || v.transmission], ["Fuel", v.fuel], ["Engine", v.engine], ["Exterior", v.exterior || v.color], ["Interior", v.interior], ["Doors", v.doors], ["Seats", v.seats], ["MPG", v.mpg]];
    var specs = info.filter(function (x) { return str(x[1]) !== ""; }).map(function (x) { return '<div class="vd-spec"><span>' + esc(x[0]) + "</span><b>" + esc(x[1]) + "</b></div>"; }).join("");
    var desc = str(v.description) ? str(v.description).split(/\n\s*\n/).map(function (x) { return "<p>" + esc(x) + "</p>"; }).join("") : "<p>Contact the team for more details about this vehicle, its history, and current availability.</p>";
    var tel = str(SITE.tel_link) || (SITE.phone ? "tel:" + String(SITE.phone).replace(/[^0-9+]/g, "") : "");
    var t = titleV(v), pad = function (n) { return String(n).padStart(2, "0"); };
    box.innerHTML =
      '<nav class="pg-crumbs vd-crumbs" aria-label="Breadcrumb"><a href="index.html">Home</a><i></i><a href="inventory.html">Inventory</a><i></i><span>' + esc(t) + "</span></nav>" +
      '<div class="vd-grid"><div class="vd-gallery">' +
        '<div class="vd-main" id="vdMain"><span class="vd-tag' + (sold ? " is-sold" : "") + '"><i></i>' + (sold ? "Sold" : "Available now") + "</span>" +
          '<img id="apxMainVehicleImage" src="' + esc(imageUrl(imgs[0])) + '" alt="' + esc(t) + '" onerror="this.onerror=null;this.src=\'' + PLACEHOLDER + '\'">' +
          (imgs.length > 1 ? '<button class="vd-nav vd-prev" type="button" aria-label="Previous photo"><svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg></button><button class="vd-nav vd-next" type="button" aria-label="Next photo"><svg viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg></button>' : "") +
          '<span class="vd-counter" id="apxPhotoCounter">01 / ' + pad(imgs.length) + "</span></div>" +
        (imgs.length > 1 ? '<div class="vd-thumbs" aria-label="Vehicle photos">' + imgs.map(function (im, i) { return '<button class="vd-thumb" type="button" data-gallery-index="' + i + '" aria-pressed="' + (i === 0) + '" aria-label="View photo ' + (i + 1) + '"><img src="' + esc(imageUrl(im)) + '" alt="" loading="lazy" onerror="this.onerror=null;this.src=\'' + PLACEHOLDER + '\'"></button>'; }).join("") + "</div>" : "") +
      "</div>" +
      '<div class="vd-info"><p class="vd-state">' + (sold ? "Sold listing" : "Current listing") + '</p><h1 class="vd-title">' + esc(t) + "</h1>" +
        '<p class="vd-ids">' + esc([v.stock ? "STOCK " + v.stock : "", v.vin ? "VIN " + v.vin : ""].filter(Boolean).join(" · ")) + "</p>" +
        '<div class="vd-price"><div><small>Listed price</small><b>' + esc(money(v.price)) + '</b></div><span class="vd-pill' + (sold ? " is-sold" : "") + '"><i></i>' + (sold ? "Sold" : "Available") + "</span></div>" +
        '<div class="vd-specs">' + specs + "</div>" +
        '<div class="vd-actions">' + (tel ? '<a class="sr-btn sr-btn-red sr-magnet" href="' + esc(tel) + '"><span class="sr-btn-txt">Call ' + esc(SITE.phone || "the dealership") + "</span>" + BTN_ICO + "</a>" : "") + '<a class="sr-btn sr-btn-glass" href="#apxVehicleInquiry"><span class="sr-btn-txt">Ask about this vehicle</span></a></div></div>' +
        '<section class="vd-panel vd-desc sr-reveal"><p class="pg-kicker">The details</p><h2>Vehicle description</h2><div class="vd-copy">' + desc + "</div></section>" +
        '<form class="pg-card pg-form-wrap vd-form sr-reveal" id="apxVehicleInquiry" data-apx-lead-form data-vehicle-id="' + esc(v.id) + '"><p class="pg-kicker">Next step</p><h2>Interested in this <em>vehicle?</em></h2><p class="pg-muted">Send a message to ' + esc(SITE.name || "the dealership") + ' and ask about availability or arrange a visit.</p>' +
          '<div class="pg-form"><div><label for="apxName">Your name *</label><input class="pg-input" id="apxName" name="name" autocomplete="name" required maxlength="120"></div><div><label for="apxPhone">Phone</label><input class="pg-input" id="apxPhone" name="phone" autocomplete="tel" maxlength="40"></div>' +
          '<div class="full"><label for="apxEmail">Email</label><input class="pg-input" id="apxEmail" name="email" type="email" autocomplete="email" maxlength="160"></div>' +
          '<div class="full"><label for="apxMessage">Message *</label><textarea class="pg-input" id="apxMessage" name="message" required maxlength="4000">I am interested in the ' + esc(t) + ". Please contact me with more information.</textarea></div>" +
          '<div class="pg-honey" aria-hidden="true"><label>Leave this field empty<input name="_honey" tabindex="-1" autocomplete="off"></label></div>' +
          '<div class="pg-form-foot"><button class="sr-btn sr-btn-ink" type="submit"><span class="sr-btn-txt">Send inquiry</span>' + BTN_ICO + '</button><p class="pg-status" aria-live="polite"></p></div></div></form>' +
      "</div>" +
      '<div class="vd-bar" aria-label="Quick actions"><div class="vd-bar-price"><small>' + esc([v.year, v.make, v.model].filter(Boolean).join(" ")) + "</small><b>" + esc(money(v.price)) + "</b></div>" + (tel ? '<a class="vd-bar-call" href="' + esc(tel) + '" aria-label="Call the dealership"><svg viewBox="0 0 24 24"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/></svg></a>' : "") + '<a class="vd-bar-ask" href="#apxVehicleInquiry">Ask now</a></div>';
    /* gallery: thumbs, arrows, swipe, keys */
    var main = $("#apxMainVehicleImage"), counter = $("#apxPhotoCounter"), idx = 0;
    function show(i) {
      if (imgs.length < 2) return; idx = (i + imgs.length) % imgs.length; main.classList.add("is-changing");
      setTimeout(function () { main.onload = function () { main.classList.remove("is-changing"); }; main.src = imageUrl(imgs[idx]); if (main.complete) main.classList.remove("is-changing"); }, 120);
      counter.textContent = pad(idx + 1) + " / " + pad(imgs.length);
      $$(".vd-thumb", box).forEach(function (b, k) { b.setAttribute("aria-pressed", String(k === idx)); if (k === idx && b.scrollIntoView) b.parentNode.scrollTo({ left: b.offsetLeft - b.parentNode.clientWidth / 2 + b.offsetWidth / 2, behavior: RM ? "auto" : "smooth" }); });
    }
    $$(".vd-thumb", box).forEach(function (b) { b.addEventListener("click", function () { show(Number(b.getAttribute("data-gallery-index"))); }); });
    var pv = $(".vd-prev", box), nx = $(".vd-next", box); if (pv) pv.addEventListener("click", function () { show(idx - 1); }); if (nx) nx.addEventListener("click", function () { show(idx + 1); });
    var frame = $("#vdMain"), sx = null;
    frame.addEventListener("touchstart", function (e) { sx = e.touches[0].clientX; }, { passive: true });
    frame.addEventListener("touchend", function (e) { if (sx === null) return; var dx = e.changedTouches[0].clientX - sx; if (Math.abs(dx) > 40) show(idx + (dx < 0 ? 1 : -1)); sx = null; });
    document.addEventListener("keydown", function (e) { if (e.target.closest && e.target.closest("input,textarea,select")) return; if (e.key === "ArrowLeft") show(idx - 1); if (e.key === "ArrowRight") show(idx + 1); });
    watch(box);
  }

  /* ---------- blog list + article ---------- */
  function renderBlog(data) {
    var grid = $("#apxBlogGrid"); if (!$('[data-apx-kind="blog"]') || !grid) return;
    var posts = data.posts.filter(function (p) { return p && str(p.title) && p.status !== "draft"; });
    if (!posts.length) { grid.innerHTML = empty("Articles will appear here", "When articles are published in the admin panel, they will show here automatically.", "inventory.html", "Browse inventory"); return; }
    grid.innerHTML = posts.slice().sort(function (a, b) { return str(b.date).localeCompare(str(a.date)); }).map(function (p, i) {
      return '<a class="pg-post" style="--ad:' + (Math.min(i, 8) * .07).toFixed(2) + 's" href="blog-post.html?id=' + encodeURIComponent(str(p.id)) + '"><div class="pg-post-img"><img src="' + esc(imageUrl(p.image)) + '" alt="' + esc(p.title) + '" loading="lazy" onerror="this.onerror=null;this.src=\'' + PLACEHOLDER + '\'"></div><div class="pg-post-body"><span class="pg-post-meta">' + esc(p.tag || "Guide") + (p.date ? " · " + esc(p.date) : "") + "</span><h2>" + esc(p.title) + "</h2><p>" + esc(p.excerpt || "Read the latest article from " + (SITE.name || "the dealership") + ".") + '</p><span class="pg-more">Read article ↗</span></div></a>';
    }).join("");
  }
  function renderPost(data) {
    var box = $("#apxBlogPostContent"); if (!$('[data-apx-kind="blog-post"]') || !box) return;
    var id = new URLSearchParams(location.search).get("id") || "", p = data.posts.find(function (x) { return str(x.id) === id; });
    if (!p) { box.innerHTML = empty("Article not found", "This article may have been removed or unpublished.", "blog.html", "Back to blog"); var ht = $("#apxDynamicHeroTitle"); if (ht) ht.textContent = "Article not found"; return; }
    document.title = (p.metaTitle || p.title) + " | " + (SITE.name || "");
    var h = $("#apxDynamicHeroTitle"), tx = $("#apxDynamicHeroText"), eb = $("#apxDynamicHeroEyebrow"), lab = $("#apxDynamicCrumb");
    if (h) h.textContent = p.title; if (tx) tx.textContent = str(p.excerpt) || "Read this published article from the dealership."; if (eb) eb.textContent = str(p.tag || "From the dealership").toUpperCase() + (p.date ? " · " + p.date : ""); if (lab) lab.textContent = p.title;
    var body = str(p.content).split(/\n\s*\n/).filter(Boolean).map(function (x) { return "<p>" + esc(x) + "</p>"; }).join("");
    box.innerHTML = '<article class="pg-article">' + (p.image ? '<div class="pg-article-img"><img src="' + esc(imageUrl(p.image)) + '" alt="' + esc(p.title) + '" onerror="this.onerror=null;this.src=\'' + PLACEHOLDER + '\'"></div>' : "") + '<div class="pg-article-body">' + body + '</div><div class="pg-card pg-card-dark pg-article-cta"><p class="pg-kicker">Continue your search</p><h2>Find a vehicle that fits your next journey.</h2><p class="pg-muted">Browse the live inventory or contact the dealership with a question.</p><div class="pg-actions"><a class="sr-btn sr-btn-red" href="inventory.html"><span class="sr-btn-txt">Browse inventory</span>' + BTN_ICO + '</a><a class="sr-btn sr-btn-glass" href="contact-us.html"><span class="sr-btn-txt">Contact us</span></a></div></div></article>';
  }

  /* ---------- lead forms (unchanged endpoint) ---------- */
  document.addEventListener("submit", function (e) {
    var form = e.target.closest && e.target.closest("[data-apx-lead-form]"); if (!form) return;
    e.preventDefault();
    var d = new FormData(form); if (str(d.get("_honey"))) return;
    var name = str(d.get("name")), email = str(d.get("email")), phone = str(d.get("phone")), message = str(d.get("message")), st = $(".pg-status", form), btn = $('button[type="submit"]', form);
    if (!name || (!email && !phone) || !message) { if (st) st.textContent = "Please enter your name, a phone number or email, and a message."; return; }
    if (btn) { btn.disabled = true; btn.style.opacity = ".6"; } if (st) st.textContent = "Sending your message…";
    var vt = $(".vd-title");
    fetch("api/lead.php", { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name, email: email, phone: phone, topic: form.getAttribute("data-vehicle-id") ? "Vehicle inquiry: " + ((vt && vt.textContent) || "vehicle") : (str(d.get("topic")) || "Website inquiry"), message: message, page: location.href, vehicleId: form.getAttribute("data-vehicle-id") || "", _honey: "" }) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok && !!j.ok }; }); })
      .then(function (res) { if (res.ok) { form.reset(); if (st) st.textContent = "Thank you. Your inquiry has been sent to the dealership."; } else if (st) st.textContent = "Your message could not be submitted. Please try again or call the dealership."; })
      .catch(function () { if (st) st.textContent = "Connection issue. Please try again or call the dealership."; })
      .then(function () { if (btn) { btn.disabled = false; btn.style.opacity = ""; } });
  });

  /* ---------- boot ---------- */
  var kind = document.body.getAttribute("data-apx-kind") || "", heroCount = $("#apxHeroCount");
  if (kind || heroCount) loadData().then(function (data) {
    if (heroCount) heroCount.textContent = String(data.vehicles.length);
    if (kind === "catalog") renderCatalog(data); else if (kind === "vehicle") renderVehicle(data); else if (kind === "blog") renderBlog(data); else if (kind === "blog-post") renderPost(data);
    onScroll();
  }).catch(function () {
    var place = $("#apxVehicleGrid") || $("#apxVehicleContent") || $("#apxBlogGrid") || $("#apxBlogPostContent");
    if (place) place.innerHTML = empty("Content could not be loaded", "Please refresh the page. If the problem continues, contact the dealership.");
    if (heroCount) heroCount.textContent = "—";
  });
  onScroll();
})();
