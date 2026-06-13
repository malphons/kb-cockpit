// ---------------------------------------------------------------------------
// kb-cockpit — md.js
// Markdown rendering with [[wikilink]] resolution + a small ego-graph SVG.
// Depends on the vendored marked global. Content is the owner's own KB rendered
// for the owner only (trusted), so no extra sanitization layer in v1.
// ---------------------------------------------------------------------------

// stem (lowercase, no extension, last path segment) -> bucket-relative path
function buildStemMap(pages) {
  const m = {};
  for (const p of pages) {
    if (!m[p.stem]) m[p.stem] = p.path;
  }
  return m;
}

function normStem(target) {
  return String(target).trim().toLowerCase().replace(/\.md$/, "").split("/").pop();
}

function stripFrontmatter(body) {
  // Defensive: sync stores body without frontmatter, but strip a leading block if present.
  return body.replace(/^\s*---\n[\s\S]*?\n---\s*\n?/, "");
}

// Render markdown to HTML, rewriting [[stem]] / [[stem|label]] to navigator links.
function renderMarkdown(body, stemToPath) {
  const src = stripFrontmatter(body || "");
  const withLinks = src.replace(
    /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g,
    (m, target, label) => {
      const stem = normStem(target);
      const text = (label || target).trim();
      const path = stemToPath[stem];
      if (path) return `[${text}](navigator.html?path=${encodeURIComponent(path)})`;
      return `<span class="wikilink-missing" title="unresolved: ${stem}">${text}</span>`;
    }
  );
  if (window.marked && typeof window.marked.parse === "function") {
    window.marked.setOptions({ gfm: true, breaks: false });
    return window.marked.parse(withLinks);
  }
  return "<pre>" + withLinks.replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])) + "</pre>";
}

// Ego-graph: center page + its 1-hop neighbors (out = wikilinks, in = backlinks).
// neighbors: [{ path, title, dir: 'out'|'in'|'both' }]
function buildGraph(center, neighbors) {
  const W = 280, H = 250, cx = W / 2, cy = H / 2, R = 96;
  const trunc = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + "…" : (s || ""));
  const enc = p => `navigator.html?path=${encodeURIComponent(p)}`;
  const n = neighbors.length || 1;
  const nodes = neighbors.map((nb, i) => {
    const a = (2 * Math.PI * i) / n - Math.PI / 2;
    return { ...nb, x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) };
  });
  const edges = nodes.map(nd =>
    `<line class="edge" x1="${cx}" y1="${cy}" x2="${nd.x.toFixed(1)}" y2="${nd.y.toFixed(1)}"/>`
  ).join("");
  const color = dir => dir === "in" ? "var(--t-question)" : dir === "both" ? "var(--accent-2)" : "var(--t-concept)";
  const ring = nodes.map(nd => `
    <a href="${enc(nd.path)}" class="node">
      <circle cx="${nd.x.toFixed(1)}" cy="${nd.y.toFixed(1)}" r="5" fill="${color(nd.dir)}"/>
      <text x="${nd.x.toFixed(1)}" y="${(nd.y - 8).toFixed(1)}" text-anchor="middle">${(trunc(nd.title || nd.path, 16)).replace(/[<>&]/g, "")}</text>
    </a>`).join("");
  const centerNode = `
    <circle cx="${cx}" cy="${cy}" r="7" fill="var(--accent)"/>
    <text x="${cx}" y="${cy - 11}" text-anchor="middle" style="font-weight:600">${(trunc(center.title || center.path, 18)).replace(/[<>&]/g, "")}</text>`;
  return `<div class="graph"><svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">${edges}${ring}${centerNode}</svg></div>`;
}
