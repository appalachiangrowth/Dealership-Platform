/* Live inventory + lead bridge for the VroomFox theme.
   Reads the dealership's inventory.json synchronously (so the page scripts see it) and exposes window.VF_LIVE.
   Also exposes the dealer's blog posts. When the inventory is empty the theme shows friendly empty states. */
(function () {
  "use strict";
  var L = window.VF_LIVE = {cars: [], feat: [], posts: [], details: {}, gallery: {}, ids: {}};
  function arr(v) { if (Array.isArray(v)) return v; if (typeof v === "string" && v) { try { var p = JSON.parse(v); if (Array.isArray(p)) return p; } catch (e) {} } return []; }
  function num(v) { var n = parseInt(String(v == null ? "" : v).replace(/[^\d]/g, ""), 10); return isNaN(n) ? 0 : n; }
  function fmt(n) { return n.toLocaleString("en-US"); }
  function drive(s) { s = String(s || "").toLowerCase(); if (/all|awd/.test(s)) return "AWD"; if (/four|4x4|4wd/.test(s)) return "4WD"; if (/rear|rwd/.test(s)) return "RWD"; return "FWD"; }
  function hex(name) {
    var n = String(name || "").toLowerCase(), m = [["white","#eceff4"],["pearl","#eceff4"],["black","#161a22"],["silver","#b4bbc6"],["gr","#5b6577"],["red","#b3222f"],["maroon","#7a1b2a"],["blue","#2a56c4"],["green","#3a6b4f"],["brown","#6b4a33"],["orange","#d9731f"],["yellow","#e3b923"],["gold","#c9a24a"],["tan","#c8b08a"],["beige","#d6c6a5"]];
    if (/^#[0-9a-f]{6}$/i.test(n)) return n;
    for (var i = 0; i < m.length; i++) if (n.indexOf(m[i][0]) > -1) return m[i][1];
    return "#5b6577";
  }
  function kind(v) {
    var b = String(v.body || v.type || "").toLowerCase();
    if (/suv|crossover/.test(b)) return ["SUV", "suv"];
    if (/truck|pickup/.test(b)) return ["Truck", "truck"];
    if (/wagon/.test(b)) return ["Wagon", "suv"];
    if (/sedan/.test(b)) return ["Sedan", "sedan"];
    return [b ? b.charAt(0).toUpperCase() + b.slice(1) : "Car", "sedan"];
  }
  try {
    var x = new XMLHttpRequest(); x.open("GET", "inventory.json?_=" + Date.now(), false); x.send(null);
    if (x.status === 200) {
      var data = JSON.parse(x.responseText), site = window.SITE || {}, seen = {};
      (data.vehicles || []).forEach(function (v) {
        if (!v || /^(draft|sold|hidden)$/i.test(String(v.status || ""))) return;
        var title = String(v.title || "").trim() || [v.year, v.make, v.model, v.trim].filter(Boolean).join(" ").trim();
        if (!title) return;
        if (seen[title]) title += " (" + (v.stock || v.id || Object.keys(seen).length) + ")";
        seen[title] = 1;
        var k = kind(v), imgs = arr(v.images), feats = arr(v.features), i = L.cars.length;
        var feat = v.featured === true || /^(true|1|yes)$/i.test(String(v.featured));
        L.cars.push({id: i, title: title, make: v.make || "", model: v.model || "", body: k[1], type: k[0], price: num(v.price), miles: num(v.mileage),
          drive: drive(v.drivetrain), fuel: v.fuel || "Gasoline", trans: v.trans || "Automatic", color: hex(v.ext), feat: feat, img: imgs[0] || ""});
        L.ids[title] = v.id || "";
        var d = {};
        if (v.vin) d.vin = v.vin; if (v.stock) d.stock = v.stock; if (v.ext) d.ext = v.ext; if (v.int) d.int = v.int;
        if (v.engine) d.engine = v.engine; if (v.mpg) d.mpg = v.mpg; if (v.doors) d.doors = String(v.doors); if (v.seats) d.seats = String(v.seats);
        if (site.city) d.loc = site.city_state || site.city;
        if (v.description) d.desc = String(v.description).split(/\n+/).filter(Boolean);
        if (feats.length) d.features = feats;
        d.raw = v;
        L.details[title] = d;
        if (imgs.length) L.gallery[title] = imgs;
      });
      var H = function (t) { return String(t == null ? "" : t).replace(/[&<>"']/g, function (c) { return {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]; }); };
      var BODIES = ["sedan", "suv", "truck"], PAINT = ["#2a56c4", "#eceff4", "#b3222f", "#161a22"], used = {};
      (data.posts || []).forEach(function (p, i) {
        if (!p || !p.title || /^(draft|hidden)$/i.test(String(p.status || ""))) return;
        var slug = String(p.id || p.title).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || ("post-" + i);
        if (used[slug]) slug += "-" + i; used[slug] = 1;
        var text = String(p.content || ""), words = text.split(/\s+/).filter(Boolean).length;
        L.posts.push({s: slug, t: H(p.title), cat: H(p.tag || "Article"), d: H(p.date || ""), r: Math.max(1, Math.round(words / 200)),
          ex: H(p.excerpt || text.slice(0, 160)), img: H(p.image || ""), body: BODIES[i % 3], color: PAINT[i % 4],
          b: text.split(/\n\s*\n/).map(function (x) { return H(x.trim()).replace(/\n/g, "<br>"); }).filter(Boolean)});
      });
      var f = L.cars.filter(function (c) { return c.feat; });
      if (!f.length) f = L.cars.slice(0, 8);
      L.feat = f.slice(0, 8).map(function (c) {
        return {title: c.title, type: c.type, body: c.body, miles: fmt(c.miles), loc: (site.city_state || ""), price: "$" + fmt(c.price), color: c.color, featured: true, img: c.img};
      });
    }
  } catch (e) { L.cars = []; L.feat = []; L.posts = []; }

  function send(o) {
    try { fetch("api/lead.php", {method: "POST", headers: {"Content-Type": "application/json"}, credentials: "same-origin", cache: "no-store", body: JSON.stringify(o)}).catch(function () {}); } catch (e) {}
  }
  document.addEventListener("vroomfox:contact", function (e) {
    var d = e.detail || {};
    send({name: d.name, email: d.email, phone: d.phone, topic: "Contact form", message: d.message, page: location.href, vehicleId: "", _honey: ""});
  });
  document.addEventListener("vroomfox:vehicle-inquiry", function (e) {
    var d = e.detail || {};
    send({name: d.name, email: d.email, phone: d.phone, topic: "Vehicle inquiry: " + (d.vehicle || ""),
      message: (d.interest ? "[" + d.interest + "] " : "") + (d.message || "") + "\n\nVehicle: " + (d.vehicle || "") + " | Stock: " + (d.stock || "") + " | VIN: " + (d.vin || "") + " | Price: " + (d.price || ""),
      page: location.href, vehicleId: L.ids[d.vehicle] || "", _honey: ""});
  });
})();
