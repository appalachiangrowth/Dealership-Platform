/* Used SUVs page: size chips, quick finder, lifestyle tabs, payment estimator. */
(function () {
  "use strict";
  function esc(s) {return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");}
  /* ---- Size chips: show / hide the live cards (size is worked out from the vehicle, see PA.suvSize in pa-data.js) ---- */
  var cards = document.getElementById("cards");
  function apply(f) {if (!cards) return; cards.querySelectorAll(".pl-card").forEach(function (c) {c.style.display = (f === "all" || c.dataset.size === f) ? "" : "none";});}
  document.querySelectorAll(".chip").forEach(function (b) {
    b.onclick = function () {document.querySelectorAll(".chip").forEach(function (x) {x.setAttribute("aria-pressed", x === b);}); apply(b.dataset.f);};
  });

  /* ---- Quick finder: sends visitors to the inventory page with filters ---- */
  var finder = document.getElementById("finder");
  if (finder) finder.onsubmit = function (e) {
    e.preventDefault();
    var q = [], size = document.getElementById("f-size").value, max = document.getElementById("f-price").value, dr = document.getElementById("f-drive").value;
    if (size) q.push("size=" + encodeURIComponent(size)); if (max) q.push("max=" + encodeURIComponent(max)); if (dr) q.push("drive=" + encodeURIComponent(dr));
    location.href = "./#/inventory?type=SUV" + (q.length ? "&" + q.join("&") : "");
  };

  /* ---- Lifestyle tabs (texts from the Website Editor) ---- */
  var life = window.SUV_LIFE || [];
  var tabs = document.getElementById("tabs"), panel = document.getElementById("panel");
  function show(i) {
    Array.prototype.forEach.call(tabs.children, function (b, j) {b.setAttribute("aria-selected", i === j);});
    var x = life[i], models = String(x.m || "").split(",").map(function (s) {return s.trim();}).filter(Boolean);
    var see = String(window.SUV_SEE || "See {tab} SUVs").split("{tab}").join(x.k);
    panel.innerHTML = '<div><h3>' + esc(x.t) + '</h3><p>' + esc(x.d) + '</p><ul>' + models.map(function (m) {return '<li>' + esc(m) + '</li>';}).join("") + '</ul><a class="btn" href="' + esc(x.l) + '">' + esc(see) + ' <svg><use href="#i-arrow"/></svg></a></div>'
      + '<div class="ph"><svg viewBox="0 0 300 118" style="color:' + esc(x.c) + '" role="img" aria-label="' + esc(x.k) + ' SUV"><use href="#suv"/></svg></div>';
  }
  if (tabs && panel && life.length) {
    life.forEach(function (x, i) {var b = document.createElement("button"); b.className = "tab"; b.setAttribute("role", "tab"); b.textContent = x.k; b.onclick = function () {show(i);}; tabs.appendChild(b);});
    show(0);
  }

  /* ---- Payment estimator (estimate only) ---- */
  var $ = function (id) {return document.getElementById(id);};
  function calc() {
    var P = Math.max(0, (+$("c-price").value || 0) - (+$("c-down").value || 0)), n = +$("c-term").value, r = (+$("c-apr").value || 0) / 1200;
    var m = r ? P * r / (1 - Math.pow(1 + r, -n)) : P / n;
    $("c-out").textContent = "$" + Math.round(m).toLocaleString("en-US");
  }
  if ($("c-price")) {["c-price", "c-down", "c-term", "c-apr"].forEach(function (id) {$(id).addEventListener("input", calc);}); calc();}
})();
