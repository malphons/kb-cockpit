// ---------------------------------------------------------------------------
// kb-cockpit — annotations.js  (ES module, shared by showcase + table)
// Owner-scoped annotations on exoplanet info: a note + links (to wiki notes,
// bibliography refs, or any URL) + a personal confidence rating, attached either
// to a whole planet (parameter "") or to one value (parameter e.g. "scale_height").
// Also renders the DB provenance-confidence badge from xo_canonical_facts.
// Relies on globals kbFetch / esc (from app.js, loaded before any module).
// ---------------------------------------------------------------------------

// ---- confidence palettes ----------------------------------------------------
export const USER_CONF = {
  high:   { label: "High",   color: "#3aa86b" },
  medium: { label: "Medium", color: "#c79a3a" },
  low:    { label: "Low",    color: "#b04a4a" },
};
// DB confidence_class (xo_facts) → colour + short label
const DB_CONF = {
  canonical:           { label: "canonical",   color: "#3aa86b" },
  "well-established":   { label: "established", color: "#6cb6ff" },
  supported:           { label: "supported",   color: "#c79a3a" },
  provisional:         { label: "provisional", color: "#8b98a9" },
};

export function userConfDot(level) {
  const c = USER_CONF[level];
  return c ? `<span class="an-dot" title="Your confidence: ${c.label}" style="background:${c.color}"></span>` : "";
}
export function dbConfBadge(cls) {
  const c = DB_CONF[cls];
  if (!c) return "";
  return `<span class="an-cbadge" title="DB provenance confidence: ${c.label}" style="border-color:${c.color};color:${c.color}">${c.label}</span>`;
}

// ---- data -------------------------------------------------------------------
export async function fetchAnnotations(entityId, entityType = "planet") {
  const rows = await kbFetch(
    `xo_annotations?entity_type=eq.${encodeURIComponent(entityType)}&entity_id=eq.${encodeURIComponent(entityId)}&select=*`);
  const list = rows || [];
  const byParam = {};
  list.forEach(a => { byParam[a.parameter || ""] = a; });
  return { list, byParam };
}

// All annotation rows for the owner (id+param) — for note indicators on the table.
export async function fetchAnnotationIndex() {
  const rows = await kbFetch("xo_annotations?select=entity_id,parameter") || [];
  const count = {};
  rows.forEach(r => { count[r.entity_id] = (count[r.entity_id] || 0) + 1; });
  return count;
}

// DB provenance confidence per parameter for a planet (sparse — curated systems).
export async function fetchDbConfidence(entityId, entityType = "planet") {
  const rows = await kbFetch(
    `xo_canonical_facts?entity_type=eq.${encodeURIComponent(entityType)}&entity_id=eq.${encodeURIComponent(entityId)}&select=parameter,confidence_class,confidence_score`) || [];
  const m = {};
  rows.forEach(r => { m[r.parameter] = r; });
  return m;
}

export async function saveAnnotation(a) {
  const body = {
    entity_type: a.entity_type || "planet", entity_id: a.entity_id,
    parameter: a.parameter || "", body: a.body || null,
    links: a.links || [], confidence: a.confidence || null, color: a.color || null,
  };
  if (a.annotation_id) {
    const rows = await kbFetch(`xo_annotations?annotation_id=eq.${a.annotation_id}`,
      { method: "PATCH", prefer: "return=representation", body });
    return rows && rows[0];
  }
  const rows = await kbFetch("xo_annotations", { method: "POST", prefer: "return=representation", body });
  return rows && rows[0];
}
export async function deleteAnnotation(id) {
  await kbFetch(`xo_annotations?annotation_id=eq.${id}`, { method: "DELETE", prefer: "return=minimal" });
}

// ---- link rendering ---------------------------------------------------------
export function renderLinks(links) {
  if (!links || !links.length) return "";
  return `<span class="an-links">` + links.map(l => {
    const label = esc(l.label || l.ref || l.url || "link");
    let href = "#", icon = "🔗";
    if (l.kind === "wiki") { href = `navigator.html?path=${encodeURIComponent(l.ref)}`; icon = "📝"; }
    else if (l.kind === "ref") { href = `bibliography.html?ref=${encodeURIComponent(l.ref)}`; icon = "📚"; }
    else { href = l.ref || l.url || "#"; icon = "🔗"; }
    const ext = l.kind === "url" ? ` target="_blank" rel="noopener"` : "";
    return `<a class="an-link" href="${esc(href)}"${ext}>${icon} ${label}</a>`;
  }).join("") + `</span>`;
}

// ---- pickers (wiki pages + bib refs), fetched lazily & cached ---------------
let _pages = null, _refs = null;
async function pages() { if (!_pages) _pages = kbFetch("kb_pages?select=path,title&order=path").then(r => r || []).catch(() => []); return _pages; }
async function refs() { if (!_refs) _refs = kbFetch("kb_bib?select=citation_key,title&order=citation_key").then(r => r || []).catch(() => []); return _refs; }

// ---- editor modal (single shared instance) ----------------------------------
let modal = null;
function ensureModal() {
  if (modal) return modal;
  injectStyles();
  modal = document.createElement("div");
  modal.className = "an-modal hidden";
  modal.innerHTML = `
    <div class="an-card">
      <div class="an-head"><span id="an-title">Annotation</span><button class="an-x" id="an-close">✕</button></div>
      <label class="an-lbl">Your confidence</label>
      <div class="an-conf" id="an-conf">
        <button data-c="" class="active">None</button>
        <button data-c="low">Low</button>
        <button data-c="medium">Medium</button>
        <button data-c="high">High</button>
      </div>
      <label class="an-lbl">Note</label>
      <textarea id="an-body" rows="4" placeholder="Your note about this…"></textarea>
      <label class="an-lbl">Links to notes &amp; articles</label>
      <div id="an-links"></div>
      <button class="an-addlink" id="an-addlink">+ Add link</button>
      <datalist id="an-dl-wiki"></datalist>
      <datalist id="an-dl-ref"></datalist>
      <div class="an-actions">
        <button id="an-del" class="an-danger">Delete</button>
        <span class="an-status" id="an-status"></span>
        <span style="flex:1"></span>
        <button id="an-cancel">Cancel</button>
        <button id="an-save" class="primary">Save</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  modal.addEventListener("click", e => { if (e.target === modal) close(); });
  modal.querySelector("#an-close").onclick = close;
  modal.querySelector("#an-cancel").onclick = close;
  return modal;
}
function close() { if (modal) modal.classList.add("hidden"); }

let chosenConf = "", linkRows = [];
function renderLinkRows() {
  const wrap = modal.querySelector("#an-links");
  wrap.innerHTML = linkRows.map((l, i) => `
    <div class="an-lrow" data-i="${i}">
      <select class="an-kind">
        <option value="url"${l.kind === "url" ? " selected" : ""}>URL</option>
        <option value="wiki"${l.kind === "wiki" ? " selected" : ""}>Wiki note</option>
        <option value="ref"${l.kind === "ref" ? " selected" : ""}>Reference</option>
      </select>
      <input class="an-ref" list="${l.kind === "wiki" ? "an-dl-wiki" : l.kind === "ref" ? "an-dl-ref" : ""}"
        placeholder="${l.kind === "url" ? "https://…" : l.kind === "wiki" ? "wiki page path" : "citation key"}" value="${esc(l.ref || "")}">
      <input class="an-llabel" placeholder="label (optional)" value="${esc(l.label || "")}">
      <button class="an-lx" title="remove">✕</button>
    </div>`).join("");
  wrap.querySelectorAll(".an-lrow").forEach(rowEl => {
    const i = +rowEl.dataset.i;
    rowEl.querySelector(".an-kind").onchange = e => { linkRows[i].kind = e.target.value; renderLinkRows(); };
    rowEl.querySelector(".an-ref").oninput = e => { linkRows[i].ref = e.target.value; };
    rowEl.querySelector(".an-llabel").oninput = e => { linkRows[i].label = e.target.value; };
    rowEl.querySelector(".an-lx").onclick = () => { linkRows.splice(i, 1); renderLinkRows(); };
  });
}

export async function openAnnotationEditor({ entityId, entityType = "planet", parameter = "", label, existing, onSaved }) {
  ensureModal();
  modal.querySelector("#an-title").textContent = label || (parameter ? parameter : "Planet note");
  modal.querySelector("#an-body").value = existing?.body || "";
  chosenConf = existing?.confidence || "";
  linkRows = (existing?.links || []).map(l => ({ kind: l.kind || "url", ref: l.ref || l.url || "", label: l.label || "" }));
  renderLinkRows();
  modal.querySelectorAll("#an-conf button").forEach(b => b.classList.toggle("active", (b.dataset.c || "") === chosenConf));
  modal.querySelector("#an-del").style.display = existing ? "" : "none";
  modal.querySelector("#an-status").textContent = "";

  // populate pickers
  pages().then(ps => { modal.querySelector("#an-dl-wiki").innerHTML = ps.map(p => `<option value="${esc(p.path)}">${esc(p.title || p.path)}</option>`).join(""); });
  refs().then(rs => { modal.querySelector("#an-dl-ref").innerHTML = rs.map(r => `<option value="${esc(r.citation_key)}">${esc(r.title || r.citation_key)}</option>`).join(""); });

  modal.querySelectorAll("#an-conf button").forEach(b => b.onclick = () => {
    chosenConf = b.dataset.c || "";
    modal.querySelectorAll("#an-conf button").forEach(x => x.classList.toggle("active", x === b));
  });
  modal.querySelector("#an-addlink").onclick = () => { linkRows.push({ kind: "url", ref: "", label: "" }); renderLinkRows(); };

  modal.querySelector("#an-save").onclick = async () => {
    const st = modal.querySelector("#an-status"); st.textContent = "Saving…";
    try {
      const saved = await saveAnnotation({
        annotation_id: existing?.annotation_id, entity_type: entityType, entity_id: entityId, parameter,
        body: modal.querySelector("#an-body").value,
        links: linkRows.filter(l => (l.ref || "").trim()).map(l => ({ kind: l.kind, ref: l.ref.trim(), label: (l.label || "").trim() })),
        confidence: chosenConf || null,
      });
      close(); onSaved && onSaved(saved);
    } catch (e) { st.textContent = e.message; }
  };
  modal.querySelector("#an-del").onclick = async () => {
    if (!existing) return;
    try { await deleteAnnotation(existing.annotation_id); close(); onSaved && onSaved(null); }
    catch (e) { modal.querySelector("#an-status").textContent = e.message; }
  };
  modal.classList.remove("hidden");
  modal.querySelector("#an-body").focus();
}

// ---- styles (injected once) -------------------------------------------------
function injectStyles() {
  if (document.getElementById("an-styles")) return;
  const s = document.createElement("style");
  s.id = "an-styles";
  s.textContent = `
  .an-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-left:6px;vertical-align:middle}
  .an-cbadge{display:inline-block;border:1px solid;border-radius:999px;padding:0 7px;font-size:10px;margin-left:6px;vertical-align:middle}
  .an-links{display:inline-flex;gap:6px;flex-wrap:wrap;margin-left:4px}
  .an-link{font-size:11.5px;border:1px solid var(--line);border-radius:999px;padding:1px 8px}
  .an-tag-btn{cursor:pointer;opacity:.55;margin-left:6px;font-size:11px}
  .an-tag-btn:hover{opacity:1}
  .an-modal{position:fixed;inset:0;z-index:200;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center}
  .an-modal.hidden{display:none}
  .an-card{background:var(--panel);border:1px solid var(--line);border-radius:12px;width:min(560px,92vw);max-height:88vh;overflow:auto;padding:16px 18px}
  .an-head{display:flex;align-items:center;margin:0 0 10px}
  .an-head span{font-weight:600}
  .an-x{margin-left:auto;background:none;border:0;color:var(--muted);font-size:16px;cursor:pointer}
  .an-lbl{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);margin:12px 0 5px}
  .an-conf{display:flex;gap:6px}
  .an-conf button{flex:1;padding:6px;font-size:12.5px}
  .an-conf button.active{background:var(--accent);color:#06131f;border-color:var(--accent);font-weight:600}
  .an-lrow{display:flex;gap:6px;margin-bottom:6px}
  .an-lrow .an-kind{width:96px;flex:none}
  .an-lrow .an-ref{flex:1}
  .an-lrow .an-llabel{width:120px;flex:none}
  .an-lrow .an-lx{flex:none;padding:6px 10px}
  .an-addlink{background:none;border:1px dashed var(--line);color:var(--accent);width:100%;padding:7px;border-radius:8px}
  .an-actions{display:flex;align-items:center;gap:10px;margin-top:14px}
  .an-danger{border-color:var(--bad);color:#e08a8a}
  .an-status{font-size:12px;color:var(--muted)}`;
  document.head.appendChild(s);
}
