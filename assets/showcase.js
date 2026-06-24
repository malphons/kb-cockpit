// ---------------------------------------------------------------------------
// kb-cockpit — showcase.js  (ES module)
// Single-exoplanet 3D showcase: star/planet selector → procedural-by-regime
// planet hero + to-scale orbit system view, with a detectability HUD driven by
// real xo_* data and the derivations in exo.js.
// Globals (kbAuth, kbFetch, kbFetchAll, renderHeader, renderFooter, wireSignOut,
// errorNotice, esc) come from the classic scripts loaded before this module.
// ---------------------------------------------------------------------------
import * as THREE from "three";
import { OrbitControls } from "./vendor/OrbitControls.js";
import { deriveAll, C } from "./exo.js";
import { fetchAnnotations, fetchDbConfidence, openAnnotationEditor, userConfDot, dbConfBadge, renderLinks } from "./annotations.js";

let LIST = [];                 // lightweight planet rows for the selector
let CURRENT = null;            // selected planet_id
let viz = null;               // the three.js controller
let CUR = null;                // { p, s, d, annot:{list,byParam}, dbConf } for the selected planet

// ---- small utilities --------------------------------------------------------
function hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// Approximate blackbody RGB (Tanner Helland), Teff in K → THREE.Color.
function blackbody(T) {
  T = Math.max(1000, Math.min(40000, T || 5772)) / 100;
  let r, g, b;
  if (T <= 66) { r = 255; g = 99.47 * Math.log(T) - 161.12; }
  else { r = 329.7 * Math.pow(T - 60, -0.1332); g = 288.12 * Math.pow(T - 60, -0.0755); }
  if (T >= 66) b = 255;
  else if (T <= 19) b = 0;
  else b = 138.52 * Math.log(T - 10) - 305.04;
  const cl = x => Math.max(0, Math.min(255, x)) / 255;
  return new THREE.Color(cl(r), cl(g), cl(b));
}

// Temperature tint for a planet surface: cold→blue, warm→orange/red.
function tempTint(Teq) {
  if (Teq == null) return new THREE.Color(0.8, 0.82, 0.85);
  const t = Math.max(0, Math.min(1, (Teq - 150) / 1400));
  return new THREE.Color().setHSL((1 - t) * 0.62, 0.55, 0.5); // 0.62≈blue → 0≈red
}

function regimeKind(regime) {
  const r = (regime || "").toLowerCase();
  if (/jupiter|saturn|gas|hot-?(jupiter|saturn)/.test(r)) return "gas";
  if (/hycean/.test(r)) return "hycean";
  if (/neptune/.test(r)) return "neptune";
  if (/terrestrial|rocky|earth|mars|venus|super-?earth|sub-?earth/.test(r)) return "rocky";
  return "neptune";
}

// Procedural surface texture on a canvas, deterministic per planet.
function planetTexture(planet) {
  const W = 512, H = 256, cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d");
  const rnd = mulberry32(hash(planet.planet_id || planet.name || "x"));
  const kind = regimeKind(planet.regime_class);
  const tint = tempTint(planet.equilibrium_temp_k);
  const base = tint.clone();
  const hsl = {}; base.getHSL(hsl);

  if (kind === "gas" || kind === "neptune" || kind === "hycean") {
    // horizontal banding
    for (let y = 0; y < H; y++) {
      const band = Math.sin(y * (kind === "gas" ? 0.16 : 0.07) + rnd() * 6) * 0.5 + 0.5;
      const noise = (rnd() - 0.5) * (kind === "gas" ? 0.10 : 0.05);
      const l = Math.max(0.12, Math.min(0.82, hsl.l + (band - 0.5) * (kind === "gas" ? 0.34 : 0.18) + noise));
      const s = kind === "hycean" ? Math.min(0.8, hsl.s + 0.15) : hsl.s;
      ctx.fillStyle = `hsl(${hsl.h * 360},${s * 100}%,${l * 100}%)`;
      ctx.fillRect(0, y, W, 1);
    }
  } else {
    // rocky: base + blobby "continents"
    ctx.fillStyle = `hsl(${hsl.h * 360},${hsl.s * 70}%,${Math.max(14, hsl.l * 60)}%)`;
    ctx.fillRect(0, 0, W, H);
    const blobs = 90;
    for (let i = 0; i < blobs; i++) {
      const x = rnd() * W, y = rnd() * H, r = 6 + rnd() * 34;
      const l = Math.max(0.18, Math.min(0.7, hsl.l + (rnd() - 0.4) * 0.5));
      ctx.fillStyle = `hsla(${(hsl.h * 360 + (rnd() - 0.5) * 30)},${(40 + rnd() * 40)}%,${l * 100}%,0.5)`;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Visual radius for the planet (compressed log of physical radius).
function planetVizRadius(Rearth) {
  const R = (typeof Rearth === "number" && Rearth > 0) ? Rearth : 1;
  return Math.max(0.6, Math.min(2.6, 0.8 * Math.cbrt(R)));
}

// ---- number formatting for derived records ---------------------------------
function fmtNum(v) {
  if (v == null || !isFinite(v)) return "—";
  const a = Math.abs(v);
  if (a >= 1e4 || (a > 0 && a < 1e-3)) return v.toExponential(2);
  if (a >= 1000) return Math.round(v).toLocaleString();
  if (a >= 100) return v.toFixed(1);
  if (a >= 10) return v.toFixed(2);
  return v.toFixed(3);
}
function vrec(rec) {
  if (!rec || rec.value == null) return `<span class="v">—</span>`;
  const u = rec.unit ? `<span class="sc-u">${esc(rec.unit)}</span>` : "";
  const txt = fmtNum(rec.value);
  if (rec.derived) return `<span class="v"><span class="sc-d" title="derived — ${esc(rec.note || "computed")}">≈${txt}</span>${u}</span>`;
  return `<span class="v">${txt}${u}</span>`;
}
function row(k, rec) { return `<div class="sc-row"><span class="k">${k}</span>${vrec(rec)}</div>`; }
function rowRaw(k, html) { return `<div class="sc-row"><span class="k">${k}</span><span class="v">${html}</span></div>`; }

// ---- data -------------------------------------------------------------------
async function loadList() {
  LIST = await kbFetchAll(
    "xo_planets?select=planet_id,name,host_star_id,radius_rearth,equilibrium_temp_k,regime_class,hz_position&order=name");
}
async function loadDetail(id) {
  const rows = await kbFetch(`xo_planets?planet_id=eq.${encodeURIComponent(id)}&select=*,host:xo_stars(*)&limit=1`);
  return rows && rows[0];
}

// ---- selector ---------------------------------------------------------------
function regimeOptions() {
  const set = new Set();
  LIST.forEach(p => { if (p.regime_class) set.add(p.regime_class); });
  return [...set].sort();
}
function filtered() {
  const q = (document.getElementById("sc-q").value || "").trim().toLowerCase();
  const reg = document.getElementById("sc-regime").value;
  const hz = document.getElementById("sc-hz").value;
  return LIST.filter(p =>
    (!q || (p.name || p.planet_id).toLowerCase().includes(q) || (p.host_star_id || "").toLowerCase().includes(q)) &&
    (!reg || p.regime_class === reg) &&
    (!hz || p.hz_position === hz));
}
function renderList() {
  const rows = filtered();
  const cap = 300;
  const shown = rows.slice(0, cap);
  document.getElementById("sc-count").textContent =
    `${rows.length.toLocaleString()} planet${rows.length === 1 ? "" : "s"}${rows.length > cap ? ` · showing ${cap}` : ""}`;
  document.getElementById("sc-list").innerHTML = shown.map(p => {
    const t = p.equilibrium_temp_k ? `${Math.round(p.equilibrium_temp_k)} K` : (p.regime_class || "");
    return `<div class="sc-item${p.planet_id === CURRENT ? " active" : ""}" data-id="${esc(p.planet_id)}">${esc(p.name || p.planet_id)}<span class="sub">${esc(t)}</span></div>`;
  }).join("") || `<p class="muted">No planets match.</p>`;
}

// ---- HUD --------------------------------------------------------------------
// inner value HTML for a derived record (no wrapping span)
function valHtml(rec) {
  if (!rec || rec.value == null) return "—";
  const u = rec.unit ? `<span class="sc-u">${esc(rec.unit)}</span>` : "";
  const t = fmtNum(rec.value);
  return rec.derived ? `<span class="sc-d" title="derived — ${esc(rec.note || "computed")}">≈${t}</span>${u}` : `${t}${u}`;
}
// A taggable HUD row: value + DB confidence badge + your-confidence dot + links + tag button.
// key = stable annotation parameter; dbParam = matching xo_canonical_facts parameter (optional).
function tag(key, label, inner, dbParam) {
  const a = CUR && CUR.annot.byParam[key];
  const dbc = dbParam && CUR && CUR.dbConf[dbParam];
  const badge = dbc ? dbConfBadge(dbc.confidence_class) : "";
  const dot = a && a.confidence ? userConfDot(a.confidence) : "";
  const links = (a && a.links && a.links.length) ? `<div class="sc-links">${renderLinks(a.links)}</div>` : "";
  return `<div class="sc-row${a ? " has-anno" : ""}"><span class="k">${label}</span><span class="v">${inner}${badge}${dot}` +
    ` <button class="an-tag-btn" data-key="${esc(key)}" data-label="${esc(label)}" title="Tag / note / link">🏷</button></span>${links}</div>`;
}

function renderHud() {
  const { p, s, d } = CUR; const star = s || {};
  const planetAnno = CUR.annot.byParam[""];
  const noteBtn = `<button class="an-tag-btn sc-notebtn" data-key="" data-label="Planet note" title="Note on this planet">📝 Note${planetAnno ? userConfDot(planetAnno.confidence) : ""}</button>`;
  document.getElementById("sc-title").innerHTML =
    `<div class="nm">${esc(p.name || p.planet_id)}</div><div class="rg">${esc(p.regime_class || "—")}${star.name ? " · " + esc(star.name) : ""}</div>${noteBtn}`;

  document.getElementById("sc-id").innerHTML = `<h4>Identity</h4>` +
    tag("host_star", "Host star", esc(star.name || p.host_star_id || "—")) +
    rowRaw("Spectral type", esc(star.spectral_type || "—")) +
    rowRaw("Distance", star.distance_pc != null ? `${fmtNum(star.distance_pc)}<span class="sc-u">pc</span>` : "—") +
    tag("discovery", "Discovered", esc((p.discovery_year || "—") + (p.discovery_method ? " · " + p.discovery_method : "")), "discovery_method") +
    rowRaw("HZ position", esc(p.hz_position || "—"));

  document.getElementById("sc-phys").innerHTML = `<h4>Physical</h4>` +
    tag("radius_rearth", "Radius", p.radius_rearth != null ? `${fmtNum(p.radius_rearth)}<span class="sc-u">R⊕</span>` : "—", "radius_rearth") +
    tag("mass_mearth", "Mass", p.mass_mearth != null ? `${fmtNum(p.mass_mearth)}<span class="sc-u">M⊕</span>` : "—", "mass_mearth") +
    tag("density_gcc", "Density", valHtml(d.density), "density_gcc") +
    tag("gravity", "Gravity", valHtml(d.gravity)) +
    tag("equilibrium_temp_k", "Eq. temp", valHtml(d.eqTemp), "equilibrium_temp_k") +
    tag("insolation", "Insolation", valHtml(d.insolation)) +
    tag("orbital_period_days", "Orbital period", p.orbital_period_days != null ? `${fmtNum(p.orbital_period_days)}<span class="sc-u">d</span>` : "—", "orbital_period_days") +
    tag("semi_major_axis", "Semi-major axis", valHtml(d.semiMajorAxis));

  document.getElementById("sc-det").innerHTML = `<h4>Detectability</h4>` +
    tag("scale_height", "Scale height", valHtml(d.scaleHeight)) +
    tag("transit_depth", "Transit depth", valHtml(d.transitDepth)) +
    tag("transmission", "Transmission Δδ", valHtml(d.transmissionSignal)) +
    tag("tsm", "TSM", valHtml(d.tsm)) +
    tag("esm", "ESM", valHtml(d.esm)) +
    tag("escape_velocity", "Escape vel.", valHtml(d.escapeVelocity));

  const note = planetAnno && planetAnno.body ? `<div class="sc-row" style="line-height:1.4"><span class="k" style="text-align:left">${esc(planetAnno.body)}</span></div>` + (planetAnno.links && planetAnno.links.length ? `<div class="sc-links">${renderLinks(planetAnno.links)}</div>` : "") : "";
  document.getElementById("sc-conf").innerHTML = `<h4>Notes &amp; provenance</h4>` + note +
    `<div class="sc-row" style="line-height:1.4"><span class="k" style="text-align:left">Badges = DB provenance confidence; dots = your rating. <span class="sc-d" title="model-based">≈ marks derived metrics</span>. Click 🏷 to tag any value.</span></div>`;
}

// ===========================================================================
// three.js controller
// ===========================================================================
function makeViz(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 5000);
  camera.position.set(0, 0, 6);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.enablePan = false;

  scene.add(new THREE.AmbientLight(0x33405a, 0.5));
  const starLight = new THREE.PointLight(0xffffff, 2.4, 0, 0);
  starLight.position.set(-6, 2, 4);
  scene.add(starLight);

  // starfield (ported distribution: isotropic shell, 3 size classes)
  scene.add(makeStarfield());

  const planetGroup = new THREE.Group();   // hero view
  const systemGroup = new THREE.Group();   // orbit view
  systemGroup.visible = false;
  scene.add(planetGroup, systemGroup);

  let planetMesh = null, planetSpin = 0.0025;
  let orbit = null;                          // { planet, angle, e, a, b, cx, speed }

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  window.addEventListener("resize", resize);

  function clear(group) { while (group.children.length) { const o = group.children.pop(); o.geometry?.dispose?.(); o.material?.dispose?.(); } }

  function load(p, s, d) {
    // ----- hero planet -----
    clear(planetGroup); planetMesh = null;
    const PR = planetVizRadius(p.radius_rearth);
    const tex = planetTexture(p);
    planetMesh = new THREE.Mesh(
      new THREE.SphereGeometry(PR, 64, 48),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, metalness: 0.0 }));
    planetGroup.add(planetMesh);

    // atmosphere: 4 additive back-side shells; opacity scales with scale height
    const H = d.scaleHeight.value;            // km
    const strength = H == null ? 0.5 : Math.max(0.35, Math.min(1.6, Math.log10(H + 10) / 2));
    const atmoCol = regimeKind(p.regime_class) === "rocky"
      ? new THREE.Color(0.55, 0.72, 1.0) : tempTint(p.equilibrium_temp_k).lerp(new THREE.Color(1, 1, 1), 0.3);
    const shells = [1.04, 1.08, 1.13, 1.19], alphas = [0.12, 0.08, 0.05, 0.03];
    shells.forEach((sc, i) => {
      planetGroup.add(new THREE.Mesh(
        new THREE.SphereGeometry(PR * sc, 48, 32),
        new THREE.MeshBasicMaterial({ color: atmoCol, transparent: true, opacity: alphas[i] * strength * 2.2,
          side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false })));
    });

    // ----- system / orbit view -----
    clear(systemGroup); orbit = null;
    const SR = Math.max(0.3, Math.min(2.6, 0.7 * Math.sqrt(s && s.radius_rsun ? s.radius_rsun : 0.3) + 0.25));
    const starCol = blackbody(s && s.teff_k);
    const starMesh = new THREE.Mesh(new THREE.SphereGeometry(SR, 48, 32),
      new THREE.MeshBasicMaterial({ color: starCol }));
    systemGroup.add(starMesh);
    const glow = new THREE.Mesh(new THREE.SphereGeometry(SR * 1.25, 32, 24),
      new THREE.MeshBasicMaterial({ color: starCol, transparent: true, opacity: 0.18, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    systemGroup.add(glow);

    const aAU = d.semiMajorAxis.value;
    const e = (typeof p.eccentricity === "number" ? p.eccentricity : 0) || 0;
    const aVis = SR + 1.6 + (aAU != null ? Math.min(4, Math.max(0, Math.log10(aAU * 50 + 1) * 1.6)) : 1.5);
    const bVis = aVis * Math.sqrt(1 - e * e);
    const cx = aVis * e; // focus offset (star at focus)
    const pr = Math.max(0.05, Math.min(0.5, SR * ((p.radius_rearth ? p.radius_rearth * C.R_earth : C.R_earth) / ((s && s.radius_rsun ? s.radius_rsun : 0.3) * C.R_sun)) * 9));
    const pMesh = new THREE.Mesh(new THREE.SphereGeometry(pr, 32, 24),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }));
    systemGroup.add(pMesh);

    const curve = new THREE.EllipseCurve(-cx, 0, aVis, bVis, 0, Math.PI * 2, false, 0);
    const pts = curve.getPoints(180).map(pt => new THREE.Vector3(pt.x, 0, pt.y));
    systemGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: 0x3a4759 })));
    orbit = { planet: pMesh, angle: 0, e, a: aVis, b: bVis, cx, speed: 0.01 };

    fit(PR * 1.25);
    setView(currentView, true);
  }

  function fit(radius) {
    const d = radius / Math.tan((camera.fov * Math.PI / 180) / 2) * 1.5;
    camera.position.set(0, radius * 0.15, d);
    controls.target.set(0, 0, 0); controls.update();
  }

  let currentView = "planet";
  function setView(v, keepCam) {
    currentView = v;
    planetGroup.visible = v === "planet";
    systemGroup.visible = v === "system";
    if (!keepCam) {
      if (v === "planet" && planetMesh) fit(planetMesh.geometry.parameters.radius * 1.25);
      else fit(orbit ? orbit.a * 1.3 : 4);
    } else if (v === "system" && orbit) {
      fit(orbit.a * 1.3);
    }
  }

  function tick() {
    requestAnimationFrame(tick);
    if (planetMesh && planetGroup.visible) planetMesh.rotation.y += planetSpin;
    if (orbit && systemGroup.visible) {
      orbit.angle += orbit.speed;
      const x = -orbit.cx + orbit.a * Math.cos(orbit.angle);
      const z = orbit.b * Math.sin(orbit.angle);
      orbit.planet.position.set(x, 0, z);
      orbit.planet.rotation.y += 0.01;
    }
    controls.update();
    renderer.render(scene, camera);
  }
  resize(); tick();
  return { load, setView, resize };
}

function makeStarfield() {
  const n = 2500, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const v = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    const r = 60 + Math.random() * 240;
    pos[i * 3] = v.x * r; pos[i * 3 + 1] = v.y * r; pos[i * 3 + 2] = v.z * r;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  return new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 0.6, sizeAttenuation: true }));
}

// ---- selection orchestration ------------------------------------------------
async function select(id) {
  CURRENT = id;
  document.querySelectorAll(".sc-item").forEach(el => el.classList.toggle("active", el.dataset.id === id));
  const detail = await loadDetail(id);
  if (!detail) return;
  const star = detail.host || null;
  const d = deriveAll(detail, star);
  const [annot, dbConf] = await Promise.all([fetchAnnotations(id), fetchDbConfidence(id)]);
  CUR = { p: detail, s: star, d, annot, dbConf };
  document.getElementById("sc-empty").style.display = "none";
  renderHud();
  viz.load(detail, star, d);
}

// Open the annotation editor for whatever 🏷 / 📝 button was clicked.
async function openTag(key, label) {
  if (!CUR) return;
  openAnnotationEditor({
    entityId: CUR.p.planet_id, parameter: key, label,
    existing: CUR.annot.byParam[key],
    onSaved: async () => { CUR.annot = await fetchAnnotations(CUR.p.planet_id); renderHud(); }
  });
}

// ---- boot -------------------------------------------------------------------
function ui(user) {
  mount(renderHeader("showcase.html", user) + `<div class="sc-wrap">
    <div class="sc-side">
      <input id="sc-q" class="search" type="search" placeholder="Search planet or star…" autocomplete="off">
      <div class="sc-filters">
        <select id="sc-regime"><option value="">All regimes</option></select>
        <select id="sc-hz">
          <option value="">Any HZ</option>
          <option value="habitable">Habitable</option>
          <option value="inner_edge">Inner edge</option>
          <option value="outer_edge">Outer edge</option>
          <option value="not_in_hz">Not in HZ</option>
        </select>
      </div>
      <div class="sc-count" id="sc-count">—</div>
      <div class="sc-list" id="sc-list"></div>
    </div>
    <div class="sc-stage">
      <canvas id="sc-canvas"></canvas>
      <div class="sc-title" id="sc-title"></div>
      <div class="sc-hud sc-id" id="sc-id"></div>
      <div class="sc-hud sc-phys" id="sc-phys"></div>
      <div class="sc-hud sc-det" id="sc-det"></div>
      <div class="sc-hud sc-conf" id="sc-conf"></div>
      <div class="sc-toggle">
        <button id="sc-v-planet" class="active">Planet</button>
        <button id="sc-v-system">System</button>
      </div>
      <div class="sc-empty" id="sc-empty">Select a planet to begin.</div>
      <div class="sc-foot">System view is schematic — sizes relative, distances compressed.</div>
    </div>
  </div>`);
  wireSignOut();

  document.getElementById("sc-regime").innerHTML =
    `<option value="">All regimes</option>` + regimeOptions().map(r => `<option value="${esc(r)}">${esc(r)}</option>`).join("");

  viz = makeViz(document.getElementById("sc-canvas"));

  const reflow = () => renderList();
  document.getElementById("sc-q").addEventListener("input", reflow);
  document.getElementById("sc-regime").addEventListener("change", reflow);
  document.getElementById("sc-hz").addEventListener("change", reflow);
  document.getElementById("sc-list").addEventListener("click", e => {
    const it = e.target.closest(".sc-item"); if (it) select(it.dataset.id);
  });
  // tag / note buttons in the HUD (delegated)
  document.addEventListener("click", e => {
    const b = e.target.closest(".an-tag-btn"); if (!b) return;
    openTag(b.dataset.key || "", b.dataset.label || "Planet note");
  });
  document.getElementById("sc-v-planet").addEventListener("click", () => {
    viz.setView("planet"); document.getElementById("sc-v-planet").classList.add("active"); document.getElementById("sc-v-system").classList.remove("active");
  });
  document.getElementById("sc-v-system").addEventListener("click", () => {
    viz.setView("system"); document.getElementById("sc-v-system").classList.add("active"); document.getElementById("sc-v-planet").classList.remove("active");
  });

  renderList();
  // default selection: a well-populated stress-test planet if present
  const def = LIST.find(p => p.planet_id === "wasp-39b") || LIST.find(p => p.planet_id === "k2-18b") || LIST[0];
  if (def) select(def.planet_id);
}

window.kbAuth.requireOwner({
  onReady: async (user) => {
    try {
      await loadList();
      ui(user);
      // canvas needs a resize once it has real layout dimensions
      requestAnimationFrame(() => viz && viz.resize());
    } catch (err) {
      mount(renderHeader("showcase.html", user) + `<main>${errorNotice(err)}</main>` + renderFooter());
      wireSignOut();
    }
  }
});
