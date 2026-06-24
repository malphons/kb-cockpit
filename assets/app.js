// ---------------------------------------------------------------------------
// kb-cockpit — app.js
// Shared helpers + authenticated Supabase REST/RPC/Edge-Function clients.
// Loaded AFTER auth.js (uses window.kbAuth for the user JWT). No build step.
// ---------------------------------------------------------------------------
const KB = window.KB_CONFIG || {};

// ---- formatting / DOM ----
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function fmt(v) {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : (+v.toFixed(4)).toString();
  return String(v);
}
function qs(name) { return new URLSearchParams(location.search).get(name); }
function mount(html) { document.getElementById("app").innerHTML = html; }
function timeAgo(iso) {
  if (!iso) return "—";
  const d = Date.parse(iso);
  if (!d) return "—";
  const s = Math.max(0, (Date.now() - d) / 1000);
  const mins = s / 60, hrs = mins / 60, days = hrs / 24;
  if (days >= 1) return `${Math.round(days)}d ago`;
  if (hrs >= 1) return `${Math.round(hrs)}h ago`;
  if (mins >= 1) return `${Math.round(mins)}m ago`;
  return "just now";
}

// GitHub blob/tree URL into the (private) KB repo. path is bucket-relative.
function repoUrl(path, kind) {
  if (!KB.repoBaseUrl) return "";
  const root = KB.repoBaseUrl.replace(/\/?$/, "");
  const rel = (KB.bucketPrefix || "") + String(path || "").replace(/^\//, "");
  return `${root}/${kind || "blob"}/${KB.repoBranch || "main"}/${rel}`;
}

// ---- authenticated Supabase clients ----
// REST query/mutation with the user JWT (falls back to anon key when signed out,
// which by RLS returns nothing private).
async function kbFetch(path, opts = {}) {
  const token = (await window.kbAuth.getAccessToken()) || KB.anonKey;
  const headers = {
    apikey: KB.anonKey,
    Authorization: `Bearer ${token}`,
    ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
    ...(opts.prefer ? { Prefer: opts.prefer } : {}),
    ...(opts.headers || {})
  };
  const res = await fetch(`${KB.url}/rest/v1/${path}`, {
    method: opts.method || "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Supabase ${res.status} ${res.statusText} — ${t.slice(0, 240)}`);
  }
  if (res.status === 204) return null;
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

// Fetch ALL rows of a REST query, paging past PostgREST's 1000-row cap. Pass a
// stable &order=<unique col> so paging can't skip/duplicate rows.
async function kbFetchAll(path, pageSize = 1000) {
  const sep = path.includes("?") ? "&" : "?";
  let offset = 0, out = [];
  for (;;) {
    const rows = (await kbFetch(`${path}${sep}limit=${pageSize}&offset=${offset}`)) || [];
    out = out.concat(rows);
    if (rows.length < pageSize) return out;
    offset += pageSize;
  }
}

// Call a Postgres function (RPC) with the user JWT.
async function kbRpc(fn, args) {
  const token = (await window.kbAuth.getAccessToken()) || KB.anonKey;
  const res = await fetch(`${KB.url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: KB.anonKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(args || {})
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`RPC ${fn} ${res.status} — ${t.slice(0, 240)}`);
  }
  return res.json();
}

// Call the kb-chat Edge Function with the user JWT. Returns { answer, citations, model }.
async function kbChat(question, model, threadId) {
  const token = await window.kbAuth.getAccessToken();
  const res = await fetch(`${KB.functionsUrl}/kb-chat`, {
    method: "POST",
    headers: { apikey: KB.anonKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ question, model, thread_id: threadId })
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`kb-chat ${res.status} — ${t.slice(0, 300)}`);
  }
  return res.json();
}

// ---- chrome ----
function renderHeader(active, user) {
  const link = (href, label) =>
    `<a href="${href}"${active === href ? ' style="text-decoration:underline"' : ""}>${label}</a>`;
  const who = user ? `<span class="who">${esc(user.email || user.id || "owner")}</span>` : "";
  return `<header class="site">
    <h1><a href="index.html" style="color:inherit">kb&#8209;cockpit</a></h1>
    <span class="sub">PhD_Exoplanets knowledge base</span>
    <nav>
      ${link("navigator.html", "Navigator")}
      ${link("showcase.html", "Showcase")}
      ${link("table.html", "Table")}
      ${link("chat.html", "Chat")}
      ${link("bibliography.html", "Bibliography")}
      ${link("notes.html", "Notes")}
      ${who}
      <button id="kb-signout-btn">Sign out</button>
    </nav>
  </header>`;
}
function wireSignOut() {
  const b = document.getElementById("kb-signout-btn");
  if (b) b.addEventListener("click", () => window.kbAuth.signOut());
}
function renderFooter() {
  return `<footer class="site">
    Private cockpit · access enforced by Supabase Auth + owner row-level security ·
    KB mirrored into Supabase (re-run <code>sync_kb.py</code> to refresh).
  </footer>`;
}
function errorNotice(err) {
  return `<div class="notice"><strong>Something went wrong.</strong><br>${esc(err.message || String(err))}</div>`;
}
