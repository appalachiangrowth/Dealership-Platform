/* ==========================================================================
   Category pages (used-cars.html, used-sedans.html ...): header/footer behaviour.
   The header and footer HTML are rendered on the server (partials/site-header.html,
   partials/site-footer.html) so menu labels and dealer details come from the admin panel.
   ========================================================================== */
(function () {
  "use strict";
  var active = (document.body && document.body.getAttribute("data-nav")) || "";
  if (active) {
    Array.prototype.forEach.call(document.querySelectorAll('.nav-links a[data-nav="' + active + '"]'), function (a) {a.classList.add("active");});
    if (["sedans", "trucks", "suvs", "wagons"].indexOf(active) > -1) {
      var p = document.querySelector('.nav-links a[data-nav="cars"]'); if (p) p.classList.add("active");
    }
  }
  var head = document.getElementById("siteHead"), toTop = document.getElementById("toTop"),
      burger = document.getElementById("burger"), mmenu = document.getElementById("mobileMenu"), ticking = false;
  if (burger && mmenu) {
    burger.addEventListener("click", function () {
      var o = mmenu.classList.toggle("open"); burger.classList.toggle("open", o); burger.setAttribute("aria-expanded", o);
    });
    mmenu.addEventListener("click", function (e) {if (e.target.closest && e.target.closest("a")) {mmenu.classList.remove("open"); burger.classList.remove("open");}});
  }
  function onScroll() {
    var y = window.scrollY;
    if (head) head.classList.toggle("scrolled", y > 60);
    if (toTop) toTop.classList.toggle("show", y > 500);
    ticking = false;
  }
  window.addEventListener("scroll", function () {if (!ticking) {requestAnimationFrame(onScroll); ticking = true;}}, {passive: true});
  if (toTop) toTop.addEventListener("click", function () {window.scrollTo({top: 0, behavior: "smooth"});});
  onScroll();

  var toastEl, toastTimer;
  window.toast = function (msg) {
    toastEl = toastEl || document.getElementById("toast"); if (!toastEl) return;
    toastEl.textContent = msg; toastEl.classList.add("show"); clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {toastEl.classList.remove("show");}, 3500);
  };
})();

/* ===== Hero photo slideshow on category pages (photos come from the Website Editor) ===== */
(function () {
  function init() {
    var sc = document.querySelector(".hero .scene"); if (!sc) return;
    var W = window.innerWidth < 700 ? 900 : window.innerWidth < 1200 ? 1400 : 1920;
    var slides = Array.prototype.slice.call(sc.querySelectorAll(":scope > img"));
    slides.forEach(function (im) {
      if (im.src.indexOf("images.unsplash.com") > -1) im.src = im.src.replace(/([?&])w=\d+/, "$1w=" + W);
      im.addEventListener("error", function () {slides = slides.filter(function (x) {return x !== im;});});
    });
    if (slides.length < 2) return;
    var cur = 0;
    setInterval(function () {
      slides = slides.filter(function (x) {return x.isConnected;});
      if (slides.length < 2) return;
      slides.forEach(function (x) {x.classList.remove("on");});
      cur = (cur + 1) % slides.length; slides[cur].classList.add("on");
    }, 2500);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
