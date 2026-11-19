/* About / Contact pages (content is rendered on the server from the Website Editor) + contact form. */
(function () {
  "use strict";
  var T = window.paT || function () {return "";};
  function show(id) {
    if (window.paShowPage) window.paShowPage(id);
    else {document.querySelectorAll(".page").forEach(function (x) {x.classList.remove("active");}); var el = document.getElementById(id); if (el) el.classList.add("active");}
    window.scrollTo(0, 0);
  }
  function route() {
    var base = (location.hash || "#/").split("?")[0];
    if (base === "#/used-cars") {location.replace("used-cars.html"); return;}
    if (base === "#/used-cars/sedans") {location.replace("used-sedans.html"); return;}
    if (base !== "#/about" && base !== "#/contact") return;
    show(base === "#/about" ? "page-about" : "page-contact");
    if (window.paSetNavActive) window.paSetNavActive(base.slice(2));
    if (window.paSetSEO) window.paSetSEO(T(base === "#/about" ? "about_title" : "contact_title"), T(base === "#/about" ? "about_desc" : "contact_desc"));
  }
  window.addEventListener("hashchange", route);
  setTimeout(route, 0);

  document.addEventListener("submit", function (e) {
    var f = e.target; if (f.id !== "contactForm") return;
    e.preventDefault();
    var d = new FormData(f);
    if (d.get("_honey")) return;
    var m = {name: String(d.get("name") || ""), email: String(d.get("email") || ""), phone: String(d.get("phone") || ""), topic: String(d.get("topic") || "General Question"), message: String(d.get("message") || ""), page: location.href, _honey: ""};
    var btn = f.querySelector("button[type=submit]"); if (btn) btn.disabled = true;
    window.PA_BRIDGE.sendLead(m).then(function (r) {
      if (r.ok) {f.reset(); if (window.toast) window.toast(T("contact_ok"));}
      else if (window.toast) window.toast(T("contact_fail"));
    }).then(function () {if (btn) btn.disabled = false;});
  });
})();
