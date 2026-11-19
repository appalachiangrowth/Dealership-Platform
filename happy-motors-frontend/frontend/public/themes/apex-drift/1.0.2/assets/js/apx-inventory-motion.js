/* Entrance motion for the inventory search experience; all filtering behavior remains in apex-pages.js. */
(function () {
  'use strict';
  var page = document.querySelector('body[data-page="inventory"]');
  if (!page) return;

  var section = page.querySelector('.apx-content-section');
  if (!section) return;

  var items = [
    section.querySelector('.apx-section-head'),
    section.querySelector('#apxFilterForm'),
    section.querySelector('.apx-results-head')
  ].filter(Boolean);
  if (!items.length) return;

  var reduced = false;
  try {
    reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch (_) {}

  if (reduced || !('IntersectionObserver' in window)) {
    items.forEach(function (item) {
      item.classList.add('apx-motion-ready', 'apx-motion-visible');
    });
    return;
  }

  items.forEach(function (item, index) {
    item.style.setProperty('--apx-motion-delay', (index * 125) + 'ms');
    item.classList.add('apx-motion-ready');
  });

  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('apx-motion-visible');
      observer.unobserve(entry.target);
    });
  }, {
    root: null,
    rootMargin: '0px 0px -7% 0px',
    threshold: 0.12
  });

  items.forEach(function (item) { observer.observe(item); });
})();
