/* ============================================================
   CLASSIC THEME - main site script (data, pages, router)
   Dealer details come from
   window.SITE (Website Settings) and texts from window.SITE_T
   (Website Editor) - nothing dealer-specific is hard-coded here.
============================================================ */
(function () {
  "use strict";
  var S = window.SITE || {};
  function T(k, rep) {
    var s = String((window.SITE_T || {})[k] || "");
    if (rep) Object.keys(rep).forEach(function (x) {s = s.split("{" + x + "}").join(rep[x]);});
    return s;
  }
  window.paT = T;

  /* old dashboard link (#/admin) -> new admin panel */
  if ((location.hash || "").indexOf("#/admin") === 0) {location.replace("admin/"); return;}

  var DB = {vehicles: [], posts: [], leadForm: null, loaded: false};
  function dbLoad() {
    return fetch("inventory.json", {cache: "no-store"}).then(function (r) {return r.ok ? r.json() : null;}).catch(function () {return null;}).then(function (d) {
      if (d) {
        DB.vehicles = Array.isArray(d.vehicles) ? d.vehicles.filter(function (v) {return v && typeof v === "object";}) : [];
        DB.posts = Array.isArray(d.posts) ? d.posts : [];
        DB.leadForm = d.leadForm || null;
      }
      DB.loaded = true;
    });
  }

  /* helpers */
  function $(s, c) {return (c || document).querySelector(s);}
  function $$(s, c) {return Array.prototype.slice.call((c || document).querySelectorAll(s));}
  function money(n) {return "$" + Math.round(Number(n) || 0).toLocaleString("en-US");}
  function miles(n) {return Number(n || 0).toLocaleString("en-US") + " mi";}
  function vName(v) {return v.title || (v.year + " " + v.make + " " + v.model + " " + (v.trim || "")).trim();}
  function esc(s) {return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");}
  function getVehicle(id) {for (var i = 0; i < DB.vehicles.length; i++) {if (String(DB.vehicles[i].id) === String(id)) return DB.vehicles[i];} return null;}
  function publishedV() {return DB.vehicles.filter(function (v) {return v.status !== "draft";});}
  function telA(inner) {return S.tel ? '<a href="' + esc(S.tel_link) + '" style="color:var(--blue);font-weight:600">' + (inner || esc(S.phone)) + '</a>' : "";}
  var IC = {
    speed: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 17.5a8.5 8.5 0 1 1 15 0"/><path d="M12 13.5 15.5 10"/><circle cx="12" cy="13.8" r="1.6"/></svg>',
    dt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="5" cy="6" r="2"/><circle cx="19" cy="6" r="2"/><circle cx="5" cy="18" r="2"/><circle cx="19" cy="18" r="2"/><path d="M5 8v8M19 8v8M7 12h10"/></svg>',
    drop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/></svg>',
    eng: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="9" width="14" height="8" rx="2"/><path d="M18 11h3v4h-3M8 9V7h6v2M4 13H2"/></svg>',
    fuel: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 21V6a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v15M3 21h12M14 10h2a2 2 0 0 1 2 2v5a1.5 1.5 0 0 0 3 0V9l-3-3"/><path d="M6.5 8h5"/></svg>',
    gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v3M12 18.2v3M2.8 12h3M18.2 12h3M5.5 5.5l2.1 2.1M16.4 16.4l2.1 2.1M18.5 5.5l-2.1 2.1M7.6 16.4l-2.1 2.1"/></svg>',
    cam: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="18" height="13" rx="2"/><circle cx="12" cy="13.3" r="3.4"/><path d="M9 7l1.4-2.2h3.2L15 7"/></svg>',
    share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 14V4M8.5 6.5 12 3l3.5 3.5"/><path d="M6 11v8a1.5 1.5 0 0 0 1.5 1.5h9A1.5 1.5 0 0 0 18 19v-8"/></svg>',
    heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 20.3S4 15 4 9.6A4.4 4.4 0 0 1 12 7a4.4 4.4 0 0 1 8 2.6C20 15 12 20.3 12 20.3z"/></svg>',
    pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-6.5-5.2-6.5-10a6.5 6.5 0 1 1 13 0C18.5 15.8 12 21 12 21z"/><circle cx="12" cy="10.6" r="2.3"/></svg>',
    chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-8 8H4l2-3a8 8 0 1 1 15-5z"/></svg>',
    check: '<svg class="ok" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m8.5 12.2 2.4 2.4 4.6-5"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1.6 1.6 0 0 1 1.6-1.6H15"/></svg>',
    down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7l7 7 4-4 7 7"/><path d="M21 12v5h-5"/></svg>',
    arrR: '<svg class="arr" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h15M13 5l7 7-7 7"/></svg>',
    arrL: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12H5M11 5l-7 7 7 7"/></svg>',
    chevL: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m14 6-6 6 6 6"/></svg>',
    chevR: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m10 6 6 6-6 6"/></svg>',
    searchBig: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/></svg>'
  };
  window.IC = IC;
  var state = {v: null, gal: {imgs: [], i: 0}};
  window.state = state;
  var toastEl, toastTimer;
  function toast(msg) {if (!toastEl) toastEl = $("#toast"); if (!toastEl) return; toastEl.textContent = msg; toastEl.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(function () {toastEl.classList.remove("show");}, 4200);}
  window.toast = toast;
  function copyText(t, okMsg) {
    function ok() {toast(okMsg);}
    function fb() {var ta = document.createElement("textarea"); ta.value = t; ta.style.position = "fixed"; ta.style.opacity = "0"; document.body.appendChild(ta); ta.select(); try {document.execCommand("copy"); ok();} catch (e) {toast("Copy failed");} document.body.removeChild(ta);}
    if (navigator.clipboard && window.isSecureContext) {navigator.clipboard.writeText(t).then(ok, fb);} else {fb();}
  }
  var revealIO = ("IntersectionObserver" in window) ? new IntersectionObserver(function (es) {es.forEach(function (e) {if (e.isIntersecting) {e.target.classList.add("in"); revealIO.unobserve(e.target);} });}, {threshold: .08}) : null;
  function observeReveals() {
    $$(".reveal:not(.in)").forEach(function (el) {if (revealIO) revealIO.observe(el); else el.classList.add("in");});
    setTimeout(function () {$$(".reveal:not(.in)").forEach(function (el) {var r = el.getBoundingClientRect(); if (r.top < window.innerHeight && r.bottom > 0) el.classList.add("in");});}, 900);
  }

  /* nav */
  var head = $("#siteHead"), toTop = $("#toTop"), burger = $("#burger"), mmenu = $("#mobileMenu");
  function closeMenu() {if (!mmenu || !burger) return; mmenu.classList.remove("open"); burger.classList.remove("open"); burger.setAttribute("aria-expanded", "false");}
  if (burger) burger.addEventListener("click", function () {var o = mmenu.classList.toggle("open"); burger.classList.toggle("open", o); burger.setAttribute("aria-expanded", o);});
  if (mmenu) mmenu.addEventListener("click", function (e) {if (e.target.closest && e.target.closest("a")) closeMenu();});
  var ticking = false;
  function onScroll() {var y = window.scrollY; if (head) head.classList.toggle("scrolled", y > 60); if (toTop) toTop.classList.toggle("show", y > 500); ticking = false;}
  window.addEventListener("scroll", function () {if (!ticking) {requestAnimationFrame(onScroll); ticking = true;} }, {passive: true});
  if (toTop) toTop.addEventListener("click", function () {window.scrollTo({top: 0, behavior: "smooth"});});
  function setNavActive(key) {$$(".nav-links a").forEach(function (a) {a.classList.toggle("active", a.getAttribute("data-nav") === key);});}
  var HOME_T = document.title;
  var mdesc = $('meta[name="description"]');
  var HOME_D = mdesc ? mdesc.getAttribute("content") : "";
  function setSEO(t, d) {document.title = t; var m = $('meta[name="description"]'); if (m) m.setAttribute("content", d);}
  window.paSetSEO = setSEO;
  function setSchema(obj) {
    var el = document.getElementById("dynSchema");
    if (!obj) {if (el) el.remove(); return;}
    if (!el) {el = document.createElement("script"); el.type = "application/ld+json"; el.id = "dynSchema"; document.head.appendChild(el);}
    el.textContent = JSON.stringify(obj);
  }

  /* cards */
  function vehicleCard(v, delay) {
    var id = String(v.id), t2 = v.trans || v.fuel || v.drivetrain || "";
    return '<article class="pl-card reveal"' + (delay ? ' style="transition-delay:' + delay + 's"' : '') + '>'
      + (v.status === "draft" ? '<span class="v-draft">DRAFT</span>' : "")
      + '<button type="button" class="pl-heart' + (isSaved(id) ? " saved" : "") + '" data-action="save" data-id="' + esc(id) + '" aria-label="Save ' + esc(vName(v)) + '">' + IC.heart + '</button>'
      + '<a href="#/vehicle/' + encodeURIComponent(id) + '" data-vehicle="' + esc(id) + '"><div class="pl-pimg"><img src="' + esc((v.images && v.images[0]) || "") + '" alt="' + esc(vName(v) + " " + T("v_alt")) + '" loading="lazy" onerror="imgFallback(this)"></div>'
      + '<div class="pl-cb"><small>' + esc(v.body || v.type || "") + '</small><h3>' + esc(vName(v)) + '</h3>'
      + '<div class="pl-tags"><span>' + Number(v.mileage || 0).toLocaleString("en-US") + ' mi</span>' + (t2 ? '<span>' + esc(t2) + '</span>' : '') + '</div>'
      + '<div class="pl-pr"><b>' + money(v.price) + '</b><span>View details →</span></div></div></a></article>';
  }

  /* home */
  function buildHome() {
    if (window.PL_HOME) window.PL_HOME.render();
    var pub = publishedV();
    var makes = {}; pub.forEach(function (v) {if (v.make) makes[v.make] = 1;});
    function opts(o) {return Object.keys(o).sort().map(function (m) {return '<option value="' + esc(m) + '">' + esc(m) + '</option>';}).join("");}
    var fm = $("#fMake"); if (fm) {var cur = fm.value; fm.innerHTML = '<option value="">Any Make</option>' + opts(makes); fm.value = cur;}
  }

  /* inventory */
  var EXTRA = {};
  function driveCode(d) {d = String(d || "").toLowerCase(); return /four|4/.test(d) ? "4x4" : /all/.test(d) ? "awd" : /front/.test(d) ? "fwd" : /rear/.test(d) ? "rwd" : d;}
  function suvSize(v) {
    if (Number(v.seats) >= 7) return "3row";
    var m = (v.make + " " + v.model).toLowerCase();
    if (/cr-v|crv|rav4|rogue|escape|tucson|sportage|forester|cx-5|cx5|equinox|compass|renegade|hr-v|hrv|kona|trax|bronco sport|outlander sport|crosstrek|seltos|soul/.test(m)) return "compact";
    if (/highlander|explorer|traverse|pilot|tahoe|suburban|expedition|telluride|palisade|pathfinder|durango|acadia|atlas|sequoia|armada|yukon|enclave|mdx/.test(m)) return "3row";
    return "mid";
  }
  function extraOn() {return !!(EXTRA.body || EXTRA.min || EXTRA.max || EXTRA.drive || EXTRA.size);}
  function applyQuery(q) {
    /* extra filters that the separate pages (used-sedans.html etc.) link with */
    EXTRA = {body: (q.body || "").toLowerCase(), min: Number(q.min) || 0, max: Number(q.max) || 0, drive: (q.drive || "").toLowerCase(), size: q.size || ""};
    if ($("#fType")) $("#fType").value = q.type || ""; if ($("#fMake")) $("#fMake").value = q.make || ""; if ($("#fYear")) $("#fYear").value = q.year || ""; if ($("#fPrice")) $("#fPrice").value = q.price || ""; if ($("#fSort")) $("#fSort").value = q.sort || "featured"; if ($("#fSearch")) $("#fSearch").value = q.q || "";
  }
  function readFilters() {return {type: $("#fType") ? $("#fType").value : "", make: $("#fMake") ? $("#fMake").value : "", year: $("#fYear") ? $("#fYear").value : "", price: $("#fPrice") ? $("#fPrice").value : "", sort: $("#fSort") ? $("#fSort").value : "featured", q: $("#fSearch") ? $("#fSearch").value.trim().toLowerCase() : ""};}
  function filteredList() {
    var f = readFilters();
    var list = publishedV().filter(function (v) {
      if (f.type && v.type !== f.type) return false;
      if (f.make && v.make !== f.make) return false;
      if (f.year) {if (f.year === "older") {if (v.year > 2018) return false;} else if (String(v.year) !== f.year) return false;}
      if (f.price === "under15" && v.price >= 15000) return false;
      if (f.price === "15to25" && (v.price < 15000 || v.price > 25000)) return false;
      if (f.price === "25to35" && (v.price < 25000 || v.price > 35000)) return false;
      if (f.price === "over35" && v.price <= 35000) return false;
      if (EXTRA.body && String(v.body || "").toLowerCase().indexOf(EXTRA.body) === -1) return false;
      if (EXTRA.min && Number(v.price) < EXTRA.min) return false;
      if (EXTRA.max && Number(v.price) > EXTRA.max) return false;
      if (EXTRA.drive && driveCode(v.drivetrain) !== EXTRA.drive) return false;
      if (EXTRA.size && suvSize(v) !== EXTRA.size) return false;
      if (f.q) {var hay = (vName(v) + " " + (v.stock || "") + " " + (v.vin || "") + " " + v.type).toLowerCase(); if (hay.indexOf(f.q) === -1) return false;}
      return true;
    });
    if (f.sort === "price-asc") list.sort(function (a, b) {return a.price - b.price;});
    if (f.sort === "price-desc") list.sort(function (a, b) {return b.price - a.price;});
    if (f.sort === "mileage-asc") list.sort(function (a, b) {return a.mileage - b.mileage;});
    if (f.sort === "year-desc") list.sort(function (a, b) {return b.year - a.year;});
    return list;
  }
  function renderInventory() {
    var grid = $("#inventoryGrid"); if (!grid) return;
    if (!DB.loaded) {grid.innerHTML = '<div class="inv-empty"><p>Loading vehicles…</p></div>'; return;}
    var list = filteredList(), f = readFilters();
    var cnt = $("#invCount"); if (cnt) cnt.innerHTML = "Showing <b>" + list.length + "</b> of " + publishedV().length + " vehicles" + ((f.type || f.make || f.year || f.price || f.q || extraOn()) ? " (filtered)" : "");
    if (!list.length) {grid.innerHTML = '<div class="inv-empty">' + IC.searchBig + '<h3>' + esc(T("inv_empty_title")) + '</h3><p>' + esc(T("inv_empty_text")) + '</p></div>'; return;}
    grid.innerHTML = list.map(function (v, i) {return vehicleCard(v, (i % 3) * 0.07);}).join("");
    observeReveals();
  }
  function updateInvURL() {
    var f = readFilters(), q = [];
    if (f.type) q.push("type=" + encodeURIComponent(f.type)); if (f.make) q.push("make=" + encodeURIComponent(f.make));
    if (f.year) q.push("year=" + encodeURIComponent(f.year)); if (f.price) q.push("price=" + encodeURIComponent(f.price));
    if (f.sort && f.sort !== "featured") q.push("sort=" + encodeURIComponent(f.sort)); if (f.q) q.push("q=" + encodeURIComponent(f.q));
    ["body", "min", "max", "drive", "size"].forEach(function (k) {if (EXTRA[k]) q.push(k + "=" + encodeURIComponent(EXTRA[k]));});
    try {history.replaceState(null, "", "#/inventory" + (q.length ? "?" + q.join("&") : ""));} catch (e) { }
    renderInventory();
  }
  ["fType", "fMake", "fYear", "fPrice", "fSort"].forEach(function (id) {var el = $("#" + id); if (el) el.addEventListener("change", updateInvURL);});
  var fs = $("#fSearch"); if (fs) fs.addEventListener("input", updateInvURL);
  var icl = $("#invClear"); if (icl) icl.addEventListener("click", function () {applyQuery({}); try {history.replaceState(null, "", "#/inventory");} catch (e) { } renderInventory(); toast("Filters cleared");});

  /* vehicle detail */
  function isSaved(id) {try {return (JSON.parse(localStorage.getItem("savedVehicles") || "[]")).indexOf(id) > -1;} catch (e) {return false;} }
  function toggleSave(id, el) {
    var l; try {l = JSON.parse(localStorage.getItem("savedVehicles") || "[]");} catch (e) {l = [];}
    var i = l.indexOf(id);
    if (i > -1) {l.splice(i, 1); toast("Removed from saved vehicles");} else {l.push(id); toast("Vehicle saved");}
    try {localStorage.setItem("savedVehicles", JSON.stringify(l));} catch (e) { }
    if (el) el.classList.toggle("saved", isSaved(id));
  }
  function specRow(l, val) {return '<div class="spec-row"><span>' + l + '</span><b>' + val + '</b></div>';}
  var LEAD_DEFAULT = {title: "Ask About This Vehicle", button: "Send Request", fields: {name: 1, phone: 1, email: 1, message: 1, bestTime: 0, tradeIn: 0, financing: 0}};
  function leadCfg() {
    var c = DB.leadForm || {};
    var f = {}; Object.keys(LEAD_DEFAULT.fields).forEach(function (k) {f[k] = c.fields && c.fields[k] != null ? c.fields[k] : LEAD_DEFAULT.fields[k];});
    return {title: c.title || LEAD_DEFAULT.title, button: c.button || LEAD_DEFAULT.button, fields: f};
  }
  function leadFormHTML(v) {
    var c = leadCfg(), f = c.fields, h = "";
    function row(name, label, html) {return f[name] ? '<label class="lead-f"><span>' + label + '</span>' + html + '</label>' : "";}
    h += row("name", "Name *", '<input name="name" required placeholder="Your name" autocomplete="name">');
    h += row("phone", "Phone *", '<input name="phone" type="tel" required placeholder="Your phone number" autocomplete="tel">');
    h += row("email", "Email *", '<input name="email" type="email" required placeholder="you@example.com" autocomplete="email">');
    h += row("bestTime", "Best time to call", '<select name="bestTime"><option>Anytime</option><option>Morning</option><option>Afternoon</option><option>Evening</option></select>');
    h += row("tradeIn", "Trade-in?", '<select name="tradeIn"><option>No</option><option>Yes</option></select>');
    h += row("financing", "Need financing?", '<select name="financing"><option>No</option><option>Yes</option><option>Not sure</option></select>');
    h += row("message", "Message", '<textarea name="message" rows="3">I am interested in the ' + esc(vName(v)) + '. Is it still available?</textarea>');
    return '<form id="reqForm" class="lead-form" data-vid="' + esc(v.id) + '"><h3>' + esc(c.title) + '</h3>' + h
      + '<input type="text" name="_honey" tabindex="-1" autocomplete="off" style="display:none">'
      + '<button type="submit" class="btn btn-primary btn-block">' + esc(c.button) + ' ' + IC.arrR + '</button></form>';
  }
  function vehiclePageHTML(v) {
    var g = v.images && v.images.length ? v.images : [""];
    var thumbs = g.map(function (src, i) {return '<button type="button" class="g-thumb' + (i === 0 ? " active" : "") + '" data-action="g-thumb" data-i="' + i + '" aria-label="Photo ' + (i + 1) + '"><img src="' + esc(src) + '" alt="" loading="lazy" onerror="imgFallback(this)"></button>';}).join("");
    var kf = [[IC.speed, "Mileage", miles(v.mileage)], [IC.dt, "Drivetrain", esc(v.drivetrain)], [IC.drop, "Exterior", esc(v.ext)], [IC.eng, "Engine", esc(v.engine)], [IC.fuel, "Fuel Type", esc(v.fuel)], [IC.gear, "Transmission", esc(v.trans)]].map(function (k) {return '<div class="kf"><span class="ic">' + k[0] + '</span><span><b>' + k[1] + '</b><strong>' + k[2] + '</strong></span></div>';}).join("");
    var vinRow = '<div class="spec-row"><span>VIN</span><b class="vin-val">' + esc(v.vin || "—") + '<button type="button" class="copy-btn" data-action="copy-vin" title="Copy VIN">' + IC.copy + '</button></b></div>';
    var hist = ['<div class="hist-item">' + IC.check + '<span><b>Clean Title</b><p>No issues reported.</p></span></div>',
    '<div class="hist-item">' + IC.check + '<span><b>' + (Number(v.accidents) === 0 ? "0 Accidents Reported" : esc(v.accidents) + " Accidents Reported") + '</b><p>' + (Number(v.accidents) === 0 ? "No accidents or damage reported." : "See dealer for details.") + '</p></span></div>',
    '<div class="hist-item">' + IC.check + '<span><b>' + (Number(v.owners) === 1 ? "1 Previous Owner" : esc(v.owners || "1") + " Previous Owners") + '</b><p>' + (Number(v.owners) === 1 ? "Vehicle has had one previous owner." : "See vehicle history for details.") + '</p></span></div>'].join("");
    var similar = publishedV().filter(function (x) {return x.id !== v.id && x.type === v.type;});
    if (similar.length < 3) similar = similar.concat(publishedV().filter(function (x) {return x.id !== v.id && x.type !== v.type;}));
    similar = similar.slice(0, 3);
    var alt = esc(vName(v) + " " + T("v_alt"));
    return '<div class="container">'
      + '<div class="back-row"><button type="button" class="back-inv" data-action="go-inventory">' + IC.arrL + ' ' + esc(T("v_back")) + '</button><span class="crumb">Inventory / ' + esc(v.year + " " + v.make + " " + v.model) + '</span></div>'
      + '<div class="detail-grid"><div class="d-left">'
      + '<div class="g-main"><img id="gMainImg" src="' + esc(g[0]) + '" alt="' + alt + ' — photo 1" onerror="imgFallback(this)">'
      + '<div class="g-actions"><button type="button" class="g-act' + (isSaved(v.id) ? " saved" : "") + '" data-action="save" data-id="' + esc(v.id) + '" aria-label="Save vehicle">' + IC.heart + '</button>'
      + '<button type="button" class="g-act" data-action="share" aria-label="Share vehicle">' + IC.share + '</button></div>'
      + '<button type="button" class="g-btn g-prev" data-action="g-prev" aria-label="Previous photo">' + IC.chevL + '</button>'
      + '<button type="button" class="g-btn g-next" data-action="g-next" aria-label="Next photo">' + IC.chevR + '</button>'
      + '<span class="g-counter">' + IC.cam + '<span id="gCounter">1 / ' + g.length + '</span></span></div>'
      + '<div class="g-thumbs" id="gThumbs">' + thumbs + '</div>'
      + '<div class="kf-grid">' + kf + '</div>'
      + '<section><h2>Overview</h2><div class="spec-grid">' + specRow("Make", esc(v.make)) + specRow("Exterior Color", esc(v.ext)) + specRow("Model", esc(v.model)) + specRow("Interior Color", esc(v.int)) + specRow("Year", esc(v.year)) + specRow("Mileage", miles(v.mileage)) + specRow("Trim", esc(v.trim)) + specRow("Condition", esc(v.condition)) + specRow("Body Type", esc(v.body)) + specRow("Stock Number", esc(v.stock)) + specRow("Doors", esc(v.doors)) + specRow("Seats", esc(v.seats)) + vinRow + '</div></section>'
      + '<section><h2>Fuel Economy</h2><div class="spec-grid">' + specRow("Fuel Type", esc(v.fuel)) + specRow("Fuel Tank Size", esc(v.tank)) + specRow("MPG (City/Hwy)", esc(v.mpg)) + specRow("Transmission", esc(v.trans)) + '</div></section>'
      + '<section><h2>Performance</h2><div class="spec-grid">' + specRow("Engine", esc(v.engine)) + specRow("Horsepower", esc(v.hp)) + specRow("Drivetrain", esc(v.drivetrain)) + specRow("Body Style", esc(v.body)) + '</div></section>'
      + (v.safety && v.safety.length ? '<section><h2>Safety</h2><div class="chips">' + v.safety.map(function (f) {return '<span class="chip">' + esc(f) + '</span>';}).join("") + '</div></section>' : "")
      + (v.features && v.features.length ? '<section><h2>Comfort &amp; Features</h2><div class="chips">' + v.features.map(function (f) {return '<span class="chip">' + esc(f) + '</span>';}).join("") + '</div></section>' : "")
      + '<section><h2>' + esc(T("v_history")) + '</h2>' + hist + '</section>'
      + '<section><h2>' + esc(T("v_about")) + '</h2><p class="d-desc">' + esc(v.description) + '</p><p class="d-desc" style="margin-top:12px;font-size:13.5px;color:var(--muted)">' + esc(T("v_note")) + (S.tel ? ' ' + telA() + '.' : "") + '</p></section>'
      + '</div>'
      + '<aside class="d-right"><div class="side-card stick"><div class="d-head"><h1>' + esc(vName(v)) + '</h1>'
      + '<p class="d-loc">' + IC.pin + ' ' + esc(S.city_state || "") + ' • Stock #' + esc(v.stock || "—") + '</p>'
      + '<div><span class="d-price">' + money(v.price) + '</span></div>'
      + (v.deal ? '<span class="deal-badge">' + IC.down + ' ' + esc(T("v_deal")) + ' • ' + esc(v.deal) + '</span>' : "")
      + '</div>'
      + (S.tel ? '<div style="margin-top:18px"><a href="' + esc(S.tel_link) + '" class="btn btn-primary btn-block">' + esc(T("v_cta")) + ' ' + IC.arrR + '</a></div>' : "")
      + '<div class="contact-row">' + (S.tel ? '<a href="' + esc(S.tel_link) + '">' + esc(T("v_call")) + '</a>' : "")
      + (S.facebook ? '<a href="' + esc(S.facebook) + '" target="_blank" rel="noopener"></a>' : "") + '</div>'
      + leadFormHTML(v)
      + '</div></aside></div></div>'
      + '<div class="container similar-wrap"><div class="section-head"><div><span class="label">' + esc(T("v_similar_label")) + '</span><h2>' + esc(T("v_similar_title")) + '</h2></div><a class="link-arrow" href="#/inventory">' + esc(T("v_view_all")) + ' ' + IC.arrR + '</a></div><div class="v-grid g3">' + similar.map(function (s, i) {return vehicleCard(s, i * 0.08);}).join("") + '</div></div>';
  }
  function recalc() {
    var v = state.v; if (!v) return; var dEl = $("#calcDown"), tEl = $("#calcTerm"), out = $("#calcMonthly"); if (!dEl || !tEl || !out) return;
    var down = parseFloat(dEl.value) || 0, n = parseInt(tEl.value, 10) || 72, P = Math.max(v.price - down, 0), r = 0.079 / 12;
    out.textContent = (P > 0 ? money(P * r / (1 - Math.pow(1 + r, -n))) : money(0)) + "/mo";
  }
  function gShow(i) {
    var g = state.gal; if (!g.imgs.length) return; g.i = (i + g.imgs.length) % g.imgs.length;
    if (window.__phase3VehicleState) window.__phase3VehicleState.galleryIndex = g.i;
    var img = $("#gMainImg"); if (img) img.src = g.imgs[g.i];
    var c = $("#gCounter"); if (c) c.textContent = (g.i + 1) + " / " + g.imgs.length;
    $$("#gThumbs .g-thumb").forEach(function (t, j) {t.classList.toggle("active", j === g.i);});
    var act = $('#gThumbs .g-thumb.active'); if (act && act.scrollIntoView) act.scrollIntoView({block: "nearest", inline: "nearest", behavior: "smooth"});
  }
  function renderVehicle(id) {
    if (!DB.loaded) {showPageEl("page-vehicle"); $("#vehicleRoot").innerHTML = '<div class="container" style="padding:160px 0 80px;text-align:center;color:var(--muted)">Loading vehicle…</div>'; return;}
    var v = getVehicle(decodeURIComponent(id));
    if (!v) {toast("Vehicle not found — showing inventory"); location.hash = "#/inventory"; return;}
    state.v = v; state.gal = {imgs: v.images || [], i: 0}; window.__phase3VehicleState = {vehicle: v, images: v.images || [], title: v.title || vName(v), galleryIndex: 0};
    $("#vehicleRoot").innerHTML = vehiclePageHTML(v);
    showPageEl("page-vehicle"); window.scrollTo(0, 0); document.body.classList.add("on-vehicle");
    setNavActive("inventory");
    var name = vName(v);
    setSEO(v.metaTitle || T("vehicle_title", {vehicle: name}), v.metaDescription || T("vehicle_desc", {vehicle: name, miles: miles(v.mileage), price: money(v.price), vin: v.vin || ""}));
    setSchema({"@context": "https://schema.org", "@type": "Car", "name": name, "brand": v.make, "model": v.model, "vehicleModelDate": String(v.year), "vehicleConfiguration": v.body, "mileageFromOdometer": {"@type": "QuantitativeValue", "value": v.mileage, "unitCode": "SMI"}, "vehicleIdentificationNumber": v.vin, "itemCondition": "https://schema.org/UsedCondition", "offers": {"@type": "Offer", "price": v.price, "priceCurrency": "USD", "availability": "https://schema.org/InStock", "seller": {"@type": "AutoDealer", "name": S.name, "telephone": S.tel, "address": {"@type": "PostalAddress", "streetAddress": S.street, "addressLocality": S.city, "addressRegion": S.state, "postalCode": S.zip}}}});
    var m = $("#mCTA"); if (m) m.innerHTML = '<div class="mp"><b>' + money(v.price) + '</b><small>' + esc(name) + '</small></div><button type="button" class="btn btn-primary btn-sm" data-action="scroll-form">Check Availability</button>';
    setTimeout(recalc, 50); observeReveals();
  }
  function openVehicle(id) {
    var target = "#/vehicle/" + encodeURIComponent(id);
    try {if (location.hash !== target) {var h = location.hash; location.hash = target; if (location.hash === h) {renderVehicle(id); return;} return;} } catch (e) { }
    renderVehicle(id);
  }

  /* blog */
  function renderBlogList() {
    var grid = $("#blogGrid"); if (!grid) return;
    if (!DB.loaded) {grid.innerHTML = "<p>Loading…</p>"; return;}
    grid.innerHTML = DB.posts.map(function (p, i) {
      return '<a class="p-card reveal" href="#/blog/' + esc(p.id) + '" style="transition-delay:' + (i * 0.07) + 's">'
        + '<div class="ph"><img src="' + esc(p.image || "") + '"' + sset(p.image) + ' alt="" loading="lazy" decoding="async" width="900" height="600" onerror="imgFallback(this)"></div>'
        + '<div class="p-body"><span class="p-tag">' + esc(p.tag || "Article") + '</span><h3>' + esc(p.title) + '</h3><p>' + esc(p.excerpt) + '</p>'
        + '<span class="p-meta">' + esc(p.date || "") + ' &nbsp;•&nbsp; Read article ' + IC.arrR + '</span></div></a>';
    }).join("") || "<p>No articles yet.</p>";
    observeReveals();
  }
  function renderPost(id) {
    if (!DB.loaded) {$("#postRoot").innerHTML = '<div class="container" style="padding:160px 0 80px;text-align:center">Loading…</div>'; return;}
    var p = null; for (var i = 0; i < DB.posts.length; i++) {if (DB.posts[i].id === id) p = DB.posts[i];}
    if (!p) {location.hash = "#/blog"; return;}
    var paras = String(p.content || "").split(/\n\s*\n/).map(function (t) {return '<p>' + esc(t).replace(/\n/g, "<br>") + '</p>';}).join("");
    var others = DB.posts.filter(function (x) {return x.id !== id;}).slice(0, 3);
    var recent = DB.posts.filter(function (x) {return x.id !== id;}).slice(0, 4);
    var side = '<aside class="post-side">'
      + '<div class="ps-card"><h4>Recent Posts</h4>' + (recent.map(function (o) {return '<a class="ps-post" href="#/blog/' + esc(o.id) + '"><span class="ps-img"><img src="' + esc(o.image || "") + '" alt="" loading="lazy" onerror="imgFallback(this)"></span><span><b>' + esc(o.title) + '</b><small>' + esc(o.date || "") + '</small></span></a>';}).join("") || "<p>More articles coming soon.</p>") + '</div>'
      + '<div class="ps-card ps-dark"><h4>' + esc(T("blog_side_title")) + '</h4><p>' + esc(T("blog_side_text")) + '</p><a href="#/inventory" class="btn btn-primary btn-sm btn-block">' + esc(T("blog_side_btn")) + ' ' + IC.arrR + '</a></div>'
      + '<div class="ps-card"><h4>Contact Us</h4><p>' + (S.tel ? '<a href="' + esc(S.tel_link) + '"><b>' + esc(S.phone) + '</b></a><br>' : "") + esc(S.address || "") + '<br>' + esc(S.hours_week || "") + '<br>' + esc(S.hours_weekend || "") + '</p><a href="#/contact" class="link-arrow">Send a message ' + IC.arrR + '</a></div>'
      + '</aside>';
    $("#postRoot").innerHTML = '<div class="post-layout"><div class="post-wrap">'
      + '<span class="p-tag">' + esc(p.tag || "Article") + '</span>'
      + '<h1>' + esc(p.title) + '</h1>'
      + '<div class="p-meta" style="margin-bottom:6px">' + esc(p.date || "") + ' &nbsp;•&nbsp; ' + esc(T("blog_author")) + '</div>'
      + (p.image ? '<div class="post-hero"><img fetchpriority="high" decoding="async" src="' + esc(p.image) + '" alt="' + esc(p.title) + '" onerror="imgFallback(this)"></div>' : "")
      + '<div class="post-body">' + paras + '</div>'
      + '<div class="post-cta"><h3>' + esc(T("blog_cta_title")) + '</h3><p>' + esc(T("blog_cta_text")) + '</p>'
      + '<a href="#/inventory" class="btn btn-primary btn-sm">' + esc(T("blog_cta_btn")) + ' ' + IC.arrR + '</a></div>'
      + (others.length ? '<h2 style="font-size:20px;margin:30px 0 16px">More Articles</h2><div class="p-grid" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr))">'
        + others.map(function (o) {return '<a class="p-card" href="#/blog/' + esc(o.id) + '"><div class="ph" style="height:130px"><img src="' + esc(o.image || "") + '" alt="" loading="lazy" onerror="imgFallback(this)"></div><div class="p-body"><h3 style="font-size:15px">' + esc(o.title) + '</h3></div></a>';}).join("") + '</div>' : "")
      + '<div style="padding:20px 0 60px"><button type="button" class="back-inv" data-action="go-blog">' + IC.arrL + ' All Articles</button></div>'
      + '</div>' + side + '</div>';
    showPageEl("page-post"); window.scrollTo(0, 0);
    setNavActive("blog");
    setSEO(p.metaTitle || p.title + " | " + S.name, p.metaDescription || p.excerpt || "");
    setSchema({"@context": "https://schema.org", "@type": "Article", "headline": p.title, "description": p.excerpt, "datePublished": p.date, "image": p.image, "author": {"@type": "Organization", "name": S.name}, "publisher": {"@type": "Organization", "name": S.name}});
  }

  /* router */
  function showPageEl(id) {$$(".page").forEach(function (p) {p.classList.remove("active");}); var el = $("#" + id); if (el) el.classList.add("active"); document.body.classList.remove("on-vehicle"); closeMenu();}
  window.paShowPage = showPageEl;
  window.paSetNavActive = setNavActive;
  function parseHash() {
    var h = location.hash || "#/", q = {}; var qi = h.indexOf("?");
    if (qi > -1) {h.slice(qi + 1).split("&").forEach(function (p) {var kv = p.split("="); if (kv[0]) {try {q[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || "");} catch (e) { }} }); h = h.slice(0, qi);}
    return {path: h, query: q};
  }
  var EDITORIAL = {"#/about": 1, "#/contact": 1, "#/used-cars": 1, "#/used-cars/sedans": 1};
  function route() {
    try {
      var r = parseHash(); setSchema(null);
      if (r.path.indexOf("#/admin") === 0) {location.replace("admin/"); return;}
      if (EDITORIAL[r.path]) {return;} /* editorial.js handles these */
      if (r.path.indexOf("#/vehicle/") === 0) {renderVehicle(r.path.replace("#/vehicle/", ""));}
      else if (r.path.indexOf("#/blog/") === 0) {showPageEl("page-post"); renderPost(decodeURIComponent(r.path.replace("#/blog/", "")));}
      else if (r.path === "#/blog") {showPageEl("page-blog"); window.scrollTo(0, 0); renderBlogList(); setNavActive("blog"); setSEO(T("blog_title"), T("blog_desc"));}
      else if (r.path === "#/inventory") {showPageEl("page-inventory"); window.scrollTo(0, 0); applyQuery(r.query); renderInventory(); setNavActive("inventory"); setSEO(T("inventory_title"), T("inventory_desc"));}
      else {
        showPageEl("page-home"); setNavActive("home"); setSEO(HOME_T, HOME_D);
        if (location.hash && location.hash.charAt(1) !== "/") {
          var sec = location.hash.slice(1), el = document.getElementById(sec);
          if (el) {requestAnimationFrame(function () {el.scrollIntoView({behavior: "smooth"});});} else window.scrollTo(0, 0);
        }
        else window.scrollTo(0, 0);
      }
      observeReveals();
    } catch (e) {if (window.toast) toast("Navigation error: " + e.message);}
  }
  window.addEventListener("hashchange", route);

  /* global click delegation (site only) */
  document.addEventListener("click", function (e) {
    if (!e.target || !e.target.closest) return;
    var card = e.target.closest("[data-vehicle]");
    if (card) {e.preventDefault(); openVehicle(card.getAttribute("data-vehicle")); return;}
    var t = e.target.closest("[data-action]");
    if (!t) return;
    var a = t.getAttribute("data-action");
    if (a === "g-prev") gShow(state.gal.i - 1);
    else if (a === "g-next") gShow(state.gal.i + 1);
    else if (a === "g-thumb") gShow(parseInt(t.getAttribute("data-i"), 10));
    else if (a === "copy-vin" && state.v) copyText(state.v.vin || "", "VIN copied to clipboard");
    else if (a === "save") toggleSave(t.getAttribute("data-id"), t);
    else if (a === "share") {var v = state.v, url = location.href, name = v ? vName(v) : S.name; if (navigator.share) {navigator.share({title: name, url: url}).catch(function () { });} else copyText(url, "Link copied to clipboard");}
    else if (a === "go-inventory") {location.hash = "#/inventory";}
    else if (a === "go-blog") {location.hash = "#/blog";}
    else if (a === "scroll-form") {var f = $("#reqForm"); if (f) {f.scrollIntoView({behavior: "smooth", block: "center"}); var inp = f.querySelector("input"); if (inp) setTimeout(function () {inp.focus();}, 500);} }
  });
  document.addEventListener("submit", function (e) {
    if (e.target.id !== "reqForm") return;
    e.preventDefault(); var f = e.target, d = new FormData(f); if (d.get("_honey")) return;
    var v = getVehicle(f.getAttribute("data-vid")) || {}, vn = vName(v), g = function (k) {return String(d.get(k) || "");};
    var extra = ["bestTime", "tradeIn", "financing"].filter(function (k) {return d.get(k) != null;}).map(function (k) {return {bestTime: "Best time to call", tradeIn: "Trade-in", financing: "Financing"}[k] + ": " + g(k);}).join("\n");
    var text = "Vehicle: " + vn + " (Stock #" + (v.stock || "-") + ", " + money(v.price || 0) + ")\n" + (extra ? extra + "\n" : "") + "\n" + (g("message") || "(no message)");
    var msg = {name: g("name"), email: g("email"), phone: g("phone"), topic: "Vehicle inquiry - " + vn, message: text, vehicleId: v.id || ""};
    var btn = f.querySelector("button[type=submit]"); if (btn) btn.disabled = true;
    window.PA_BRIDGE.leadFromForm(msg)
      .then(function (r) {if (!r.ok) throw 0; f.reset(); toast(T("lead_ok"));})
      .catch(function () {toast(T("lead_fail"));})
      .then(function () {if (btn) btn.disabled = false;});
  });
  document.addEventListener("input", function (e) {if (e.target.id === "calcDown") recalc();});
  document.addEventListener("change", function (e) {if (e.target.id === "calcTerm") recalc();});
  document.addEventListener("keydown", function (e) {
    if (!document.body.classList.contains("on-vehicle")) return;
    if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    if (e.key === "ArrowLeft") gShow(state.gal.i - 1);
    if (e.key === "ArrowRight") gShow(state.gal.i + 1);
  });

  /* ---- image lightbox on the vehicle page (was "Phase 3") ---- */
  (function () {
    var lb = {open: false, index: 0, imgs: [], title: ""};
    function create() {
      if (document.getElementById("phase3Lightbox")) return;
      var x = document.createElement("div"); x.id = "phase3Lightbox"; x.className = "phase3-lightbox"; x.setAttribute("aria-hidden", "true");
      x.innerHTML = '<button class="lb-close" type="button" aria-label="Close image viewer">×</button><button class="lb-prev" type="button" aria-label="Previous image">‹</button><img alt="Vehicle photo enlarged"><button class="lb-next" type="button" aria-label="Next image">›</button><div class="lb-caption"></div>';
      document.body.appendChild(x);
      x.addEventListener("click", function (e) {if (e.target === x || e.target.closest(".lb-close")) close(); else if (e.target.closest(".lb-prev")) move(-1); else if (e.target.closest(".lb-next")) move(1);});
    }
    function paint() {var x = document.getElementById("phase3Lightbox"); if (!x) return; x.querySelector("img").src = lb.imgs[lb.index] || ""; x.querySelector(".lb-caption").textContent = (lb.title || "Vehicle photo") + "  •  " + (lb.index + 1) + " / " + lb.imgs.length;}
    function open(i) {create(); var v = window.__phase3VehicleState || {}; lb.imgs = (v.images || []).filter(Boolean); if (!lb.imgs.length) return; lb.index = (i + lb.imgs.length) % lb.imgs.length; lb.title = v.title || "Vehicle photo"; paint(); var x = document.getElementById("phase3Lightbox"); x.classList.add("open"); x.setAttribute("aria-hidden", "false"); document.body.style.overflow = "hidden"; lb.open = true;}
    function close() {var x = document.getElementById("phase3Lightbox"); if (!x) return; x.classList.remove("open"); x.setAttribute("aria-hidden", "true"); document.body.style.overflow = ""; lb.open = false;}
    function move(d) {if (!lb.open) return; lb.index = (lb.index + d + lb.imgs.length) % lb.imgs.length; paint();}
    document.addEventListener("click", function (e) {var main = e.target.closest && e.target.closest("#gMainImg"); if (main) {open((window.__phase3VehicleState && window.__phase3VehicleState.galleryIndex) || 0);} });
    document.addEventListener("keydown", function (e) {if (!lb.open) return; if (e.key === "Escape") close(); if (e.key === "ArrowLeft") move(-1); if (e.key === "ArrowRight") move(1);});
  })();

  /* expose for the home page script */
  window.PADB = {
    getV: function () {return DB.vehicles;},
    getP: function () {return DB.posts;},
    getVehicle: getVehicle,
    loaded: function () {return DB.loaded;},
    rebuild: function () {buildHome(); if ($("#page-inventory").classList.contains("active")) renderInventory();}
  };

  /* init: show the page at once, then fill in vehicles when inventory.json arrives */
  toastEl = $("#toast");
  route();
  onScroll();
  observeReveals();
  dbLoad().then(function () {buildHome(); route();});
})();
