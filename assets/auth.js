// ---------------------------------------------------------------------------
// kb-cockpit — auth.js
// Supabase Auth (GitHub OAuth) client + owner gate. Loaded BEFORE app.js.
// Exposes window.kbAuth. The "lock" is enforced server-side by row-level
// security keyed on kb_allowed_users; this module also provides a clean UX gate.
// ---------------------------------------------------------------------------
(function () {
  const CFG = window.KB_CONFIG || {};
  // The vendored UMD bundle exposes the library as the global `supabase`.
  const sb = window.supabase.createClient(CFG.url, CFG.anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: "pkce"
    }
  });

  async function getSession() {
    const { data } = await sb.auth.getSession();
    return data.session || null;
  }
  async function getAccessToken() {
    const s = await getSession();
    return s ? s.access_token : null;
  }
  async function getUser() {
    const s = await getSession();
    return s ? s.user : null;
  }

  function signInWithGitHub() {
    // Return to the page that initiated sign-in (origin + path, no query/hash).
    const redirectTo = location.origin + location.pathname;
    return sb.auth.signInWithOAuth({ provider: "github", options: { redirectTo } });
  }
  async function signOut() {
    await sb.auth.signOut();
    location.href = "index.html";
  }

  // Ownership is authoritative server-side: kb_allowed_users RLS only returns
  // YOUR row. If the select returns a row, you're the owner.
  async function isOwner() {
    const token = await getAccessToken();
    if (!token) return false;
    try {
      const res = await fetch(
        `${CFG.url}/rest/v1/kb_allowed_users?select=user_id&limit=1`,
        { headers: { apikey: CFG.anonKey, Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) return false;
      const rows = await res.json();
      return Array.isArray(rows) && rows.length > 0;
    } catch (_) {
      return false;
    }
  }

  // Orchestrates the gate. Callbacks: onReady(user), onSignedOut(), onDenied(user).
  // If the host page omits a callback, sensible default UI is rendered into #app.
  async function requireOwner(cb = {}) {
    const session = await getSession();
    if (!session) {
      (cb.onSignedOut || defaultGate)();
      return false;
    }
    const owner = await isOwner();
    if (!owner) {
      (cb.onDenied || defaultDenied)(session.user);
      return false;
    }
    if (cb.onReady) cb.onReady(session.user);
    return true;
  }

  function defaultGate() {
    const el = document.getElementById("app");
    if (!el) return;
    el.innerHTML = `
      <div class="gate">
        <h1>kb-cockpit</h1>
        <p>Private cockpit over the PhD_Exoplanets knowledge base.</p>
        <button class="primary gh" id="kb-signin">Sign in with GitHub</button>
        <div class="lock-note">
          Access is enforced by Supabase Auth + owner row-level security.<br>
          This page is public by design and contains no secrets or private content.
        </div>
      </div>`;
    const b = document.getElementById("kb-signin");
    if (b) b.addEventListener("click", () => signInWithGitHub());
  }

  function defaultDenied(user) {
    const el = document.getElementById("app");
    if (!el) return;
    const who = user && user.email ? user.email : (user && user.id) || "this account";
    el.innerHTML = `
      <div class="gate denied">
        <h1>Access denied</h1>
        <p>${who} is signed in but is not the owner of this knowledge base.</p>
        <button class="gh" id="kb-signout">Sign out</button>
      </div>`;
    const b = document.getElementById("kb-signout");
    if (b) b.addEventListener("click", () => signOut());
  }

  window.kbAuth = { sb, getSession, getAccessToken, getUser, signInWithGitHub, signOut, isOwner, requireOwner };
})();
