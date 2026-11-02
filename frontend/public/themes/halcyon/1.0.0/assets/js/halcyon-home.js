(function () {
  "use strict";

  var reducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var hero = document.querySelector(".hero");
  var menuToggle = document.getElementById("menuToggle");
  var mobileNav = document.getElementById("mobileNav");
  var toTop = null; // handled by halcyon-sections.js
  var footerYear = document.getElementById("footerYear");

  if (footerYear) footerYear.textContent = String(new Date().getFullYear());

  // Accessible mobile navigation.
  function closeMenu() {
    if (!menuToggle || !mobileNav) return;
    menuToggle.setAttribute("aria-expanded", "false");
    menuToggle.setAttribute("aria-label", "Open navigation");
    mobileNav.setAttribute("aria-hidden", "true");
    mobileNav.classList.remove("is-open");
    document.body.classList.remove("menu-open");
  }
  if (menuToggle && mobileNav) {
    menuToggle.addEventListener("click", function () {
      var opening = menuToggle.getAttribute("aria-expanded") !== "true";
      menuToggle.setAttribute("aria-expanded", String(opening));
      menuToggle.setAttribute("aria-label", opening ? "Close navigation" : "Open navigation");
      mobileNav.setAttribute("aria-hidden", String(!opening));
      mobileNav.classList.toggle("is-open", opening);
      document.body.classList.toggle("menu-open", opening);
    });
    mobileNav.querySelectorAll("a").forEach(function (link) { link.addEventListener("click", closeMenu); });
    document.addEventListener("keydown", function (event) { if (event.key === "Escape") closeMenu(); });
    window.addEventListener("resize", function () { if (window.innerWidth > 800) closeMenu(); });
  }

  // On-scroll reveal, with a graceful fallback when IntersectionObserver is unavailable.
  var revealEls = Array.prototype.slice.call(document.querySelectorAll(".reveal"));
  if (reducedMotion || !("IntersectionObserver" in window)) {
    revealEls.forEach(function (el) { el.classList.add("is-visible"); });
  } else {
    var revealObserver = new IntersectionObserver(function (entries, observer) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -30px 0px" });
    revealEls.forEach(function (el) { revealObserver.observe(el); });
  }

  // Back-to-top affordance.
  function onScroll() {
    if (!toTop) return;
    toTop.classList.toggle("is-visible", window.scrollY > 650);
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  // 3D Vanquish scene, derived from the uploaded hero's Three.js treatment.
  var canvas = document.getElementById("carCanvas");
  var loading = document.getElementById("modelLoading");
  var errorBox = document.getElementById("modelError");
  var swatches = document.getElementById("paintSwatches");
  var paintName = document.getElementById("paintName");
  if (!canvas) return;

  // Hero paint can be changed from the theme editor through --sr-paint.
  var cssPaint = "";
  try { cssPaint = (getComputedStyle(document.body).getPropertyValue("--sr-paint") || "").trim(); } catch (_) { }
  var PAINTS = [
    ["Velocity Red", cssPaint || "#8a0812"],
    ["Racing Green", "#1f4d3a"],
    ["Onyx Black", "#0d0d0f"],
    ["Silver Birch", "#b9bcc0"],
    ["Aston Red", "#8e1a1f"],
    ["Skyfall Blue", "#2c4670"]
  ];
  var paintMaterials = [];

  function setPaint(index) {
    var selected = PAINTS[index] || PAINTS[0];
    if (paintName) paintName.textContent = "Paint: " + selected[0];
    if (swatches) {
      Array.prototype.forEach.call(swatches.children, function (button, i) {
        button.setAttribute("aria-pressed", String(i === index));
      });
    }
    paintMaterials.forEach(function (material) {
      if (material && material.color) material.color.set(selected[1]).convertSRGBToLinear();
    });
  }
  if (swatches) {
    PAINTS.forEach(function (paint, index) {
      var button = document.createElement("button");
      button.type = "button";
      button.style.setProperty("--swatch", paint[1]);
      button.setAttribute("aria-label", paint[0]);
      button.setAttribute("title", paint[0]);
      button.setAttribute("aria-pressed", String(index === 0));
      button.addEventListener("click", function () { setPaint(index); });
      swatches.appendChild(button);
    });
  }

  function showError() {
    if (loading) loading.style.display = "none";
    if (errorBox) errorBox.hidden = false;
  }
  if (!window.THREE || !window.THREE.GLTFLoader) {
    showError();
    return;
  }

  var renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  } catch (err) {
    showError();
    return;
  }
  // Cap resolution for a steady frame rate; lowered further at runtime if frames run slow.
  var maxPixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
  var pixelRatio = maxPixelRatio;
  renderer.setPixelRatio(pixelRatio);
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  var scene = new THREE.Scene();
  var camera = new THREE.PerspectiveCamera(32, 1, 0.1, 200);
  var pivot = new THREE.Group();
  scene.add(pivot);
  // Night-showroom lighting: cool key, blue fill and a red rim that echoes the LED ring.
  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x0b0f18, 0.95));
  var keyLight = new THREE.DirectionalLight(0xffffff, 1.35);
  keyLight.position.set(5, 10, 8);
  scene.add(keyLight);
  var rimLight = new THREE.DirectionalLight(0xff3b46, 1.1);
  rimLight.position.set(-8, 3, -6);
  scene.add(rimLight);
  var blueLight = new THREE.DirectionalLight(0x7aa8ff, 0.9);
  blueLight.position.set(8, 4, -7);
  scene.add(blueLight);

  // Procedural studio panels create long, premium paint reflections without a remote HDRI.
  var pmrem;
  try {
    var envScene = new THREE.Scene();
    var dome = new THREE.Mesh(
      new THREE.SphereGeometry(50, 32, 16),
      new THREE.MeshBasicMaterial({ color: 0x0c1322, side: THREE.BackSide })
    );
    envScene.add(dome);
    function panel(w, h, x, y, z, brightness) {
      var material = new THREE.MeshBasicMaterial({ color: new THREE.Color(brightness, brightness, brightness), side: THREE.DoubleSide });
      var mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
      mesh.position.set(x, y, z);
      mesh.lookAt(0, 0, 0);
      envScene.add(mesh);
    }
    panel(34, 8, 0, 30, 0, 3.0);
    panel(6, 28, -35, 8, 5, 3.2);
    panel(6, 28, 35, 8, -5, 3.2);
    panel(30, 5, 0, 10, -40, 2.4);
    panel(30, 3, 0, 3, 40, 0.9);
    // A soft red strip and a cool strip give the paint a two-tone showroom reflection.
    (function () {
      var red = new THREE.Mesh(new THREE.PlaneGeometry(40, 2.2), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 0.25, 0.3), side: THREE.DoubleSide }));
      red.position.set(-20, 1, -30); red.lookAt(0, 0, 0); envScene.add(red);
      var blue = new THREE.Mesh(new THREE.PlaneGeometry(40, 2.2), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 0.8, 2.0), side: THREE.DoubleSide }));
      blue.position.set(24, 1, -26); blue.lookAt(0, 0, 0); envScene.add(blue);
    })();
    pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(envScene, 0.03).texture;
    dome.geometry.dispose();
    envScene.traverse(function (obj) {
      if (obj.isMesh) {
        if (obj.geometry) obj.geometry.dispose();
        var materials = Array.isArray(obj.material) ? obj.material : [obj.material];
        materials.forEach(function (material) { if (material && material.dispose) material.dispose(); });
      }
    });
    pmrem.dispose();
  } catch (_) {
    // Direct lighting still provides a useful render if environment-map generation is unavailable.
  }

  // Circular motor-show turntable. It stays centered while the car drives onto it,
  // then rotates in sync with the car for a continuous walk-around presentation.
  var turntable = new THREE.Group();
  scene.add(turntable);
  var plinthMaterial = new THREE.MeshStandardMaterial({ color: 0x05070a, metalness: 0.85, roughness: 0.32 });
  var deckMaterial = new THREE.MeshStandardMaterial({ color: 0x07090d, metalness: 0.35, roughness: 0.55 });
  var brassMaterial = new THREE.MeshStandardMaterial({ color: 0xdfe4ec, metalness: 1, roughness: 0.14, emissive: 0x111520, emissiveIntensity: 0.3 });
  var ledMaterial = new THREE.MeshStandardMaterial({ color: 0xff2a36, emissive: 0xff1e2c, emissiveIntensity: 1.6, metalness: 0.2, roughness: 0.4 });
  function addCylinder(radiusTop, radiusBottom, height, y, material, radialSegments) {
    var mesh = new THREE.Mesh(new THREE.CylinderGeometry(radiusTop, radiusBottom, height, radialSegments || 160, 1, false), material);
    mesh.position.y = y;
    mesh.receiveShadow = false;
    turntable.add(mesh);
    return mesh;
  }
  addCylinder(4.04, 4.17, 0.18, -1.02, plinthMaterial, 160);
  addCylinder(4.025, 4.025, 0.05, -0.93, deckMaterial, 160);
  var outerTrim = new THREE.Mesh(new THREE.TorusGeometry(4.07, 0.022, 10, 180), brassMaterial);
  outerTrim.rotation.x = Math.PI / 2;
  outerTrim.position.y = -0.916;
  turntable.add(outerTrim);
  var innerTrim = new THREE.Mesh(new THREE.TorusGeometry(3.78, 0.018, 8, 160), ledMaterial);
  innerTrim.rotation.x = Math.PI / 2;
  innerTrim.position.y = -0.901;
  turntable.add(innerTrim);
  var lowerTrim = new THREE.Mesh(new THREE.TorusGeometry(4.12, 0.018, 8, 180), brassMaterial);
  lowerTrim.rotation.x = Math.PI / 2;
  lowerTrim.position.y = -0.99;
  turntable.add(lowerTrim);

  // A soft round pool of light grounds the display without adding any hero copy.
  var haloCanvas = document.createElement("canvas");
  haloCanvas.width = haloCanvas.height = 256;
  var haloContext = haloCanvas.getContext("2d");
  if (haloContext) {
    var haloGradient = haloContext.createRadialGradient(128, 128, 22, 128, 128, 124);
    haloGradient.addColorStop(0, "rgba(255,60,70,.30)");
    haloGradient.addColorStop(0.5, "rgba(140,40,70,.14)");
    haloGradient.addColorStop(1, "rgba(60,80,160,0)");
    haloContext.fillStyle = haloGradient;
    haloContext.fillRect(0, 0, 256, 256);
    var halo = new THREE.Mesh(
      new THREE.PlaneGeometry(11.5, 11.5),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(haloCanvas), transparent: true, depthWrite: false, opacity: 0.9 })
    );
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = -1.115;
    scene.add(halo);
  }

  // The hero's driver is a Three.js character in the same scene, not a section-07 overlay.
  var showroomDriver = new THREE.Group();
  var driverSuit = new THREE.MeshStandardMaterial({ color: 0x1b2130, roughness: .74, metalness: .08 });
  var driverTrousers = new THREE.MeshStandardMaterial({ color: 0x121722, roughness: .84, metalness: .04 });
  var driverShirt = new THREE.MeshStandardMaterial({ color: 0xeef1f6, roughness: .82 });
  var driverSkin = new THREE.MeshStandardMaterial({ color: 0xc99070, roughness: .88 });
  var driverHair = new THREE.MeshStandardMaterial({ color: 0x251c19, roughness: .92 });
  var driverShoes = new THREE.MeshStandardMaterial({ color: 0x111417, roughness: .72, metalness: .08 });
  function driverPart(parent, geometry, material, x, y, z) {
    var part = new THREE.Mesh(geometry, material);
    part.position.set(x, y, z);
    parent.add(part);
    return part;
  }
  driverPart(showroomDriver, new THREE.CylinderGeometry(.17, .23, .62, 14), driverSuit, 0, 1.12, 0);
  driverPart(showroomDriver, new THREE.BoxGeometry(.105, .48, .018), driverShirt, 0, 1.13, .188);
  driverPart(showroomDriver, new THREE.CylinderGeometry(.052, .055, .13, 10), driverSkin, 0, 1.48, 0);
  driverPart(showroomDriver, new THREE.SphereGeometry(.13, 16, 12), driverSkin, 0, 1.66, 0);
  var driverHairCap = driverPart(showroomDriver, new THREE.SphereGeometry(.132, 16, 8, 0, Math.PI * 2, 0, Math.PI * .53), driverHair, 0, 1.70, 0);
  driverHairCap.rotation.x = -.08;
  driverPart(showroomDriver, new THREE.ConeGeometry(.038, .29, 4), driverSuit, 0, 1.10, .203);
  var driverDetail = new THREE.MeshStandardMaterial({ color: 0xc3141d, roughness: .6, metalness: .12 });
  driverPart(showroomDriver, new THREE.BoxGeometry(.018, .27, .02), driverDetail, -.075, 1.27, .193).rotation.z = -.22;
  driverPart(showroomDriver, new THREE.BoxGeometry(.018, .27, .02), driverDetail, .075, 1.27, .193).rotation.z = .22;
  var driverLeftArm = new THREE.Group();
  driverLeftArm.position.set(-.205, 1.37, 0);
  showroomDriver.add(driverLeftArm);
  driverPart(driverLeftArm, new THREE.CylinderGeometry(.048, .055, .50, 10), driverSuit, -.015, -.24, 0);
  driverPart(driverLeftArm, new THREE.SphereGeometry(.053, 10, 8), driverSkin, -.03, -.505, .015);
  var driverRightArm = new THREE.Group();
  driverRightArm.position.set(.205, 1.37, 0);
  showroomDriver.add(driverRightArm);
  driverPart(driverRightArm, new THREE.CylinderGeometry(.055, .048, .50, 10), driverSuit, .015, -.24, 0);
  driverPart(driverRightArm, new THREE.SphereGeometry(.053, 10, 8), driverSkin, .03, -.505, .015);
  var driverLeftLeg = new THREE.Group();
  driverLeftLeg.position.set(-.105, .82, 0);
  showroomDriver.add(driverLeftLeg);
  driverPart(driverLeftLeg, new THREE.CylinderGeometry(.065, .052, .72, 10), driverTrousers, 0, -.36, 0);
  driverPart(driverLeftLeg, new THREE.BoxGeometry(.13, .075, .24), driverShoes, 0, -.735, .055);
  var driverRightLeg = new THREE.Group();
  driverRightLeg.position.set(.105, .82, 0);
  showroomDriver.add(driverRightLeg);
  driverPart(driverRightLeg, new THREE.CylinderGeometry(.065, .052, .72, 10), driverTrousers, 0, -.36, 0);
  driverPart(driverRightLeg, new THREE.BoxGeometry(.13, .075, .24), driverShoes, 0, -.735, .055);
  var driverShadow = new THREE.Mesh(new THREE.CircleGeometry(.31, 24), new THREE.MeshBasicMaterial({ color: 0x120e0c, transparent: true, opacity: .24, depthWrite: false }));
  driverShadow.rotation.x = -Math.PI / 2;
  driverShadow.scale.set(1.2, .72, 1);
  driverShadow.position.y = .012;
  showroomDriver.add(driverShadow);
  showroomDriver.visible = false;
  showroomDriver.rotation.y = -.36;
  scene.add(showroomDriver);
  // Keep the host fully framed beside (never on) the turntable. A responsive scale
  // prevents the near-camera figure from being cropped in narrow preview/mobile viewports.
  // The feet stay aligned with the studio floor after scaling.
  var driverScale = 0.58;
  var driverStartX = 2.45, driverEndX = 2.62, driverStartZ = 3.45, driverEndZ = 3.50;
  var driverFloorY = -1.115 - (0.0475 * driverScale);

  var dragging = false;
  var lastX = 0;
  var userRotationOffset = 0;
  var userRotationVelocity = 0;
  var baseYaw = 0.16;
  var spinAngle = 0;
  var modelReady = false;
  var modelErrorReported = false;
  var wheelNodes = [];
  var arrivalStart = 0;
  var arrivalDistance = 9.6;
  var runDuration = reducedMotion ? 1 : 1820;
  var brakeDuration = reducedMotion ? 1 : 440;
  var settleDelay = reducedMotion ? 0 : 640;
  var spinAccelerationDuration = 1850;
  var spinRate = 0.19; // rad/s: roughly one elegant full circuit every 33 seconds.
  var brakingPulse = 0;
  pivot.position.x = reducedMotion ? 0 : arrivalDistance;
  pivot.position.y = 0;

  function fitRenderer() {
    if (!renderer || !canvas) return;
    var rect = canvas.getBoundingClientRect();
    var width = Math.max(1, Math.round(rect.width));
    var height = Math.max(1, Math.round(rect.height));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    var narrow = camera.aspect < 1.12;
    camera.position.set(0, narrow ? 4.8 : 3.6, narrow ? 17.5 : 14.2);
    camera.lookAt(0, -0.2, 0);
    // On wide screens the car sits right of centre so the headline has room on the left.
    if (!narrow && window.innerWidth > 980) camera.setViewOffset(width, height, -Math.round(width * (camera.aspect > 1.45 ? 0.15 : 0.09)), Math.round(height * 0.03), width, height);
    else camera.clearViewOffset();
    driverScale = narrow ? 0.58 : 0.72;
    showroomDriver.scale.setScalar(driverScale);
    driverFloorY = -1.115 - (0.0475 * driverScale);
    // Move the character slightly farther back and laterally outward. The final
    // path remains outside the 4.17-unit platform radius but inside the hero frame.
    driverStartX = narrow ? 2.45 : 2.78;
    driverEndX = narrow ? 2.62 : 2.96;
    driverStartZ = narrow ? 3.45 : 3.15;
    driverEndZ = narrow ? 3.50 : 3.22;
    showroomDriver.position.set(driverStartX, driverFloorY, driverStartZ);
  }
  window.addEventListener("resize", fitRenderer, { passive: true });
  if ("ResizeObserver" in window) {
    var resizeObserver = new ResizeObserver(fitRenderer);
    resizeObserver.observe(canvas);
  }
  fitRenderer();

  canvas.addEventListener("pointerdown", function (event) {
    dragging = true;
    userRotationVelocity = 0;
    lastX = event.clientX;
    if (canvas.setPointerCapture) {
      try { canvas.setPointerCapture(event.pointerId); } catch (_) { }
    }
  });
  canvas.addEventListener("pointermove", function (event) {
    if (!dragging) return;
    var delta = event.clientX - lastX;
    userRotationVelocity = delta * 0.0075;
    userRotationOffset += userRotationVelocity;
    lastX = event.clientX;
  });
  function endDrag() { dragging = false; }
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  canvas.addEventListener("lostpointercapture", endDrag);

  function normalizeModel(car) {
    car.traverse(function (object) {
      if (/^(FR|FL|RL|RR)$/.test(object.name || "") && object.children && object.children.length) {
        wheelNodes.push(object);
      }
      if (!object.isMesh) return;
      var materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach(function (material) {
        if (!material) return;
        if (material.name === "Paint_Geo") {
          // Upgrade the body paint to a clear-coated metallic finish.
          var paint = material;
          if (THREE.MeshPhysicalMaterial && !material.isMeshPhysicalMaterial) {
            paint = new THREE.MeshPhysicalMaterial({ name: "Paint_Geo", map: material.map || null, normalMap: material.normalMap || null, side: material.side });
            if (Array.isArray(object.material)) object.material[object.material.indexOf(material)] = paint; else object.material = paint;
            if (material.dispose) material.dispose();
          }
          // Paint hex values are sRGB; convert so the rendered red matches the chosen colour.
          if (paint.color) paint.color.set(PAINTS[0][1]).convertSRGBToLinear();
          paint.roughness = 0.32;
          paint.metalness = 0.42;
          if ("clearcoat" in paint) { paint.clearcoat = 1; paint.clearcoatRoughness = 0.07; }
          paint.envMapIntensity = 1.0;
          paint.needsUpdate = true;
          paintMaterials.push(paint);
          return;
        }
        if (material.name === "Window_Geo") {
          material.transparent = true;
          material.opacity = 0.35;
          material.depthWrite = false;
        }
        if ("envMapIntensity" in material) material.envMapIntensity = 1.1;
        material.needsUpdate = true;
      });
      object.castShadow = false;
      object.receiveShadow = false;
    });

    var bounds = new THREE.Box3().setFromObject(car);
    var size = bounds.getSize(new THREE.Vector3());
    var center = bounds.getCenter(new THREE.Vector3());
    var scale = 6.1 / Math.max(size.x, size.z);
    car.scale.setScalar(scale);
    car.position.set(-center.x * scale, -bounds.min.y * scale - 0.9, -center.z * scale);
    pivot.add(car);
  }

  async function loadModel() {
    try {
      if (!("DecompressionStream" in window)) throw new Error("This browser does not support compressed 3D model decoding.");
      var modelUrl = canvas.getAttribute("data-model-url") || "assets/models/2025-aston-martin-vanquish-volante-model.bin";
      var response = await fetch(modelUrl, { cache: "force-cache" });
      if (!response.ok) throw new Error("3D model asset returned HTTP " + response.status);
      var compressed = new Uint8Array(await response.arrayBuffer());
      var stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("gzip"));
      var buffer = await new Response(stream).arrayBuffer();
      var gltf = await new Promise(function (resolve, reject) {
        new THREE.GLTFLoader().parse(buffer, "", resolve, reject);
      });
      normalizeModel(gltf.scene);
      // Warm-up: compile every shader and upload every texture off-screen before the car
      // appears, so the drive-in never stalls on its first visible frames.
      try {
        pivot.position.set(0, 0, 0);
        renderer.compile(scene, camera);
        var warmTarget = new THREE.WebGLRenderTarget(256, 160);
        renderer.setRenderTarget(warmTarget);
        renderer.render(scene, camera);
        renderer.setRenderTarget(null);
        warmTarget.dispose();
      } catch (_) { renderer.setRenderTarget(null); }
      pivot.position.x = reducedMotion ? 0 : arrivalDistance;
      await new Promise(function (resolve) { requestAnimationFrame(function () { requestAnimationFrame(resolve); }); });
      animTime = 0;
      pivot.position.x = reducedMotion ? 0 : arrivalDistance;
      pivot.position.y = 0;
      turntable.rotation.y = 0;
      spinAngle = 0;
      baseYaw = reducedMotion ? 0.64 : 0.16;
      modelReady = true;
      if (loading) {
        loading.style.opacity = "0";
        window.setTimeout(function () { if (loading && loading.parentNode) loading.parentNode.removeChild(loading); }, 500);
      }
      if (reducedMotion) {
        pivot.position.x = 0;
        pivot.rotation.y = 0.64;
        turntable.rotation.y = 0;
      }
    } catch (error) {
      if (!modelErrorReported) {
        modelErrorReported = true;
        showError();
        if (window.console && console.warn) console.warn("Halcyon 3D model failed to load.", error);
      }
    }
  }
  loadModel();

  var frameId = 0;
  var lastFrameTime = 0;
  var animTime = 0;          // animation clock that never jumps after a slow frame
  var slowFrames = 0, sampleFrames = 0;
  // Pause the WebGL loop while the hero is scrolled out of view to keep the page smooth.
  var heroInView = true;
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (entries) { heroInView = entries[0].isIntersecting; }, { rootMargin: "80px 0px" }).observe(canvas);
  }
  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
  function tick(now) {
    frameId = window.requestAnimationFrame(tick);
    if (!renderer || !heroInView) { lastFrameTime = 0; return; }
    var rawDelta = lastFrameTime ? Math.max(0, (now - lastFrameTime) / 1000) : 0;
    var deltaSeconds = Math.min(1 / 30, rawDelta);
    lastFrameTime = now;
    // Adaptive resolution: if frames are consistently slow, render fewer pixels.
    if (rawDelta) {
      sampleFrames++; if (rawDelta > 0.026) slowFrames++;
      if (sampleFrames >= 90) {
        if (slowFrames > 45 && pixelRatio > 1) { pixelRatio = Math.max(1, pixelRatio - 0.25); renderer.setPixelRatio(pixelRatio); fitRenderer(); }
        sampleFrames = 0; slowFrames = 0;
      }
    }
    if (modelReady) {
      var previousCarX = pivot.position.x;
      animTime += deltaSeconds * 1000;
      var elapsed = reducedMotion ? runDuration + brakeDuration + settleDelay + spinAccelerationDuration : animTime;
      brakingPulse = 0;
      if (reducedMotion) {
        pivot.position.x = 0;
        pivot.position.y = 0;
        pivot.rotation.z = 0;
        baseYaw = 0.64;
        spinAngle = 0;
        turntable.rotation.y = 0;
      } else if (elapsed < runDuration) {
        // Accelerating arrival from beyond the right edge, never scaling the vehicle.
        var runT = Math.max(0, Math.min(1, elapsed / runDuration));
        var accelEase = runT * runT * runT;
        pivot.position.x = arrivalDistance * (1 - 0.947 * accelEase);
        baseYaw = 0.16 + (0.64 - 0.16) * easeOutCubic(runT);
        pivot.position.y = 0;
        pivot.rotation.z = 0;
        spinAngle = 0;
        turntable.rotation.y = 0;
      } else if (elapsed < runDuration + brakeDuration) {
        // Short, forceful braking phase: quick deceleration, a restrained overshoot,
        // and visible nose dip before the car settles onto the circular display.
        var brakeT = Math.max(0, Math.min(1, (elapsed - runDuration) / brakeDuration));
        var brakeEase = easeOutCubic(brakeT);
        var approachRemainder = arrivalDistance * (1 - 0.947);
        pivot.position.x = approachRemainder * (1 - brakeEase) - 0.13 * Math.sin(Math.PI * brakeT);
        brakingPulse = Math.sin(Math.PI * brakeT);
        pivot.position.y = 0.045 * brakingPulse;
        pivot.rotation.z = 0.025 * brakingPulse;
        baseYaw = 0.64;
        spinAngle = 0;
        turntable.rotation.y = 0;
      } else {
        pivot.position.x = 0;
        pivot.position.y = 0;
        pivot.rotation.z = 0;
        baseYaw = 0.64;
        var spinElapsed = Math.max(0, elapsed - runDuration - brakeDuration - settleDelay);
        if (spinElapsed <= spinAccelerationDuration) {
          var spinT = spinElapsed / spinAccelerationDuration;
          spinAngle = spinRate * (spinElapsed / 1000) * (spinT * 0.5);
        } else {
          spinAngle = spinRate * (spinAccelerationDuration / 2000) + spinRate * ((spinElapsed - spinAccelerationDuration) / 1000);
        }
        turntable.rotation.y = spinAngle;
      }

      // The host is placed and kept on the studio floor outside the platform rim.
      // His short step finishes farther from the circle; only the car and table rotate.
      if (reducedMotion) {
        showroomDriver.visible = true;
        showroomDriver.position.set(driverEndX, driverFloorY, driverEndZ);
      } else {
        var driverWalkStart = runDuration + brakeDuration + settleDelay + 180;
        if (elapsed >= driverWalkStart) {
          showroomDriver.visible = true;
          var walkProgress = Math.max(0, Math.min(1, (elapsed - driverWalkStart) / 1280));
          var walkEase = easeOutCubic(walkProgress);
          var stride = Math.sin(walkProgress * Math.PI * 4) * (1 - walkProgress) * .48;
          showroomDriver.position.set(driverStartX + (driverEndX - driverStartX) * walkEase, driverFloorY, driverStartZ + (driverEndZ - driverStartZ) * walkEase);
          driverLeftLeg.rotation.z = stride;
          driverRightLeg.rotation.z = -stride;
          driverLeftArm.rotation.z = -stride * .58;
          driverRightArm.rotation.z = stride * .58;
        } else {
          showroomDriver.visible = false;
        }
      }

      // Apply manual drag as an offset while the car continues to follow the display.
      if (!dragging && Math.abs(userRotationVelocity) > 0.0001) {
        userRotationOffset += userRotationVelocity;
        userRotationVelocity *= 0.94;
      }
      pivot.rotation.y = baseYaw + spinAngle + userRotationOffset;
      // Roll the four wheel assemblies as the car travels onto the display.
      var travelled = previousCarX - pivot.position.x;
      if (Math.abs(travelled) > 0.00001) {
        wheelNodes.forEach(function (wheel) { wheel.rotation.x += travelled * 1.7; });
      }
      // Small camera jolt at the brake point emphasizes the physical stop.
      camera.position.y = (camera.aspect < 1.12 ? 4.8 : 3.6) - 0.075 * brakingPulse;
    }
    ledMaterial.emissiveIntensity = 1.25 + Math.sin(now / 700) * 0.45 + brakingPulse * 1.2;
    renderer.render(scene, camera);
  }
  frameId = window.requestAnimationFrame(tick);
  window.addEventListener("pagehide", function () {
    if (frameId) window.cancelAnimationFrame(frameId);
    if (renderer) renderer.dispose();
  }, { once: true });
})();
