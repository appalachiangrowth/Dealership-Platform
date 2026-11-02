/* ==========================================================================
   Shared inventory layer for the separate HTML pages (used-cars.html etc.).

   ONE source of truth: inventory.json (the same file the main site and the
   inventory.xml feed use).  Push inventory from the dashboard and every page
   below updates by itself - no per-page editing of cars, prices or photos.

   HOW TO USE IN ANY PAGE (no JavaScript needed):

     <div class="cards" data-pa-list="sedan" data-limit="6"></div>
        -> fills with live vehicle cards.  kinds: sedan | truck | suv | wagon |
           car | featured | all     (data-limit optional)

     <span data-pa-count="truck"></span>       -> number of trucks in stock
     <span data-pa-from="suv"></span>          -> lowest price, e.g. "$8,995"
     <div class="brands" data-pa-brands="sedan"></div>  -> brand links (live)

   Optional hooks:  document.addEventListener("pa:ready", function (e) {...})
   ========================================================================== */
(function () {
  "use strict";
  var PA = window.PA = {vehicles: [], posts: [], source: "", ready: null};

  /* ---------- helpers ---------- */
  function esc(s) {return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");}
  PA.esc = esc;
  PA.money = function (n) {return "$" + Math.round(Number(n) || 0).toLocaleString("en-US");};
  PA.miles = function (n) {return Number(n || 0).toLocaleString("en-US");};
  PA.name = function (v) {return v.title || (v.year + " " + v.make + " " + v.model + " " + (v.trim || "")).trim();};
  PA.vehicleUrl = function (v) {return "./#/vehicle/" + encodeURIComponent(v.id);};
  PA.inventoryUrl = function (q) {
    var p = []; Object.keys(q || {}).forEach(function (k) {if (q[k] !== "" && q[k] != null) p.push(encodeURIComponent(k) + "=" + encodeURIComponent(q[k]));});
    return "./#/inventory" + (p.length ? "?" + p.join("&") : "");
  };
  PA.drive = function (d) {
    d = String(d || "");
    if (/four|4/i.test(d)) return "4x4";
    if (/all/i.test(d)) return "AWD";
    if (/front/i.test(d)) return "FWD";
    if (/rear/i.test(d)) return "RWD";
    return d;
  };
  /* rough SUV size (there is no size field in the dashboard) */
  PA.suvSize = function (v) {
    if (Number(v.seats) >= 7) return "3row";
    var m = (v.make + " " + v.model).toLowerCase();
    if (/cr-v|crv|rav4|rogue|escape|tucson|sportage|forester|cx-5|cx5|equinox|compass|renegade|hr-v|hrv|kona|trax|bronco sport|outlander sport|crosstrek|seltos|soul/.test(m)) return "compact";
    if (/highlander|explorer|traverse|pilot|tahoe|suburban|expedition|telluride|palisade|pathfinder|durango|acadia|atlas|sequoia|armada|yukon|enclave|mdx/.test(m)) return "3row";
    return "mid";
  };

  /* ---------- which cars belong on which page ---------- */
  PA.kinds = {
    sedan: function (v) {return /sedan/i.test(v.body || "");},
    truck: function (v) {return v.type === "Truck" || /pickup|truck/i.test(v.body || "");},
    suv: function (v) {return v.type === "SUV" || /^suv$/i.test(v.body || "");},
    wagon: function (v) {return /wagon/i.test(v.body || "");},
    car: function (v) {return v.type === "Car";},
    featured: function (v) {return !!v.featured;},
    all: function () {return true;}
  };
  PA.published = function () {return PA.vehicles.filter(function (v) {return v && typeof v === "object" && v.status !== "draft";});};
  PA.list = function (kind) {
    var f = PA.kinds[kind] || PA.kinds.all;
    var l = PA.published().filter(f);
    /* featured first, otherwise the order of inventory.json */
    return l.filter(function (v) {return v.featured;}).concat(l.filter(function (v) {return !v.featured;}));
  };

  /* ---------- load this dealership's inventory.json ---------- */
  PA.load = function () {
    if (PA.ready) return PA.ready;
    PA.ready = fetch("inventory.json", {cache: "no-store"})
      .then(function (r) {return r.ok ? r.json() : null;})
      .catch(function () {return null;})
      .then(function (d) {
        if (d && Array.isArray(d.vehicles)) {PA.vehicles = d.vehicles; PA.posts = d.posts || []; PA.source = "inventory.json";}
        else {PA.vehicles = []; PA.posts = []; PA.source = "none";}
        return PA;
      });
    return PA.ready;
  };

  /* ---------- vehicle card (matches the .card design used on the pages) ---------- */
  var ARROW = '<svg><use href="#i-arrow"/></svg>';
  var ALT = ((window.SITE_T || {}).v_alt) || "for sale";
  var HEART = '<svg viewBox="0 0 24 24"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>';
  function savedList() {try {return JSON.parse(localStorage.getItem("savedVehicles") || "[]");} catch (e) {return [];}}
  PA.card = function (v, opts) {
    opts = opts || {};
    var img = (v.images && v.images[0]) || "", id = String(v.id), t2 = v.trans || v.fuel || v.drivetrain || "";
    var on = savedList().indexOf(id) > -1;
    return '<article class="pl-card" data-size="' + (opts.size || "") + '">'
      + '<button type="button" class="pl-heart' + (on ? " pl-on" : "") + '" data-pa-save="' + esc(id) + '" aria-label="Save ' + esc(PA.name(v)) + '" aria-pressed="' + on + '">' + HEART + '</button>'
      + '<a href="' + PA.vehicleUrl(v) + '"><div class="pl-pimg">'
      + (img ? '<img src="' + esc(img) + '" alt="' + esc(PA.name(v) + " " + ALT) + '" loading="lazy" decoding="async" onerror="this.remove()">' : "")
      + '</div><div class="pl-cb"><small>' + esc(v.body || v.type || "") + '</small><h3>' + esc(PA.name(v)) + '</h3>'
      + '<div class="pl-tags"><span>' + PA.miles(v.mileage) + ' mi</span>' + (t2 ? '<span>' + esc(t2) + '</span>' : "") + '</div>'
      + '<div class="pl-pr"><b>' + PA.money(v.price) + '</b><span>View details →</span></div></div></a></article>';
  };
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-pa-save]"); if (!b) return;
    e.preventDefault();
    var id = b.getAttribute("data-pa-save"), l = savedList(), i = l.indexOf(id);
    if (i > -1) l.splice(i, 1); else l.push(id);
    try {localStorage.setItem("savedVehicles", JSON.stringify(l));} catch (_) { }
    b.classList.toggle("pl-on", i === -1); b.setAttribute("aria-pressed", i === -1);
  });

  /* ---------- auto-fill every data-pa-* element ---------- */
  function fillLists() {
    [].forEach.call(document.querySelectorAll("[data-pa-list]"), function (el) {
      var kind = el.getAttribute("data-pa-list"), lim = parseInt(el.getAttribute("data-limit"), 10) || 999;
      var isSuv = kind === "suv";
      var list = PA.list(kind).slice(0, lim);
      var opt = {third: el.getAttribute("data-third") || (kind === "truck" || kind === "suv" ? "drive" : "")};
      el.innerHTML = list.length
        ? list.map(function (v) {
            var o = {third: opt.third}; if (isSuv) {o.size = PA.suvSize(v); o.tag = {compact: "Compact", mid: "Midsize", "3row": "Three-row"}[o.size];}
            return PA.card(v, o);
          }).join("")
        : '<p class="pa-empty">' + esc(el.getAttribute("data-empty") || "New inventory is arriving soon - call " + ((window.SITE || {}).phone || "us") + " for what is on the lot today.") + '</p>';
    });
    [].forEach.call(document.querySelectorAll("[data-pa-count]"), function (el) {el.textContent = PA.list(el.getAttribute("data-pa-count")).length;});
    [].forEach.call(document.querySelectorAll("[data-pa-from]"), function (el) {
      var l = PA.list(el.getAttribute("data-pa-from")); if (!l.length) {el.textContent = "-"; return;}
      el.textContent = PA.money(Math.min.apply(null, l.map(function (v) {return Number(v.price) || 0;})));
    });
    [].forEach.call(document.querySelectorAll("[data-pa-brands]"), function (el) {
      var kind = el.getAttribute("data-pa-brands"), lim = parseInt(el.getAttribute("data-limit"), 10) || 8, c = {};
      PA.list(kind).forEach(function (v) {if (v.make) c[v.make] = (c[v.make] || 0) + 1;});
      var makes = Object.keys(c).sort(function (a, b) {return c[b] - c[a] || a.localeCompare(b);}).slice(0, lim);
      var base = {sedan: {type: "Car"}, truck: {type: "Truck"}, suv: {type: "SUV"}, wagon: {type: "Car"}}[kind] || {};
      el.innerHTML = makes.map(function (m) {
        var q = {make: m}; if (base.type) q.type = base.type;
        return '<a href="' + PA.inventoryUrl(q) + '">' + esc(m) + '</a>';
      }).join("");
    });
  }
  function itemListSchema() {
    var el = document.querySelector("[data-pa-list]"); if (!el) return;
    var kind = el.getAttribute("data-pa-list"), l = PA.list(kind).slice(0, 12); if (!l.length) return;
    var s = document.createElement("script"); s.type = "application/ld+json";
    s.textContent = JSON.stringify({"@context": "https://schema.org", "@type": "ItemList", itemListElement: l.map(function (v, i) {
      return {"@type": "ListItem", position: i + 1, item: {"@type": "Car", name: PA.name(v), vehicleModelDate: String(v.year), brand: v.make,
        mileageFromOdometer: {"@type": "QuantitativeValue", value: v.mileage, unitCode: "SMI"},
        offers: {"@type": "Offer", price: v.price, priceCurrency: "USD", availability: "https://schema.org/InStock"}}};
    })});
    document.head.appendChild(s);
  }

  PA.refresh = function () {fillLists(); document.dispatchEvent(new CustomEvent("pa:ready", {detail: PA}));};
  function boot() {PA.load().then(function () {PA.refresh(); itemListSchema();});}
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
