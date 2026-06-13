// ---------------------------------------------------------------------------
// kb-cockpit — runtime config (committed; served to the browser).
//
// The anon/publishable key is DESIGNED to ship in client code — it only grants
// what the Supabase row-level-security policies allow. The PRIVATE tables
// (kb_pages, xo_ref_notes, kb_chat_log) require an authenticated owner session,
// so the anon key alone reads nothing private. NEVER put the service_role key
// or the Anthropic key here — the Anthropic key lives only in the kb-chat Edge
// Function secret; the service_role key lives only in the local sync .env.
//
// The "lock" is Supabase Auth (GitHub OAuth) + owner row-level security, NOT
// GitHub Pages (which is always public). This file contains no secrets.
// ---------------------------------------------------------------------------
window.KB_CONFIG = {
  // Supabase project ref vthwfufbcntvrjijhckj
  url: "https://vthwfufbcntvrjijhckj.supabase.co",

  // anon / publishable key (public-read safe; same project as xoplanet-explorer)
  anonKey: "sb_publishable_OrTzc3xGb8kIw3mHBHf-Ng_KhpUcPe_",

  // Edge Functions base (kb-chat lives here)
  functionsUrl: "https://vthwfufbcntvrjijhckj.supabase.co/functions/v1",

  // RAG chat model selector (default first). Validated server-side too.
  chatModelDefault: "claude-sonnet-4-6",
  chatModels: ["claude-sonnet-4-6", "claude-opus-4-8", "claude-haiku-4-5"],

  // Private KB repo, for "open on GitHub" links (self-securing: 404 for non-collaborators).
  repoBaseUrl: "https://github.com/malphons/PhD_Exoplanets",
  repoBranch: "main",

  // kb_pages.path is relative to the exoplanets bucket; prepend this for GitHub links.
  bucketPrefix: "exoplanets/"
};
