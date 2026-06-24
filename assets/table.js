// ---------------------------------------------------------------------------
// kb-cockpit — table.js  (ES module)
// Sortable / filterable table over all exoplanets with derived detectability
// columns (scale height, TSM), a DB-confidence column, and an inline per-planet
// note (annotation) affordance. Globals kbFetch/kbFetchAll/esc/fmt/renderHeader/
// renderFooter/wireSignOut/errorNotice/mount from app.js.
// ---------------------------------------------------------------------------
import { scaleHeight, tsm } from "./exo.js";
import { openAnnotationEditor, fetchAnnotations, fetchAnnotationIndex, dbConfBadge } from "./annotations.js";

let ROWS = [];                 // augmented planet rows
let ANNO = {};                 // entity_id -> annotation count
let sort = { key: "name", dir: 1 };
let page = 0;
const PAGE = 100;

const COLS = [
  { key: "name", label: "Planet", type: "s" },
  { key: "host_star_id", label: "Host", type: "s" },
  { key: "regime_class", label: "Regime", type: "s" },
  { key: "radius_rearth", label: "R⊕", type: "n" },
  { key: "mass_mearth", label: "M⊕", type: "n" },
  { key: "equilibrium_temp_k", label: "T_eq (K)", type: "n" },
  { key: "_H", label: "Scale H (km)", type: "n", derived: true },
  { key: "_tsm", label: "TSM", type: "n", derived: true },
  { key: "_conf", label: "Confidence", type: "s" },
  { key: "_notes", label: "Notes", type: "n" },
];

async function load() {
  const [planets, stars, facts, annoIdx] = await Promise.all([
    kbFetchAll("xo_planets?select=planet_id,name,host_star_id,regime_class,hz_position,radius_rearth,mass_mearth,equilibrium_temp_k,orbital_period_days,eccentricity,density_gcc&order=name"),
    kbFetchAll("xo_stars?select=star_id,teff_k,radius_rsun,mass_msun,magnitude_k,spectral_type,distance_pc&order=star_id"),
    kbFetch("xo_canonical_facts?entity_type=eq.planet&select=entity_id,confidence_class"),
    fetchAnnotationIndex(),
  ]);
  const starMap = {}; (stars || []).forEach(s => { starMap[s.star_id] = s; });
  const confMap = {}; (facts || []).forEach(f => { if (!confMap[f.entity_id]) confMap[f.entity_id] = f.confidence_class; });
  ANNO = annoIdx || {};
  ROWS = (planets || []).map(p => {
    const s = starMap[p.host_star_id] || null;
    return {
      ...p, _star: s,
      _H: scaleHeight(p, s).value,
      _tsm: tsm(p, s).value,
      _conf: confMap[p.planet_id] || null,
      get _notes() { return ANNO[this.planet_id] || 0; },
    };
  });
}

function regimes() { return [...new Set(ROWS.map(r => r.regime_class).filter(Boolean))].sort(); }

function filtered() {
  const q = (document.getElementById("xt-q").value || "").trim().toLowerCase();
  const reg = document.getElementById("xt-regime").value;
  const hz = document.getElementById("xt-hz").value;
  let rows = ROWS.filter(r =>
    (!q || (r.name || r.planet_id).toLowerCase().includes(q) || (r.host_star_id || "").toLowerCase().includes(q)) &&
    (!reg || r.regime_class === reg) &&
    (!hz || r.hz_position === hz));
  const col = COLS.find(c => c.key === sort.key);
  rows.sort((a, b) => {
    let va = a[sort.key], vb = b[sort.key];
    if (col.type === "n") { va = (va == null || !isFinite(va)) ? -Infinity : va; vb = (vb == null || !isFinite(vb)) ? -Infinity : vb; return (va - vb) * sort.dir; }
    return String(va ?? "").localeCompare(String(vb ?? "")) * sort.dir;
  });
  return rows;
}

function fmtCell(v, derived) {
  if (v == null || !isFinite(v)) return "—";
  const a = Math.abs(v);
  const t = a >= 1000 ? Math.round(v).toLocaleString() : a >= 100 ? v.toFixed(1) : a >= 10 ? v.toFixed(2) : v.toFixed(3);
  return derived ? `<span class="derived" title="derived">≈${t}</span>` : t;
}

function render() {
  const rows = filtered();
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  if (page >= pages) page = pages - 1;
  const slice = rows.slice(page * PAGE, page * PAGE + PAGE);
  document.getElementById("xt-count").textContent = `${rows.length.toLocaleString()} planets`;

  const head = COLS.map(c => `<th data-key="${c.key}" class="${sort.key === c.key ? "sorted " + (sort.dir === 1 ? "asc" : "") : ""}">${esc(c.label)}</th>`).join("");
  const body = slice.map(r => {
    const conf = r._conf ? dbConfBadge(r._conf).replace("an-cbadge", "xt-cbadge") : `<span class="xt-cat">catalog</span>`;
    const nc = r._notes;
    const note = `<span class="xt-note${nc ? " has" : ""}" data-id="${esc(r.planet_id)}">${nc ? "📝 " + nc : "＋ note"}</span>`;
    return `<tr>
      <td class="nm">${esc(r.name || r.planet_id)}</td>
      <td>${esc(r.host_star_id || "—")}</td>
      <td>${esc(r.regime_class || "—")}</td>
      <td class="num">${fmtCell(r.radius_rearth)}</td>
      <td class="num">${fmtCell(r.mass_mearth)}</td>
      <td class="num">${fmtCell(r.equilibrium_temp_k)}</td>
      <td class="num">${fmtCell(r._H, true)}</td>
      <td class="num">${fmtCell(r._tsm, true)}</td>
      <td>${conf}</td>
      <td>${note}</td>
    </tr>`;
  }).join("");

  document.getElementById("xt-table").innerHTML = `<thead><tr>${head}</tr></thead><tbody>${body}</tbody>`;
  document.getElementById("xt-pageinfo").textContent = `Page ${page + 1} / ${pages}`;
  document.getElementById("xt-prev").disabled = page === 0;
  document.getElementById("xt-next").disabled = page >= pages - 1;
}

function openNote(id) {
  const r = ROWS.find(x => x.planet_id === id); if (!r) return;
  fetchAnnotations(id).then(({ byParam }) => {
    openAnnotationEditor({
      entityId: id, parameter: "", label: `${r.name || id} — planet note`,
      existing: byParam[""],
      onSaved: (saved) => { ANNO[id] = saved ? Math.max(1, ANNO[id] || 0) : Math.max(0, (ANNO[id] || 1) - 1); render(); }
    });
  });
}

function ui(user) {
  mount(renderHeader("table.html", user) + `<div class="xt-wrap">
    <div class="xt-bar">
      <input id="xt-q" class="search" type="search" placeholder="Search planet or star…" autocomplete="off">
      <select id="xt-regime"><option value="">All regimes</option></select>
      <select id="xt-hz">
        <option value="">Any HZ</option>
        <option value="habitable">Habitable</option>
        <option value="inner_edge">Inner edge</option>
        <option value="outer_edge">Outer edge</option>
        <option value="not_in_hz">Not in HZ</option>
      </select>
      <span class="xt-count" id="xt-count">—</span>
    </div>
    <table class="xt" id="xt-table"></table>
    <div class="xt-page">
      <button id="xt-prev">‹ Prev</button>
      <span id="xt-pageinfo" class="muted"></span>
      <button id="xt-next">Next ›</button>
    </div>
  </div>` + renderFooter());
  wireSignOut();

  document.getElementById("xt-regime").innerHTML =
    `<option value="">All regimes</option>` + regimes().map(r => `<option value="${esc(r)}">${esc(r)}</option>`).join("");

  const reflow = () => { page = 0; render(); };
  document.getElementById("xt-q").addEventListener("input", reflow);
  document.getElementById("xt-regime").addEventListener("change", reflow);
  document.getElementById("xt-hz").addEventListener("change", reflow);
  document.getElementById("xt-prev").addEventListener("click", () => { if (page > 0) { page--; render(); } });
  document.getElementById("xt-next").addEventListener("click", () => { page++; render(); });
  document.getElementById("xt-table").addEventListener("click", e => {
    const th = e.target.closest("th[data-key]");
    if (th) { const k = th.dataset.key; if (sort.key === k) sort.dir *= -1; else sort = { key: k, dir: 1 }; render(); return; }
    const n = e.target.closest(".xt-note"); if (n) openNote(n.dataset.id);
  });
  render();
}

window.kbAuth.requireOwner({
  onReady: async (user) => {
    try { await load(); ui(user); }
    catch (err) { mount(renderHeader("table.html", user) + `<main>${errorNotice(err)}</main>` + renderFooter()); wireSignOut(); }
  }
});
