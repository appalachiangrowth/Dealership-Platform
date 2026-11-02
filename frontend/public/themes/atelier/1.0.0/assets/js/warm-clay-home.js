/* Atelier home interactions: 3D arrival, navigation, reveal and gentle parallax. */
(function () {
  "use strict";
  var doc = document;
  var reduceMotion = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  var header = doc.getElementById("atelierHeader");
  var menuToggle = doc.getElementById("menuToggle");
  var mobileNav = doc.getElementById("mobileNav");
  var toTop = doc.getElementById("toTop");
  var hero = doc.getElementById("hero");
  var modelStage = doc.getElementById("modelStage");
  var model = doc.getElementById("astonModel");
  var loading = doc.getElementById("modelLoading");
  var error = doc.getElementById("modelError");
  var rafPending = false;

  function closeMenu() {
    if (!menuToggle || !mobileNav) return;
    menuToggle.setAttribute("aria-expanded", "false");
    menuToggle.setAttribute("aria-label", "Open navigation");
    mobileNav.setAttribute("aria-hidden", "true");
    mobileNav.classList.remove("is-open");
    doc.body.classList.remove("menu-is-open");
  }
  if (menuToggle && mobileNav) {
    menuToggle.addEventListener("click", function () {
      var open = menuToggle.getAttribute("aria-expanded") !== "true";
      menuToggle.setAttribute("aria-expanded", String(open));
      menuToggle.setAttribute("aria-label", open ? "Close navigation" : "Open navigation");
      mobileNav.setAttribute("aria-hidden", String(!open));
      mobileNav.classList.toggle("is-open", open);
      doc.body.classList.toggle("menu-is-open", open);
    });
    mobileNav.addEventListener("click", function (event) {
      if (event.target.closest && event.target.closest("a")) closeMenu();
    });
    doc.addEventListener("keydown", function (event) { if (event.key === "Escape") closeMenu(); });
    window.addEventListener("resize", function () { if (window.innerWidth > 800) closeMenu(); }, { passive: true });
  }

  function updateScroll() {
    var y = window.scrollY || window.pageYOffset || 0;
    if (header) header.classList.toggle("is-scrolled", y > 22);
    if (toTop) toTop.classList.toggle("is-visible", y > 600);
    rafPending = false;
  }
  window.addEventListener("scroll", function () {
    if (!rafPending) { rafPending = true; window.requestAnimationFrame(updateScroll); }
  }, { passive: true });
  if (toTop) toTop.addEventListener("click", function (event) {
    event.preventDefault(); window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
  });
  updateScroll();

  /* Scroll entrances: elements animate once, and content remains readable without IO. */
  var revealItems = Array.prototype.slice.call(doc.querySelectorAll("[data-reveal]"));
  if (reduceMotion || !("IntersectionObserver" in window)) {
    revealItems.forEach(function (el) { el.classList.add("is-visible"); });
  } else {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1, rootMargin: "0px 0px -35px 0px" });
    revealItems.forEach(function (el) { observer.observe(el); });
  }

  /* The actual GLB is the star: begin the entrance only once the model is ready,
     then ease the camera from a more oblique angle into its final side/three-quarter view. */
  if (model) {
    var loaded = false;
    function ready() {
      if (loaded) return;
      loaded = true;
      if (modelStage) modelStage.classList.add("is-model-ready");
      model.classList.add("model-ready");
      if (loading) loading.classList.add("is-hidden");
      if (error) error.hidden = true;
      if (!reduceMotion) {
        window.setTimeout(function () {
          try { model.setAttribute("camera-orbit", "72deg 73deg 112%"); } catch (_) { /* 3D view remains usable at its initial camera */ }
        }, 220);
      } else {
        try { model.setAttribute("camera-orbit", "72deg 73deg 112%"); } catch (_) { }
      }
    }
    model.addEventListener("load", ready, { once: true });
    model.addEventListener("error", function () {
      if (loading) loading.classList.add("is-hidden");
      if (error) error.hidden = false;
      if (modelStage) modelStage.classList.add("model-unavailable");
    });
    /* Covers cached models which finish before the listener is registered. */
    if (model.loaded) ready();
  }

  /* Soft spotlight follows the pointer rather than rotating the car away from its settled profile. */
  if (hero && !reduceMotion && window.matchMedia && window.matchMedia("(pointer: fine)").matches) {
    var moveScheduled = false, px = 50, py = 50;
    hero.addEventListener("pointermove", function (event) {
      if (moveScheduled) return;
      moveScheduled = true;
      px = (event.clientX / Math.max(1, window.innerWidth)) * 100;
      py = (event.clientY / Math.max(1, window.innerHeight)) * 100;
      window.requestAnimationFrame(function () {
        hero.style.setProperty("--pointer-x", px.toFixed(2) + "%");
        hero.style.setProperty("--pointer-y", py.toFixed(2) + "%");
        moveScheduled = false;
      });
    }, { passive: true });
  }

  var year = doc.getElementById("footerYear");
  if (year) year.textContent = String(new Date().getFullYear());

  /* Tiny accessibility affordance for anchor jumps when native smooth scrolling is disabled. */
  doc.querySelectorAll('a[href^="#"]').forEach(function (link) {
    link.addEventListener("click", function () {
      var id = link.getAttribute("href");
      if (!id || id === "#" || reduceMotion) return;
      var target = doc.querySelector(id);
      if (target) target.setAttribute("tabindex", "-1");
    });
  });
})();
